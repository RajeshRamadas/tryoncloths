import { recordTryon } from "./analytics-tracking.js";
import { randomBytes, randomUUID } from "node:crypto";
import { requireRole } from "./tenancy.js";
import { meter, billingFailure } from "./billing.js";
import { normalizeAvatar } from "./gemini-tryon.js";
import { normalizeGarmentImage } from "./product-link.js";
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = () => randomBytes(16).toString("hex");
export function installCampaignRoutes(
  app,
  store,
  service,
  config,
  { requireUser, sameOrigin, wrap },
) {
  const manager = requireRole("owner", "manager");
  const get = (account, key) => {
    if (
      !store.db
        .prepare("SELECT 1 FROM whatsapp_campaigns WHERE store=? AND id=?")
        .get(account.id, key)
    )
      throw fail("Lookbook campaign not found.", 404);
    return store.db
      .prepare(
        `SELECT i.*,c.name AS customerName,g.name AS garmentName,l.thumbnail FROM whatsapp_campaign_items i JOIN customers c ON c.store=i.store AND c.id=i.customer JOIN garments g ON g.account=i.store AND g.id=i.garment LEFT JOIN looks l ON l.account=i.store AND l.id=i.look WHERE i.store=? AND i.campaign=? ORDER BY i.id`,
      )
      .all(account.id, key)
      .map(({ thumbnail, ...row }) => ({
        ...row,
        thumbnail: thumbnail
          ? `data:image/png;base64,${Buffer.from(thumbnail).toString("base64")}`
          : null,
      }));
  };
  const quote = (account, input) => {
    service.access(account);
    service.checkConnection(account);
    if (
      !Array.isArray(input.customers) ||
      !Array.isArray(input.garmentIds) ||
      !input.customers.length ||
      !input.garmentIds.length ||
      input.customers.some(
        (c) => !c || typeof c.customerId !== "string" || typeof c.avatarId !== "string",
      ) ||
      input.garmentIds.some((g) => typeof g !== "string") ||
      input.customers.length * input.garmentIds.length > 6 ||
      new Set(input.customers.map((c) => c.customerId)).size !== input.customers.length ||
      new Set(input.garmentIds).size !== input.garmentIds.length
    )
      throw fail("Choose distinct customers and garments, up to 6 combinations per campaign.");
    const items = [];
    for (const selection of input.customers) {
      const customer = service.consent(account, selection.customerId, "new_arrivals");
      const avatar = store.db
        .prepare("SELECT id,body_type FROM avatars WHERE account=? AND id=? AND customer=?")
        .get(account.id, selection.avatarId, customer.id);
      if (!avatar) throw fail("Choose an avatar belonging to each selected customer.", 404);
      if (avatar.body_type === "female" && !config.femaleEnabled)
        throw fail("Female generation is not enabled on this studio.");
      for (const garmentId of input.garmentIds) {
        const garment = store.garments.row(account, garmentId);
        items.push({ customer: customer.id, avatar: avatar.id, garment: garment.id });
      }
    }
    return { items, maxCredits: items.length, remaining: store.billing.balance(account.org) };
  };
  app.get(
    "/api/whatsapp/workspace",
    requireUser,
    requireRole("owner", "manager", "staff"),
    wrap((req, res) => {
      service.access(req.account);
      const customers = store.db
        .prepare(
          `SELECT c.id,c.name,c.phoneE164,c.marketingOptIn,c.whatsappConsentAt,a.id AS avatarId,a.name AS avatarName FROM customers c JOIN avatars a ON a.account=c.store AND a.customer=c.id WHERE c.store=? ORDER BY c.name,a.savedAt DESC LIMIT 200`,
        )
        .all(req.account.id);
      const looks = store.db
        .prepare(
          `SELECT l.id,l.name,a.customer AS customerId,l.thumbnail FROM looks l JOIN avatars a ON a.account=l.account AND a.id=l.avatarId WHERE l.account=? AND a.customer IS NOT NULL ORDER BY l.savedAt DESC LIMIT 200`,
        )
        .all(req.account.id)
        .map(({ thumbnail, ...r }) => ({
          ...r,
          thumbnail: `data:image/png;base64,${Buffer.from(thumbnail).toString("base64")}`,
        }));
      res.json({
        customers,
        looks,
        garments: store.garments.browse(req.account, { stock: "available", limit: 200 }).garments,
        remaining: store.billing.balance(req.account.org),
        campaigns: ["owner", "manager"].includes(req.account.user.role)
          ? store.db
              .prepare(
                "SELECT id,createdAt FROM whatsapp_campaigns WHERE store=? ORDER BY createdAt DESC LIMIT 20",
              )
              .all(req.account.id)
          : [],
      });
    }),
  );
  app.post(
    "/api/whatsapp/campaigns/quote",
    sameOrigin,
    requireUser,
    manager,
    wrap((req, res) => {
      const { items, ...result } = quote(req.account, req.body || {});
      res.json({ ...result, combinations: items.length });
    }),
  );
  app.post(
    "/api/whatsapp/campaigns",
    sameOrigin,
    requireUser,
    manager,
    wrap((req, res) => {
      const result = quote(req.account, req.body || {});
      if (req.body.generationConsent !== true || req.body.maxCredits !== result.maxCredits)
        throw fail(
          "Confirm reuse of the selected avatars with the AI provider and the displayed credit cost.",
        );
      if (!config.apiKey || config.provider !== "gemini")
        throw fail("Configure Gemini clothing try-on before creating a campaign.", 503);
      if (result.remaining < result.maxCredits)
        throw fail("Not enough AI credits for this campaign.", 402);
      const key = id();
      store.db.exec("BEGIN IMMEDIATE");
      try {
        store.db
          .prepare("INSERT INTO whatsapp_campaigns VALUES(?,?,?)")
          .run(key, req.account.id, Date.now());
        for (const item of result.items)
          store.db
            .prepare(
              "INSERT INTO whatsapp_campaign_items(id,campaign,store,customer,avatar,garment,state,requestId) VALUES(?,?,?,?,?,?,'pending',?)",
            )
            .run(id(), key, req.account.id, item.customer, item.avatar, item.garment, randomUUID());
        store.db.exec("COMMIT");
      } catch (e) {
        store.db.exec("ROLLBACK");
        throw e;
      }
      res.status(201).json({ id: key, items: get(req.account, key) });
    }),
  );
  app.get(
    "/api/whatsapp/campaigns/:id",
    requireUser,
    manager,
    wrap((req, res) => res.json({ id: req.params.id, items: get(req.account, req.params.id) })),
  );
  app.post(
    "/api/whatsapp/campaigns/:id/items/:item/generate",
    sameOrigin,
    requireUser,
    manager,
    wrap(async (req, res) => {
      const account = req.account,
        item = get(account, req.params.id).find((i) => i.id === req.params.item);
      if (!item) throw fail("Campaign item not found.", 404);
      if (item.state !== "pending")
        throw fail(
          "This item was already attempted. Open its saved result; no automatic regeneration is allowed.",
          409,
        );
      if (req.body?.generationConsent !== true)
        throw fail("Confirm the customer agrees to reuse this avatar for AI try-on.");
      service.consent(account, item.customer, "new_arrivals");
      service.checkConnection(account);
      if (!config.apiKey || config.provider !== "gemini")
        throw fail("Gemini clothing try-on is unavailable.", 503);
      const avatarRow = store.db
        .prepare("SELECT body_type FROM avatars WHERE account=? AND id=?")
        .get(account.id, item.avatar);
      if (avatarRow?.body_type === "female" && !config.femaleEnabled)
        throw fail("Female generation is not enabled on this studio.");
      if (service.generating.size >= 2 || service.generating.has(account.org))
        throw fail("Another lookbook is generating. Wait before starting this item.", 429);
      // Claim synchronously before decoding or paid work, including across processes.
      if (
        !store.db
          .prepare(
            "UPDATE whatsapp_campaign_items SET state='generating' WHERE id=? AND store=? AND state='pending'",
          )
          .run(item.id, account.id).changes
      )
        throw fail("This item was already started.", 409);
      service.generating.add(account.org);
      try {
        const avatar = await normalizeAvatar(
          `data:image/png;base64,${store.image(account, item.avatar).toString("base64")}`,
        );
        const garment = store.garments.get(account, item.garment),
          photo = await normalizeGarmentImage(Buffer.from(garment.image.split(",")[1], "base64"));
        const context = await store.garments.context(
          account,
          {
            avatarId: item.avatar,
            avatar: `data:image/png;base64,${avatar.toString("base64")}`,
            garmentId: item.garment,
            garmentType: garment.garmentType,
            bodyType: avatarRow.body_type,
          },
          config,
        );
        const cached = store.garments.cached(account, context);
        service.consent(account, item.customer, "new_arrivals");
        const image =
          cached?.image ||
          (await meter(
            { body: { requestId: item.requestId } },
            {
              billing: store.billing,
              account,
              action: "tryon",
              beforeCommit: () => {
                service.consent(account, item.customer, "new_arrivals");
                store.requireAvatar(account, item.avatar);
              },
            },
            async () => {
              const output = await config.tryOn({
                avatar,
                garment: photo,
                garmentType: garment.garmentType,
                title: garment.name,
                apiKey: config.apiKey,
                model: config.model,
              });
              service.consent(account, item.customer, "new_arrivals");
              store.requireAvatar(account, item.avatar);
              return output;
            },
          ));
        recordTryon(
          store,
          account,
          {
            sessionId: item.requestId,
            requestId: item.requestId,
            avatarId: item.avatar,
            garmentId: item.garment,
          },
          { reused: Boolean(cached), source: "campaign" },
        );
        // Erasure/opt-out during provider work must prevent new publishing or reattachment.
        service.consent(account, item.customer, "new_arrivals");
        store.requireAvatar(account, item.avatar);
        const look = await store.saveLook(account, {
          sessionId: item.requestId,
          garmentIds: [item.garment],
          avatarId: item.avatar,
          image,
          name: `New arrival: ${garment.name}`.slice(0, 60),
          garments: [garment.name],
        });
        store.db
          .prepare("UPDATE whatsapp_campaign_items SET state='ready',look=? WHERE id=? AND store=?")
          .run(look.id, item.id, account.id);
        res.json({ id: req.params.id, items: get(account, req.params.id) });
      } catch (e) {
        store.db
          .prepare("UPDATE whatsapp_campaign_items SET state='failed' WHERE id=? AND store=?")
          .run(item.id, account.id);
        if (billingFailure(res, e)) return;
        throw fail(
          "This item could not complete. Check saved looks and credits; generation was not retried.",
          e.status || 502,
        );
      } finally {
        service.generating.delete(account.org);
      }
    }),
  );
  app.post(
    "/api/whatsapp/campaigns/:id/items/:item/review",
    sameOrigin,
    requireUser,
    manager,
    wrap((req, res) => {
      const item = get(req.account, req.params.id).find((i) => i.id === req.params.item);
      if (!item || !["ready", "approved"].includes(item.state))
        throw fail("A generated result is required before review.", 409);
      if (typeof req.body?.approved !== "boolean")
        throw fail("Choose whether this outfit is approved.");
      store.db
        .prepare("UPDATE whatsapp_campaign_items SET state=? WHERE id=? AND store=?")
        .run(req.body.approved ? "approved" : "ready", item.id, req.account.id);
      res.json({ items: get(req.account, req.params.id) });
    }),
  );
}
