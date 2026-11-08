import {createHash,createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {transaction} from './catalogue-fields.js';
import {productImage} from './garment-store.js';
import {handsTemplate} from './hands-templates.js';
import {viewPng} from './avatar-view-store.js';
import {JEWELLERY_CONTRACT,jewellerySelection,normalizeJewelleryView} from './jewellery-tryon.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const dataUrl=bytes=>'data:image/png;base64,'+Buffer.from(bytes).toString('base64');
const catalogue={category:'jewellery',jewelleryEnabled:true};
const itemVersion=item=>hash(JSON.stringify([item.imageHash,item.garmentType,item.attributesJson,item.name]));

export async function jewelleryPng(value,view,{legacyFull=false}={}){
  if(view!=='full')return viewPng(value,view);
  try{
    const match=typeof value==='string'&&value.length<14_000_000&&/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if(!match)throw new Error();const bytes=Buffer.from(match[1],'base64');if(bytes.length>10*1024*1024)throw new Error();
    if(legacyFull)return await normalizeJewelleryView(bytes,'full');
    const image=sharp(bytes,{limitInputPixels:2_000_000,animated:false}),m=await image.metadata();
    if(m.format!=='png'||m.width!==1024||m.height!==1536||m.pages>1||m.orientation&&m.orientation!==1)throw new Error();
    await image.png().toBuffer();return bytes;
  }catch{throw fail('Use the original full-body view PNG at the required size.');}
}

/** Store-owned context and signed output receipts. Only reviewed results are
 * persisted; product/face inputs and pending generated images are never stored. */
export class JewelleryStore{
  constructor(store){
    this.store=store;this.db=store.db;
    transaction(this.db,()=>this.db.exec(`
      CREATE TABLE IF NOT EXISTS jewellery_jobs(
        store TEXT NOT NULL,id TEXT NOT NULL,avatarId TEXT NOT NULL,view TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,expiresAt INTEGER NOT NULL,PRIMARY KEY(store,id),
        FOREIGN KEY(store,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE);
      CREATE TRIGGER IF NOT EXISTS jewellery_view_deleted AFTER DELETE ON avatar_views BEGIN
        DELETE FROM garment_results WHERE account=OLD.store AND avatarId=OLD.avatarId AND view=OLD.kind;
        DELETE FROM jewellery_jobs WHERE store=OLD.store AND avatarId=OLD.avatarId AND view=OLD.kind;
      END;
      CREATE TRIGGER IF NOT EXISTS jewellery_view_replaced AFTER UPDATE ON avatar_views BEGIN
        DELETE FROM garment_results WHERE account=OLD.store AND avatarId=OLD.avatarId AND view=OLD.kind;
        DELETE FROM jewellery_jobs WHERE store=OLD.store AND avatarId=OLD.avatarId AND view=OLD.kind;
      END;
      CREATE TRIGGER IF NOT EXISTS jewellery_avatar_changed AFTER UPDATE OF image,profileId,body_type,template_tone ON avatars
      WHEN OLD.image IS NOT NEW.image OR OLD.profileId IS NOT NEW.profileId OR OLD.body_type IS NOT NEW.body_type OR OLD.template_tone IS NOT NEW.template_tone
      BEGIN
        DELETE FROM garment_results WHERE account=NEW.account AND avatarId=NEW.id AND garmentId IN(SELECT id FROM garments WHERE account=NEW.account AND category='jewellery');
        DELETE FROM jewellery_jobs WHERE store=NEW.account AND avatarId=NEW.id;
      END;`));
  }
  actor(account){
    this.store.views.actor(account);
    if(this.db.prepare('SELECT status FROM orgs WHERE id=?').get(account.org)?.status==='suspended')throw fail('This organisation is suspended. No jewellery result was delivered.',403);
  }
  current(account,context){
    this.actor(account);this.store.requireAvatar(account,context.avatarId);
    const epoch=this.db.prepare('SELECT * FROM avatar_view_epochs WHERE store=? AND avatarId=?').get(account.id,context.avatarId);
    if(!epoch||epoch.nonce!==context.nonce||context.view!=='full'&&epoch[context.view+'Revision']!==context.revision)throw fail('The avatar or approved view changed. Reopen it before continuing.',409);
    if(context.itemId){const item=this.store.garments.row(account,context.itemId,catalogue);if(itemVersion(item)!==context.itemVersion||item.needsTypeReview||item.stock==='out')throw fail('This jewellery item changed or is unavailable. Review it again.',409);}
  }
  claims(account,receipt){
    try{
      if(typeof receipt!=='string'||receipt.length>8192)throw new Error();const [payload,signature,extra]=receipt.split('.');
      const expected=createHmac('sha256',this.store.views.key).update('jewellery:'+payload).digest();
      if(extra||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw new Error();
      const value=JSON.parse(Buffer.from(payload,'base64url').toString());
      if(value.contract!==JEWELLERY_CONTRACT||value.store!==account.id||value.user!==account.user.id||!Number.isFinite(value.expires)||value.expires<Date.now())throw new Error();
      this.current(account,value);return value;
    }catch(error){if(error.status&&error.status!==400)throw error;throw fail('This jewellery preview cannot be verified or has expired. Keep the downloaded result; do not regenerate just to save it.',409);}
  }
  receipt(account,context,image){
    this.current(account,context);
    const payload=Buffer.from(JSON.stringify({contract:JEWELLERY_CONTRACT,store:account.id,user:account.user.id,id:context.id,avatarId:context.avatarId,
      view:context.view,nonce:context.nonce,revision:context.revision,itemId:context.itemId,itemVersion:context.itemVersion,
      selection:context.selection,title:context.title,imageHash:hash(Buffer.from(image.split(',')[1],'base64')),expires:Date.now()+24*3600000})).toString('base64url');
    return payload+'.'+createHmac('sha256',this.store.views.key).update('jewellery:'+payload).digest('hex');
  }
  async context(account,input,{provider,model,guard=()=>{}}){
    this.actor(account);
    let item,selection,photo,angle;
    if(input.itemId!==undefined){
      if(['image','type','attributes','title'].some(key=>input[key]!==undefined))throw fail('Use the saved item details, or upload a separate jewellery item.');
      item=this.store.garments.row(account,input.itemId,catalogue);
      if(item.needsTypeReview||item.stock==='out')throw fail('Choose available jewellery with a confirmed type.',409);
      if(input.count!==undefined&&item.garmentType!=='bangles')throw fail('Piece count overrides are supported for bangles only.');
      selection=jewellerySelection({...input,type:item.garmentType,attributes:{...JSON.parse(item.attributesJson),...(input.count!==undefined?{count:input.count}:{})}});
    }else{if(input.count!==undefined&&input.type!=='bangles')throw fail('Piece count overrides are supported for bangles only.');selection=jewellerySelection({...input,attributes:{...input.attributes,...(input.count!==undefined?{count:input.count}:{})}});}
    const {view}=selection,reference=this.store.views.context(account,input.avatarId,view==='full'?'portrait':view);
    const context={avatarId:input.avatarId,view,nonce:reference.nonce,revision:view==='full'?null:reference.revision,itemId:item?.id??null,itemVersion:item?itemVersion(item):null};
    const current=()=>{guard();this.current(account,context);};
    const source=view==='full'?Buffer.from(reference.avatar.image):this.store.views.get(account,input.avatarId,view).image;
    const saved=await normalizeJewelleryView(source,view);current();
    let base=saved;
    if(input.base!==undefined){
      const suppliedRaw=await jewelleryPng(input.base,view,{legacyFull:view==='full'});current();
      // Compare canonical pixels/canvas, so opaque alpha or harmless PNG
      // encoding differences cannot turn the same starting view into a miss.
      const supplied=await normalizeJewelleryView(suppliedRaw,view);current();
      if(hash(supplied)!==hash(saved)){
        if([input.baseReceipt,input.baseResultId,input.baseLookId].filter(v=>v!==undefined).length>1)throw fail('Use one proof for the current jewellery base.');
        if(input.baseReceipt!==undefined){
          if(input.baseReviewed!==true)throw fail('Review this jewellery result before using it as the next base.');
          const claims=this.claims(account,input.baseReceipt),original=Buffer.from(input.base.split(',')[1],'base64');
          if(claims.avatarId!==context.avatarId||claims.view!==view||claims.imageHash!==hash(original))throw fail('Use the original reviewed result for this avatar view.',409);
        }else if(input.baseResultId!==undefined){
          const row=this.db.prepare("SELECT r.image FROM garment_results r JOIN garments g ON g.account=r.account AND g.id=r.garmentId WHERE r.account=? AND r.id=? AND r.avatarId=? AND r.view=? AND g.category='jewellery'").get(account.id,input.baseResultId,context.avatarId,view);
          if(!row||hash(await normalizeJewelleryView(Buffer.from(row.image),view))!==hash(supplied))throw fail('The approved base result is unavailable for this avatar view.',409);
        }else if(input.baseLookId!==undefined){
          if(input.baseReviewed!==true)throw fail('Review this saved jewellery look before adding another item.');
          const row=this.db.prepare("SELECT image FROM looks WHERE account=? AND id=? AND avatarId=? AND view=? AND itemsJson<>'[]'").get(account.id,input.baseLookId,context.avatarId,view);
          if(!row||hash(await normalizeJewelleryView(Buffer.from(row.image),view))!==hash(supplied))throw fail('The saved jewellery look is unavailable for this avatar view.',409);
        }else throw fail('Use an approved saved view or a verified, reviewed jewellery result as the base.');
      }
      base=supplied;
    }else if(input.baseReceipt!==undefined||input.baseResultId!==undefined||input.baseLookId!==undefined||input.baseReviewed!==undefined)throw fail('Provide the original base PNG with its review proof.');
    if(item)photo={image:Buffer.from(item.image),imageHash:item.imageHash};
    else photo=await productImage(input.image);
    current();
    if(input.secondAngle!==undefined){angle=await productImage(input.secondAngle);current();}
    let anchors;
    if(view==='hands'){
      const approved=this.store.views.get(account,input.avatarId,'hands');
      if(approved.sourceKind!=='template')throw fail('Customer hand photos are not supported for jewellery yet.');
      anchors=(await handsTemplate(reference.avatar.body_type,approved.tone)).anchors;current();
    }
    const title=item?.name||(typeof input.title==='string'?input.title.slice(0,100):'');
    context.id=hash(JSON.stringify({contract:JEWELLERY_CONTRACT,...context,baseHash:hash(base),itemHash:photo.imageHash,angleHash:angle?.imageHash??null,selection,title,provider,model}));
    current();return {...context,base,product:photo.image,secondAngle:angle?.image,selection,title,anchors,bodyType:reference.avatar.body_type};
  }
  cached(account,context){
    this.current(account,context);if(!context.itemId)return null;
    const row=this.db.prepare('SELECT image FROM garment_results WHERE account=? AND id=? AND avatarId=? AND garmentId=? AND view=?').get(account.id,context.id,context.avatarId,context.itemId,context.view);
    return row?{image:dataUrl(row.image),resultId:context.id}:null;
  }
  async approve(account,id,input,{guard=()=>{}}={}){
    if(input.reviewed!==true||input.storageConsent!==true)throw fail('Review this jewellery result and confirm customer agreement to save it for reuse.');
    const context=this.claims(account,input.receipt);if(context.id!==id)throw fail('Use the receipt for this jewellery result.',409);
    if(!context.itemId)throw fail('Automatic reuse requires a saved catalogue item. Keep or download this upload preview; no regeneration is required.');
    const image=await jewelleryPng(input.image,context.view);
    if(hash(image)!==context.imageHash)throw fail('The result changed. Save the original generated PNG.',409);
    return transaction(this.db,()=>{
      guard();this.current(account,context);
      const exists=this.db.prepare('SELECT image FROM garment_results WHERE account=? AND id=?').get(account.id,id);
      if(exists&&hash(exists.image)!==context.imageHash)throw fail('Another reviewed result is already saved for this starting state and item. Keep or download this preview; it was not substituted for the saved image.',409);
      if(!exists&&this.db.prepare('SELECT count(*) n FROM garment_results WHERE account=?').get(account.id).n>=200)throw fail('Your store holds up to 200 saved adaptations. Remove an unused result first.',409);
      this.db.prepare('INSERT INTO garment_results(account,id,avatarId,garmentId,image,savedAt,view) VALUES(?,?,?,?,?,?,?) ON CONFLICT(account,id) DO NOTHING').run(account.id,id,context.avatarId,context.itemId,image,Date.now(),context.view);
      return {ok:true,resultId:id,view:context.view};
    });
  }
  acquire(account,context){return transaction(this.db,()=>{
    this.current(account,context);this.db.prepare('DELETE FROM jewellery_jobs WHERE expiresAt<=?').run(Date.now());
    if(this.db.prepare('SELECT 1 FROM jewellery_jobs WHERE store=? AND id=?').get(account.id,context.id))throw fail('This jewellery adaptation is already running. Wait for its result; no second generation was started.',409);
    const token=randomBytes(16).toString('hex');this.db.prepare('INSERT INTO jewellery_jobs VALUES(?,?,?,?,?,?)').run(account.id,context.id,context.avatarId,context.view,token,Date.now()+195000);return token;
  });}
  job(account,context,token){if(!this.db.prepare('SELECT 1 FROM jewellery_jobs WHERE store=? AND id=? AND token=? AND expiresAt>?').get(account.id,context.id,token,Date.now()))throw fail('This jewellery request was cancelled or expired.',409);}
  release(token){this.db.prepare('DELETE FROM jewellery_jobs WHERE token=?').run(token);}
}
