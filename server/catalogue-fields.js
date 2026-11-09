import { validateVariantLink } from "./jewellery-variants.js";
import { catalogueCategory, validateAttributes, visualAttributes } from "./jewellery-types.js";
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const legacyGarmentColumns =
  "account,id,name,garmentType,variant,sourceUrl,imageHash,signature,colour,image,thumbnail,savedAt";
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function installCatalogueSchema(db) {
  transaction(db, () => {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(garments)")
        .all()
        .map((c) => c.name),
    );
    for (const [name, type] of Object.entries({
      sku: "TEXT",
      brand: "TEXT NOT NULL DEFAULT ''",
      priceInr: "REAL",
      mrpInr: "REAL",
      sizesJson: "TEXT NOT NULL DEFAULT '[]'",
      stock: "TEXT NOT NULL DEFAULT 'in' CHECK(stock IN ('in','low','out'))",
      externalId: "TEXT",
      source: "TEXT NOT NULL DEFAULT 'manual'",
      updatedAt: "INTEGER",
      colourLabel: "TEXT NOT NULL DEFAULT ''",
      needsTypeReview: "INTEGER NOT NULL DEFAULT 0",
      category: "TEXT NOT NULL DEFAULT 'garment' CHECK(category IN ('garment','jewellery'))",
      attributesJson: "TEXT NOT NULL DEFAULT '{}'",
      overlayPng: "BLOB",
      overlayAnchor: "TEXT",
    }))
      if (!columns.has(name)) db.exec(`ALTER TABLE garments ADD COLUMN ${name} ${type}`);
    db.exec(`UPDATE garments SET updatedAt=savedAt WHERE updatedAt IS NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS garments_csv_sku ON garments(account,source,sku) WHERE source='csv' AND sku IS NOT NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS garments_external ON garments(account,source,externalId) WHERE externalId IS NOT NULL;
 CREATE INDEX IF NOT EXISTS garments_stock ON garments(account,stock);
 CREATE INDEX IF NOT EXISTS garments_category ON garments(account,category);`);
    // Refresh an existing shared view in the same transaction as the new columns.
    if (
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='view' AND name='catalogue_visible'").get()
    )
      installSharedCatalogueSchema(db);
  });
}
export function catalogueLimit(db, account) {
  const row = db
    .prepare("SELECT o.plan FROM stores s JOIN orgs o ON o.id=s.org WHERE s.id=?")
    .get(account.id);
  if (!row) throw fail("Store not found.", 404);
  return { starter: 500, growth: 5000, chain: 50000, pilot: 500, trial: 500 }[row.plan] || 500;
}
export function requireCatalogueSpace(db, account) {
  const limit = catalogueLimit(db, account);
  if (
    db
      .prepare("SELECT count(*) AS n FROM garments WHERE account=? AND source<>'master'")
      .get(account.id).n >= limit
  )
    throw fail(
      `This store’s catalogue limit is ${limit.toLocaleString("en-IN")} items. Update existing SKUs, remove unused items or upgrade the plan.`,
      409,
    );
}
export function assertCatalogueWritable(db, account, id) {
  if (
    typeof id === "string" &&
    (id.startsWith("master:") ||
      db
        .prepare("SELECT 1 FROM garments WHERE account=? AND id=? AND source='master'")
        .get(account.id, id))
  )
    throw fail("Shared master products are read-only. Edit them in the master store.", 403);
}
function text(value, label, max, required = false) {
  if (value == null) value = "";
  if (typeof value !== "string" || value.length > max || /[\x00-\x1f]/.test(value))
    throw fail(`Use ${label} up to ${max} characters without line breaks.`);
  value = value.trim();
  if (required && !value) throw fail(`${label} is required.`);
  return value;
}
function money(value, label) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || Number(raw) > 10000000)
    throw fail(`${label} must be a number from 0 to 10000000 with at most two decimal places.`);
  return Number(raw);
}
export function catalogueFields(input, { requiredSku = false } = {}) {
  const sku = text(input.sku, "SKU", 64, requiredSku) || null,
    brand = text(input.brand, "Brand", 80),
    colourLabel = text(input.colourLabel, "Colour", 80);
  const priceInr = money(input.priceInr, "Price"),
    mrpInr = money(input.mrpInr, "MRP");
  if (priceInr !== null && mrpInr !== null && mrpInr < priceInr)
    throw fail("MRP must be at least the selling price.");
  let sizes = input.sizes ?? [];
  if (typeof sizes === "string")
    sizes = sizes
      .split(/[|;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  if (!Array.isArray(sizes) || sizes.length > 30) throw fail("Use up to 30 sizes separated by |.");
  sizes = [...new Set(sizes.map((s) => text(s, "Size", 30, true)))];
  const stock = input.stock || "in";
  if (!["in", "low", "out"].includes(stock)) throw fail("Stock must be in, low or out.");
  return { sku, brand, priceInr, mrpInr, sizesJson: JSON.stringify(sizes), stock, colourLabel };
}
export function patchCatalogue(db, account, id, input, options = {}) {
  assertCatalogueWritable(db, account, id);
  const category = catalogueCategory(options.category, options),
    row = db
      .prepare("SELECT * FROM garments WHERE account=? AND id=? AND category=?")
      .get(account.id, id, category);
  if (!row) throw fail("Garment not found.", 404);
  const allowed = [
    "sku",
    "brand",
    "priceInr",
    "mrpInr",
    "sizes",
    "stock",
    "colourLabel",
    ...(category === "jewellery" ? ["attributes"] : []),
  ];
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !allowed.includes(k))
  )
    throw fail("Use supported catalogue fields and, for jewellery, validated attributes.");
  const fields = catalogueFields(
    { ...row, sizes: JSON.parse(row.sizesJson), ...input },
    { requiredSku: row.source === "csv" },
  );
  if (row.source === "csv" && fields.sku !== row.sku)
    throw fail("An imported SKU is its identity. Use the CSV import to add a different SKU.");
  const attributesJson =
    input.attributes === undefined
      ? row.attributesJson
      : JSON.stringify(validateAttributes(row.garmentType, input.attributes));
  transaction(db, () => {
    if (category === "jewellery")
      validateVariantLink(db, account, id, row.garmentType, JSON.parse(attributesJson));
    db.prepare(
      "UPDATE garments SET sku=?,brand=?,priceInr=?,mrpInr=?,sizesJson=?,stock=?,colourLabel=?,attributesJson=?,updatedAt=? WHERE account=? AND id=?",
    ).run(
      fields.sku,
      fields.brand,
      fields.priceInr,
      fields.mrpInr,
      fields.sizesJson,
      fields.stock,
      fields.colourLabel,
      attributesJson,
      Date.now(),
      account.id,
      id,
    );
    if (
      category === "jewellery" &&
      JSON.stringify(visualAttributes(JSON.parse(attributesJson))) !==
        JSON.stringify(visualAttributes(JSON.parse(row.attributesJson)))
    )
      db.prepare("DELETE FROM garment_results WHERE account=? AND garmentId=?").run(account.id, id);
  });
}
export function installSharedCatalogueSchema(db) {
  transaction(db, () => {
    db.exec(
      `CREATE TABLE IF NOT EXISTS catalogue_master(org TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,store TEXT NOT NULL,FOREIGN KEY(store,org) REFERENCES stores(id,org) ON DELETE CASCADE);`,
    );
    const columns = db
      .prepare("PRAGMA table_info(garments)")
      .all()
      .map((c) => c.name);
    const local = columns.map((c) => "g." + c).join(","),
      shared = columns
        .map((c) =>
          c === "account" ? "b.id" : c === "id" ? "'master:'||g.account||':'||g.id" : "g." + c,
        )
        .join(",");
    const visible = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='view' AND name='catalogue_visible'")
      .get();
    if (
      visible &&
      !["category", "attributesJson", "overlayPng", "overlayAnchor"].every((name) =>
        db
          .prepare("PRAGMA table_info(catalogue_visible)")
          .all()
          .some((column) => column.name === name),
      )
    )
      db.exec("DROP VIEW catalogue_visible");
    db.exec(`CREATE VIEW IF NOT EXISTS catalogue_visible AS
 SELECT ${local},NULL AS sharedFrom,NULL AS sharedId,0 AS readOnly FROM garments g WHERE g.source<>'master'
 UNION ALL SELECT ${shared},g.account AS sharedFrom,g.id AS sharedId,1 AS readOnly FROM catalogue_master m JOIN orgs o ON o.id=m.org AND o.plan='chain' JOIN stores b ON b.org=m.org AND b.id<>m.store JOIN garments g ON g.account=m.store AND g.source<>'master';`);
  });
}
