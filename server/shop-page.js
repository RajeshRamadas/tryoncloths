import sharp from "sharp";
import { randomBytes, randomUUID } from "node:crypto";
import { transaction } from "./catalogue-fields.js";
import {
  brandHeader,
  brandContact,
  brandCss,
  brandInk,
  escapeBrand as escape,
} from "./branding.js";
import { requireRole } from "./tenancy.js";

// Public shop pages: each store gets a customer-facing page at /shop/<slug> that
// shows its branding, shop photos, opening hours and in-stock catalogue, with a
// "Try it on" entry point that contacts the store. Owners and managers edit the
// page content and photos; only owners change the web address or publish it.

export const MAX_SHOP_PHOTOS = 12;
export const MAX_SHOP_ITEMS = 60;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(["admin", "api", "edit", "forme", "new", "settings", "shop", "www"]);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const settingKeys = ["tagline", "about", "hours", "whatsapp", "showCatalogue", "showPrices"];

export function slugify(name) {
  const base = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `shop-${base || randomBytes(3).toString("hex")}`.slice(0, 32);
}
export function validSlug(value) {
  return (
    typeof value === "string" && SLUG.test(value) && !value.includes("--") && !RESERVED.has(value)
  );
}
function text(value, max, label, { lines = false } = {}) {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (lines ? /[\x00-\x09\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)
  )
    throw fail(`Use ${label} up to ${max} characters.`);
  return value.trim().replace(/\r\n?/g, "\n");
}
function whatsappNumber(value) {
  const result = text(value, 40, "a WhatsApp number").replace(/[\s().-]/g, "");
  if (result && !/^\+[1-9]\d{7,14}$/.test(result))
    throw fail("Use a WhatsApp number with its country code, for example +91 98765 43210.");
  return result;
}
const settings = (json) => {
  let saved = {};
  try {
    saved = JSON.parse(json) || {};
  } catch {}
  const safe = (fn, value, fallback) => {
    try {
      return fn(value);
    } catch {
      return fallback;
    }
  };
  return {
    tagline: safe((v) => text(v, 120, "a tagline"), saved.tagline ?? "", ""),
    about: safe((v) => text(v, 1200, "an about section", { lines: true }), saved.about ?? "", ""),
    hours: safe((v) => text(v, 300, "opening hours", { lines: true }), saved.hours ?? "", ""),
    whatsapp: safe(whatsappNumber, saved.whatsapp ?? "", ""),
    showCatalogue: saved.showCatalogue !== false,
    showPrices: saved.showPrices !== false,
  };
};
export async function normalizeShopPhoto(value) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    typeof value === "string" && value.length < 7_200_000 ? value : "",
  );
  const problem = () =>
    fail("Use a JPEG, PNG or WebP shop photo under 5 MB, at least 320 pixels wide.");
  if (!match) throw problem();
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw problem();
  try {
    const source = sharp(bytes, { limitInputPixels: 25_000_000, animated: false }),
      meta = await source.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format) ||
      !meta.width ||
      !meta.height ||
      Math.min(meta.width, meta.height) < 200 ||
      Math.max(meta.width, meta.height) < 320 ||
      (meta.pages || 1) > 1
    )
      throw new Error();
    // Re-encoding drops EXIF/GPS metadata, so shop photos never publish camera location.
    const image = await source
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const thumbnail = await sharp(image)
      .resize(360, 360, { fit: "inside" })
      .jpeg({ quality: 78 })
      .toBuffer();
    return { image, thumbnail };
  } catch {
    throw problem();
  }
}
const money = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 2 })
    : "";
const httpsUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
};

export class ShopPageStore {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    transaction(this.db, () =>
      this.db.exec(`CREATE TABLE IF NOT EXISTS shop_pages(
        store TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE, slug TEXT UNIQUE NOT NULL,
        published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)), settingsJson TEXT NOT NULL DEFAULT '{}',
        revision TEXT NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shop_page_photos(
        id TEXT PRIMARY KEY, store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        caption TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, image BLOB NOT NULL,
        thumbnail BLOB NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS shop_page_photos_store ON shop_page_photos(store,position);`),
    );
  }
  row(storeId) {
    const existing = this.db.prepare("SELECT * FROM shop_pages WHERE store=?").get(storeId);
    if (existing) return existing;
    const shop = this.db.prepare("SELECT name FROM stores WHERE id=?").get(storeId);
    if (!shop) throw fail("Store not found.", 404);
    return transaction(this.db, () => {
      const again = this.db.prepare("SELECT * FROM shop_pages WHERE store=?").get(storeId);
      if (again) return again;
      const base = slugify(shop.name);
      let slug = validSlug(base) ? base : `shop-${randomBytes(3).toString("hex")}`;
      for (let n = 2; this.db.prepare("SELECT 1 FROM shop_pages WHERE slug=?").get(slug); n++)
        slug = n < 20 ? `${base}-${n}` : `${base.slice(0, 30)}-${randomBytes(3).toString("hex")}`;
      this.db
        .prepare(
          "INSERT INTO shop_pages(store,slug,published,settingsJson,revision,updatedAt) VALUES(?,?,0,'{}',?,?)",
        )
        .run(storeId, slug, randomUUID(), Date.now());
      return this.db.prepare("SELECT * FROM shop_pages WHERE store=?").get(storeId);
    });
  }
  photos(storeId) {
    return this.db
      .prepare(
        "SELECT id,caption,position,thumbnail FROM shop_page_photos WHERE store=? ORDER BY position,createdAt",
      )
      .all(storeId);
  }
  read(storeId) {
    const row = this.row(storeId);
    return {
      slug: row.slug,
      path: `/shop/${row.slug}`,
      published: row.published === 1,
      ...settings(row.settingsJson),
      revision: row.revision,
      updatedAt: row.updatedAt,
      photoLimit: MAX_SHOP_PHOTOS,
      photos: this.photos(storeId).map((p) => ({
        id: p.id,
        caption: p.caption,
        thumbnail: `data:image/jpeg;base64,${Buffer.from(p.thumbnail).toString("base64")}`,
      })),
    };
  }
  // Recheck membership inside each write so a role removed mid-request cannot edit.
  actor(account, owner = false) {
    const current = account?.user && this.store.identity(account.user.id, account.id);
    if (
      !current ||
      current.org !== account.org ||
      !(owner ? ["owner"] : ["owner", "manager"]).includes(current.user.role)
    )
      throw fail(
        owner
          ? "Only the store owner can change the shop page address or publish it."
          : "Owner or manager access is required to edit the shop page.",
        403,
      );
    return current;
  }
  update(account, input = {}) {
    const role = this.actor(account).user.role;
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((k) => ![...settingKeys, "slug", "published", "revision"].includes(k))
    )
      throw fail(
        "Use the shop page address, publish choice, tagline, about, hours, WhatsApp and catalogue options.",
      );
    if ((input.slug !== undefined || input.published !== undefined) && role !== "owner")
      this.actor(account, true);
    const previous = this.row(account.id);
    if (input.revision !== undefined && input.revision !== previous.revision)
      throw fail("The shop page changed in another tab. Refresh before saving.", 409);
    const current = settings(previous.settingsJson),
      value = { ...current, ...input };
    if (typeof value.showCatalogue !== "boolean" || typeof value.showPrices !== "boolean")
      throw fail("Choose whether to show the catalogue and prices.");
    const next = {
      tagline: text(value.tagline, 120, "a tagline"),
      about: text(value.about, 1200, "an about section", { lines: true }),
      hours: text(value.hours, 300, "opening hours", { lines: true }),
      whatsapp: whatsappNumber(value.whatsapp),
      showCatalogue: value.showCatalogue,
      showPrices: value.showPrices,
    };
    const slug = input.slug === undefined ? previous.slug : input.slug;
    if (slug !== previous.slug && !validSlug(slug))
      throw fail(
        "Use a shop address of 3–40 lowercase letters, numbers and single hyphens, not starting or ending with a hyphen.",
      );
    if (input.published !== undefined && typeof input.published !== "boolean")
      throw fail("Choose whether the shop page is published.");
    const published = input.published === undefined ? previous.published : input.published ? 1 : 0;
    return transaction(this.db, () => {
      this.actor(account, input.slug !== undefined || input.published !== undefined);
      if (this.row(account.id).revision !== previous.revision)
        throw fail("The shop page changed in another tab. Refresh before saving.", 409);
      if (
        slug !== previous.slug &&
        this.db.prepare("SELECT 1 FROM shop_pages WHERE slug=? AND store<>?").get(slug, account.id)
      )
        throw fail("That shop address is already taken. Choose another.", 409);
      this.db
        .prepare(
          "UPDATE shop_pages SET slug=?,published=?,settingsJson=?,revision=?,updatedAt=? WHERE store=?",
        )
        .run(slug, published, JSON.stringify(next), randomUUID(), Date.now(), account.id);
      return this.read(account.id);
    });
  }
  async addPhoto(account, input = {}) {
    this.actor(account);
    if (
      !input ||
      typeof input !== "object" ||
      Object.keys(input).some((k) => !["image", "caption"].includes(k))
    )
      throw fail("Use a shop photo and optional caption.");
    const caption = text(input.caption ?? "", 140, "a caption");
    if (this.photos(account.id).length >= MAX_SHOP_PHOTOS)
      throw fail(`A shop page can hold up to ${MAX_SHOP_PHOTOS} photos. Remove one first.`, 409);
    const { image, thumbnail } = await normalizeShopPhoto(input.image);
    return transaction(this.db, () => {
      this.actor(account);
      this.row(account.id);
      const count = this.db
        .prepare(
          "SELECT count(*) AS n, coalesce(max(position),-1) AS last FROM shop_page_photos WHERE store=?",
        )
        .get(account.id);
      if (count.n >= MAX_SHOP_PHOTOS)
        throw fail(`A shop page can hold up to ${MAX_SHOP_PHOTOS} photos. Remove one first.`, 409);
      const id = randomBytes(12).toString("hex");
      this.db
        .prepare("INSERT INTO shop_page_photos VALUES(?,?,?,?,?,?,?)")
        .run(id, account.id, caption, count.last + 1, image, thumbnail, Date.now());
      return this.read(account.id);
    });
  }
  updatePhoto(account, id, input = {}) {
    this.actor(account);
    if (
      !input ||
      typeof input !== "object" ||
      Object.keys(input).some((k) => !["caption", "move"].includes(k)) ||
      (input.move !== undefined && !["up", "down", "first"].includes(input.move))
    )
      throw fail("Use a caption or move the photo up, down or first.");
    const caption = input.caption === undefined ? undefined : text(input.caption, 140, "a caption");
    return transaction(this.db, () => {
      this.actor(account);
      const list = this.photos(account.id),
        index = list.findIndex((p) => p.id === id);
      if (index < 0) throw fail("Shop photo not found.", 404);
      if (caption !== undefined)
        this.db
          .prepare("UPDATE shop_page_photos SET caption=? WHERE id=? AND store=?")
          .run(caption, id, account.id);
      if (input.move) {
        const [photo] = list.splice(index, 1),
          target =
            input.move === "first"
              ? 0
              : Math.max(0, Math.min(list.length, index + (input.move === "up" ? -1 : 1)));
        list.splice(target, 0, photo);
        const position = this.db.prepare(
          "UPDATE shop_page_photos SET position=? WHERE id=? AND store=?",
        );
        list.forEach((p, i) => position.run(i, p.id, account.id));
      }
      return this.read(account.id);
    });
  }
  removePhoto(account, id) {
    return transaction(this.db, () => {
      this.actor(account);
      if (
        !this.db.prepare("DELETE FROM shop_page_photos WHERE id=? AND store=?").run(id, account.id)
          .changes
      )
        throw fail("Shop photo not found.", 404);
      const position = this.db.prepare("UPDATE shop_page_photos SET position=? WHERE id=?");
      this.photos(account.id).forEach((p, i) => position.run(i, p.id));
      return this.read(account.id);
    });
  }
  // Only a published page of a store whose organisation is not suspended is public.
  // Store staff can preview their own unpublished page while signed in.
  bySlug(slug, viewerStore = null) {
    if (typeof slug !== "string" || !SLUG.test(slug)) return null;
    return (
      this.db
        .prepare(
          "SELECT p.* FROM shop_pages p JOIN stores s ON s.id=p.store JOIN orgs o ON o.id=s.org WHERE p.slug=? AND (p.published=1 AND o.status<>'suspended' OR p.store=?)",
        )
        .get(slug, viewerStore) || null
    );
  }
  photo(storeId, id) {
    return this.db
      .prepare("SELECT image FROM shop_page_photos WHERE store=? AND id=?")
      .get(storeId, id)?.image;
  }
  catalogue(storeId) {
    return this.db
      .prepare(
        "SELECT id,name,variant,category,garmentType,priceInr,mrpInr,stock,sourceUrl,colourLabel FROM catalogue_visible WHERE account=? AND stock<>'out' ORDER BY savedAt DESC,id LIMIT ?",
      )
      .all(storeId, MAX_SHOP_ITEMS);
  }
  async itemImage(storeId, id) {
    const row = this.db
      .prepare("SELECT image FROM catalogue_visible WHERE account=? AND id=? AND stock<>'out'")
      .get(storeId, id);
    if (!row) return null;
    return sharp(Buffer.from(row.image), { limitInputPixels: 25_000_000 })
      .resize(480, 600, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();
  }
}

// WhatsApp click-to-chat when the store set a number, otherwise a phone call.
export function tryOnLink(page, brand, itemName) {
  const message = itemName
    ? `Hi ${brand.displayName}, I'd like to try on "${itemName}". When can I visit?`
    : `Hi ${brand.displayName}, I'd like to book a try-on visit.`;
  if (page.whatsapp)
    return `https://wa.me/${page.whatsapp.slice(1)}?text=${encodeURIComponent(message)}`;
  if (brand.phone) return `tel:${brand.phone}`;
  return "";
}
// Same neutral palette as the studio (docs/DESIGN_SYSTEM.md); the store's own colour is --brand.
const css = [
  "*{box-sizing:border-box}body{margin:0;background:#f6f7f5;color:#18211d;font:16px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}",
  "main{max-width:1040px;margin:auto;padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}@media(min-width:1280px){main{max-width:1200px}}",
  "h2{font-size:22px;font-weight:700;letter-spacing:-.01em;margin:40px 0 12px}p{overflow-wrap:anywhere;white-space:pre-line}a{color:var(--brand)}",
  ".tagline{font-size:18px;color:#3a4641;margin:-4px 0 16px}",
  ".cta{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 24px;border-radius:999px;background:var(--brand);color:var(--brand-ink);text-decoration:none;font-weight:600;box-shadow:0 1px 3px rgb(24 33 29/.12)}",
  ".hero{display:block;width:100%;max-height:60vh;object-fit:cover;border-radius:16px;margin:20px 0}",
  ".gallery,.items{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}@media(max-width:600px){.gallery,.items{gap:10px;grid-template-columns:repeat(2,minmax(0,1fr))}.item{padding:8px}}",
  ".gallery figure{margin:0}.gallery img,.item img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:12px;background:#edf0ed}.item img{object-fit:contain;padding:8px}figcaption{font-size:14px;color:#535f59;margin-top:6px}",
  ".item{padding:12px;border:1px solid #e1e6e2;border-radius:14px;background:#fff;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgb(24 33 29/.05)}",
  ".item h3{font-size:16px;font-weight:600;margin:8px 0 0;overflow-wrap:anywhere}.item small{color:#535f59}.item .price{font-weight:700}.item s{color:#68746e;font-weight:400;margin-left:6px}.item .low{color:#93500b;font-size:14px;font-weight:500}",
  ".item nav{display:flex;flex-direction:column;gap:2px;margin-top:auto;padding-top:8px;font-size:15px}",
  ".item nav a:first-child{justify-content:center;border-radius:999px;background:var(--brand);color:var(--brand-ink);text-decoration:none;font-weight:600}.item nav a+a{justify-content:center;font-weight:500}",
  ".item nav a,.store-contact nav a{display:inline-flex;align-items:center;min-height:44px}",
  ".info{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.info section{padding:20px 24px;border:1px solid #e1e6e2;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgb(24 33 29/.05)}.info h2{margin-top:0;font-size:18px}",
  ".powered{margin-top:32px;font-size:13px;color:#68746e}.preview{padding:10px 14px;border-radius:10px;background:#fdf6e7;color:#93500b}",
].join("");
// Loaded after the shared brand styles so the shop page header and contact card match the page.
const shopBrandCss =
  ".store-brand{border-radius:16px;padding:28px 24px}.store-brand h1{font-size:clamp(26px,4vw,36px);letter-spacing:-.02em}.store-contact{margin:40px 0 0;padding:20px 24px;border:1px solid #e1e6e2;border-radius:14px;background:#fff}.store-contact p{margin:0 0 8px;color:#3a4641}.store-contact nav{gap:12px}.store-contact nav a{padding:0 20px;border:1px solid #cbd3ce;border-radius:999px;text-decoration:none;font-weight:600;color:#18211d}";
export function shopPageHtml({ page, brand, photos, items, slug, preview = false }) {
  const base = `/shop/${encodeURIComponent(slug)}`,
    [hero, ...rest] = photos,
    tryAll = tryOnLink(page, brand),
    external = (href) =>
      href.startsWith("https:") ? ' target="_blank" rel="noopener noreferrer"' : "";
  const photo = (p, cls) =>
    `<img${cls ? ` class="${cls}"` : ""} src="${base}/photos/${escape(p.id)}" alt="${escape(p.caption || `${brand.displayName} shop photo`)}" loading="lazy">`;
  const item = (g) => {
    const label = [g.name, g.variant].filter(Boolean).join(" — "),
      link = tryOnLink(page, brand, label),
      online = httpsUrl(g.sourceUrl),
      price = page.showPrices ? money(g.priceInr) : "",
      mrp = page.showPrices && g.mrpInr > g.priceInr ? money(g.mrpInr) : "";
    return `<article class="item"><img src="${base}/items/${encodeURIComponent(g.id)}/image" alt="${escape(label)}" loading="lazy"><h3>${escape(g.name)}</h3>${g.variant ? `<small>${escape(g.variant)}</small>` : ""}${price ? `<span class="price">${escape(price)}${mrp ? `<s>${escape(mrp)}</s>` : ""}</span>` : ""}${g.stock === "low" ? '<span class="low">Only a few left</span>' : ""}<nav>${link ? `<a href="${escape(link)}"${external(link)}>Try it on</a>` : ""}${online ? `<a href="${escape(online)}" target="_blank" rel="noopener noreferrer">View online</a>` : ""}</nav></article>`;
  };
  const info = [
    page.about ? `<section><h2>About us</h2><p>${escape(page.about)}</p></section>` : "",
    page.hours ? `<section><h2>Opening hours</h2><p>${escape(page.hours)}</p></section>` : "",
  ].join("");
  const body = `${preview ? '<p class="preview" role="status">Preview: only your store team can see this page until it is published.</p>' : ""}${brandHeader(brand, `${base}/logo`)}${page.tagline ? `<p class="tagline">${escape(page.tagline)}</p>` : ""}${tryAll ? `<a class="cta" href="${escape(tryAll)}"${external(tryAll)}>Book a try-on</a>` : ""}${hero ? photo(hero, "hero") : ""}${info ? `<div class="info">${info}</div>` : ""}${rest.length ? `<h2>Inside our shop</h2><div class="gallery">${rest.map((p) => `<figure>${photo(p)}${p.caption ? `<figcaption>${escape(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}${page.showCatalogue && items.length ? `<h2>In store now</h2><p>See a piece you like? Tap “Try it on” and the store will set up a virtual try-on on your own avatar.</p><div class="items">${items.map(item).join("")}</div>` : ""}${brandContact(brand)}<p class="powered">Virtual try-on by Forme. Try-on images are an approximate visual guide and do not predict size or fit.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escape(brand.displayName)}</title><meta name="theme-color" content="${brand.primaryColor}"><link rel="manifest" href="${base}/manifest.webmanifest"><link rel="icon" type="image/png" sizes="192x192" href="${base}/icon-192.png"><link rel="apple-touch-icon" href="${base}/icon-180.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="${escape(brand.displayName.slice(0, 30))}">${page.tagline ? `<meta name="description" content="${escape(page.tagline)}">` : ""}<meta property="og:title" content="${escape(brand.displayName)}"><style>${css}${brandCss}${shopBrandCss}</style></head><body><main style="--brand:${brand.primaryColor};--brand-ink:${brandInk(brand.primaryColor)}">${body}</main></body></html>`;
}

// One public model of the page for the web page and for app clients (iOS, Android,
// tablets, kiosks). Image links are relative to the studio origin.
export function shopData({ page, brand, photos, items, slug }) {
  const base = `/shop/${encodeURIComponent(slug)}`;
  return {
    version: 1,
    slug,
    url: base,
    store: {
      name: brand.displayName,
      primaryColor: brand.primaryColor,
      textColor: brandInk(brand.primaryColor),
      logo: brand.hasLogo ? `${base}/logo` : null,
      icon: `${base}/icon-512.png`,
      phone: brand.phone || null,
      address: brand.address || null,
      mapUrl: brand.mapUrl || null,
      whatsapp: page.whatsapp || null,
    },
    tagline: page.tagline,
    about: page.about,
    hours: page.hours,
    bookTryOn: tryOnLink(page, brand) || null,
    photos: photos.map((p, i) => ({
      id: p.id,
      caption: p.caption,
      cover: i === 0,
      image: `${base}/photos/${encodeURIComponent(p.id)}`,
    })),
    items: page.showCatalogue
      ? items.map((g) => {
          const label = [g.name, g.variant].filter(Boolean).join(" — ");
          return {
            id: g.id,
            name: g.name,
            variant: g.variant || "",
            category: g.category,
            type: g.garmentType,
            stock: g.stock,
            priceInr: page.showPrices && typeof g.priceInr === "number" ? g.priceInr : null,
            mrpInr:
              page.showPrices && typeof g.mrpInr === "number" && g.mrpInr > g.priceInr
                ? g.mrpInr
                : null,
            image: `${base}/items/${encodeURIComponent(g.id)}/image`,
            tryOn: tryOnLink(page, brand, label) || null,
            productUrl: httpsUrl(g.sourceUrl) || null,
          };
        })
      : [],
  };
}
export async function shopIcon(brand, logo, size) {
  const inset = Math.round(size * 0.14),
    background = {
      create: { width: size, height: size, channels: 4, background: brand.primaryColor },
    };
  if (logo) {
    const mark = await sharp(Buffer.from(logo))
      .resize(size - inset * 2, size - inset * 2, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return sharp(background)
      .composite([{ input: mark, left: inset, top: inset }])
      .png()
      .toBuffer();
  }
  const letter = escape([...brand.displayName.trim()][0]?.toUpperCase() || "S");
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${brand.primaryColor}"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="${Math.round(size * 0.55)}" fill="${brandInk(brand.primaryColor)}">${letter}</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
}
const publicHeaders = (res) =>
  res.set({
    "Cache-Control": "public, max-age=60",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self'; manifest-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
const missing = (res) =>
  publicHeaders(res)
    .set("Cache-Control", "no-store")
    .status(404)
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Shop page unavailable</title><style>body{margin:0;padding:24px 16px;background:#f7f8f3;color:#233d31;font:16px/1.6 system-ui,sans-serif}main{max-width:560px;margin:auto}</style></head><body><main><h1>This shop page is not available.</h1><p>Check the address, or ask the store for its current link.</p></main></body></html>`,
    );

export function installShopPageRoutes(app, store, { requireUser, sameOrigin, wrap, viewer }) {
  const pages = store.shopPages,
    staff = requireRole("owner", "manager", "staff"),
    editors = requireRole("owner", "manager");
  app.get(
    "/api/shop-page",
    requireUser,
    staff,
    wrap((req, res) => res.json(pages.read(req.account.id))),
  );
  app.put(
    "/api/shop-page",
    sameOrigin,
    requireUser,
    editors,
    wrap((req, res) => res.json(pages.update(req.account, req.body))),
  );
  app.post(
    "/api/shop-page/photos",
    sameOrigin,
    requireUser,
    editors,
    wrap(async (req, res) => res.status(201).json(await pages.addPhoto(req.account, req.body))),
  );
  app.patch(
    "/api/shop-page/photos/:id",
    sameOrigin,
    requireUser,
    editors,
    wrap((req, res) => res.json(pages.updatePhoto(req.account, req.params.id, req.body))),
  );
  app.delete(
    "/api/shop-page/photos/:id",
    sameOrigin,
    requireUser,
    editors,
    wrap((req, res) => res.json(pages.removePhoto(req.account, req.params.id))),
  );
  const pub = (fn) => async (req, res) => {
    try {
      let row = pages.bySlug(req.params.slug);
      if (!row && viewer) {
        row = pages.bySlug(req.params.slug, viewer(req)?.id ?? null);
        if (row) {
          // Private preview: never cache or index an unpublished page.
          const send = res.send.bind(res);
          res.send = (body) => {
            res.set({ "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" });
            return send(body);
          };
        }
      }
      if (!row) return missing(res);
      await fn(req, res, row);
    } catch {
      if (!res.headersSent) missing(res);
    }
  };
  app.get(
    "/shop/:slug",
    pub((req, res, row) => {
      const brand = store.branding.read(row.store),
        page = settings(row.settingsJson);
      const html = shopPageHtml({
        page,
        brand,
        slug: row.slug,
        photos: pages.photos(row.store),
        items: page.showCatalogue ? pages.catalogue(row.store) : [],
        preview: row.published !== 1,
      });
      publicHeaders(res).type("html").send(html);
    }),
  );
  const model = (row) => {
    const page = settings(row.settingsJson);
    return shopData({
      page,
      brand: store.branding.read(row.store),
      slug: row.slug,
      photos: pages.photos(row.store),
      items: page.showCatalogue ? pages.catalogue(row.store) : [],
    });
  };
  // Read-only feed for the iOS/Android apps and other clients. It carries only what
  // the public page already shows, so any origin may read it without credentials.
  app.get(
    "/shop/:slug/data.json",
    pub((req, res, row) => {
      publicHeaders(res).set({ "Access-Control-Allow-Origin": "*", Vary: "Origin" });
      res.json({ ...model(row), published: row.published === 1 });
    }),
  );
  app.get(
    "/shop/:slug/manifest.webmanifest",
    pub((req, res, row) => {
      const data = model(row);
      publicHeaders(res)
        .type("application/manifest+json")
        .send(
          JSON.stringify({
            name: data.store.name,
            short_name: data.store.name.slice(0, 12),
            description: data.tagline || undefined,
            start_url: data.url,
            scope: data.url,
            display: "standalone",
            orientation: "any",
            theme_color: data.store.primaryColor,
            background_color: "#f7f8f3",
            icons: [192, 512].map((size) => ({
              src: `${data.url}/icon-${size}.png`,
              sizes: `${size}x${size}`,
              type: "image/png",
              purpose: "any",
            })),
          }),
        );
    }),
  );
  app.get(
    "/shop/:slug/icon-:size.png",
    pub(async (req, res, row) => {
      const size = Number(req.params.size);
      if (![180, 192, 512].includes(size)) return missing(res);
      const icon = await shopIcon(
        store.branding.read(row.store),
        store.branding.logo(row.store),
        size,
      );
      publicHeaders(res).set("Cache-Control", "public, max-age=3600").type("png").send(icon);
    }),
  );
  app.get(
    "/shop/:slug/logo",
    pub((req, res, row) => {
      const logo = store.branding.logo(row.store);
      if (!logo) return missing(res);
      publicHeaders(res).type("png").send(Buffer.from(logo));
    }),
  );
  app.get(
    "/shop/:slug/photos/:id",
    pub((req, res, row) => {
      const image = pages.photo(row.store, req.params.id);
      if (!image) return missing(res);
      publicHeaders(res)
        .set("Cache-Control", "public, max-age=3600")
        .type("jpeg")
        .send(Buffer.from(image));
    }),
  );
  app.get(
    "/shop/:slug/items/:id/image",
    pub(async (req, res, row) => {
      if (!settings(row.settingsJson).showCatalogue) return missing(res);
      const image = await pages.itemImage(row.store, req.params.id);
      if (!image) return missing(res);
      publicHeaders(res).set("Cache-Control", "public, max-age=600").type("jpeg").send(image);
    }),
  );
}
