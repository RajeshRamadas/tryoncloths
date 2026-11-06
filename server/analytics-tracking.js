import {transaction} from './catalogue-fields.js';
import {recordEvent} from './events.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const sessionIdValid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function installTrackingSchema(db){transaction(db,()=>db.exec(`
 CREATE TABLE IF NOT EXISTS fitting_sessions (
  store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,id TEXT NOT NULL,avatarId TEXT,
  createdBy TEXT REFERENCES users(id) ON DELETE SET NULL,createdAt INTEGER NOT NULL,PRIMARY KEY(store,id),
  FOREIGN KEY(store,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS session_products (
  store TEXT NOT NULL,sessionId TEXT NOT NULL,garmentId TEXT NOT NULL,PRIMARY KEY(store,sessionId,garmentId),
  FOREIGN KEY(store,sessionId) REFERENCES fitting_sessions(store,id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS look_attribution (
  store TEXT NOT NULL,lookId TEXT NOT NULL,sessionId TEXT,garmentIdsJson TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(store,lookId),
  FOREIGN KEY(store,lookId) REFERENCES looks(account,id) ON DELETE CASCADE ON UPDATE CASCADE);
 `));}
export function validateSession(store,account,input){
 if(input.sessionId!==undefined&&!sessionIdValid(input.sessionId))throw fail('Use a UUID fitting session ID.');
 if(input.avatarId!=null)store.requireAvatar(account,input.avatarId);
 const session=input.sessionId&&store.db.prepare('SELECT avatarId FROM fitting_sessions WHERE store=? AND id=?').get(account.id,input.sessionId.toLowerCase());
 if(session?.avatarId&&input.avatarId&&session.avatarId!==input.avatarId)throw fail('Start a new fitting session for this avatar.',409);
}
function ensureSession(store,account,input){
 const id=input.sessionId?.toLowerCase();if(!id)return null;validateSession(store,account,input);
 store.db.prepare('INSERT INTO fitting_sessions(store,id,avatarId,createdBy,createdAt) VALUES(?,?,?,?,?) ON CONFLICT(store,id) DO UPDATE SET avatarId=COALESCE(fitting_sessions.avatarId,excluded.avatarId)').run(account.id,id,input.avatarId??null,account.user.id,Date.now());return id;
}
export function recordTryon(store,account,input,{reused=false,source='studio'}={}){
 if(!store||!account)return;
 try{transaction(store.db,()=>{
  const sessionId=(input.sessionId||input.requestId).toLowerCase();
  ensureSession(store,account,{...input,sessionId});
  if(input.garmentId)store.db.prepare('INSERT OR IGNORE INTO session_products VALUES(?,?,?)').run(account.id,sessionId,input.garmentId);
  recordEvent(store.db,{org:account.org,store:account.id,user:account.user.id},reused?'tryon_reused':'tryon_generated',{requestId:input.requestId.toLowerCase(),sessionId,avatarId:input.avatarId,garmentId:input.garmentId,source},{operationKey:input.requestId.toLowerCase()});
 });}catch{console.error(JSON.stringify({event:'analytics_record_failed',type:reused?'tryon_reused':'tryon_generated'}));}
}
export function validateLookTracking(store,account,input){
 validateSession(store,account,input);
 if(input.garmentIds!==undefined&&(!Array.isArray(input.garmentIds)||input.garmentIds.length>20||input.garmentIds.some(id=>typeof id!=='string'||id.length>200)))throw fail('Use up to 20 saved garment IDs.');
 for(const id of input.garmentIds||[]){
  const owned=store.db.prepare('SELECT 1 FROM garments WHERE account=? AND id=?').get(account.id,id)||store.db.prepare('SELECT 1 FROM session_products WHERE store=? AND garmentId=? LIMIT 1').get(account.id,id);
  if(!owned)throw fail('Saved garment not found in this store.',404);
 }
}
export function attributeLook(store,account,id,input){
 validateLookTracking(store,account,input);const sessionId=ensureSession(store,account,input);
 const previous=store.db.prepare('SELECT * FROM look_attribution WHERE store=? AND lookId=?').get(account.id,id);
 const garmentIds=input.garmentIds===undefined?JSON.parse(previous?.garmentIdsJson||'[]'):[...new Set(input.garmentIds)];
 store.db.prepare('INSERT INTO look_attribution VALUES(?,?,?,?) ON CONFLICT(store,lookId) DO UPDATE SET sessionId=COALESCE(look_attribution.sessionId,excluded.sessionId),garmentIdsJson=excluded.garmentIdsJson').run(account.id,id,sessionId,JSON.stringify(garmentIds));
 const attribution=lookAttribution(store,account,id);
 recordEvent(store.db,{org:account.org,store:account.id,user:account.user.id},'look_saved',{lookId:id,avatarId:input.avatarId,...attribution},{operationKey:'look:'+id});
}
export function lookAttribution(store,account,id){const row=store.db.prepare('SELECT sessionId,garmentIdsJson FROM look_attribution WHERE store=? AND lookId=?').get(account.id,id);return {sessionId:row?.sessionId||undefined,garmentIds:JSON.parse(row?.garmentIdsJson||'[]')};}
