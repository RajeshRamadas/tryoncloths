import {installCatalogueSchema,requireCatalogueSpace,catalogueLimit,transaction,assertCatalogueWritable,catalogueFields} from './catalogue-fields.js';
import {catalogueCategory,jewelleryTypes,jewelleryMetals,validateAttributes,visualAttributes} from './jewellery-types.js';
import {validateVariantLink,variantParent} from './jewellery-variants.js';
import sharp from 'sharp';
import {overlayAsset} from './jewellery-overlay.js';
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

export async function productImage(value) {
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

const metadata = row => ({hasOverlay:Boolean(row.hasOverlay??row.overlayPng),overlayAnchor:row.overlayAnchor||null,category:row.category||'garment',attributes:row.category==='jewellery'?{...JSON.parse(row.attributesJson||'{}'),...(variantParent(row)?{variantOf:variantParent(row)}:{})}:{},readOnly:Boolean(row.readOnly),sharedFrom:row.sharedFrom||null,needsTypeReview:Boolean(row.needsTypeReview), id: row.id, name: row.name, garmentType: row.garmentType, variant: ['shopify','woo'].includes(row.source)?[row.colourLabel,...JSON.parse(row.sizesJson||'[]'),row.sku].filter(Boolean).join(' · ').slice(0,80):row.variant,
  sku:row.sku||null,brand:row.brand||'',priceInr:row.priceInr??null,mrpInr:row.mrpInr??null,sizes:JSON.parse(row.sizesJson||'[]'),stock:row.stock||'in',source:row.source||'manual',colourLabel:row.colourLabel||'',updatedAt:row.updatedAt||row.savedAt,
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
    transaction(this.db,()=>{
      if(!this.db.prepare('PRAGMA table_info(garment_results)').all().some(column=>column.name==='view'))
        this.db.exec("ALTER TABLE garment_results ADD COLUMN view TEXT NOT NULL DEFAULT 'full'");
      if(!this.db.prepare('PRAGMA table_info(garment_results)').all().some(c=>c.name==='previewMode'))this.db.exec("ALTER TABLE garment_results ADD COLUMN previewMode TEXT NOT NULL DEFAULT 'ai'");
    });
    installCatalogueSchema(this.db);
  }
  row(account, id, options={}) {
    const category=catalogueCategory(options.category,options);
    const row = typeof id === 'string' && this.db.prepare('SELECT * FROM catalogue_visible WHERE account=? AND id=? AND category=?').get(account.id, id,category);
    if (!row) throw problem('Garment not found.', 404);
    if(row.readOnly)this.mirror(account,row);
    return row;
  }
  mirror(account,row){
    transaction(this.db,()=>{
      const previous=this.db.prepare('SELECT imageHash,garmentType,name,externalId,updatedAt,stock,needsTypeReview,category,attributesJson,overlayPng,overlayAnchor FROM garments WHERE account=? AND id=?').get(account.id,row.id);
      if(previous&&previous.imageHash===row.imageHash&&previous.garmentType===row.garmentType&&previous.name===row.name&&previous.externalId===row.sharedFrom+':'+row.sharedId&&previous.updatedAt===row.updatedAt&&previous.stock===row.stock&&previous.needsTypeReview===row.needsTypeReview&&previous.category===row.category&&previous.attributesJson===row.attributesJson&&previous.overlayAnchor===row.overlayAnchor&&Buffer.from(previous.overlayPng||[]).equals(Buffer.from(row.overlayPng||[])))return;
      if(previous&&(previous.imageHash!==row.imageHash||previous.garmentType!==row.garmentType||previous.name!==row.name||previous.externalId!==row.sharedFrom+':'+row.sharedId||previous.category!==row.category||JSON.stringify(visualAttributes(JSON.parse(previous.attributesJson)))!==JSON.stringify(visualAttributes(JSON.parse(row.attributesJson)))))this.db.prepare('DELETE FROM garment_results WHERE account=? AND garmentId=?').run(account.id,row.id);
      const columns=this.db.prepare('PRAGMA table_info(garments)').all().map(c=>c.name),values={...row,source:'master',variant:row.id,externalId:row.sharedFrom+':'+row.sharedId};
      this.db.prepare(`INSERT INTO garments(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ON CONFLICT(account,id) DO UPDATE SET ${columns.filter(c=>!['account','id'].includes(c)).map(c=>c+'=excluded.'+c).join(',')}`).run(...columns.map(c=>values[c]));
    });
  }
  describe(row){return metadata(row);}
  list(account,options={}) {
    const category=catalogueCategory(options.category,options);
    return this.db.prepare('SELECT g.id,g.name,g.garmentType,g.variant,g.sourceUrl,g.thumbnail,g.savedAt,g.sku,g.brand,g.priceInr,g.mrpInr,g.sizesJson,g.stock,g.colourLabel,g.source,g.updatedAt,g.needsTypeReview,g.category,g.attributesJson,g.overlayAnchor,(g.overlayPng IS NOT NULL) AS hasOverlay,g.sharedFrom,g.readOnly,(SELECT count(*) FROM garment_results r WHERE r.account=g.account AND r.garmentId=g.id) AS adaptations FROM catalogue_visible g WHERE g.account=? AND g.category=? ORDER BY g.savedAt DESC').all(account.id,category).map(metadata);
  }
  browse(account,query={},options={}) {
    const category=catalogueCategory(query.category,options),types=category==='jewellery'?jewelleryTypes:garmentTypes;
    const search=query.search??'',type=query.type??'all',stock=query.stock??'available',offset=String(query.offset??0),limit=String(query.limit??100);
    if(typeof search!=='string'||search.length>120||typeof type!=='string'||(type!=='all'&&!Object.hasOwn(types,type))||!['available','all','in','low','out'].includes(stock)||!/^\d+$/.test(offset)||Number(offset)>50000||!/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>200)throw problem('Use valid catalogue filters and a page size from 1 to 200.');
    const where=['g.account=?','g.category=?'],args=[account.id,category];
    const metal=query.metal??'all';if(metal!=='all'){if(category!=='jewellery'||!jewelleryMetals.some(([id])=>id===metal))throw problem('Choose a supported jewellery metal filter.');where.push("json_extract(g.attributesJson,'$.metal')=?");args.push(metal);}
    if(type!=='all'){where.push('g.garmentType=?');args.push(type);}
    if(stock==='available')where.push("g.stock<>'out'");else if(stock!=='all'){where.push('g.stock=?');args.push(stock);}
    if(search.trim()){where.push("(g.name LIKE ? ESCAPE '\\' OR g.variant LIKE ? ESCAPE '\\' OR g.sku LIKE ? ESCAPE '\\' OR g.brand LIKE ? ESCAPE '\\' OR g.colourLabel LIKE ? ESCAPE '\\')");const pattern='%'+search.trim().replace(/[\\%_]/g,'\\$&')+'%';args.push(pattern,pattern,pattern,pattern,pattern);}
    const filter=where.join(' AND '),total=this.db.prepare(`SELECT count(*) AS n FROM catalogue_visible g WHERE ${filter}`).get(...args).n;
    const rows=this.db.prepare(`SELECT g.id,g.name,g.garmentType,g.variant,g.sourceUrl,g.thumbnail,g.savedAt,g.sku,g.brand,g.priceInr,g.mrpInr,g.sizesJson,g.stock,g.colourLabel,g.source,g.updatedAt,g.needsTypeReview,g.category,g.attributesJson,g.overlayAnchor,(g.overlayPng IS NOT NULL) AS hasOverlay,g.sharedFrom,g.readOnly,(SELECT count(*) FROM garment_results r WHERE r.account=g.account AND r.garmentId=g.id) AS adaptations FROM catalogue_visible g WHERE ${filter} ORDER BY g.savedAt DESC,g.id LIMIT ? OFFSET ?`).all(...args,Number(limit),Number(offset));
    return {garments:rows.map(metadata),total,offset:Number(offset),limit:Number(limit),capacity:catalogueLimit(this.db,account),stored:this.db.prepare('SELECT count(*) AS n FROM garments WHERE account=? AND source<>\'master\'').get(account.id).n};
  }
  get(account, id, options={}) { const row = this.row(account, id,options); return { ...metadata(row), image: png(row.image),...(row.category==='jewellery'&&row.overlayPng?{overlayPng:png(row.overlayPng)}:{}) }; }
  async matches(account, input, options={}) {
    const category=catalogueCategory(input.category,options);
    if (!input.url && !input.image) throw problem('Supply a product link or photo.');
    const url = canonicalProductUrl(input.url), photo = input.image ? await productImage(input.image) : null;
    // Scan signatures without loading every product thumbnail into memory.
    const exactIds = photo ? this.db.prepare("SELECT id FROM catalogue_visible WHERE account=? AND category=? AND imageHash=? AND stock<>'out' ORDER BY savedAt DESC").all(account.id,category,photo.imageHash).map(r=>r.id) : [];
    const exactSet=new Set(exactIds);
    const linkedIds=url ? this.db.prepare("SELECT g.id FROM catalogue_visible g JOIN garment_links l ON l.account=COALESCE(g.sharedFrom,g.account) AND l.garmentId=COALESCE(g.sharedId,g.id) WHERE g.account=? AND g.category=? AND l.sourceUrl=? AND g.stock<>'out' ORDER BY g.savedAt DESC").all(account.id,category,url).map(r=>r.id) : [];
    const linkedSet=new Set(linkedIds),similarIds=[];
    if(photo)for(const row of this.db.prepare("SELECT id,signature,colour FROM catalogue_visible WHERE account=? AND category=? AND stock<>'out' ORDER BY savedAt DESC").iterate(account.id,category)){
      if(exactSet.has(row.id)||linkedSet.has(row.id))continue;
      let diff=BigInt(`0x${row.signature}`)^BigInt(`0x${photo.signature}`),distance=0;while(diff){distance++;diff&=diff-1n;}
      const a=JSON.parse(row.colour),b=JSON.parse(photo.colour);
      if(distance<=6&&a.reduce((n,c,i)=>n+(c-b[i])**2,0)<=1600)similarIds.push(row.id);
      if(similarIds.length===6)break;
    }
    const read=ids=>ids.slice(0,6).map(id=>metadata(this.db.prepare('SELECT id,name,garmentType,variant,sourceUrl,thumbnail,savedAt,sku,brand,priceInr,mrpInr,sizesJson,stock,colourLabel,source,updatedAt,needsTypeReview,category,attributesJson,overlayAnchor,(overlayPng IS NOT NULL) AS hasOverlay,sharedFrom,readOnly FROM catalogue_visible WHERE account=? AND id=?').get(account.id,id)));
    return {exact:read(exactIds),linked:read(linkedIds.filter(id=>!exactSet.has(id))),similar:read(similarIds)};
  }

  async save(account, input, options={}) {
    const category=catalogueCategory(input.category,options),types=category==='jewellery'?jewelleryTypes:garmentTypes;
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const variant = typeof input.variant === 'string' ? input.variant.trim() : '';
    if (!name || name.length > 100 || variant.length > 80 || !Object.hasOwn(types, input.garmentType)) throw problem('Enter a product name, supported type and optional colour/size/SKU variant.');
    const attributes=category==='jewellery'?validateAttributes(input.garmentType,input.attributes):{};
    if(category==='garment'&&input.attributes!==undefined&&(!input.attributes||typeof input.attributes!=='object'||Array.isArray(input.attributes)||Object.keys(input.attributes).length))throw problem('Jewellery attributes require the jewellery catalogue category.');
    if(category==='garment'&&(input.overlayPng!==undefined||input.overlayAnchor!==undefined))throw problem('Jewellery cut-outs require the jewellery catalogue category.');
    const attributesJson=JSON.stringify(attributes),fields=category==='jewellery'?catalogueFields(input):null;
    const sourceUrl = canonicalProductUrl(input.sourceUrl), photo = await productImage(input.image);
    const overlay=input.overlayPng===undefined?null:await overlayAsset(input.overlayPng,input.overlayAnchor,input.garmentType);
    return transaction(this.db,()=>{
    if(category==='jewellery'){
      options.guard?.();
      validateVariantLink(this.db,account,null,input.garmentType,attributes);
      const actor=account.user&&this.accounts.identity(account.user.id,account.id);
      if(!actor||actor.org!==account.org||!['owner','manager'].includes(actor.user.role))throw problem('Only owners and managers can change the jewellery catalogue.',403);
    }
    const samePhotos = this.db.prepare("SELECT id,sourceUrl,attributesJson FROM garments WHERE account=? AND category=? AND source<>'master' AND imageHash=? AND garmentType=? AND lower(variant)=lower(?)").all(account.id,category, photo.imageHash, input.garmentType, variant);
    if (!sourceUrl && samePhotos.length > 1) throw problem('This photo is used by multiple saved products. Choose the correct product in My store clothes or specify its variant.', 409);
    // Identical retailer photos may represent different SKUs/colour variants.
    // A different meaningful URL must not silently collapse those products.
    const duplicate = samePhotos.find(r => !sourceUrl || !r.sourceUrl || r.sourceUrl === sourceUrl);
    if (duplicate) {
      if(category==='jewellery'&&duplicate.attributesJson!==attributesJson)throw problem('This jewellery photo/variant already has different attributes. Edit the saved item or use a distinct metal/stone/SKU variant.',409);
      if(overlay)throw problem('This product is already saved. Use its cut-out editor to attach or replace an overlay.',409);
      this.addLink(account, duplicate.id, sourceUrl);
      return { garment: metadata(this.row(account, duplicate.id,{...options,category})), duplicate: true };
    }
    if (sourceUrl && this.db.prepare('SELECT g.id FROM catalogue_visible g JOIN garment_links l ON l.account=COALESCE(g.sharedFrom,g.account) AND l.garmentId=COALESCE(g.sharedId,g.id) WHERE g.account=? AND g.category=? AND l.sourceUrl=? AND g.garmentType=? AND lower(g.variant)=lower(?)').get(account.id,category, sourceUrl, input.garmentType, variant))
      throw problem('That product and variant are already saved. Use My store clothes, or give this different photo its own colour/size/SKU variant.', 409);
    requireCatalogueSpace(this.db,account);
    const id = randomBytes(16).toString('hex'), savedAt = Date.now();
    this.db.prepare('INSERT INTO garments(account,id,name,garmentType,variant,sourceUrl,imageHash,signature,colour,image,thumbnail,savedAt,updatedAt,category,attributesJson) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(account.id, id, name, input.garmentType, variant, sourceUrl, photo.imageHash, photo.signature, photo.colour, photo.image, photo.thumbnail, savedAt, savedAt,category,attributesJson);
    if(overlay)this.db.prepare('UPDATE garments SET overlayPng=?,overlayAnchor=? WHERE account=? AND id=?').run(overlay,input.overlayAnchor,account.id,id);
    if(fields)this.db.prepare('UPDATE garments SET sku=?,brand=?,priceInr=?,mrpInr=?,sizesJson=?,stock=?,colourLabel=? WHERE account=? AND id=?').run(fields.sku,fields.brand,fields.priceInr,fields.mrpInr,fields.sizesJson,fields.stock,fields.colourLabel,account.id,id);
    this.addLink(account, id, sourceUrl);
    return { garment: metadata(this.row(account, id,{...options,category})), duplicate: false };
    });
  }
  addLink(account, id, sourceUrl) {
    if (!sourceUrl) return;
    if (this.db.prepare('SELECT count(*) AS n FROM garment_links WHERE account=? AND garmentId=?').get(account.id, id).n >= 10) return;
    this.db.prepare('INSERT OR IGNORE INTO garment_links VALUES(?,?,?)').run(account.id, id, sourceUrl);
    this.db.prepare("UPDATE garments SET sourceUrl=? WHERE account=? AND id=? AND sourceUrl=''").run(sourceUrl, account.id, id);
  }
  remove(account, id, options={}) { const category=catalogueCategory(options.category,options);assertCatalogueWritable(this.db,account,id);return this.db.prepare('DELETE FROM garments WHERE account=? AND id=? AND category=?').run(account.id, id,category).changes > 0; }
  async context(account, input, { provider, model }) {
    this.accounts.requireAvatar(account, input.avatarId);
    const garment = this.row(account, input.garmentId);
    if(garment.needsTypeReview)throw problem('Ask an owner or manager to confirm this product’s clothing type in Store catalogue before using it.',409);
    if (garment.garmentType !== input.garmentType) throw problem('Use the saved garment category, or save it as a different item.');
    const bodyType = input.bodyType || 'male';
    const avatarRow = this.db.prepare('SELECT body_type FROM avatars WHERE account=? AND id=?').get(account.id, input.avatarId);
    if (bodyType !== avatarRow.body_type) throw problem('Use the saved avatar body library.');
    let avatar;
    try { avatar = await normalizeAvatar(input.avatar); } catch { throw problem('Use a valid approved avatar PNG.'); }
    this.accounts.requireAvatar(account, input.avatarId); const latest=this.row(account, input.garmentId);
    if(latest.imageHash!==garment.imageHash||latest.garmentType!==garment.garmentType||latest.name!==garment.name)throw problem('The product changed while loading. Review it again before generating.',409);
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
    this.db.prepare('INSERT INTO garment_results(account,id,avatarId,garmentId,image,savedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(account,id) DO NOTHING').run(account.id, receipt.id, receipt.avatarId, garmentId, image, Date.now());
    return { id: receipt.id };
  }
  removeResult(account, garmentId, id) {
    this.row(account,garmentId);
    return this.db.prepare('DELETE FROM garment_results WHERE account=? AND garmentId=? AND id=?').run(account.id, garmentId, id).changes > 0;
  }
}
