import sharp from 'sharp';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { parseProductUrl } from './public-url.js';
import { garmentTypes, normalizeAvatar } from './gemini-tryon.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
export const ADAPTATION_REVISION = 'garment-catalogue-v1';
const png = bytes => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

export function canonicalProductUrl(raw) {
  if (!raw) return '';
  let url;
  try { url = parseProductUrl(raw); } catch { throw problem('Use a public product link without credentials.'); }
  for (const name of [...url.searchParams.keys()])
    if (/^utm_/i.test(name) || ['gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid'].includes(name.toLowerCase())) url.searchParams.delete(name);
  // Amazon product paths have interchangeable human-readable prefixes. Retain
  // all unknown query parameters: they may identify colour/size/SKU variants.
  if (/(^|\.)amazon\.(com|in|co\.uk|de|fr|it|es|ca|com\.au)$/.test(url.hostname)) {
    const asin = /\/(?:dp|gp\/product)\/([a-zA-Z0-9]{10})(?:\/|$)/.exec(url.pathname)?.[1];
    if (asin) { url.pathname = `/dp/${asin.toUpperCase()}`; url.searchParams.delete('ref'); url.searchParams.delete('tag'); }
  }
  url.searchParams.sort();
  return url.href;
}

export async function pixelHash(bytes) {
  const { data, info } = await sharp(bytes, { limitInputPixels: 25_000_000 }).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return digest(Buffer.concat([Buffer.from(`${info.width}x${info.height}:`), data]));
}

async function productImage(value) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof value === 'string' && value.length < 7_000_000 ? value : '');
  if (!match) throw problem('Use a JPEG, PNG or WebP garment photo under 5 MB.');
  try {
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 5 * 1024 * 1024) throw new Error();
    const image = sharp(bytes, { limitInputPixels: 25_000_000, animated: false });
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || meta.width < 160 || meta.height < 160 || (meta.pages || 1) > 1) throw new Error();
    const normalized = await image.rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const thumbnail = await sharp(normalized).resize(160, 160, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    const grey = await sharp(normalized).flatten({ background: '#fff' }).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
    let bits = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | BigInt(grey[y * 9 + x] > grey[y * 9 + x + 1]);
    const colour = [...await sharp(normalized).flatten({ background: '#fff' }).removeAlpha().resize(1, 1, { fit: 'fill' }).raw().toBuffer()];
    return { image: normalized, thumbnail, imageHash: await pixelHash(normalized), signature: bits.toString(16).padStart(16, '0'), colour: JSON.stringify(colour) };
  } catch { throw problem('Use a valid garment photo at least 160 × 160 pixels and under 5 MB.'); }
}

const metadata = row => ({ id: row.id, name: row.name, garmentType: row.garmentType, variant: row.variant,
  sourceUrl: row.sourceUrl, savedAt: row.savedAt, adaptations: row.adaptations || 0,
  thumbnail: `data:image/jpeg;base64,${Buffer.from(row.thumbnail).toString('base64')}` });

export class GarmentStore {
  constructor(accounts) {
    this.accounts = accounts; this.db = accounts.db;
    // Receipts keep unsaved customer outputs out of persistent storage. Their
    // signature binds the actual provider result to its exact input context.
    this.receiptKey = randomBytes(32);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS garments (
        account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL,
        name TEXT NOT NULL, garmentType TEXT NOT NULL, variant TEXT NOT NULL, sourceUrl TEXT NOT NULL,
        imageHash TEXT NOT NULL, signature TEXT NOT NULL, colour TEXT NOT NULL,
        image BLOB NOT NULL, thumbnail BLOB NOT NULL, savedAt INTEGER NOT NULL,
        PRIMARY KEY(account,id), UNIQUE(account,imageHash,garmentType,variant,sourceUrl));
      CREATE INDEX IF NOT EXISTS garments_link ON garments(account,sourceUrl);
      CREATE TABLE IF NOT EXISTS garment_links (
        account TEXT NOT NULL, garmentId TEXT NOT NULL, sourceUrl TEXT NOT NULL,
        PRIMARY KEY(account,garmentId,sourceUrl),
        FOREIGN KEY(account,garmentId) REFERENCES garments(account,id) ON DELETE CASCADE);
      INSERT OR IGNORE INTO garment_links SELECT account,id,sourceUrl FROM garments WHERE sourceUrl<>'';
      CREATE TABLE IF NOT EXISTS garment_results (
        account TEXT NOT NULL, id TEXT NOT NULL, avatarId TEXT NOT NULL, garmentId TEXT NOT NULL,
        image BLOB NOT NULL, savedAt INTEGER NOT NULL,
        PRIMARY KEY(account,id),
        FOREIGN KEY(account,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE,
        FOREIGN KEY(account,garmentId) REFERENCES garments(account,id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS garment_results_item ON garment_results(account,garmentId);
      CREATE INDEX IF NOT EXISTS garment_results_avatar ON garment_results(account,avatarId);
    `);
  }
  row(account, id) {
    const row = typeof id === 'string' && this.db.prepare('SELECT * FROM garments WHERE account=? AND id=?').get(account.id, id);
    if (!row) throw problem('Garment not found.', 404);
    return row;
  }
  list(account) {
    return this.db.prepare('SELECT g.id,g.name,g.garmentType,g.variant,g.sourceUrl,g.thumbnail,g.savedAt,(SELECT count(*) FROM garment_results r WHERE r.account=g.account AND r.garmentId=g.id) AS adaptations FROM garments g WHERE g.account=? ORDER BY g.savedAt DESC').all(account.id).map(metadata);
  }
  get(account, id) { const row = this.row(account, id); return { ...metadata(row), image: png(row.image) }; }
  async matches(account, input) {
    if (!input.url && !input.image) throw problem('Supply a product link or photo.');
    const url = canonicalProductUrl(input.url), photo = input.image ? await productImage(input.image) : null;
    const rows = this.db.prepare('SELECT id,name,garmentType,variant,sourceUrl,thumbnail,savedAt,imageHash,signature,colour FROM garments WHERE account=? ORDER BY savedAt DESC').all(account.id);
    const exact = photo ? rows.filter(r => r.imageHash === photo.imageHash) : [];
    const linkedIds = new Set(url ? this.db.prepare('SELECT garmentId FROM garment_links WHERE account=? AND sourceUrl=?').all(account.id, url).map(r => r.garmentId) : []);
    const linked = rows.filter(r => linkedIds.has(r.id) && !exact.some(x => x.id === r.id));
    const similar = photo ? rows.filter(r => {
      if (exact.some(x => x.id === r.id) || linked.some(x => x.id === r.id)) return false;
      let diff = BigInt(`0x${r.signature}`) ^ BigInt(`0x${photo.signature}`), distance = 0;
      while (diff) { distance++; diff &= diff - 1n; }
      const a = JSON.parse(r.colour), b = JSON.parse(photo.colour);
      return distance <= 6 && a.reduce((n, c, i) => n + (c - b[i]) ** 2, 0) <= 1600;
    }) : [];
    return { exact: exact.slice(0, 6).map(metadata), linked: linked.slice(0, 6).map(metadata), similar: similar.slice(0, 6).map(metadata) };
  }
  async save(account, input) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const variant = typeof input.variant === 'string' ? input.variant.trim() : '';
    if (!name || name.length > 100 || variant.length > 80 || !Object.hasOwn(garmentTypes, input.garmentType)) throw problem('Enter a garment name, category and optional colour/size/SKU variant.');
    const sourceUrl = canonicalProductUrl(input.sourceUrl), photo = await productImage(input.image);
    const samePhotos = this.db.prepare('SELECT id,sourceUrl FROM garments WHERE account=? AND imageHash=? AND garmentType=? AND lower(variant)=lower(?)').all(account.id, photo.imageHash, input.garmentType, variant);
    if (!sourceUrl && samePhotos.length > 1) throw problem('This photo is used by multiple saved products. Choose the correct product in My store clothes or specify its variant.', 409);
    // Identical retailer photos may represent different SKUs/colour variants.
    // A different meaningful URL must not silently collapse those products.
    const duplicate = samePhotos.find(r => !sourceUrl || !r.sourceUrl || r.sourceUrl === sourceUrl);
    if (duplicate) {
      this.addLink(account, duplicate.id, sourceUrl);
      return { garment: metadata(this.row(account, duplicate.id)), duplicate: true };
    }
    if (sourceUrl && this.db.prepare('SELECT g.id FROM garments g JOIN garment_links l ON l.account=g.account AND l.garmentId=g.id WHERE g.account=? AND l.sourceUrl=? AND g.garmentType=? AND lower(g.variant)=lower(?)').get(account.id, sourceUrl, input.garmentType, variant))
      throw problem('That product and variant are already saved. Use My store clothes, or give this different photo its own colour/size/SKU variant.', 409);
    if (this.db.prepare('SELECT count(*) AS n FROM garments WHERE account=?').get(account.id).n >= 200) throw problem('Your store holds up to 200 garments. Delete an unused garment before adding another.', 409);
    const id = randomBytes(16).toString('hex'), savedAt = Date.now();
    this.db.prepare('INSERT INTO garments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(account.id, id, name, input.garmentType, variant, sourceUrl, photo.imageHash, photo.signature, photo.colour, photo.image, photo.thumbnail, savedAt);
    this.addLink(account, id, sourceUrl);
    return { garment: metadata(this.row(account, id)), duplicate: false };
  }
  addLink(account, id, sourceUrl) {
    if (!sourceUrl) return;
    if (this.db.prepare('SELECT count(*) AS n FROM garment_links WHERE account=? AND garmentId=?').get(account.id, id).n >= 10) return;
    this.db.prepare('INSERT OR IGNORE INTO garment_links VALUES(?,?,?)').run(account.id, id, sourceUrl);
    this.db.prepare("UPDATE garments SET sourceUrl=? WHERE account=? AND id=? AND sourceUrl=''").run(sourceUrl, account.id, id);
  }
  remove(account, id) { return this.db.prepare('DELETE FROM garments WHERE account=? AND id=?').run(account.id, id).changes > 0; }
  async context(account, input, { provider, model }) {
    this.accounts.requireAvatar(account, input.avatarId);
    const garment = this.row(account, input.garmentId);
    if (garment.garmentType !== input.garmentType) throw problem('Use the saved garment category, or save it as a different item.');
    const bodyType = input.bodyType || 'male';
    const avatarRow = this.db.prepare('SELECT body_type FROM avatars WHERE account=? AND id=?').get(account.id, input.avatarId);
    if (bodyType !== avatarRow.body_type) throw problem('Use the saved avatar body library.');
    let avatar;
    try { avatar = await normalizeAvatar(input.avatar); } catch { throw problem('Use a valid approved avatar PNG.'); }
    this.accounts.requireAvatar(account, input.avatarId); this.row(account, input.garmentId);
    const id = digest(JSON.stringify({ avatarId: input.avatarId, baseHash: await pixelHash(avatar),
      garmentId: garment.id, garmentHash: garment.imageHash, garmentType: garment.garmentType, bodyType,
      provider, model, revision: ADAPTATION_REVISION, title: garment.name }));
    return { id, avatarId: input.avatarId, garmentId: garment.id, avatar, garment };
  }
  cached(account, context) {
    const row = this.db.prepare('SELECT image FROM garment_results WHERE account=? AND id=? AND avatarId=? AND garmentId=?').get(account.id, context.id, context.avatarId, context.garmentId);
    return row ? { id: context.id, image: png(row.image) } : null;
  }
  async receipt(account, context, image) {
    const normalized = await normalizeAvatar(image);
    const payload = Buffer.from(JSON.stringify({ account: account.id, id: context.id, avatarId: context.avatarId,
      garmentId: context.garmentId, outputHash: await pixelHash(normalized), expires: Date.now() + 24 * 3600000 })).toString('base64url');
    return `${payload}.${createHmac('sha256', this.receiptKey).update(payload).digest('hex')}`;
  }
  async saveResult(account, garmentId, input) {
    if (input.reviewed !== true || input.storageConsent !== true) throw problem('Review the adaptation and confirm customer agreement before saving it for reuse.');
    let receipt;
    try {
      if (typeof input.receipt !== 'string' || input.receipt.length > 2048) throw new Error();
      const [payload, signature, extra] = input.receipt.split('.');
      const expected = createHmac('sha256', this.receiptKey).update(payload).digest();
      if (extra || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new Error();
      receipt = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (receipt.account !== account.id || receipt.garmentId !== garmentId || receipt.expires < Date.now()) throw new Error();
    } catch { throw problem('This adaptation cannot be saved for automatic reuse after a restart or expired session receipt. You can still save the image as a look; do not regenerate it just to save it.'); }
    this.accounts.requireAvatar(account, receipt.avatarId); this.row(account, garmentId);
    let image;
    try { image = await normalizeAvatar(input.image); } catch { throw problem('Use the original generated adaptation PNG.'); }
    if (await pixelHash(image) !== receipt.outputHash) throw problem('The image changed after generation. Save the original adaptation before adding other layers.');
    this.accounts.requireAvatar(account, receipt.avatarId); this.row(account, garmentId);
    const exists = this.db.prepare('SELECT id FROM garment_results WHERE account=? AND id=?').get(account.id, receipt.id);
    if (!exists && this.db.prepare('SELECT count(*) AS n FROM garment_results WHERE account=?').get(account.id).n >= 200)
      throw problem('Your store holds up to 200 saved adaptations. Remove an unused result or garment first.', 409);
    this.db.prepare('INSERT INTO garment_results VALUES(?,?,?,?,?,?) ON CONFLICT(account,id) DO NOTHING').run(account.id, receipt.id, receipt.avatarId, garmentId, image, Date.now());
    return { id: receipt.id };
  }
  removeResult(account, garmentId, id) {
    return this.db.prepare('DELETE FROM garment_results WHERE account=? AND garmentId=? AND id=?').run(account.id, garmentId, id).changes > 0;
  }
}
