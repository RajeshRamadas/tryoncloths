import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encrypt, decrypt } from "./secrets.js";
import { integrationFetch } from "./integration-http.js";
import { parseProductUrl } from "./public-url.js";
import {
  shopDomain,
  shopifyError as fail,
  verifyShopifyQuery,
  verifyShopifyWebhook,
} from "./shopify-security.js";
import { ShopperState } from "./shopper-state.js";
import { shopperReadiness } from "./shopper-readiness.js";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const publicOrigin = (raw) => {
  try {
    const u = parseProductUrl(raw);
    if (u.protocol !== "https:" || u.port || u.pathname !== "/" || u.search) throw new Error();
    return u.origin;
  } catch {
    throw fail("Configure TRYON_PUBLIC_URL as the public HTTPS studio origin.", 503);
  }
};
const cleanHost = (raw) => {
  const u = parseProductUrl("https://" + raw);
  if (u.hostname !== raw || u.port || u.pathname !== "/" || u.search)
    throw fail("Shopify returned an invalid storefront domain.", 502);
  return raw;
};
const fields = [
  "id",
  "shop",
  "shopId",
  "primaryHost",
  "status",
  "enabled",
  "revision",
  "connectedAt",
];

export function installShopifyShopperSchema(store) {
  store.billing.transaction(() =>
    store.db.exec(`
  CREATE TABLE IF NOT EXISTS shopper_shopify_installations(
    id TEXT PRIMARY KEY,store TEXT NOT NULL UNIQUE REFERENCES stores(id),shop TEXT NOT NULL,shopId TEXT NOT NULL,primaryHost TEXT NOT NULL,
    credentials TEXT,status TEXT NOT NULL CHECK(status IN ('installed','disconnected','uninstalled')),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    revision TEXT NOT NULL,webhookEpoch TEXT NOT NULL,connectedAt INTEGER NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS shopper_shopify_shop ON shopper_shopify_installations(shop) WHERE status='installed';
  CREATE TABLE IF NOT EXISTS shopper_shopify_products(
    installation TEXT NOT NULL REFERENCES shopper_shopify_installations(id) ON DELETE CASCADE,garment TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),PRIMARY KEY(installation,garment));
  CREATE TABLE IF NOT EXISTS shopper_shopify_webhooks(
    installation TEXT NOT NULL,epoch TEXT NOT NULL,topic TEXT NOT NULL,bodyHash TEXT NOT NULL,receivedAt INTEGER NOT NULL,
    PRIMARY KEY(installation,epoch,topic,bodyHash));
`),
  );
}

export class ShopifyShopper {
  constructor(
    store,
    {
      clientId = process.env.SHOPIFY_APP_CLIENT_ID,
      clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET,
      secretKey = process.env.TRYON_SECRET_KEY,
      publicUrl = process.env.TRYON_PUBLIC_URL,
      stateDirectory = process.env.TRYON_SHOPPER_STATE_DIR,
      state,
      fetchImpl = integrationFetch,
      version = process.env.SHOPIFY_API_VERSION || "2026-10",
      now = Date.now,
    } = {},
  ) {
    this.store = store;
    this.db = store.db;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.key = secretKey;
    this.publicUrl = publicUrl;
    this.fetch = fetchImpl;
    this.version = version;
    this.now = now;
    this.state = state;
    if (!state && stateDirectory)
      try {
        this.state = new ShopperState({ directory: stateDirectory, now });
      } catch {
        this.stateError = true;
      }
  }
  ready() {
    if (
      !/^[a-zA-Z0-9_-]{8,128}$/.test(this.clientId || "") ||
      typeof this.clientSecret !== "string" ||
      this.clientSecret.length < 16 ||
      this.clientSecret.length > 256
    )
      throw fail(
        "Configure SHOPIFY_APP_CLIENT_ID and SHOPIFY_APP_CLIENT_SECRET on the server.",
        503,
      );
    if (!/^[a-f0-9]{64}$/i.test(this.key || ""))
      throw fail("Configure the persistent TRYON_SECRET_KEY on the server.", 503);
    if (!/^20\d{2}-(01|04|07|10)$/.test(this.version))
      throw fail("Configure a quarterly SHOPIFY_API_VERSION.", 503);
    const origin = publicOrigin(this.publicUrl);
    if (!this.state || this.stateError)
      throw fail(
        "Configure TRYON_SHOPPER_STATE_DIR as a writable tmpfs directory for private launch state.",
        503,
      );
    return origin;
  }
  actor(account, owner = false) {
    this.store.shoppers.actor(account, owner);
    return this.store.identity(account.user.id, account.id);
  }
  row(store) {
    return this.db.prepare("SELECT * FROM shopper_shopify_installations WHERE store=?").get(store);
  }
  summary(account) {
    const actor = this.actor(account);
    let available = true,
      setupMessage = "";
    try {
      this.ready();
    } catch (e) {
      available = false;
      setupMessage = e.message;
    }
    const row = this.row(account.id),
      installation = row
        ? Object.fromEntries(fields.map((k) => [k, k === "enabled" ? Boolean(row[k]) : row[k]]))
        : null;
    if (installation?.status === "installed" && !row.credentials)
      installation.status = "reconnect_required";
    const generation = Boolean(this.workflow?.metadata());
    return {
      available,
      setupMessage,
      canEdit: actor.user.role === "owner",
      installation,
      shopperGenerationAvailable: generation,
      stage: generation ? "hosted-workflow" : "launch-preview",
      products: row ? this.products(row) : [],
      productsTotal: row ? this.productCount(row) : 0,
      readiness: shopperReadiness(this, account),
    };
  }
  productCount(row) {
    if (
      row.status !== "installed" ||
      this.db
        .prepare(
          "SELECT baseUrl FROM catalogue_source_origins WHERE store=? AND provider='shopify'",
        )
        .get(row.store)?.baseUrl !==
        "https://" + row.shop
    )
      return 0;
    return this.db
      .prepare(
        "SELECT count(*) n FROM garments WHERE account=? AND category='garment' AND source='shopify' AND externalId LIKE 'gid://shopify/Product/%'",
      )
      .get(row.store).n;
  }
  products(row, { garmentId, externalId, search = "", offset = 0 } = {}) {
    if (row.status !== "installed") return [];
    const source = this.db
      .prepare("SELECT baseUrl FROM catalogue_source_origins WHERE store=? AND provider='shopify'")
      .get(row.store);
    if (source?.baseUrl !== "https://" + row.shop) return [];
    const extra = garmentId
        ? " AND g.id=?"
        : externalId
          ? " AND g.externalId=?"
          : " AND g.name LIKE ?",
      value = garmentId || externalId || "%" + search + "%";
    return this.db
      .prepare(
        `SELECT g.id,g.name,g.externalId,g.sourceUrl,g.stock,g.needsTypeReview,g.garmentType,coalesce(p.enabled,0) enabled FROM garments g
      LEFT JOIN shopper_shopify_products p ON p.installation=? AND p.garment=g.id WHERE g.account=? AND g.category='garment' AND g.source='shopify'${extra} ORDER BY g.name,g.id LIMIT 50 OFFSET ?`,
      )
      .all(row.id, row.store, value, offset)
      .filter((g) => /^gid:\/\/shopify\/Product\/[1-9]\d{0,19}$/.test(g.externalId || ""))
      .map((g) => ({
        ...g,
        enabled: Boolean(g.enabled),
        eligible: g.stock !== "out" && !g.needsTypeReview,
      }));
  }
  browse(account, query = {}) {
    this.actor(account);
    const row = this.row(account.id),
      offset = Number(query.offset ?? 0),
      search = query.search ?? "";
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 100000 ||
      typeof search !== "string" ||
      search.length > 100 ||
      Object.keys(query).some((k) => !["offset", "search"].includes(k))
    )
      throw fail("Use a product search and nonnegative page offset.");
    return {
      products: row ? this.products(row, { offset, search }) : [],
      offset,
      total: row ? this.productCount(row) : 0,
    };
  }
  pendingActor(state) {
    const account = this.store.identity(state.user, state.store);
    if (
      !account ||
      account.user.role !== "owner" ||
      account.org !== state.org ||
      !this.db
        .prepare("SELECT 1 FROM sessions WHERE token=? AND user=? AND store=? AND expires>?")
        .get(state.staffSession, state.user, state.store, this.now())
    )
      throw fail("The store owner session changed. Sign in and connect Shopify again.", 403);
    this.actor(account, true);
    return account;
  }
  start(account, input, staffSession) {
    const origin = this.ready();
    this.actor(account, true);
    if (!input || Object.keys(input).some((k) => k !== "shopDomain"))
      throw fail("Use only the Shopify shop address.");
    const shop = shopDomain(input.shopDomain),
      other = this.db
        .prepare(
          "SELECT store FROM shopper_shopify_installations WHERE shop=? AND status='installed'",
        )
        .get(shop);
    if (other && other.store !== account.id)
      throw fail("This Shopify shop is already connected to another Forme store.", 409);
    const state = token(),
      browser = token(),
      existing = this.row(account.id),
      pending = {
        shop,
        user: account.user.id,
        store: account.id,
        org: account.org,
        staffSession: digest(staffSession),
        browserHash: digest(browser),
        previousRevision: existing?.revision ?? null,
      };
    this.pendingActor(pending);
    this.state.transaction(() =>
      this.state.put("oauth", digest(state), pending, this.now() + 10 * 60000),
    );
    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      scope: "read_products",
      redirect_uri: origin + "/shopify/callback",
      state,
    }).toString();
    return { authorizationUrl: url.href, browser };
  }
  async request(url, options) {
    let response, data;
    try {
      response = await this.fetch(url, { ...options, maxBytes: 1024 * 1024, timeoutMs: 20000 });
      if (response.status < 200 || response.status >= 300 || response.body.length > 1024 * 1024)
        throw new Error();
      data = JSON.parse(response.body.toString());
    } catch {
      throw fail(
        "Shopify could not confirm the connection. Check app permissions and try a new connection.",
        502,
      );
    }
    if (!data || data.errors)
      throw fail("Shopify rejected the app request. Check app permissions and reconnect.", 502);
    return data;
  }
  async graph(shop, accessToken, query, variables = {}) {
    return (
      await this.request(`https://${shop}/admin/api/${this.version}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query, variables }),
      })
    ).data;
  }
  async shopInfo(shop, accessToken) {
    const data = await this.graph(
      shop,
      accessToken,
      "query { shop { id myshopifyDomain primaryDomain { host url } } }",
    );
    if (
      !/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(data?.shop?.id || "") ||
      data.shop.myshopifyDomain !== shop
    )
      throw fail("Shopify did not confirm this shop identity.", 502);
    const primaryHost = cleanHost(data.shop.primaryDomain?.host),
      primary = new URL(data.shop.primaryDomain.url);
    if (
      primary.protocol !== "https:" ||
      primary.hostname !== primaryHost ||
      primary.port ||
      primary.username ||
      primary.password ||
      primary.pathname !== "/" ||
      primary.search ||
      primary.hash
    )
      throw fail("Shopify did not confirm an HTTPS storefront domain.", 502);
    return { shopId: data.shop.id, primaryHost };
  }
  async cleanSubscriptions(shop, accessToken, assertActive) {
    // This is a dedicated Forme app. Replace only its own four lifecycle topics;
    // leaving old epochs behind would exhaust Shopify's per-topic limits after
    // a few reconnects, including partially completed OAuth installations.
    const topics = new Set([
        "APP_UNINSTALLED",
        "SHOP_UPDATE",
        "PRODUCTS_UPDATE",
        "PRODUCTS_DELETE",
      ]),
      ids = [];
    let after = null;
    const seen = new Set();
    for (let page = 0; page < 20; page++) {
      assertActive();
      const data = await this.graph(
        shop,
        accessToken,
        "query($after:String){ webhookSubscriptions(first:100,after:$after){ nodes { id topic } pageInfo { hasNextPage endCursor } } }",
        { after },
      );
      assertActive();
      const list = data?.webhookSubscriptions;
      if (!Array.isArray(list?.nodes) || typeof list.pageInfo?.hasNextPage !== "boolean")
        throw fail("Shopify subscriptions could not be checked. Reconnect later.", 502);
      for (const item of list.nodes)
        if (topics.has(item.topic)) {
          if (!/^gid:\/\/shopify\/WebhookSubscription\/\d+$/.test(item.id))
            throw fail("Shopify returned an invalid subscription.", 502);
          ids.push(item.id);
        }
      if (!list.pageInfo.hasNextPage) break;
      after = list.pageInfo.endCursor;
      if (!after || seen.has(after) || page === 19)
        throw fail("Shopify subscription paging could not complete.", 502);
      seen.add(after);
    }
    for (const id of ids) {
      assertActive();
      const data = await this.graph(
        shop,
        accessToken,
        "mutation($id:ID!){ webhookSubscriptionDelete(id:$id){ deletedWebhookSubscriptionId userErrors { message } } }",
        { id },
      );
      assertActive();
      if (
        data?.webhookSubscriptionDelete?.deletedWebhookSubscriptionId !== id ||
        data.webhookSubscriptionDelete.userErrors?.length
      )
        throw fail("Old Forme webhooks could not be replaced. Reconnect later.", 502);
    }
  }
  async callback(raw, browser) {
    const origin = this.ready(),
      verified = verifyShopifyQuery(raw, this.clientSecret, { now: this.now() }),
      stateKey = digest(verified.params.get("state"));
    const pending = this.state.transaction(() => {
      const value = this.state.get("oauth", stateKey);
      if (
        !value ||
        value.shop !== verified.shop ||
        !browser ||
        digest(browser) !== value.browserHash
      )
        throw fail("Shopify connection expired or belongs to another browser. Start again.", 403);
      this.pendingActor(value);
      this.state.take("oauth", stateKey);
      return value;
    });
    const lockKey = digest(pending.shop),
      lockOwner = token();
    let installingKey = null;
    this.state.transaction(() => {
      if (this.state.get("install-lock", lockKey))
        throw fail(
          "A Shopify connection for this shop is already in progress. Try again after it finishes.",
          409,
        );
      this.state.put("install-lock", lockKey, { owner: lockOwner }, this.now() + 180000);
    });
    const assertActive = () => {
      this.pendingActor(pending);
      if (this.state.get("install-lock", lockKey)?.owner !== lockOwner)
        throw fail("Shopify connection time limit reached. Start a new connection.", 504);
      if (installingKey && this.state.get("installing", installingKey)?.revoked !== false)
        throw fail("Shopify changed or uninstalled the app during connection. Start again.", 409);
      if ((this.row(pending.store)?.revision ?? null) !== pending.previousRevision)
        throw fail("Shopify connection changed. Start again.", 409);
    };
    try {
      const account = this.pendingActor(pending),
        previous = this.row(account.id);
      if ((previous?.revision ?? null) !== pending.previousRevision)
        throw fail("The Shopify connection changed. Start a new connection.", 409);
      const response = await this.request(`https://${pending.shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: verified.params.get("code"),
        }),
      });
      const accessToken = response.access_token;
      if (
        typeof accessToken !== "string" ||
        !accessToken ||
        accessToken.length > 1500 ||
        /[\x00-\x20\x7f]/.test(accessToken) ||
        typeof response.scope !== "string" ||
        !response.scope.split(",").includes("read_products")
      )
        throw fail("Shopify did not grant product-read access. Start a new connection.", 502);
      assertActive();
      const info = await this.shopInfo(pending.shop, accessToken),
        id = previous?.id ?? randomUUID(),
        epoch = randomUUID();
      assertActive();
      installingKey = digest(id + ":" + epoch);
      this.state.transaction(() =>
        this.state.put(
          "installing",
          installingKey,
          { shop: pending.shop, shopId: info.shopId, revoked: false },
          this.now() + 180000,
        ),
      );
      if (previous)
        this.store.billing.transaction(() => {
          assertActive();
          const revision = randomUUID();
          this.db
            .prepare(
              "UPDATE shopper_shopify_installations SET enabled=0,credentials=NULL,revision=? WHERE id=?",
            )
            .run(revision, id);
          pending.previousRevision = revision;
        });
      await this.cleanSubscriptions(pending.shop, accessToken, assertActive);
      for (const topic of [
        "APP_UNINSTALLED",
        "SHOP_UPDATE",
        "PRODUCTS_UPDATE",
        "PRODUCTS_DELETE",
      ]) {
        assertActive();
        const registered = await this.graph(
          pending.shop,
          accessToken,
          `mutation($topic:WebhookSubscriptionTopic!,$input:WebhookSubscriptionInput!){ webhookSubscriptionCreate(topic:$topic,webhookSubscription:$input){ webhookSubscription { id } userErrors { message } } }`,
          { topic, input: { uri: origin + `/shopify/webhooks/${id}/${epoch}`, format: "JSON" } },
        );
        if (
          !registered?.webhookSubscriptionCreate?.webhookSubscription?.id ||
          registered.webhookSubscriptionCreate.userErrors?.length
        )
          throw fail(
            "Shopify lifecycle webhooks could not be registered. Reconnect before enabling the widget.",
            502,
          );
      }
      this.store.billing.transaction(() => {
        assertActive();
        const other = this.db
          .prepare(
            "SELECT store FROM shopper_shopify_installations WHERE shop=? AND status='installed'",
          )
          .get(pending.shop);
        if (other && other.store !== account.id)
          throw fail("This Shopify shop is connected to another store.", 409);
        this.db
          .prepare(
            `INSERT INTO shopper_shopify_installations VALUES(?,?,?,?,?,?,'installed',0,?,?,?)
        ON CONFLICT(store) DO UPDATE SET shop=excluded.shop,shopId=excluded.shopId,primaryHost=excluded.primaryHost,credentials=excluded.credentials,status='installed',enabled=0,revision=excluded.revision,webhookEpoch=excluded.webhookEpoch,connectedAt=excluded.connectedAt`,
          )
          .run(
            id,
            account.id,
            pending.shop,
            info.shopId,
            info.primaryHost,
            encrypt(accessToken, this.key, id + ":shopify-shopper"),
            randomUUID(),
            epoch,
            this.now(),
          );
        this.db.prepare("DELETE FROM shopper_shopify_products WHERE installation=?").run(id);
      });
      return origin + "/shopify-shopper";
    } finally {
      this.state.transaction(() => {
        if (installingKey) this.state.take("installing", installingKey);
        if (this.state.get("install-lock", lockKey)?.owner === lockOwner)
          this.state.take("install-lock", lockKey);
      });
    }
  }
  update(account, input) {
    return this.store.billing.transaction(() => {
      this.actor(account, true);
      const row = this.row(account.id);
      if (!row || row.status !== "installed") throw fail("Connect Shopify first.", 409);
      if (
        !input ||
        Object.keys(input).some((k) => !["enabled", "revision"].includes(k)) ||
        typeof input.enabled !== "boolean"
      )
        throw fail("Use an enable choice and connection revision.");
      if (input.revision !== row.revision)
        throw fail("Shopify connection changed. Refresh before saving.", 409);
      if (input.enabled) {
        this.ready();
        if (!row.credentials) throw fail("Reconnect Shopify before enabling preview.", 409);
        this.store.shoppers.ensurePolicy(this.store.shoppers.policy(account.id));
      }
      this.db
        .prepare("UPDATE shopper_shopify_installations SET enabled=?,revision=? WHERE store=?")
        .run(Number(input.enabled), randomUUID(), account.id);
      return this.summary(account);
    });
  }
  disconnect(account) {
    return this.store.billing.transaction(() => {
      this.actor(account, true);
      this.db
        .prepare(
          "UPDATE shopper_shopify_installations SET status='disconnected',enabled=0,credentials=NULL,revision=? WHERE store=?",
        )
        .run(randomUUID(), account.id);
      return this.summary(account);
    });
  }
  async setProduct(account, id, input) {
    this.actor(account, true);
    const row = this.row(account.id);
    if (!row || row.status !== "installed") throw fail("Connect Shopify first.", 409);
    if (
      !input ||
      Object.keys(input).some((k) => !["enabled", "revision"].includes(k)) ||
      typeof input.enabled !== "boolean"
    )
      throw fail("Use a product enable choice and connection revision.");
    if (input.revision !== row.revision)
      throw fail("Shopify connection changed. Refresh before editing products.", 409);
    const product = this.products(row, { garmentId: id })[0];
    if (!product)
      throw fail("Sync products from this installed Shopify shop before selecting them.", 404);
    if (input.enabled && !product.eligible)
      throw fail("Confirm the clothing type and stock before enabling this product.", 409);
    if (input.enabled) {
      let accessToken;
      try {
        accessToken = decrypt(row.credentials, this.key, row.id + ":shopify-shopper");
      } catch {
        throw fail("Reconnect Shopify before selecting products.", 503);
      }
      const result = await this.graph(
          row.shop,
          accessToken,
          "query($id:ID!){ product(id:$id){ id status onlineStoreUrl } }",
          { id: product.externalId },
        ),
        published = result?.product;
      if (
        published?.id !== product.externalId ||
        published.status !== "ACTIVE" ||
        !published.onlineStoreUrl
      )
        throw fail(
          "Only active products published to the Shopify online store can be enabled.",
          409,
        );
      const url = parseProductUrl(published.onlineStoreUrl);
      if (
        url.protocol !== "https:" ||
        ![row.shop, row.primaryHost].includes(url.hostname) ||
        url.port ||
        !/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/?$/.test(
          url.pathname,
        ) ||
        new URL(product.sourceUrl).pathname.replace(/\/$/, "") !== url.pathname.replace(/\/$/, "")
      )
        throw fail("Sync this product’s published Shopify page before enabling it.", 409);
    }
    return this.store.billing.transaction(() => {
      this.actor(account, true);
      if (this.row(account.id)?.revision !== row.revision)
        throw fail(
          "Shopify connection changed while verifying the product. Refresh before selecting it.",
          409,
        );
      const current = this.products(row, { garmentId: id })[0];
      if (!current || (input.enabled && !current.eligible))
        throw fail("The synced product changed. Refresh its clothing type and stock.", 409);
      this.db
        .prepare(
          "INSERT INTO shopper_shopify_products VALUES(?,?,?) ON CONFLICT(installation,garment) DO UPDATE SET enabled=excluded.enabled",
        )
        .run(row.id, id, Number(input.enabled));
      this.db
        .prepare("UPDATE shopper_shopify_installations SET revision=? WHERE id=?")
        .run(randomUUID(), row.id);
      return this.summary(account);
    });
  }
  launchContext(installation, productId) {
    if (
      !installation ||
      installation.status !== "installed" ||
      !installation.enabled ||
      !installation.credentials
    )
      throw fail("This store has paused its try-on preview.", 410);
    const policy = this.store.shoppers.policy(installation.store);
    this.store.shoppers.ensurePolicy(policy);
    const product = this.products(installation, {
      externalId: "gid://shopify/Product/" + productId,
    }).find((g) => g.enabled && g.eligible);
    if (!product) throw fail("This product is not available for shopper try-on.", 404);
    const garment = this.db
      .prepare("SELECT imageHash,updatedAt,sourceUrl FROM garments WHERE account=? AND id=?")
      .get(installation.store, product.id);
    const source = parseProductUrl(garment.sourceUrl);
    if (
      source.protocol !== "https:" ||
      ![installation.shop, installation.primaryHost].includes(source.hostname) ||
      source.port ||
      !/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/?$/.test(
        source.pathname,
      )
    )
      throw fail("Sync a verified Shopify product page before enabling this product.", 409);
    return {
      installation: installation.id,
      installationRevision: installation.revision,
      store: installation.store,
      productId,
      garmentId: product.id,
      fingerprint: digest(
        JSON.stringify([
          product.name,
          product.garmentType,
          product.stock,
          garment.imageHash,
          garment.updatedAt,
          garment.sourceUrl,
        ]),
      ),
      storeRevision: policy.storeRevision,
      organisationRevision: policy.organisationRevision,
      product: {
        name: product.name,
        garmentType: product.garmentType,
        url: "https://" + installation.primaryHost + source.pathname,
      },
    };
  }
  launch(raw) {
    const origin = this.ready(),
      query = verifyShopifyQuery(raw, this.clientSecret, { proxy: true, now: this.now() });
    const row = this.db
      .prepare("SELECT * FROM shopper_shopify_installations WHERE shop=? AND status='installed'")
      .get(query.shop);
    const context = this.launchContext(row, query.params.get("product_id")),
      ticket = token();
    this.state.transaction(() => {
      const key = digest(query.signature);
      if (this.state.get("proxy", key))
        throw fail("This Shopify launch was already used. Open the product button again.", 409);
      this.state.put("proxy", key, true, (query.timestamp + 91) * 1000);
      this.state.put("launch", digest(ticket), context, this.now() + 60000);
    });
    return origin + "/shopper#launch=" + ticket;
  }
  redeem(ticket) {
    this.ready();
    if (typeof ticket !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(ticket))
      throw fail("Open the try-on button from the store product page.", 410);
    return this.state.transaction(() => {
      const saved = this.state.take("launch", digest(ticket));
      if (!saved)
        throw fail(
          "This product launch expired or was already opened. Return to the product page.",
          410,
        );
      const row = this.db
          .prepare("SELECT * FROM shopper_shopify_installations WHERE id=?")
          .get(saved.installation),
        current = this.launchContext(row, saved.productId);
      for (const key of [
        "installationRevision",
        "fingerprint",
        "storeRevision",
        "organisationRevision",
      ])
        if (saved[key] !== current[key])
          throw fail("The store or product changed. Open its product button again.", 410);
      return current;
    });
  }
  async webhook(id, epoch, topic, bytes, signature) {
    if (typeof this.clientSecret !== "string" || this.clientSecret.length < 16)
      throw fail("Shopify webhook verification is not configured.", 503);
    if (!verifyShopifyWebhook(bytes, signature, this.clientSecret))
      throw fail("Invalid Shopify webhook signature.", 401);
    if (!["app/uninstalled", "shop/update", "products/update", "products/delete"].includes(topic))
      throw fail("Unsupported Shopify lifecycle event.");
    let body;
    try {
      body = JSON.parse(bytes.toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    } catch {
      throw fail("Invalid Shopify webhook body.");
    }
    const row = this.db.prepare("SELECT * FROM shopper_shopify_installations WHERE id=?").get(id);
    if (!row || row.status !== "installed" || row.webhookEpoch !== epoch) {
      // Subscriptions can deliver while OAuth is still registering the other
      // topics. Never publish credentials after a pending uninstall/update.
      if (this.state)
        this.state.transaction(() => {
          const key = digest(id + ":" + epoch),
            pending = this.state.get("installing", key);
          if (pending) {
            if (
              topic.startsWith("products/")
                ? !/^[1-9]\d{0,19}$/.test(String(body.id))
                : String(body.id) !== pending.shopId.split("/").pop() ||
                  body.myshopify_domain !== pending.shop
            )
              throw fail("Shopify webhook shop mismatch.", 403);
            this.state.take("installing", key);
            this.state.put("installing", key, { ...pending, revoked: true }, this.now() + 180000);
          }
        });
      return;
    }
    if (topic.startsWith("products/")) {
      if (!/^[1-9]\d{0,19}$/.test(String(body.id))) throw fail("Invalid Shopify product event.");
    } else if (
      String(body.id) !== row.shopId.split("/").pop() ||
      body.myshopify_domain !== row.shop
    )
      throw fail("Shopify webhook shop mismatch.", 403);
    const bodyHash = digest(bytes);
    if (
      this.db
        .prepare(
          "SELECT 1 FROM shopper_shopify_webhooks WHERE installation=? AND epoch=? AND topic=? AND bodyHash=?",
        )
        .get(id, epoch, topic, bodyHash)
    )
      return;
    let info;
    if (topic === "shop/update") {
      // Revoke launches before any await. Verification failure leaves the
      // connection paused rather than trusting a potentially obsolete domain.
      this.store.billing.transaction(() =>
        this.db
          .prepare(
            "UPDATE shopper_shopify_installations SET enabled=0,revision=? WHERE id=? AND webhookEpoch=? AND status='installed'",
          )
          .run(randomUUID(), id, epoch),
      );
      let accessToken;
      try {
        accessToken = decrypt(row.credentials, this.key, row.id + ":shopify-shopper");
      } catch {
        throw fail("Reconnect Shopify to verify storefront domains.", 503);
      }
      info = await this.shopInfo(row.shop, accessToken);
    }
    this.store.billing.transaction(() => {
      const current = this.db
        .prepare("SELECT * FROM shopper_shopify_installations WHERE id=?")
        .get(id);
      if (!current || current.status !== "installed" || current.webhookEpoch !== epoch) return;
      this.db
        .prepare("INSERT OR IGNORE INTO shopper_shopify_webhooks VALUES(?,?,?,?,?)")
        .run(id, epoch, topic, bodyHash, this.now());
      if (topic === "app/uninstalled")
        this.db
          .prepare(
            "UPDATE shopper_shopify_installations SET status='uninstalled',enabled=0,credentials=NULL,revision=? WHERE id=?",
          )
          .run(randomUUID(), id);
      else if (topic.startsWith("products/")) {
        this.db
          .prepare(
            "UPDATE shopper_shopify_products SET enabled=0 WHERE installation=? AND garment IN (SELECT id FROM garments WHERE account=? AND category='garment' AND source='shopify' AND externalId=?)",
          )
          .run(id, row.store, "gid://shopify/Product/" + body.id);
        this.db
          .prepare("UPDATE shopper_shopify_installations SET revision=? WHERE id=?")
          .run(randomUUID(), id);
      } else
        this.db
          .prepare(
            "UPDATE shopper_shopify_installations SET primaryHost=?,enabled=0,revision=? WHERE id=?",
          )
          .run(info.primaryHost, randomUUID(), id);
    });
  }
}
