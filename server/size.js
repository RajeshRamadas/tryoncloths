import { lookAttribution, lookDimensions } from "./analytics-tracking.js";
import { randomBytes } from "node:crypto";
import { parse } from "csv-parse/sync";
import multer from "multer";
import { garmentTypes } from "./gemini-tryon.js";
import { fitFields, validateMeasurements } from "./measurements.js";
import { transaction } from "./catalogue-fields.js";
import { requireRole } from "./tenancy.js";
import { recordEvent } from "./events.js";
const fail = (message, status = 400, code) =>
  Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const ease = { chestCm: 2, waistCm: 2, hipCm: 3 };
const names = { chestCm: "chest", waistCm: "waist", hipCm: "hip" };
const table = {
  slim: [90, 74, 175, 65],
  regular: [98, 84, 175, 72],
  athletic: [106, 82, 180, 80],
  broad: [114, 100, 175, 90],
  "f-slim": [82, 66, 165, 52],
  "f-regular": [90, 74, 165, 62],
  "f-athletic": [96, 76, 170, 68],
  "f-curvy": [106, 88, 165, 78],
};
export function estimateSizeMeasurements({ heightCm, weightKg, bodyProfileId } = {}) {
  const base = table[bodyProfileId];
  if (
    !base ||
    !Number.isFinite(heightCm) ||
    !Number.isFinite(weightKg) ||
    heightCm < 140 ||
    heightCm > 210 ||
    weightKg < 35 ||
    weightKg > 200
  )
    return null;
  const round = (value) => Math.round(value * 10) / 10;
  // Illustrative, uncalibrated table only. These are not photo-derived measurements.
  return {
    chestCm: round(
      Math.min(
        200,
        Math.max(60, base[0] + 0.2 * (heightCm - base[2]) + 0.5 * (weightKg - base[3])),
      ),
    ),
    waistCm: round(
      Math.min(
        220,
        Math.max(40, base[1] + 0.15 * (heightCm - base[2]) + 0.65 * (weightKg - base[3])),
      ),
    ),
  };
}
export function recommendSize(charts, measurements, { estimated = false } = {}) {
  const fields = fitFields.filter(
    (field) =>
      Number.isFinite(measurements?.[field]) &&
      charts.every((row) => Number.isFinite(row.measurements[field])),
  );
  if (!charts.length || !fields.length)
    return {
      size: null,
      confidence: "Low",
      reason:
        "Record comparable chest, waist or hip measurements and chart targets to suggest a size.",
      alternatives: [],
      source: "unavailable",
    };
  const scored = charts
    .map((row) => ({
      ...row,
      score: fields.reduce(
        (sum, field) =>
          sum +
          Math.max(0, Math.abs(measurements[field] - row.measurements[field]) - ease[field]) /
            row.measurements[field],
        0,
      ),
    }))
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.sortOrder || 0) - (b.sortOrder || 0) ||
        a.size.localeCompare(b.size),
    );
  const best = scored[0],
    next = scored[1];
  let confidence = "Low";
  if (!estimated) {
    if (
      fields.length >= 2 &&
      next &&
      next.score > best.score + 1e-12 &&
      next.score >= 2 * best.score - 1e-12
    )
      confidence = "High";
    else if (fields.length === 1 || next) confidence = "Medium";
  }
  const comparison = fields
    .map(
      (field) =>
        `${names[field]} ${measurements[field]} cm vs ${best.size} target ${best.measurements[field]} cm (±${ease[field]} cm ease)`,
    )
    .join("; ");
  const reason = estimated
    ? `Low-confidence estimate from height, weight and body profile; not measured body dimensions. ${comparison}. Confirm actual measurements and try the garment.`
    : `${comparison}. ${confidence === "High" ? "At least two measured fields agree and the next size scores at least twice as badly." : fields.length === 1 ? "Only one measured field can be compared." : next ? "The next size is close or tied." : "There is no second size to compare."} This is a styling aid, not a guarantee of fit.`;
  return {
    size: best.size,
    confidence,
    reason,
    alternatives: scored
      .slice(1, 4)
      .map((r) => ({ size: r.size, score: Number(r.score.toFixed(6)) })),
    source: estimated ? "estimated" : "measured",
    score: Number(best.score.toFixed(6)),
  };
}
function text(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value))
    throw fail(`Use ${label} up to ${max} characters without line breaks.`);
  return value.trim().replace(/\s+/g, " ");
}
const brandKey = (brand) => brand.toLowerCase();
function fields(input, previous) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) => !["brand", "garmentType", "size", "measurements", "sortOrder"].includes(k),
    )
  )
    throw fail("Use brand, garmentType, size, measurements and sortOrder.");
  if (
    input.measurements !== undefined &&
    input.measurements !== null &&
    (typeof input.measurements !== "object" || Array.isArray(input.measurements))
  )
    throw fail("Use an object of chart measurements.");
  const data = { ...previous, ...input };
  if (previous && input.measurements)
    data.measurements = { ...previous.measurements, ...input.measurements };
  const brand = text(data.brand, "a brand", 80),
    size = text(data.size, "a size label", 30).toUpperCase();
  if (!Object.hasOwn(garmentTypes, data.garmentType) || data.garmentType === "shoes")
    throw fail(
      "Choose a clothing category. Footwear needs foot measurements and is not supported by this chest/waist/hip chart.",
    );
  const sortOrder = data.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000)
    throw fail("Sort order must be an integer from 0 to 10000.");
  const measurements = validateMeasurements(data.measurements, { chart: true });
  if (!measurements) throw fail("Record at least one chart measurement.");
  return { brand, size, garmentType: data.garmentType, measurements, sortOrder };
}
const chart = (row) =>
  row
    ? {
        id: row.id,
        brand: row.brand,
        garmentType: row.garmentType,
        size: row.size,
        measurements: JSON.parse(row.measurementsJson),
        sortOrder: row.sortOrder,
      }
    : null;
export const sizeChartTemplate =
  "brand,type,size,chest_cm,waist_cm,hip_cm,sort_order\nExample,shirt,S,92,76,,10\nExample,shirt,M,98,84,,20\nExample,shirt,L,104,92,,30\n";
export class SizeStore {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    transaction(this.db, () =>
      this.db.exec(`CREATE TABLE IF NOT EXISTS size_charts (
  id TEXT PRIMARY KEY,store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,brand TEXT NOT NULL,brandKey TEXT NOT NULL,
  garmentType TEXT NOT NULL,size TEXT NOT NULL,measurementsJson TEXT NOT NULL,sortOrder INTEGER NOT NULL DEFAULT 0,
  UNIQUE(store,brandKey,garmentType,size));CREATE INDEX IF NOT EXISTS size_charts_lookup ON size_charts(store,brandKey,garmentType);`),
    );
  }
  get(account, id) {
    const row =
      typeof id === "string" &&
      chart(
        this.db.prepare("SELECT * FROM size_charts WHERE store=? AND id=?").get(account.id, id),
      );
    if (!row) throw fail("Size chart row not found.", 404);
    return row;
  }
  list(account, query = {}) {
    const offset = String(query.offset ?? 0);
    if (!/^\d+$/.test(offset) || Number(offset) > 100000) throw fail("Use a valid chart page.");
    const where = ["store=?"],
      args = [account.id];
    if (query.brand) {
      where.push("brandKey=?");
      args.push(brandKey(text(query.brand, "a brand", 80)));
    }
    if (query.type && query.type !== "all") {
      if (!Object.hasOwn(garmentTypes, query.type)) throw fail("Choose an available garment type.");
      where.push("garmentType=?");
      args.push(query.type);
    }
    const filter = where.join(" AND ");
    return {
      charts: this.db
        .prepare(
          `SELECT * FROM size_charts WHERE ${filter} ORDER BY brandKey,garmentType,sortOrder,size LIMIT 100 OFFSET ?`,
        )
        .all(...args, Number(offset))
        .map(chart),
      total: this.db.prepare(`SELECT count(*) AS n FROM size_charts WHERE ${filter}`).get(...args)
        .n,
      offset: Number(offset),
      limit: 100,
    };
  }
  save(account, input, id) {
    const previous = id === undefined ? null : this.get(account, id),
      value = fields(input, previous),
      key = id || randomBytes(16).toString("hex");
    try {
      if (previous)
        this.db
          .prepare(
            "UPDATE size_charts SET brand=?,brandKey=?,garmentType=?,size=?,measurementsJson=?,sortOrder=? WHERE store=? AND id=?",
          )
          .run(
            value.brand,
            brandKey(value.brand),
            value.garmentType,
            value.size,
            JSON.stringify(value.measurements),
            value.sortOrder,
            account.id,
            key,
          );
      else
        this.db
          .prepare("INSERT INTO size_charts VALUES(?,?,?,?,?,?,?,?)")
          .run(
            key,
            account.id,
            value.brand,
            brandKey(value.brand),
            value.garmentType,
            value.size,
            JSON.stringify(value.measurements),
            value.sortOrder,
          );
    } catch (e) {
      if (e.message?.includes("UNIQUE"))
        throw fail("This brand, clothing type and size already has a chart row.", 409);
      throw e;
    }
    return this.get(account, key);
  }
  remove(account, id) {
    this.get(account, id);
    this.db.prepare("DELETE FROM size_charts WHERE store=? AND id=?").run(account.id, id);
  }
  import(account, buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5 * 1024 * 1024)
      throw fail("Upload a non-empty chart CSV up to 5 MB.", 413);
    let records;
    try {
      records = parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer), {
        bom: true,
        trim: true,
        skip_empty_lines: true,
        info: true,
        max_record_size: 8192,
        columns: (headers) => {
          const columns = headers.map((h) => h.trim().toLowerCase());
          if (
            new Set(columns).size !== columns.length ||
            columns.some(
              (c) =>
                !["brand", "type", "size", "chest_cm", "waist_cm", "hip_cm", "sort_order"].includes(
                  c,
                ),
            ) ||
            ["brand", "type", "size"].some((c) => !columns.includes(c))
          )
            throw new Error();
          return columns;
        },
      });
    } catch {
      throw fail("Use a valid UTF-8 CSV with the size-chart template headers and correct quotes.");
    }
    if (!records.length || records.length > 10000) throw fail("Use 1–10000 chart rows per import.");
    const report = { created: 0, updated: 0, skipped: 0, errors: [] },
      seen = new Set();
    return transaction(this.db, () => {
      const actor = this.store.identity(account.user?.id, account.id);
      if (!actor || !["owner", "manager"].includes(actor.user.role))
        throw fail("Owner or manager access is no longer available.", 403);
      for (const { record, info } of records) {
        try {
          const measurements = {};
          for (const [column, field] of [
            ["chest_cm", "chestCm"],
            ["waist_cm", "waistCm"],
            ["hip_cm", "hipCm"],
          ])
            if (record[column]) {
              if (!/^\d+(?:\.\d+)?$/.test(record[column]))
                throw fail("Chart measurements must be decimal centimetres.");
              measurements[field] = Number(record[column]);
            }
          const value = fields({
            brand: record.brand,
            garmentType: record.type?.toLowerCase(),
            size: record.size,
            measurements,
            sortOrder: record.sort_order ? Number(record.sort_order) : 0,
          });
          const key = JSON.stringify([brandKey(value.brand), value.garmentType, value.size]);
          if (seen.has(key)) throw fail("Duplicate brand/type/size in this CSV.");
          seen.add(key);
          const existing = chart(
            this.db
              .prepare(
                "SELECT * FROM size_charts WHERE store=? AND brandKey=? AND garmentType=? AND size=?",
              )
              .get(account.id, brandKey(value.brand), value.garmentType, value.size),
          );
          if (
            existing &&
            existing.brand === value.brand &&
            existing.sortOrder === value.sortOrder &&
            fitFields.every((f) => existing.measurements[f] === value.measurements[f])
          ) {
            report.skipped++;
            continue;
          }
          this.save(
            account,
            {
              ...value,
              measurements: Object.fromEntries(
                fitFields.map((field) => [field, value.measurements[field] ?? null]),
              ),
            },
            existing?.id,
          );
          report[existing ? "updated" : "created"]++;
        } catch (e) {
          report.skipped++;
          report.errors.push({
            row: info.lines,
            message: e.status ? e.message : "This chart row could not be saved.",
          });
        }
      }
      return report;
    });
  }
  recommend(account, customerId, garmentId) {
    if (typeof customerId !== "string" || typeof garmentId !== "string")
      throw fail("Choose a customer and a saved garment.");
    const customer = this.store.customers.get(account, customerId),
      garment = this.store.garments.row(account, garmentId);
    const charts = garment.brand
      ? this.db
          .prepare(
            "SELECT * FROM size_charts WHERE store=? AND brandKey=? AND garmentType=? ORDER BY sortOrder,size",
          )
          .all(account.id, brandKey(garment.brand.trim().replace(/\s+/g, " ")), garment.garmentType)
          .map(chart)
      : [];
    if (!charts.length)
      throw fail(
        "No size chart matches this product’s brand and clothing type. Add the brand and chart in Catalogue / Size charts.",
        404,
        "no_chart",
      );
    const input = customer.measurements || {};
    if (fitFields.some((f) => Number.isFinite(input[f]))) return recommendSize(charts, input);
    const avatar = this.db
      .prepare(
        "SELECT profileId,heightCm,weightKg FROM avatars WHERE account=? AND customer=? ORDER BY savedAt DESC,id LIMIT 1",
      )
      .get(account.id, customer.id);
    const source =
      Number.isFinite(input.heightCm) && Number.isFinite(input.weightKg) ? input : avatar;
    const estimate = estimateSizeMeasurements({
      ...source,
      bodyProfileId: input.bodyProfileId || avatar?.profileId,
    });
    return recommendSize(charts, estimate, { estimated: true });
  }
  purchase(account, id, input) {
    const size = text(input?.size, "the purchased size", 30);
    return transaction(this.db, () => {
      const row = this.db
        .prepare(
          "SELECT id,purchasedAt,purchasedSize,staffUser FROM looks WHERE account=? AND id=?",
        )
        .get(account.id, id);
      if (!row) throw fail("Look not found.", 404);
      if (row.purchasedAt) {
        if (row.purchasedSize !== size)
          throw fail(
            "This look is already marked purchased. Undo it before changing the size.",
            409,
          );
        return {
          purchasedAt: row.purchasedAt,
          purchasedSize: row.purchasedSize,
          staffUser: row.staffUser,
        };
      }
      const purchasedAt = Date.now();
      this.db
        .prepare(
          "UPDATE looks SET purchasedAt=?,purchasedSize=?,staffUser=? WHERE account=? AND id=?",
        )
        .run(purchasedAt, size, account.user.id, account.id, id);
      recordEvent(
        this.db,
        { org: account.org, store: account.id, user: account.user.id },
        "purchase_marked",
        {
          lookId: id,
          size,
          ...lookAttribution(this.store, account, id),
          ...lookDimensions(this.store, account, id),
        },
      );
      return { purchasedAt, purchasedSize: size, staffUser: account.user.id };
    });
  }
  undoPurchase(account, id) {
    return transaction(this.db, () => {
      const row = this.db
        .prepare("SELECT purchasedAt,purchasedSize FROM looks WHERE account=? AND id=?")
        .get(account.id, id);
      if (!row) throw fail("Look not found.", 404);
      if (row.purchasedAt) {
        this.db
          .prepare(
            "UPDATE looks SET purchasedAt=NULL,purchasedSize=NULL,staffUser=NULL WHERE account=? AND id=?",
          )
          .run(account.id, id);
        recordEvent(
          this.db,
          { org: account.org, store: account.id, user: account.user.id },
          "purchase_unmarked",
          {
            lookId: id,
            size: row.purchasedSize,
            ...lookAttribution(this.store, account, id),
            ...lookDimensions(this.store, account, id),
          },
        );
      }
      return { purchasedAt: null, purchasedSize: null, staffUser: null };
    });
  }
}
export function installSizeRoutes(app, store, { requireUser, sameOrigin, wrap }) {
  const manager = requireRole("owner", "manager"),
    staff = requireRole("owner", "manager", "staff"),
    sizes = store.sizes;
  app.get(
    "/api/size",
    requireUser,
    staff,
    wrap((req, res) => {
      try {
        res.json(sizes.recommend(req.account, req.query.customer, req.query.garment));
      } catch (e) {
        if (e.code === "no_chart") return res.status(404).json({ error: e.message, code: e.code });
        throw e;
      }
    }),
  );
  app.get(
    "/api/size-charts",
    requireUser,
    manager,
    wrap((req, res) => res.json(sizes.list(req.account, req.query))),
  );
  app.get(
    "/api/size-charts/template.csv",
    requireUser,
    manager,
    wrap((_req, res) =>
      res
        .type("text/csv")
        .set("Content-Disposition", 'attachment; filename="size-chart-template.csv"')
        .send(sizeChartTemplate),
    ),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  }).single("file");
  app.post(
    "/api/size-charts/import",
    sameOrigin,
    requireUser,
    manager,
    (req, res, next) =>
      upload(req, res, (error) => {
        if (error)
          return res
            .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
            .json({ error: "Upload one chart CSV, up to 5 MB, using the file field." });
        next();
      }),
    wrap((req, res) => {
      if (!req.file || !req.file.originalname.toLowerCase().endsWith(".csv"))
        throw fail("Choose a size-chart CSV file.");
      res.json(sizes.import(req.account, req.file.buffer));
    }),
  );
  app.get(
    "/api/size-charts/:id",
    requireUser,
    manager,
    wrap((req, res) => res.json({ chart: sizes.get(req.account, req.params.id) })),
  );
  app.post(
    "/api/size-charts",
    sameOrigin,
    requireUser,
    manager,
    wrap((req, res) => res.status(201).json({ chart: sizes.save(req.account, req.body) })),
  );
  app.patch(
    "/api/size-charts/:id",
    sameOrigin,
    requireUser,
    manager,
    wrap((req, res) => res.json({ chart: sizes.save(req.account, req.body, req.params.id) })),
  );
  app.delete(
    "/api/size-charts/:id",
    sameOrigin,
    requireUser,
    manager,
    wrap((req, res) => {
      sizes.remove(req.account, req.params.id);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/looks/:id/purchase",
    requireUser,
    staff,
    wrap((req, res) => {
      const row = store.db
        .prepare("SELECT purchasedAt,purchasedSize,staffUser FROM looks WHERE account=? AND id=?")
        .get(req.account.id, req.params.id);
      if (!row) throw fail("Look not found.", 404);
      res.json(row);
    }),
  );
  app.post(
    "/api/looks/:id/purchase",
    sameOrigin,
    requireUser,
    staff,
    wrap((req, res) => res.json(sizes.purchase(req.account, req.params.id, req.body))),
  );
  app.delete(
    "/api/looks/:id/purchase",
    sameOrigin,
    requireUser,
    staff,
    wrap((req, res) => res.json(sizes.undoPurchase(req.account, req.params.id))),
  );
}
