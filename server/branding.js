import sharp from 'sharp';
import {SaxesParser} from 'saxes';
import {randomUUID} from 'node:crypto';
import {transaction} from './catalogue-fields.js';
import {parseProductUrl} from './public-url.js';
import {requireRole} from './tenancy.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const escapeBrand=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const logoError=()=>fail('Use a static PNG, JPEG or SVG logo up to 500 KB. SVG scripts, styles, embedded content and external references are not allowed.');
const elements=new Set(['svg','g','defs','path','rect','circle','ellipse','line','polyline','polygon','linearGradient','radialGradient','stop','clipPath','text','tspan','title','desc']);
const attributes=new Set(['id','width','height','x','y','viewBox','preserveAspectRatio','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','opacity','fill-opacity','stroke-opacity','fill-rule','clip-rule','points','d','transform','clip-path','cx','cy','r','rx','ry','x1','x2','y1','y2','fx','fy','gradientUnits','gradientTransform','spreadMethod','offset','stop-color','stop-opacity','font-size','font-family','font-weight','font-style','text-anchor','dominant-baseline','letter-spacing']);
export function sanitizeLogoSvg(buffer){
 try{
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(buffer),parser=new SaxesParser({xmlns:true}),parts=[];let depth=0,nodes=0,root=false,textLength=0;
  parser.on('doctype',()=>{throw logoError();});parser.on('processinginstruction',()=>{throw logoError();});parser.on('error',()=>{throw logoError();});
  parser.on('opentag',tag=>{
   if(++depth>32||++nodes>5000||!elements.has(tag.local)||tag.uri&&tag.uri!=='http://www.w3.org/2000/svg')throw logoError();
   if(!root){if(tag.local!=='svg')throw logoError();root=true;}else if(tag.local==='svg')throw logoError();
   const values={};for(const attr of Object.values(tag.attributes)){
    if(attr.uri==='http://www.w3.org/2000/xmlns/'){if(attr.value!=='http://www.w3.org/2000/svg')throw logoError();continue;}
    if(attr.uri||attr.prefix||!attributes.has(attr.local)||attr.value.length>200000||/[\\<>]|(?:https?|file|ftp|data|javascript)\s*:|\/\//i.test(attr.value))throw logoError();
    if(/url\s*\(/i.test(attr.value)&&!/^url\(\s*#[A-Za-z_][\w.-]{0,63}\s*\)$/.test(attr.value))throw logoError();
    if(!['id','fill','stroke','stop-color','font-family','preserveAspectRatio'].includes(attr.local)&&[...attr.value.matchAll(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)].some(m=>!Number.isFinite(Number(m[0]))||Math.abs(Number(m[0]))>(attr.local==='font-size'?2048:1000000)))throw logoError();
    values[attr.local]=attr.value;
   }
   if(depth===1){const box=values.viewBox?.trim().split(/[\s,]+/).map(Number),dimension=v=>/^\d+(?:\.\d+)?(?:px)?$/.test(v||'')?parseFloat(v):512;let width=dimension(values.width),height=dimension(values.height);
    if(box){if(box.length!==4||box.some(n=>!Number.isFinite(n))||box[2]<=0||box[3]<=0)throw logoError();width=box[2];height=box[3];}
    if(width<=0||height<=0||width/height>20||height/width>20||width>1000000||height>1000000)throw logoError();values.viewBox=box?box.join(' '):`0 0 ${width} ${height}`;const scale=512/Math.max(width,height);values.width=String(Math.round(width*scale));values.height=String(Math.round(height*scale));values.xmlns='http://www.w3.org/2000/svg';
   }
   parts.push('<'+tag.local+Object.entries(values).map(([key,value])=>` ${key}="${escapeBrand(value)}"`).join('')+'>');
  });
  const addText=value=>{textLength+=value.length;if(textLength>32768)throw logoError();parts.push(escapeBrand(value));};parser.on('closetag',tag=>{parts.push(`</${tag.local}>`);depth--;});parser.on('text',addText);parser.on('cdata',addText);parser.write(xml).close();if(!root||depth)throw logoError();return Buffer.from(parts.join(''));
 }catch{throw logoError();}
}
export async function normalizeLogo(value){
 const match=/^data:image\/(png|jpeg|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof value==='string'&&value.length<700000?value:'');if(!match)throw logoError();
 const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>500*1024)throw logoError();
 try{const safe=match[1]==='svg+xml'?sanitizeLogoSvg(bytes):bytes,image=sharp(safe,{limitInputPixels:4000000,animated:false}),meta=await image.metadata();if(![match[1]==='svg+xml'?'svg':match[1]].includes(meta.format)||!meta.width||!meta.height||(meta.pages||1)>1)throw logoError();return await image.rotate().toColourspace('srgb').resize(512,512,{fit:'inside',withoutEnlargement:true}).png().toBuffer();}catch{throw logoError();}
}
function text(value,max,label){if(typeof value!=='string'||value.trim().length>max||/[\x00-\x1f\x7f]/.test(value))throw fail(`Use ${label} up to ${max} characters without line breaks.`);return value.trim();}
function phone(value){const result=text(value,40,'a phone number').replace(/[\s().-]/g,'');if(result&&!/^\+?\d{8,15}$/.test(result))throw fail('Use a phone number with 8–15 digits and an optional country prefix.');return result;}
function mapUrl(value){const raw=text(value,2048,'a map URL');if(!raw)return '';try{const url=parseProductUrl(raw);url.hash=new URL(raw).hash;if(url.protocol!=='https:'||url.href.length>2048)throw new Error();return url.href;}catch{throw fail('Use a public HTTPS map link without credentials or private addresses.');}}
const fallback=(fn,value,other)=>{try{return fn(value);}catch{return other;}};
export function brandInk(colour){const channels=colour.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4),l=.2126*channels[0]+.7152*channels[1]+.0722*channels[2];return l>.179?'#000000':'#ffffff';}
export function brandHeader(brand,logoUrl){return `<header class="store-brand" style="--brand:${brand.primaryColor};--brand-ink:${brandInk(brand.primaryColor)}">${brand.hasLogo?`<img class="store-logo" src="${escapeBrand(logoUrl)}" alt="${escapeBrand(brand.displayName)} logo">`:''}<h1>${escapeBrand(brand.displayName)}</h1></header>`;}
export function brandContact(brand){return `<footer class="store-contact">${brand.address?`<p>${escapeBrand(brand.address)}</p>`:''}<nav>${brand.phone?`<a href="tel:${escapeBrand(brand.phone)}">Call store</a>`:''}${brand.mapUrl?`<a href="${escapeBrand(brand.mapUrl)}" rel="noreferrer">Get directions</a>`:''}</nav></footer>`;}
export const brandCss='.store-brand{border-radius:12px;padding:20px;background:var(--brand);color:var(--brand-ink);margin-bottom:20px}.store-brand h1{margin:8px 0 0}.store-brand .store-logo{display:block;max-width:240px;max-height:80px;width:auto;height:auto;margin:0;object-fit:contain;border-radius:0}.store-contact{margin:20px 0}.store-contact nav{display:flex;gap:20px;flex-wrap:wrap}.store-contact p{overflow-wrap:anywhere}';
export async function stampTrial(bytes,format='png'){
 const meta=await sharp(bytes,{limitInputPixels:25000000}).metadata(),width=Math.min(meta.width,210),height=Math.min(meta.height,36),overlay=Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><text x="50%" y="65%" text-anchor="middle" font-family="sans-serif" font-size="${Math.min(18,width/8)}" fill="#234b3a">Forme trial</text></svg>`);
 let result=sharp(bytes,{limitInputPixels:25000000}).composite([{input:overlay,gravity:'southeast'}]);if(meta.xmp)result=result.withXmp(meta.xmp.toString());return format==='jpeg'?result.jpeg({quality:90}).toBuffer():result.png().toBuffer();
}
export class BrandingStore {
 constructor(store){this.store=store;this.db=store.db;transaction(this.db,()=>this.db.exec('CREATE TABLE IF NOT EXISTS branding_logos(store TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,image BLOB NOT NULL)'));}
 read(storeId){const row=this.db.prepare('SELECT s.name,s.phone,s.brandingJson,o.status FROM stores s JOIN orgs o ON o.id=s.org WHERE s.id=?').get(storeId);if(!row)throw fail('Store not found.',404);let saved={};try{saved=JSON.parse(row.brandingJson)||{};}catch{}return {displayName:fallback(v=>text(v,80,'a display name'),saved.displayName,row.name)||row.name,primaryColor:typeof saved.primaryColor==='string'&&/^#[a-f0-9]{6}$/i.test(saved.primaryColor)?saved.primaryColor.toLowerCase():'#215b4a',phone:fallback(phone,saved.phone??row.phone??'',''),address:fallback(v=>text(v,300,'an address'),saved.address||'',''),mapUrl:fallback(mapUrl,saved.mapUrl||'',''),exportFooter:saved.exportFooter===true,revision:typeof saved.revision==='string'?saved.revision:'',hasLogo:Boolean(this.db.prepare('SELECT 1 FROM branding_logos WHERE store=?').get(storeId)),trial:row.status==='trial'};}
 actor(account,owner=false){const current=account?.user&&this.store.identity(account.user.id,account.id);if(!current||current.org!==account.org||owner&&current.user.role!=='owner')throw fail('Owner access is required to change store branding.',403);return current;}
 async update(account,input={}){
  this.actor(account,true);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['displayName','primaryColor','phone','address','mapUrl','exportFooter','logo','revision'].includes(k)))throw fail('Use store name, colour, contacts, export footer and an optional logo.');
  const previous=this.read(account.id);if(input.revision!==undefined&&input.revision!==previous.revision)throw fail('Branding changed in another tab. Refresh before saving.',409);const value={...previous,...input};
  const displayName=text(value.displayName,80,'a display name');if(!displayName||typeof value.primaryColor!=='string'||!/^#[a-f0-9]{6}$/i.test(value.primaryColor)||typeof value.exportFooter!=='boolean')throw fail('Enter a display name, six-digit hex colour and export-footer preference.');
  const branding={displayName,primaryColor:value.primaryColor.toLowerCase(),phone:phone(value.phone),address:text(value.address,300,'an address'),mapUrl:mapUrl(value.mapUrl),exportFooter:value.exportFooter,revision:randomUUID()};
  const logo=input.logo===undefined?undefined:input.logo===null?null:await normalizeLogo(input.logo);
  transaction(this.db,()=>{this.actor(account,true);if(this.read(account.id).revision!==previous.revision)throw fail('Branding changed while the logo was processing. Refresh before saving.',409);this.db.prepare('UPDATE stores SET brandingJson=? WHERE id=?').run(JSON.stringify(branding),account.id);if(logo===null)this.db.prepare('DELETE FROM branding_logos WHERE store=?').run(account.id);else if(logo)this.db.prepare('INSERT INTO branding_logos VALUES(?,?) ON CONFLICT(store) DO UPDATE SET image=excluded.image').run(account.id,logo);});return this.read(account.id);
 }
 logo(storeId){return this.db.prepare('SELECT image FROM branding_logos WHERE store=?').get(storeId)?.image;}
 async render(storeId,bytes,{storeFooter,format='png',fixedSize=false}={}){
  const brand=this.read(storeId);if(storeFooter!==undefined&&typeof storeFooter!=='boolean')throw fail('Choose whether to include the store footer.');const footer=!brand.trial&&(storeFooter??brand.exportFooter);if(!footer&&!brand.trial)return Buffer.from(bytes);
  const meta=await sharp(bytes,{limitInputPixels:25000000}).metadata();let result=Buffer.from(bytes);
  if(footer){const width=meta.width,strip=Math.max(64,Math.min(120,Math.round(width/6))),logo=this.logo(storeId),logoWidth=logo?Math.round(width*.22):0,padding=Math.max(8,Math.round(width*.025)),left=logoWidth+padding*2,font=Math.max(10,Math.min(26,Math.round(width/30))),limit=Math.max(8,Math.floor((width-left-padding)/(font*.56))),short=value=>value.length>limit?value.slice(0,Math.max(1,limit-1))+'…':value;
   const svg=Buffer.from(`<svg width="${width}" height="${strip}"><rect width="100%" height="100%" fill="${brand.primaryColor}"/><text x="${left}" y="${Math.round(strip*.42)}" font-family="sans-serif" font-size="${font}" font-weight="bold" fill="${brandInk(brand.primaryColor)}">${escapeBrand(short(brand.displayName))}</text><text x="${left}" y="${Math.round(strip*.72)}" font-family="sans-serif" font-size="${Math.max(8,font-4)}" fill="${brandInk(brand.primaryColor)}">${escapeBrand(short([brand.phone,brand.address].filter(Boolean).join(' · ')))}</text></svg>`);
   const height=fixedSize?meta.height-strip:meta.height;const base=await sharp(bytes,{limitInputPixels:25000000}).resize(width,height,{fit:'contain',background:'#fff'}).extend({bottom:strip,background:'#fff'}).png().toBuffer();const layers=[{input:svg,left:0,top:height}];if(logo)layers.push({input:await sharp(logo).resize(logoWidth,strip-padding*2,{fit:'inside'}).png().toBuffer(),left:padding,top:height+padding});let image=sharp(base,{limitInputPixels:25000000}).composite(layers);if(meta.xmp)image=image.withXmp(meta.xmp.toString());result=await (format==='jpeg'?image.jpeg({quality:90}):image.png()).toBuffer();
  }
  return brand.trial?stampTrial(result,format):result;
 }
}
export function installBrandingRoutes(app,store,{requireUser,sameOrigin,wrap}){
 const staff=requireRole('owner','manager','staff'),owner=requireRole('owner');
 app.get('/api/branding',requireUser,staff,wrap((req,res)=>res.json(store.branding.read(req.account.id))));
 app.put('/api/branding',sameOrigin,requireUser,owner,wrap(async(req,res)=>res.json(await store.branding.update(req.account,req.body))));
 app.get('/api/branding/logo',requireUser,staff,wrap((req,res)=>{const logo=store.branding.logo(req.account.id);if(!logo)throw fail('Store logo not found.',404);res.type('png').send(Buffer.from(logo));}));
 app.post('/api/exports/image',sameOrigin,requireUser,staff,wrap(async(req,res)=>{
  if(Object.keys(req.body||{}).some(k=>!['image','storeFooter'].includes(k)))throw fail('Use an image and optional store-footer choice. The trial mark is enforced by the server.');
  const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof req.body?.image==='string'&&req.body.image.length<14000000?req.body.image:'');if(!match)throw fail('Use a PNG export under 10 MB.');const bytes=Buffer.from(match[1],'base64');if(bytes.length>10*1024*1024)throw fail('Use a PNG export under 10 MB.',413);
  try{const meta=await sharp(bytes,{limitInputPixels:16000000,animated:false}).metadata();if(meta.format!=='png'||meta.width<128||meta.height<256||meta.width>=meta.height||meta.width>8192||meta.height>8192||(meta.pages||1)>1)throw new Error();}catch{throw fail('Use a valid full-body portrait PNG up to 16 megapixels.');}
  const image=await store.branding.render(req.account.id,bytes,{storeFooter:req.body.storeFooter});store.branding.actor(req.account);res.type('png').send(image);
 }));
}
