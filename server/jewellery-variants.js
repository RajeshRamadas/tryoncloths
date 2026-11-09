import { createHmac, timingSafeEqual } from "node:crypto";
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const projection =
  "id,name,garmentType,variant,sourceUrl,thumbnail,savedAt,sku,brand,priceInr,mrpInr,sizesJson,stock,colourLabel,source,updatedAt,needsTypeReview,category,attributesJson,overlayAnchor,(overlayPng IS NOT NULL) AS hasOverlay,sharedFrom,readOnly";
export function variantParent(row) {
  const parent = JSON.parse(row.attributesJson || "{}").variantOf;
  return parent && row.sharedFrom && !parent.startsWith("master:")
    ? `master:${row.sharedFrom}:${parent}`
    : parent;
}
export function validateVariantLink(db, account, id, type, attributes) {
  const parent = attributes.variantOf;
  if (!parent) return;
  if (parent === id) throw fail("An item cannot be its own original variant.");
  const root = db
    .prepare("SELECT * FROM catalogue_visible WHERE account=? AND id=? AND category='jewellery'")
    .get(account.id, parent);
  if (!root) throw fail("Choose an original jewellery item from this store.", 404);
  if (root.garmentType !== type || variantParent(root))
    throw fail(
      "Choose an original item of the same jewellery type, rather than another linked variant.",
    );
  if (
    id &&
    db
      .prepare(
        "SELECT 1 FROM catalogue_visible WHERE account=? AND category='jewellery' AND json_extract(attributesJson,'$.variantOf')=? LIMIT 1",
      )
      .get(account.id, id)
  )
    throw fail(
      "This original has linked variants. Unlink them before moving it to another family.",
      409,
    );
}
export function comparisonVariants(store, account, ids, { metadata = true } = {}) {
  if (
    !Array.isArray(ids) ||
    ids.length !== 2 ||
    ids.some((id) => typeof id !== "string" || id.length > 200) ||
    ids[0] === ids[1]
  )
    throw fail("Choose two different linked jewellery variants.");
  const rows = ids.map((id) =>
    store.db
      .prepare(
        `SELECT ${metadata ? projection : "id,garmentType,attributesJson,sharedFrom"} FROM catalogue_visible WHERE account=? AND id=? AND category='jewellery'`,
      )
      .get(account.id, id),
  );
  if (rows.some((row) => !row)) throw fail("Jewellery variant not found in this store.", 404);
  const roots = rows.map((row) => variantParent(row) || row.id);
  if (roots[0] !== roots[1] || rows[0].garmentType !== rows[1].garmentType)
    throw fail("Compare two variants linked to the same original jewellery item.");
  const root = store.db
    .prepare(
      "SELECT id,attributesJson,sharedFrom FROM catalogue_visible WHERE account=? AND id=? AND category='jewellery'",
    )
    .get(account.id, roots[0]);
  if (!root) throw fail("The original jewellery design is unavailable.", 404);
  if (variantParent(root)) throw fail("The variant family changed. Review its original item.", 409);
  return {
    root: roots[0],
    rows,
    items: metadata ? rows.map((row) => store.garments.describe(row)) : [],
  };
}
export function comparisonQuote(jewellery, account, contexts, credits, root) {
  const payload = Buffer.from(
    JSON.stringify({
      store: account.id,
      user: account.user.id,
      contexts: contexts.map((c) => c.id),
      root,
      credits,
      expires: Date.now() + 5 * 60000,
    }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", jewellery.store.views.key)
      .update("jewellery-compare:" + payload)
      .digest("hex")
  );
}
export function verifyComparisonQuote(jewellery, account, value, contexts, credits, root) {
  try {
    if (typeof value !== "string" || value.length > 4096) throw new Error();
    const [payload, sig, extra] = value.split("."),
      expected = createHmac("sha256", jewellery.store.views.key)
        .update("jewellery-compare:" + payload)
        .digest();
    if (extra || !/^[a-f0-9]{64}$/.test(sig) || !timingSafeEqual(expected, Buffer.from(sig, "hex")))
      throw new Error();
    const p = JSON.parse(Buffer.from(payload, "base64url"));
    if (
      p.store !== account.id ||
      p.user !== account.user.id ||
      p.expires < Date.now() ||
      p.root !== root ||
      JSON.stringify(p.contexts) !== JSON.stringify(contexts.map((c) => c.id)) ||
      credits > p.credits
    )
      throw new Error();
  } catch {
    throw fail("The comparison or its cost changed. Check the cost again before running it.", 409);
  }
}

export function variantChoices(store, account, id) {
  const options = { category: "jewellery", jewelleryEnabled: true },
    row = store.garments.row(account, id, options),
    root = variantParent(row) || row.id;
  store.garments.row(account, root, options);
  const rows = store.db
    .prepare(
      `SELECT ${projection} FROM catalogue_visible WHERE account=? AND category='jewellery' AND garmentType=? AND stock<>'out' AND needsTypeReview=0 AND (id=? OR CASE WHEN sharedFrom IS NOT NULL AND json_extract(attributesJson,'$.variantOf') NOT LIKE 'master:%' THEN 'master:'||sharedFrom||':'||json_extract(attributesJson,'$.variantOf') ELSE json_extract(attributesJson,'$.variantOf') END=?) ORDER BY savedAt DESC LIMIT 50`,
    )
    .all(account.id, row.garmentType, root, root);
  return rows.map((row) => store.garments.describe(row));
}
