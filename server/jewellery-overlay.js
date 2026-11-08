import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {assertCatalogueWritable,transaction} from './catalogue-fields.js';
import {overlayAnchors,defaultOverlayPlacements,validateOverlayPlacements,combinedMode} from '../src/jewellery-overlay.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function overlayAsset(value,anchor,type){
  if(anchor!==overlayAnchors[type])throw fail('Choose the anchor that matches this jewellery type.');
  let pixels;
  try{
    const m=typeof value==='string'&&value.length<=2_800_000&&/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);if(!m)throw new Error();
    const bytes=Buffer.from(m[1],'base64');if(!bytes.length||bytes.length>2*1024*1024)throw new Error();
    const decoder=sharp(bytes,{limitInputPixels:4_000_000,animated:false}),meta=await decoder.metadata();
    if(meta.format!=='png'||meta.pages>1||!meta.hasAlpha||meta.width<200||meta.height<200||meta.width>2048||meta.height>2048||meta.orientation&&meta.orientation!==1)throw new Error();
    const raw=await decoder.toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});pixels=raw.data;
    let clear=0,visible=0,left=meta.width,top=meta.height,right=-1,bottom=-1;
    for(let y=0;y<meta.height;y++)for(let x=0;x<meta.width;x++){const alpha=pixels[(y*meta.width+x)*4+3];if(alpha<16)clear++;if(alpha>16){visible++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
    if(clear<meta.width*meta.height*.01||visible<meta.width*meta.height*.001)throw new Error();
    const png=await sharp(bytes).extract({left,top,width:right-left+1,height:bottom-top+1}).toColourspace('srgb').png().toBuffer();if(png.length>2*1024*1024)throw new Error();return png;
  }catch{throw fail('Use a visible transparent PNG, at least 200 × 200 px, at most 2048 px per side, 4 megapixels and 2 MB. A solid background or an empty alpha image cannot be overlaid.');}
  finally{pixels?.fill(0);}
}
export async function saveOverlayAsset(store,account,id,input,{guard=()=>{}}={}){
  const options={category:'jewellery',jewelleryEnabled:true};assertCatalogueWritable(store.db,account,id);
  const row=store.garments.row(account,id,options),png=input.overlayPng===null?null:await overlayAsset(input.overlayPng,input.overlayAnchor,row.garmentType);
  return transaction(store.db,()=>{
    guard();const actor=store.identity(account.user.id,account.id);if(!actor||actor.org!==account.org||!['owner','manager'].includes(actor.user.role))throw fail('Only owners and managers can edit catalogue cut-outs.',403);
    const current=store.garments.row(account,id,options);assertCatalogueWritable(store.db,account,id);if(current.garmentType!==row.garmentType)throw fail('The jewellery type changed. Reopen it.',409);
    store.db.prepare('UPDATE garments SET overlayPng=?,overlayAnchor=?,updatedAt=? WHERE account=? AND id=?').run(png,png?input.overlayAnchor:null,Date.now(),account.id,id);return {ok:true};
  });
}
export async function prepareOverlay(store,jewellery,account,input,guard){
  if(!input.itemId)throw fail('Choose a saved catalogue piece with a transparent cut-out.');
  if(input.replaceExisting)throw fail('Overlay mode adds pixels; it cannot erase existing jewellery.');
  const context=await jewellery.context(account,input,{provider:'overlay',model:'canvas-v1',guard});
  try{
    const item=store.garments.row(account,input.itemId,{category:'jewellery',jewelleryEnabled:true});if(!item.overlayPng||item.overlayAnchor!==overlayAnchors[item.garmentType])throw fail('This piece has no prepared transparent cut-out. Ask an owner or manager to add one.');
    const asset=Buffer.from(item.overlayPng),a=await sharp(asset).metadata(),m=await sharp(context.base).metadata();guard();jewellery.current(account,context);
    context.overlayHash=hash(Buffer.concat([asset,Buffer.from(item.overlayAnchor)]));
    const anchors=context.view==='portrait'?await store.views.anchors(account,input.avatarId):context.anchors||{};guard();jewellery.current(account,context);
    const defaults=defaultOverlayPlacements({...context.selection,anchors,width:m.width,height:m.height,assetWidth:a.width,assetHeight:a.height});
    return {context,asset,defaults,width:m.width,height:m.height,anchors,warning:context.view==='full'?'Full-body placement is approximate. Drag each piece into position; no body measurements were inferred.':'Anchor scale is approximate, not a physical fit measurement.'};
  }catch(e){context.base.fill(0);context.product.fill(0);throw e;}
}
export async function renderOverlay(base,asset,placements,width,height){
  const layers=[];
  for(const p of placements){
    const w=Math.max(2,Math.round(p.width)),h=Math.max(2,Math.round(p.height));
    let image=sharp(asset).resize(w,h,{fit:'fill'});if(p.mirror)image=image.flop();
    const rotated=await image.rotate(p.angle,{background:'#00000000'}).png().toBuffer(),meta=await sharp(rotated).metadata(),r=p.angle*Math.PI/180;
    const vx=(p.mirror?1-p.pivotX:p.pivotX)*w-w/2,vy=p.pivotY*h-h/2;
    const left=Math.round(p.x-(meta.width/2+vx*Math.cos(r)-vy*Math.sin(r))),top=Math.round(p.y-(meta.height/2+vx*Math.sin(r)+vy*Math.cos(r)));
    const x=Math.max(0,left),y=Math.max(0,top),cw=Math.min(width,left+meta.width)-x,ch=Math.min(height,top+meta.height)-y;
    if(cw>0&&ch>0)layers.push({input:await sharp(rotated).extract({left:x-left,top:y-top,width:cw,height:ch}).png().toBuffer(),left:x,top:y});
  }
  return sharp(base).composite(layers).png().toBuffer();
}
export async function applyOverlay(prepared,input){
  let placements;try{placements=validateOverlayPlacements(input,prepared.defaults,prepared);}catch(e){throw fail(e.message);}
  const image=await renderOverlay(prepared.context.base,prepared.asset,placements,prepared.width,prepared.height);
  prepared.context.id=hash(JSON.stringify([prepared.context.id,prepared.context.overlayHash,placements]));
  return {image:'data:image/png;base64,'+image.toString('base64'),previewMode:combinedMode(prepared.context.baseMode,'overlay')};
}
