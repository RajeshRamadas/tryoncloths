import { parse } from "csv-parse/sync";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { safeFetch, normalizeGarmentImage, parseProductUrl } from "./product-link.js";
import { productImage, canonicalProductUrl } from "./garment-store.js";
import {
  catalogueFields,
  catalogueLimit,
  requireCatalogueSpace,
  patchCatalogue,
  transaction,
  legacyGarmentColumns,
} from "./catalogue-fields.js";
import { garmentTypes } from "./gemini-tryon.js";
import { requireRole } from "./tenancy.js";
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const catalogueHeaders = [
  "name",
  "type",
  "sku",
  "brand",
  "price",
  "mrp",
  "sizes",
  "colour",
  "stock",
  "product_url",
  "image_url",
];
export const catalogueTemplate =
  catalogueHeaders.join(",") +
  "\nBlue shirt,shirt,SHIRT-BLUE-001,Example,999,1299,S|M|L,Blue,in,https://shop.example/products/blue,https://shop.example/images/blue.jpg\n";
const maxBytes = 5 * 1024 * 1024;
function rowFields(record) {
  const name = record.name?.trim();
  if (!name || name.length > 100 || /[\x00-\x1f]/.test(name))
    throw fail("Name is required and must be at most 100 characters without line breaks.");
  const type = record.type?.toLowerCase();
  if (!Object.hasOwn(garmentTypes, type))
    throw fail(
      "Use a supported clothing type such as shirt, tshirt, trousers, jeans, dress or shoes.",
    );
  const fields = catalogueFields(
    {
      sku: record.sku,
      brand: record.brand,
      priceInr: record.price,
      mrpInr: record.mrp,
      sizes: record.sizes,
      colourLabel: record.colour,
      stock: record.stock?.toLowerCase(),
    },
    { requiredSku: true },
  );
  const sourceUrl = canonicalProductUrl(record.product_url),
    imageUrl = parseProductUrl(record.image_url).href;
  return { ...fields, name, type, sourceUrl, imageUrl };
}
export function parseCatalogue(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes)
    throw fail("Upload a non-empty CSV up to 5 MB.", 413);
  let records;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    records = parse(text, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      max_record_size: 16384,
      info: true,
      columns: (columns) => {
        const names = columns.map((c) => c.trim().toLowerCase());
        if (
          new Set(names).size !== names.length ||
          names.some((c) => !catalogueHeaders.includes(c)) ||
          ["name", "type", "sku", "image_url"].some((c) => !names.includes(c))
        )
          throw new Error();
        return names;
      },
    });
  } catch {
    throw fail(
      "CSV could not be read. Use UTF-8, comma separators, unique template headers and valid quotes. Required columns: name, type, sku, image_url.",
    );
  }
  if (!records.length || records.length > 10000) throw fail("Use 1–10,000 product rows per CSV.");
  const seen = new Set(),
    rows = [],
    errors = [];
  for (const { record, info } of records) {
    const row = info.lines;
    try {
      const fields = rowFields(record);
      if (seen.has(fields.sku)) throw fail("Duplicate SKU in this file. Keep one row per SKU.");
      seen.add(fields.sku);
      rows.push({ row, ...fields });
    } catch (e) {
      errors.push({
        row,
        message: e.status
          ? e.message
          : "Use a public HTTP(S) image URL without credentials or private addresses.",
      });
    }
  }
  return { rows, errors, total: records.length };
}
export class CatalogueImporter {
  constructor(store, { fetchImage = safeFetch, deadlineMs = 5 * 60000 } = {}) {
    this.store = store;
    this.db = store.db;
    this.fetchImage = fetchImage;
    this.deadlineMs = deadlineMs;
    this.running = new Set();
  }
  actor(account) {
    const identity = this.store.identity(account.user.id, account.id);
    if (!identity || !["owner", "manager"].includes(identity.user.role))
      throw fail("Owner or manager access is no longer available.", 403);
    return identity;
  }
  async run(account, buffer) {
    if (this.running.has(account.id))
      throw fail("A catalogue import is already running for this store.", 409);
    this.actor(account);
    const input = parseCatalogue(buffer),
      report = { created: 0, updated: 0, skipped: input.errors.length, errors: input.errors };
    const existing = new Set(
      this.db
        .prepare("SELECT sku FROM garments WHERE account=? AND category='garment' AND source='csv'")
        .all(account.id)
        .map((r) => r.sku),
    );
    const limit = catalogueLimit(this.db, account),
      count = this.db
        .prepare("SELECT count(*) AS n FROM garments WHERE account=? AND source<>'master'")
        .get(account.id).n;
    if (count + input.rows.filter((r) => !existing.has(r.sku)).length > limit)
      return {
        status: 409,
        ...report,
        skipped: input.total,
        errors: [
          ...report.errors,
          {
            row: 0,
            message: `Import would exceed this store’s ${limit.toLocaleString("en-IN")}-item catalogue limit. No rows were saved. Split the file, update existing SKUs or upgrade.`,
          },
        ],
      };
    this.running.add(account.id);
    const deadline = Date.now() + this.deadlineMs;
    let next = 0,
      status = 200,
      stop = false;
    const photos = new Map();
    const photo = async (url) => {
      if (photos.has(url)) return photos.get(url);
      const promise = (async () => {
        const fetched = await this.fetchImage(url, {
          maxBytes,
          accept: "image/*",
          timeoutMs: 12000,
        });
        const normalized = await normalizeGarmentImage(fetched.body);
        return productImage(`data:image/jpeg;base64,${normalized.toString("base64")}`);
      })();
      photos.set(url, promise);
      if (photos.size > 16) photos.delete(photos.keys().next().value);
      return promise;
    };
    const worker = async () => {
      while (next < input.rows.length) {
        const item = input.rows[next++];
        try {
          if (stop) throw fail("Import stopped because store access changed.", 403);
          if (Date.now() >= deadline)
            throw fail(
              "Import time limit reached. Import the remaining SKUs in a smaller file.",
              408,
            );
          this.actor(account);
          if (
            !this.db
              .prepare(
                "SELECT id FROM garments WHERE account=? AND category='garment' AND source='csv' AND sku=?",
              )
              .get(account.id, item.sku)
          )
            requireCatalogueSpace(this.db, account);
          const image = await photo(item.imageUrl);
          const result = transaction(this.db, () => {
            this.actor(account);
            const row = this.db
              .prepare(
                "SELECT * FROM garments WHERE account=? AND category='garment' AND source='csv' AND sku=?",
              )
              .get(account.id, item.sku);
            const values = {
              name: item.name,
              garmentType: item.type,
              variant: item.sku,
              sourceUrl: item.sourceUrl,
              imageHash: image.imageHash,
              sku: item.sku,
              brand: item.brand,
              priceInr: item.priceInr,
              mrpInr: item.mrpInr,
              sizesJson: item.sizesJson,
              stock: item.stock,
              colourLabel: item.colourLabel,
            };
            if (row && Object.entries(values).every(([k, v]) => row[k] === v)) return "skipped";
            const now = Date.now();
            let garmentId = row?.id;
            if (row) {
              this.db
                .prepare(
                  "UPDATE garments SET name=?,garmentType=?,variant=?,sourceUrl=?,brand=?,priceInr=?,mrpInr=?,sizesJson=?,stock=?,colourLabel=?,updatedAt=? WHERE account=? AND id=?",
                )
                .run(
                  item.name,
                  item.type,
                  values.variant,
                  item.sourceUrl,
                  item.brand,
                  item.priceInr,
                  item.mrpInr,
                  item.sizesJson,
                  item.stock,
                  item.colourLabel,
                  now,
                  account.id,
                  garmentId,
                );
              if (row.imageHash !== image.imageHash)
                this.db
                  .prepare(
                    "UPDATE garments SET imageHash=?,signature=?,colour=?,image=?,thumbnail=? WHERE account=? AND id=?",
                  )
                  .run(
                    image.imageHash,
                    image.signature,
                    image.colour,
                    image.image,
                    image.thumbnail,
                    account.id,
                    garmentId,
                  );
              if (
                row.imageHash !== image.imageHash ||
                row.garmentType !== item.type ||
                row.name !== item.name
              )
                this.db
                  .prepare("DELETE FROM garment_results WHERE account=? AND garmentId=?")
                  .run(account.id, garmentId);
            } else {
              requireCatalogueSpace(this.db, account);
              garmentId = randomBytes(16).toString("hex");
              this.db
                .prepare(
                  `INSERT INTO garments(${legacyGarmentColumns},sku,brand,priceInr,mrpInr,sizesJson,stock,externalId,source,updatedAt,colourLabel) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                )
                .run(
                  account.id,
                  garmentId,
                  item.name,
                  item.type,
                  values.variant,
                  item.sourceUrl,
                  image.imageHash,
                  image.signature,
                  image.colour,
                  image.image,
                  image.thumbnail,
                  now,
                  item.sku,
                  item.brand,
                  item.priceInr,
                  item.mrpInr,
                  item.sizesJson,
                  item.stock,
                  item.sku,
                  "csv",
                  now,
                  item.colourLabel,
                );
            }
            this.store.garments.addLink(account, garmentId, item.sourceUrl);
            return row ? "updated" : "created";
          });
          report[result]++;
        } catch (e) {
          report.skipped++;
          report.errors.push({
            row: item.row,
            message: e.status
              ? e.message
              : e.message?.includes("UNIQUE")
                ? "This photo/category/SKU variant conflicts with another product. Use a distinct SKU or product URL."
                : "Image could not be fetched or decoded. Check its public URL and image format.",
          });
          if (e.status === 409) status = 409;
          if (e.status === 403) {
            stop = true;
            status = 403;
          }
        }
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
      report.errors.sort((a, b) => a.row - b.row);
      return { status, ...report };
    } finally {
      this.running.delete(account.id);
      photos.clear();
    }
  }
}
export function installCatalogueRoutes(
  app,
  store,
  { requireUser, sameOrigin, wrap, options, jewelleryEnabled = false },
) {
  const importer = new CatalogueImporter(store, options),
    manager = requireRole("owner", "manager"),
    staff = requireRole("owner", "manager", "staff");
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 },
  }).single("file");
  app.get(
    "/api/catalogue",
    requireUser,
    staff,
    wrap((req, res) =>
      res.json(store.garments.browse(req.account, req.query, { jewelleryEnabled })),
    ),
  );
  app.get(
    "/api/catalogue/template.csv",
    requireUser,
    manager,
    wrap((_req, res) =>
      res
        .type("text/csv")
        .set("Content-Disposition", 'attachment; filename="catalogue-template.csv"')
        .send(catalogueTemplate),
    ),
  );
  app.patch(
    "/api/catalogue/:id",
    sameOrigin,
    requireUser,
    manager,
    wrap((req, res) => {
      const options = { category: req.query.category, jewelleryEnabled };
      patchCatalogue(store.db, req.account, req.params.id, req.body, options);
      res.json({ garment: store.garments.get(req.account, req.params.id, options) });
    }),
  );
  app.post(
    "/api/catalogue/import",
    sameOrigin,
    requireUser,
    manager,
    (req, res, next) =>
      upload(req, res, (error) => {
        if (error)
          return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
            error:
              error.code === "LIMIT_FILE_SIZE"
                ? "CSV must be at most 5 MB."
                : "Upload one CSV using the file field, without extra form fields.",
          });
        next();
      }),
    wrap(async (req, res) => {
      if (!req.file || !req.file.originalname.toLowerCase().endsWith(".csv"))
        throw fail("Upload a CSV file. Convert Excel files to CSV in the catalogue page.");
      const { status, ...report } = await importer.run(req.account, req.file.buffer);
      res.status(status).json(report);
    }),
  );
}
