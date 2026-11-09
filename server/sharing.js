import { lookDimensions } from "./analytics-tracking.js";
import { previewLabel } from "../src/jewellery-overlay.js";
import { brandHeader, brandContact, brandCss } from "./branding.js";
import { createHash, randomBytes } from "node:crypto";
import { requireRole } from "./tenancy.js";
import { installEventsSchema, recordEvent } from "./events.js";
import { labelledJewelleryImage } from "./jewellery-looks.js";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = (token) => createHash("sha256").update(token).digest("hex");
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
function webUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}
const headers = (res) =>
  res.set({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
const css =
  "*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:#f7f8f3;color:#233d31;font:16px/1.6 system-ui,sans-serif}main{max-width:560px;margin:auto}h1{font-size:28px;line-height:1.25;overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto;max-height:75vh;margin:16px auto;object-fit:contain;border-radius:12px}article{padding:20px;border:1px solid #d8dfd3;border-radius:16px;background:white}li{overflow-wrap:anywhere}a{color:#205c47}nav{display:flex;gap:20px;flex-wrap:wrap}p{overflow-wrap:anywhere}small{color:#596b60}";
const document = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(title)}</title><style>${css}${brandCss}</style></head><body><main>${body}</main></body></html>`;

export class ShareStore {
  constructor(accountStore) {
    this.store = accountStore;
    this.db = accountStore.db;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      installEventsSchema(this.db);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  look(account, id) {
    const look = this.db
      .prepare(
        `SELECT l.id,l.garments,c.phoneE164 FROM looks l
      JOIN avatars a ON a.account=l.account AND a.id=l.avatarId
      LEFT JOIN customers c ON c.store=a.account AND c.id=a.customer
      WHERE l.account=? AND l.id=?`,
      )
      .get(account.id, id);
    if (!look) throw fail("Look not found.", 404);
    return look;
  }
  create(account, lookId, input = {}) {
    const look = this.look(account, lookId),
      days = input.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 90)
      throw fail("Choose a link lifetime from 1 to 90 days.");
    if (input.sharingConsent !== true)
      throw fail("Confirm customer agreement before creating a public outfit link.");
    const token = randomBytes(32).toString("base64url"),
      id = hash(token),
      expiresAt = Date.now() + days * 86400000;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO share_links(tokenHash,store,look,expiresAt,createdBy) VALUES(?,?,?,?,?)",
        )
        .run(id, account.id, lookId, expiresAt, account.user.id);
      recordEvent(
        this.db,
        { org: account.org, store: account.id, user: account.user.id },
        "look_shared",
        { shareId: id, lookId, ...lookDimensions(this.store, account, lookId) },
      );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { id, token, expiresAt, customerPhone: look.phoneE164 || null };
  }
  list(account, lookId) {
    this.look(account, lookId);
    return this.db
      .prepare(
        "SELECT tokenHash AS id,expiresAt,revokedAt,views FROM share_links WHERE store=? AND look=? ORDER BY expiresAt DESC LIMIT 100",
      )
      .all(account.id, lookId);
  }
  revoke(account, id) {
    if (
      !this.db
        .prepare(
          "UPDATE share_links SET revokedAt=COALESCE(revokedAt,?) WHERE store=? AND tokenHash=?",
        )
        .run(Date.now(), account.id, id).changes
    )
      throw fail("Share link not found.", 404);
  }
  resolve(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return (
      this.db
        .prepare(
          `SELECT sl.tokenHash,sl.look,sl.store,sl.expiresAt,l.garments,l.itemsJson,l.previewMode,l.view,s.org,s.name,s.phone,s.brandingJson
      FROM share_links sl JOIN looks l ON l.account=sl.store AND l.id=sl.look JOIN stores s ON s.id=sl.store
      WHERE sl.tokenHash=? AND sl.revokedAt IS NULL AND sl.expiresAt>?`,
        )
        .get(hash(token), Date.now()) || null
    );
  }
  view(row) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE share_links SET views=views+1 WHERE tokenHash=?").run(row.tokenHash);
      recordEvent(this.db, { org: row.org, store: row.store }, "share_viewed", {
        shareId: row.tokenHash,
        lookId: row.look,
        ...lookDimensions(this.store, { id: row.store }, row.look),
      });
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

export function installShareRoutes(app, store, { requireUser, sameOrigin, wrap, publicUrl }) {
  const shares = store.sharing,
    roles = requireRole("owner", "manager", "staff");
  app.use("/s", (_req, res, next) => {
    headers(res);
    next();
  });
  app.post(
    "/api/looks/:id/share",
    sameOrigin,
    requireUser,
    roles,
    wrap((req, res) => {
      const base = webUrl(publicUrl || `${req.protocol}://${req.get("host")}`);
      if (!base) throw fail("Configure a valid public studio address before sharing.", 503);
      const { token, ...result } = shares.create(req.account, req.params.id, req.body || {});
      res.status(201).json({ ...result, url: new URL(`/s/${token}`, base).href });
    }),
  );
  app.get(
    "/api/looks/:id/shares",
    requireUser,
    roles,
    wrap((req, res) => res.json({ shares: shares.list(req.account, req.params.id) })),
  );
  app.delete(
    "/api/share/:id",
    sameOrigin,
    requireUser,
    roles,
    wrap((req, res) => {
      shares.revoke(req.account, req.params.id);
      res.json({ ok: true });
    }),
  );
  const gone = (res) =>
    headers(res)
      .status(410)
      .type("html")
      .send(
        document(
          "Outfit link unavailable",
          "<h1>This outfit link is no longer available.</h1><p>It may have expired or been removed. Ask the store for a new link.</p>",
        ),
      );
  app.get(
    "/s/:token/logo",
    wrap((req, res) => {
      const row = shares.resolve(req.params.token);
      if (!row) return gone(res);
      const logo = store.branding.logo(row.store);
      if (!logo) return res.sendStatus(404);
      headers(res).type("png").send(Buffer.from(logo));
    }),
  );
  app.get(
    "/s/:token/image",
    wrap(async (req, res) => {
      const row = shares.resolve(req.params.token);
      if (!row) return gone(res);
      const image = store.lookImage({ id: row.store }, row.look);
      if (!image) return gone(res);
      // Revalidate on every reuse so a revoked link cannot be served from a fresh cache.
      const labelled =
        row.itemsJson !== "[]" && row.view !== "complete"
          ? await labelledJewelleryImage(image, row.previewMode)
          : image;
      const rendered = await store.branding.render(row.store, labelled);
      if (!shares.resolve(req.params.token)) return gone(res);
      headers(res)
        .set("Cache-Control", "private, max-age=300, no-cache")
        .type("png")
        .send(rendered);
    }),
  );
  app.get(
    "/s/:token",
    wrap((req, res) => {
      const row = shares.resolve(req.params.token);
      if (!row) return gone(res);
      const branding = store.branding.read(row.store);
      const clothes = JSON.parse(row.garments)
        .map((label) => `<li>${escape(label)}</li>`)
        .join("");
      const body = `${brandHeader(branding, `/s/${req.params.token}/logo`)}<article><h2>${row.view === "complete" ? "Your complete look" : row.itemsJson !== "[]" ? "Your jewellery preview" : "Your outfit preview"}</h2><img src="/s/${escape(req.params.token)}/image" alt="Shared outfit preview"><ul>${clothes}</ul><p><small>${row.itemsJson !== "[]" ? escape(previewLabel(row.previewMode)) : "Approximate visual styling. This image does not predict size, fit or fabric drape."}</small></p></article><p>Available until ${escape(new Date(row.expiresAt).toISOString().slice(0, 10))} (UTC).</p>${brandContact(branding)}`;
      if (req.method === "GET") shares.view(row);
      headers(res).type("html").send(document("Outfit preview", body));
    }),
  );
}
