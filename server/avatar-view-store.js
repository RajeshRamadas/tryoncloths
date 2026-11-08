import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import sharp from 'sharp';
import {transaction} from './catalogue-fields.js';
import {withFaceApi} from './face-check.js';
import {ProviderError} from './provider-errors.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function installInvalidation(db){db.exec(`CREATE TRIGGER IF NOT EXISTS avatar_views_invalidate AFTER UPDATE OF image,profileId,body_type,template_tone ON avatars
  WHEN OLD.image IS NOT NEW.image OR OLD.profileId IS NOT NEW.profileId OR OLD.body_type IS NOT NEW.body_type OR OLD.template_tone IS NOT NEW.template_tone
  BEGIN DELETE FROM avatar_views WHERE store=NEW.account AND avatarId=NEW.id;
    DELETE FROM avatar_view_jobs WHERE store=NEW.account AND avatarId=NEW.id;
    UPDATE avatar_view_epochs SET nonce=lower(hex(randomblob(16))),portraitRevision=portraitRevision+1,handsRevision=handsRevision+1 WHERE store=NEW.account AND avatarId=NEW.id;
  END;`);}
export const viewKinds=['portrait','hands'];
export function viewKind(kind){if(!viewKinds.includes(kind))throw fail('Choose a portrait or hands view.');return kind;}
export async function viewPng(value,kind){
  viewKind(kind);
  try{
    const match=typeof value==='string'&&value.length<14_000_000&&/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if(!match)throw new Error();const png=Buffer.from(match[1],'base64');if(png.length>10*1024*1024)throw new Error();
    const image=sharp(png,{limitInputPixels:2_000_000,animated:false}),m=await image.metadata();
    if(m.format!=='png'||m.width!==(kind==='portrait'?1152:1024)||m.height!==(kind==='portrait'?1536:1024)||m.pages>1||(m.orientation&&m.orientation!==1))throw new Error();
    await image.png().toBuffer();return png;
  }catch{throw fail('Use the original preview PNG at the required view size.');}
}

export class AvatarViewStore{
  constructor(store){
    this.store=store;this.db=store.db;this.cache=new Map();
    transaction(this.db,()=>{
      this.db.exec(`CREATE TABLE IF NOT EXISTS avatar_views(
        store TEXT NOT NULL,avatarId TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('portrait','hands')),
        image BLOB NOT NULL,tone TEXT NOT NULL,sourceKind TEXT NOT NULL CHECK(sourceKind IN ('generated','template','photo')),
        approvedAt INTEGER NOT NULL,createdAt INTEGER NOT NULL,PRIMARY KEY(store,avatarId,kind),
        FOREIGN KEY(store,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS avatar_view_epochs(
        store TEXT NOT NULL,avatarId TEXT NOT NULL,nonce TEXT NOT NULL,portraitRevision INTEGER NOT NULL DEFAULT 0,handsRevision INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(store,avatarId),FOREIGN KEY(store,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS avatar_view_keys(id INTEGER PRIMARY KEY CHECK(id=1),secret BLOB NOT NULL CHECK(length(secret)=32));
      CREATE TABLE IF NOT EXISTS avatar_view_jobs(store TEXT NOT NULL,avatarId TEXT NOT NULL,kind TEXT NOT NULL,
        token TEXT NOT NULL,expiresAt INTEGER NOT NULL,PRIMARY KEY(store,avatarId,kind),FOREIGN KEY(store,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE);`);
      this.db.prepare('INSERT OR IGNORE INTO avatar_view_keys VALUES(1,?)').run(randomBytes(32));
      // Feature-off stores with no views retain the legacy migration surface.
      // Install visual invalidation once a view context actually exists.
      if(this.db.prepare('SELECT 1 FROM avatar_view_epochs LIMIT 1').get())installInvalidation(this.db);
    });
    this.key=Buffer.from(this.db.prepare('SELECT secret FROM avatar_view_keys WHERE id=1').get().secret);
  }
  actor(account){const current=account?.user&&this.store.identity(account.user.id,account.id);if(!current||current.org!==account.org||!['owner','manager','staff'].includes(current.user.role))throw fail('Sign in to an active store account.',401);return current;}
  avatar(account,id){this.actor(account);this.store.requireAvatar(account,id);return this.db.prepare('SELECT * FROM avatars WHERE account=? AND id=?').get(account.id,id);}
  context(account,id,kind){
    return transaction(this.db,()=>{
    viewKind(kind);const avatar=this.avatar(account,id);installInvalidation(this.db);
    this.db.prepare('INSERT OR IGNORE INTO avatar_view_epochs(store,avatarId,nonce) VALUES(?,?,?)').run(account.id,id,randomBytes(16).toString('hex'));
    const epoch=this.db.prepare('SELECT * FROM avatar_view_epochs WHERE store=? AND avatarId=?').get(account.id,id);
    return {avatar,nonce:epoch.nonce,revision:epoch[kind+'Revision'],baseHash:digest(Buffer.concat([Buffer.from(avatar.image),Buffer.from(JSON.stringify([avatar.profileId,avatar.body_type,avatar.template_tone]))]))};
    });
  }
  current(account,id,kind,context){
    viewKind(kind);this.actor(account);this.store.requireAvatar(account,id);
    // The avatar trigger changes the nonce on every visual/selector change.
    // Poll only this small row instead of reading/hashing the avatar BLOB.
    const epoch=this.db.prepare('SELECT * FROM avatar_view_epochs WHERE store=? AND avatarId=?').get(account.id,id);
    if(!epoch||epoch.nonce!==context.nonce||epoch[kind+'Revision']!==context.revision)throw fail('This avatar or view changed. Reopen it before continuing.',409);return context;
  }
  receipt(account,id,kind,context,image,{tone,sourceKind}){
    const payload=Buffer.from(JSON.stringify({store:account.id,user:account.user.id,avatar:id,kind,nonce:context.nonce,revision:context.revision,baseHash:context.baseHash,imageHash:digest(Buffer.from(image.split(',')[1],'base64')),tone,sourceKind,createdAt:Date.now(),expires:Date.now()+30*60000})).toString('base64url');
    return payload+'.'+createHmac('sha256',this.key).update(payload).digest('hex');
  }
  claims(account,id,kind,receipt){
    try{
      if(typeof receipt!=='string'||receipt.length>4096)throw new Error();const [payload,signature,extra]=receipt.split('.');
      if(extra||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(createHmac('sha256',this.key).update(payload).digest(),Buffer.from(signature,'hex')))throw new Error();
      const value=JSON.parse(Buffer.from(payload,'base64url').toString());
      if(value.store!==account.id||value.user!==account.user.id||value.avatar!==id||value.kind!==kind||!Number.isFinite(value.expires)||value.expires<Date.now())throw new Error();return value;
    }catch{throw fail('This preview cannot be verified or has expired. Do not regenerate just to save it; keep the downloaded image.',409);}
  }
  list(account,id){this.avatar(account,id);return this.db.prepare('SELECT kind,tone,sourceKind,approvedAt,createdAt FROM avatar_views WHERE store=? AND avatarId=? ORDER BY kind').all(account.id,id);}
  get(account,id,kind){viewKind(kind);this.avatar(account,id);const row=this.db.prepare('SELECT * FROM avatar_views WHERE store=? AND avatarId=? AND kind=?').get(account.id,id,kind);if(!row)throw fail('Approved avatar view not found.',404);return {...row,image:Buffer.from(row.image)};}
  async approve(account,id,kind,input,{guard}={}){
    this.context(account,id,kind);
    if(input?.reviewed!==true||input?.storageConsent!==true)throw fail('Review this view and confirm saving it to the customer’s store account.');
    const value=this.claims(account,id,kind,input.receipt),png=await viewPng(input.image,kind);
    if(value.imageHash!==digest(png))throw fail('The preview changed. Approve the original generated or template image.',409);
    return transaction(this.db,()=>{
      guard?.();
      const latest=this.context(account,id,kind);
      if(value.nonce!==latest.nonce||value.baseHash!==latest.baseHash)throw fail('The avatar changed. Reopen it before continuing.',409);
      if(latest.revision!==value.revision){const existing=this.db.prepare('SELECT image,approvedAt FROM avatar_views WHERE store=? AND avatarId=? AND kind=?').get(account.id,id,kind);if(latest.revision===value.revision+1&&existing&&digest(existing.image)===value.imageHash)return {ok:true,approvedAt:existing.approvedAt};throw fail('A newer view action replaced this preview. Reopen the saved view.',409);}
      const approvedAt=Date.now();this.db.prepare(`INSERT INTO avatar_views VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(store,avatarId,kind) DO UPDATE SET image=excluded.image,tone=excluded.tone,sourceKind=excluded.sourceKind,approvedAt=excluded.approvedAt,createdAt=excluded.createdAt`).run(account.id,id,kind,png,value.tone,value.sourceKind,approvedAt,value.createdAt);
      this.db.prepare(`UPDATE avatar_view_epochs SET ${kind}Revision=${kind}Revision+1 WHERE store=? AND avatarId=?`).run(account.id,id);
      this.invalidate(account.id,id);return {ok:true,approvedAt};
    });
  }
  remove(account,id,kind){viewKind(kind);this.context(account,id,kind);return transaction(this.db,()=>{this.avatar(account,id);this.db.prepare(`UPDATE avatar_view_epochs SET ${kind}Revision=${kind}Revision+1 WHERE store=? AND avatarId=?`).run(account.id,id);this.db.prepare('DELETE FROM avatar_view_jobs WHERE store=? AND avatarId=? AND kind=?').run(account.id,id,kind);this.db.prepare('DELETE FROM avatar_views WHERE store=? AND avatarId=? AND kind=?').run(account.id,id,kind);this.invalidate(account.id,id);return {ok:true};});}
  acquire(account,id,kind){return transaction(this.db,()=>{this.avatar(account,id);this.db.prepare('DELETE FROM avatar_view_jobs WHERE expiresAt<=?').run(Date.now());if(this.db.prepare('SELECT 1 FROM avatar_view_jobs WHERE store=? AND avatarId=? AND kind=?').get(account.id,id,kind))throw fail('This avatar view is already being generated. Wait for the existing request.',409);const token=randomBytes(16).toString('hex');this.db.prepare('INSERT INTO avatar_view_jobs VALUES(?,?,?,?,?)').run(account.id,id,kind,token,Date.now()+195000);return token;});}
  job(account,id,kind,token){if(!this.db.prepare('SELECT 1 FROM avatar_view_jobs WHERE store=? AND avatarId=? AND kind=? AND token=? AND expiresAt>?').get(account.id,id,kind,token,Date.now()))throw fail('This view request was cancelled or expired.',409);}
  release(token){this.db.prepare('DELETE FROM avatar_view_jobs WHERE token=?').run(token);}
  invalidate(store,id){for(const [key,value] of this.cache)if(key.startsWith(store+':'+id+':')){clearTimeout(value.timer);this.cache.delete(key);}}
  close(){for(const value of this.cache.values())clearTimeout(value.timer);this.cache.clear();this.key.fill(0);}
  async anchors(account,id,{compute=portraitAnchors}={}){
    const row=this.get(account,id,'portrait'),hash=digest(row.image),key=account.id+':'+id+':'+hash;
    if(this.cache.has(key))return structuredClone(this.cache.get(key).value);
    const value=await compute(row.image);this.actor(account);if(digest(this.get(account,id,'portrait').image)!==hash)throw fail('The portrait changed. Reopen it before placing jewellery.',409);
    while(this.cache.size>=128){const oldest=this.cache.keys().next().value;clearTimeout(this.cache.get(oldest).timer);this.cache.delete(oldest);}
    if(this.cache.has(key))clearTimeout(this.cache.get(key).timer);
    const timer=setTimeout(()=>this.cache.delete(key),5*60000);timer.unref();this.cache.set(key,{value:structuredClone(value),timer});return value;
  }
}

export async function portraitAnchors(png){
  return withFaceApi(async api=>{
    const {data,info}=await sharp(png).resize(450,600,{fit:'fill'}).flatten({background:'#fff'}).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
    const tensor=api.tf.tensor3d(new Uint8Array(data),[info.height,info.width,3]);let crops=[];
    try{
      const faces=await api.nets.tinyFaceDetector.locateFaces(tensor,new api.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.5}));if(faces.length!==1)throw new ProviderError('missing_face');
      crops=await api.extractFaceTensors(tensor,faces);if(crops.length!==1)throw new ProviderError('face_check');
      const local=await api.nets.faceLandmark68Net.detectLandmarks(crops[0]),landmarks=api.extendWithFaceLandmarks({detection:faces[0]},local).landmarks;
      const scale=1152/info.width,points=landmarks.positions.map(p=>({x:p.x*scale,y:p.y*scale})),box=faces[0].box;
      const mean=values=>({x:values.reduce((n,p)=>n+p.x,0)/values.length,y:values.reduce((n,p)=>n+p.y,0)/values.length});
      const left=mean(points.slice(36,42)),right=mean(points.slice(42,48)),chin=points[8],nose=points[27],width=box.width*scale,height=box.height*scale;
      const anchors={leftEarlobe:{x:points[2].x-.06*width,y:points[2].y-.03*height},rightEarlobe:{x:points[14].x+.06*width,y:points[14].y-.03*height},leftNostril:points[31],rightNostril:points[35],hairParting:{x:nose.x,y:nose.y-.75*(chin.y-nose.y)},neckBase:{x:chin.x,y:chin.y+.55*height}};
      if(Object.values(anchors).some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1152||p.y<0||p.y>1536))throw new ProviderError('framing_changed');
      return {anchors,eyes:{left,right},pxPerMm:Math.hypot(right.x-left.x,right.y-left.y)/63,width:1152,height:1536,coordinateSide:'image',scaleReferenceMm:63,warning:'Approximate placement scale; not a physical fit measurement.'};
    }catch(error){throw error instanceof ProviderError?error:new ProviderError('face_check');}
    finally{for(const crop of crops)crop.dispose();tensor.dispose();data.fill(0);}
  },{recognition:true});
}
