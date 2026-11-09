import { parseProductUrl } from "./public-url.js";
import { catalogueFields } from "./catalogue-fields.js";
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const clean = (value, max) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
export function shopUrl(provider, input) {
  try {
    let raw = provider === "shopify" ? input.shopDomain : input.siteUrl;
    if (typeof raw !== "string") throw new Error();
    if (provider === "shopify" && !raw.includes("://")) raw = "https://" + raw;
    const url = parseProductUrl(raw);
    if (url.protocol !== "https:" || url.search || url.port) throw new Error();
    if (
      provider === "shopify" &&
      (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(url.hostname) || url.pathname !== "/")
    )
      throw new Error();
    if (
      provider === "woo" &&
      (/\/wp-json(?:\/|$)/i.test(url.pathname) || /%2f|%5c|\\/i.test(url.pathname))
    )
      throw new Error();
    return url.href.replace(/\/$/, "");
  } catch {
    throw fail(
      provider === "shopify"
        ? "Use your public HTTPS shop-name.myshopify.com address."
        : "Use the public HTTPS WordPress site address, without credentials, query or wp-json path.",
      400,
    );
  }
}
export function guessShopType(title) {
  const t = title.toLowerCase();
  for (const [pattern, type] of [
    [/saree|\bsari\b/, "saree"],
    [/lehenga/, "lehenga"],
    [/blouse/, "blouse"],
    [/\bdress\b(?!\s+(shirt|shoes|pants|trousers))/, "dress"],
    [/skirt/, "skirt"],
    [/\b(jeans|denim pant)/, "jeans"],
    [/\b(t-?shirts?|tees?|polo)\b/, "tshirt"],
    [/\bkurta/, "kurta"],
    [/\b(jacket|blazer|hoodie|sweatshirt|coat|overshirt)\b/, "jacket"],
    [/\bshorts\b/, "shorts"],
    [/\b(trousers?|pants?|chinos?|joggers?|track ?pants?|cargos?)\b/, "trousers"],
    [/\b(shoes?|sneakers?|loafers?|boots?|sandals?|slippers?|footwear)\b/, "shoes"],
    [/\bshirts?\b/, "shirt"],
    [/\btops?\b/, "top"],
    [/\b(set|co-?ord|suit|outfit)\b/, "outfit"],
  ])
    if (pattern.test(t)) return type;
  return null;
}
const variantFields =
  "nodes { id title sku price compareAtPrice inventoryQuantity inventoryPolicy inventoryItem { tracked } selectedOptions { name value } } pageInfo { hasNextPage endCursor }";
export class ShopCatalogue {
  constructor({ fetchImpl, shopifyVersion = "2026-10" } = {}) {
    this.fetch = fetchImpl;
    if (!/^20\d{2}-(01|04|07|10)$/.test(shopifyVersion))
      throw fail("Use a supported Shopify API version.", 503);
    this.version = shopifyVersion;
  }
  async request(url, options, deadline) {
    if (Date.now() >= deadline)
      throw fail("Catalogue sync time limit reached. No catalogue changes were published.", 504);
    let response, data;
    try {
      response = await this.fetch(url, {
        ...options,
        timeoutMs: Math.max(1, Math.min(20000, deadline - Date.now())),
        maxBytes: 4 * 1024 * 1024,
      });
      if (response.body.length > 4 * 1024 * 1024) throw new Error();
      data = JSON.parse(response.body.toString());
    } catch {
      throw fail(
        "The shop API could not be read. Check HTTPS, permissions and connectivity. No catalogue changes were published.",
      );
    }
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !data ||
      typeof data !== "object" ||
      data.errors
    )
      throw fail(
        "The shop API rejected the request. Check the read-only key, permissions and rate limits. No catalogue changes were published.",
      );
    return { data, headers: response.headers || {} };
  }
  async graph(base, credentials, query, variables, deadline) {
    return (
      await this.request(
        `${base}/admin/api/${this.version}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": credentials.token,
          },
          body: JSON.stringify({ query, variables }),
        },
        deadline,
      )
    ).data.data;
  }
  async check(provider, base, credentials, deadline) {
    if (provider === "shopify") {
      const data = await this.graph(
        base,
        credentials,
        "query { shop { id name currencyCode } }",
        {},
        deadline,
      );
      if (!data?.shop?.id) throw fail("Shopify did not confirm the shop connection.");
      if (data.shop.currencyCode !== "INR")
        throw fail("Only shops priced in INR can sync to this catalogue.", 400);
    } else {
      const result = await this.woo(base, credentials, "products?per_page=1&page=1", deadline);
      if (!Array.isArray(result.data))
        throw fail("WooCommerce did not confirm product read access.");
    }
  }
  woo(base, credentials, path, deadline) {
    return this.request(
      `${base}/wp-json/wc/v3/${path}`,
      {
        headers: {
          Authorization:
            "Basic " + Buffer.from(credentials.key + ":" + credentials.secret).toString("base64"),
        },
      },
      deadline,
    );
  }
  async *pages(provider, base, credentials, deadline) {
    if (provider === "shopify") {
      let after = null;
      const cursors = new Set();
      for (let page = 0; page < 1001; page++) {
        const data = await this.graph(
          base,
          credentials,
          `query($after:String){ products(first:50,after:$after){ nodes { id title handle onlineStoreUrl productType tags vendor status featuredImage { url } variants(first:100){ ${variantFields} } } pageInfo { hasNextPage endCursor } } }`,
          { after },
          deadline,
        );
        const batch = data?.products;
        if (
          !Array.isArray(batch?.nodes) ||
          !batch.pageInfo ||
          typeof batch.pageInfo.hasNextPage !== "boolean" ||
          batch.nodes.length > 50
        )
          throw fail("Shopify returned an incomplete product page.");
        for (const item of batch.nodes) {
          if (!/^gid:\/\/shopify\/Product\/\d+$/.test(item.id || ""))
            throw fail("Shopify returned an invalid product ID.");
          if (item.status !== "ACTIVE") {
            item.inactive = true;
            continue;
          }
          if (
            !Array.isArray(item.variants?.nodes) ||
            typeof item.variants.pageInfo?.hasNextPage !== "boolean"
          )
            throw fail("Shopify returned incomplete variants.");
          let info = item.variants.pageInfo;
          const visited = new Set();
          while (info.hasNextPage) {
            if (!info.endCursor || visited.has(info.endCursor) || visited.size >= 100)
              throw fail("Shopify variant pagination could not finish.");
            visited.add(info.endCursor);
            const more = await this.graph(
              base,
              credentials,
              `query($id:ID!,$after:String){ product(id:$id){ variants(first:100,after:$after){ ${variantFields} } } }`,
              { id: item.id, after: info.endCursor },
              deadline,
            );
            if (
              !Array.isArray(more?.product?.variants?.nodes) ||
              typeof more.product.variants.pageInfo?.hasNextPage !== "boolean"
            )
              throw fail("Shopify returned incomplete variants.");
            item.variants.nodes.push(...more.product.variants.nodes);
            info = more.product.variants.pageInfo;
          }
        }
        yield batch.nodes;
        if (!batch.pageInfo.hasNextPage) return;
        after = batch.pageInfo.endCursor;
        if (!after || cursors.has(after))
          throw fail("Shopify product pagination could not finish.");
        cursors.add(after);
      }
      throw fail("Shopify catalogue is too large for one sync.");
    } else {
      for (let page = 1; page <= 1001; page++) {
        const { data, headers } = await this.woo(
          base,
          credentials,
          `products?per_page=50&page=${page}`,
          deadline,
        );
        if (!Array.isArray(data) || data.length > 50)
          throw fail("WooCommerce returned an invalid product page.");
        for (const item of data) {
          if (!Number.isSafeInteger(item.id) || item.id < 1)
            throw fail("WooCommerce returned an invalid product ID.");
          if (item.status !== "publish") {
            item.inactive = true;
            continue;
          }
          if (item.type === "variable") {
            item.variationRows = [];
            for (let p = 1; p <= 201; p++) {
              const more = await this.woo(
                base,
                credentials,
                `products/${item.id}/variations?per_page=50&page=${p}`,
                deadline,
              );
              if (!Array.isArray(more.data) || more.data.length > 50)
                throw fail("WooCommerce returned incomplete variations.");
              item.variationRows.push(...more.data);
              if (more.data.length < 50) break;
              if (p === 201) throw fail("WooCommerce has too many variations.");
            }
          }
        }
        yield data;
        const raw = headers["x-wp-totalpages"];
        if (raw !== undefined) {
          if (!/^\d+$/.test(String(raw)) || Number(raw) > 1000)
            throw fail("WooCommerce pagination could not be verified.");
          if (page >= Number(raw)) return;
          if (!data.length) throw fail("WooCommerce returned an incomplete catalogue.");
        } else if (data.length < 50) return;
      }
      throw fail("WooCommerce catalogue is too large for one sync.");
    }
  }
  map(provider, base, item) {
    if (item.inactive) return { externalId: String(item.id), inactive: true };
    let variants,
      sizes = [],
      colours = [],
      imageUrl,
      sourceUrl,
      stock,
      price,
      mrp,
      sku,
      brand,
      typeText;
    if (provider === "shopify") {
      variants = item.variants.nodes;
      if (!variants.length) throw fail("A Shopify product has no variants.");
      if (
        new Set(variants.map((v) => v.id)).size !== variants.length ||
        variants.some(
          (v) =>
            !v.id ||
            typeof v.inventoryItem?.tracked !== "boolean" ||
            !["DENY", "CONTINUE"].includes(v.inventoryPolicy) ||
            (v.inventoryItem.tracked &&
              v.inventoryPolicy !== "CONTINUE" &&
              !Number.isFinite(v.inventoryQuantity)),
        )
      )
        throw fail(
          "Shopify returned incomplete inventory. Check read_inventory permissions. No changes were published.",
        );
      for (const v of variants) {
        for (const o of v.selectedOptions || []) {
          if (/^(size|sizes)$/i.test(o.name)) sizes.push(o.value);
          if (/^(color|colour)$/i.test(o.name)) colours.push(o.value);
        }
      }
      const available = variants.filter(
        (v) =>
          v.inventoryItem?.tracked === false ||
          v.inventoryPolicy === "CONTINUE" ||
          (Number.isFinite(v.inventoryQuantity) && v.inventoryQuantity > 0),
      );
      stock = !available.length
        ? "out"
        : available.every(
              (v) => v.inventoryItem?.tracked !== false && v.inventoryPolicy !== "CONTINUE",
            ) && available.reduce((n, v) => n + v.inventoryQuantity, 0) <= 3
          ? "low"
          : "in";
      const prices = variants.map((v) => Number(v.price));
      if (prices.some((v) => !Number.isFinite(v) || v < 0))
        throw fail("Shopify returned an invalid price.");
      price = Math.min(...prices).toFixed(2);
      const compares = variants
        .map((v) => (v.compareAtPrice == null ? null : Number(v.compareAtPrice)))
        .filter((v) => v != null && Number.isFinite(v) && v >= Number(price));
      mrp = compares.length ? Math.min(...compares).toFixed(2) : null;
      sku = variants.find((v) => v.sku)?.sku;
      brand = item.vendor;
      typeText = [item.productType, ...(item.tags || []), item.title].join(" ");
      imageUrl = item.featuredImage?.url;
      sourceUrl =
        item.onlineStoreUrl || `${base}/products/${encodeURIComponent(item.handle || "")}`;
    } else {
      for (const a of item.attributes || []) {
        if (/^sizes?$/i.test(a.name)) sizes.push(...(a.options || []));
        if (/^(color|colour)$/i.test(a.name)) colours.push(...(a.options || []));
      }
      variants = item.variationRows?.length ? item.variationRows : [item];
      const available = variants.filter(
        (v) => v.status !== "private" && v.stock_status !== "outofstock",
      );
      stock = !available.length
        ? "out"
        : available.every((v) => v.manage_stock && Number.isFinite(v.stock_quantity)) &&
            available.reduce((n, v) => n + v.stock_quantity, 0) <= 3
          ? "low"
          : "in";
      price = item.price || null;
      mrp =
        item.regular_price && Number(item.regular_price) >= Number(price)
          ? item.regular_price
          : null;
      sku = item.sku;
      brand = item.brands?.[0]?.name || "";
      typeText = [
        ...(item.categories || []).map((v) => v.name),
        ...(item.tags || []).map((v) => v.name),
        item.name,
      ].join(" ");
      imageUrl = item.images?.[0]?.src;
      sourceUrl = item.permalink;
    }
    const name = clean(provider === "shopify" ? item.title : item.name, 100);
    if (!name || !imageUrl || !sourceUrl)
      throw fail("A published product needs a name, public product URL and image before syncing.");
    try {
      imageUrl = parseProductUrl(imageUrl).href;
      sourceUrl = parseProductUrl(sourceUrl).href;
    } catch {
      throw fail("A product contains an invalid or private image/product URL.");
    }
    const type = guessShopType(typeText);
    const fields = catalogueFields({
      sku: clean(sku, 64),
      brand: clean(brand, 80),
      priceInr: price,
      mrpInr: mrp,
      sizes: [...new Set(sizes.map((v) => clean(v, 30)))].filter(Boolean),
      colourLabel: clean([...new Set(colours)].join(" / "), 80),
      stock,
    });
    return {
      ...fields,
      externalId: String(item.id),
      name,
      garmentType: type || "outfit",
      needsTypeReview: type ? 0 : 1,
      imageUrl,
      sourceUrl,
    };
  }
}
