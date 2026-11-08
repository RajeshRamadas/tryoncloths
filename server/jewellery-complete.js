import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {completeLayout} from '../src/complete-look.js';
import {previewLabel} from '../src/jewellery-overlay.js';
import {lookAttribution} from './analytics-tracking.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=b=>createHash('sha256').update(b).digest('hex'),url=b=>'data:image/png;base64,'+b.toString('base64');
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function sources(store,account,input){
  store.requireAvatar(account,input.avatarId);
  const find=id=>typeof id==='string'&&id.length<=200&&store.db.prepare('SELECT * FROM looks WHERE account=? AND id=? AND avatarId=?').get(account.id,id,input.avatarId);
  const outfit=find(input.outfitLookId),portrait=find(input.portraitLookId);
  if(!outfit||outfit.view!=='full'||outfit.itemsJson!=='[]'||!portrait||portrait.view!=='portrait'||portrait.itemsJson==='[]')throw fail('Choose a saved clothing look and a saved portrait jewellery look for the same customer avatar.',404);
  const labels=[...JSON.parse(outfit.garments).map(n=>'Outfit · '+n),...JSON.parse(portrait.garments).map(n=>'Jewellery · '+n)].map(n=>n.slice(0,140));
  const sourceHash=hash(JSON.stringify([outfit.id,hash(outfit.image),outfit.garments,portrait.id,hash(portrait.image),portrait.garments,portrait.itemsJson,portrait.previewMode]));
  return {outfit,portrait,labels,sourceHash};
}
export async function prepareComplete(store,account,input,guard=()=>{}){
  const context=sources(store,account,input),outfit=await sharp(context.outfit.image,{limitInputPixels:16_000_000}).resize(1024,1536,{fit:'contain',background:'#fff'}).png().toBuffer(),portrait=await sharp(context.portrait.image,{limitInputPixels:2_000_000}).resize(1152,1536).png().toBuffer();
  guard();if(sources(store,account,input).sourceHash!==context.sourceHash)throw fail('A source look changed. Rebuild the complete preview.',409);
  const layout=completeLayout(context.labels,previewLabel(context.portrait.previewMode));
  return {...context,outfitImage:outfit,portraitImage:portrait,layout};
}
export function completePreview(context){return {outfit:url(context.outfitImage),portrait:url(context.portraitImage),sourceHash:context.sourceHash,layout:context.layout,previewMode:context.portrait.previewMode};}
export async function renderComplete(context){
  const l=context.layout,b=l.inset,mask=Buffer.from(`<svg width="${b.width}" height="${b.height}"><rect width="100%" height="100%" rx="${b.radius}" fill="white"/></svg>`),portrait=await sharp(context.portraitImage).resize(b.width,b.height).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
  const svg=Buffer.from(`<svg width="${l.width}" height="${l.height}"><rect x="${b.x-5}" y="${b.y-5}" width="${b.width+10}" height="${b.height+10}" rx="${b.radius+5}" fill="white"/><g fill="#294b3c" font-family="sans-serif"><text x="28" y="${l.bodyHeight+64}" font-size="${l.fonts.title}" font-weight="bold">Complete look</text>${l.text.map(t=>`<text x="${t.x}" y="${t.y}" font-size="${l.fonts.item}">${escape(t.text)}</text>`).join('')}${l.previewLines.map((line,i)=>`<text x="28" y="${l.height-36-(l.previewLines.length-1-i)*44}" font-size="${l.fonts.preview}">${escape(line)}</text>`).join('')}</g></svg>`);
  return sharp({create:{width:l.width,height:l.height,channels:3,background:'#ffffff'}}).composite([{input:context.outfitImage,left:0,top:0},{input:svg,left:0,top:0},{input:portrait,left:b.x,top:b.y}]).png().toBuffer();
}
export async function saveComplete(store,account,input,guard=()=>{}){
  if(input.reviewed!==true||input.storageConsent!==true)throw fail('Review the complete look and confirm customer agreement to store it.');
  const c=await prepareComplete(store,account,input,guard);
  try{
    if(input.sourceHash!==c.sourceHash)throw fail('The source looks changed. Rebuild and review this complete preview.',409);
    const image=await renderComplete(c),check=()=>{guard();if(sources(store,account,input).sourceHash!==c.sourceHash)throw fail('A source look changed. Rebuild the complete preview.',409);};check();
    const ids=[...new Set([c.outfit,c.portrait].flatMap(row=>lookAttribution(store,account,row.id).garmentIds))].filter(id=>store.db.prepare('SELECT 1 FROM garments WHERE account=? AND id=?').get(account.id,id));
    const saved=await store.saveLook(account,{avatarId:input.avatarId,name:input.name,image:url(image),garments:c.labels.map(n=>n.slice(0,120)),garmentIds:ids},{view:'complete',itemsJson:JSON.parse(c.portrait.itemsJson),previewMode:c.portrait.previewMode,guard:check});
    return {...saved,image:url(image),view:'complete',previewMode:c.portrait.previewMode,creditsUsed:0};
  }finally{c.outfitImage.fill(0);c.portraitImage.fill(0);}
}
