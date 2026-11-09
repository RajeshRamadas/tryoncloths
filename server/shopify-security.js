import { createHmac, timingSafeEqual } from "node:crypto";
export const shopifyError = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function shopDomain(raw) {
  if (typeof raw !== "string") throw shopifyError("Use your shop-name.myshopify.com address.");
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, "")
    .replace(/\/$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(value))
    throw shopifyError("Use your shop-name.myshopify.com address.");
  return value;
}
function compare(a, b) {
  return (
    typeof a === "string" &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
// Same canonicalization as Shopify's generateLocalHmac (admin/appProxy):
// https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/lib/utils/hmac-validator.ts
export function verifyShopifyQuery(raw, secret, { proxy = false, now = Date.now() } = {}) {
  if (typeof raw !== "string" || raw.length > 8192 || /%(?![a-f0-9]{2})/i.test(raw))
    throw shopifyError("Invalid Shopify request.", 401);
  const params = new URLSearchParams(raw),
    groups = new Map();
  for (const [key, value] of params) {
    if (
      !/^[a-zA-Z0-9_\[\]-]{1,80}$/.test(key) ||
      value.length > 2048 ||
      /[\x00-\x1f\x7f\ufffd]/.test(value)
    )
      throw shopifyError("Invalid Shopify request.", 401);
    groups.set(key, [...(groups.get(key) || []), value]);
  }
  const proof = proxy ? "signature" : "hmac";
  if (
    groups.size > 32 ||
    params.has(proxy ? "hmac" : "signature") ||
    !params.get(proof) ||
    ![
      "shop",
      "timestamp",
      proof,
      ...(proxy ? ["product_id", "launch_nonce"] : ["state", "code"]),
    ].every((k) => params.getAll(k).length === 1) ||
    (!proxy && [...groups.values()].some((v) => v.length !== 1))
  )
    throw shopifyError("Invalid Shopify request.", 401);
  if (
    !/^\d{10}$/.test(params.get("timestamp")) ||
    Math.abs(now / 1000 - Number(params.get("timestamp"))) > 90
  )
    throw shopifyError("Shopify request expired.", 401);
  const shop = params.get("shop");
  if (shopDomain(shop) !== shop) throw shopifyError("Invalid Shopify shop.", 401);
  const pairs = [...groups].filter(([k]) => k !== proof).sort(([a], [b]) => a.localeCompare(b));
  const canonical = proxy
    ? pairs.map(([k, v]) => k + "=" + v.join(",")).join("")
    : new URLSearchParams(pairs.map(([k, v]) => [k, v[0]])).toString();
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(params.get(proof)) || !compare(params.get(proof), expected))
    throw shopifyError("Invalid Shopify signature.", 401);
  if (
    proxy &&
    (!/^[1-9]\d{0,19}$/.test(params.get("product_id")) ||
      !/^[a-f0-9]{32}$/.test(params.get("launch_nonce")) ||
      params.getAll("path_prefix").length > 1)
  )
    throw shopifyError("Invalid Shopify product or launch nonce.", 400);
  return { params, shop, signature: params.get(proof), timestamp: Number(params.get("timestamp")) };
}
export function verifyShopifyWebhook(bytes, signature, secret) {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > 128 * 1024 ||
    typeof signature !== "string"
  )
    return false;
  return compare(signature, createHmac("sha256", secret).update(bytes).digest("base64"));
}
