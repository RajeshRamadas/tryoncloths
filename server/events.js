import {randomBytes} from 'node:crypto';
const types=new Set(['avatar_generated','tryon_generated','tryon_reused','look_saved','look_shared','share_viewed','purchase_marked','purchase_unmarked','whatsapp_sent','catalogue_photo','jewellery_overlay_applied','jewellery_compared']);
const keys=new Set(['avatarId','garmentId','garmentIds','lookId','shareId','messageId','sessionId','requestId','size','template','source','pool','category','view','previewMode','itemCount','jewelleryItemIds','outcome']);
export function installEventsSchema(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user TEXT REFERENCES users(id) ON DELETE SET NULL,type TEXT NOT NULL,refJson TEXT NOT NULL,createdAt INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS events_store_type_date ON events(store,type,createdAt);
  CREATE INDEX IF NOT EXISTS events_store_date ON events(store,createdAt);`);
 if(!db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='operationKey'))db.exec('ALTER TABLE events ADD COLUMN operationKey TEXT');
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS events_operation ON events(store,type,operationKey) WHERE operationKey IS NOT NULL');
 db.exec("CREATE UNIQUE INDEX IF NOT EXISTS events_fitting_operation ON events(store,operationKey) WHERE operationKey IS NOT NULL AND type IN ('tryon_generated','tryon_reused','jewellery_overlay_applied')");
 db.exec("CREATE UNIQUE INDEX IF NOT EXISTS events_tryon_operation ON events(store,operationKey) WHERE operationKey IS NOT NULL AND type IN ('tryon_generated','tryon_reused')");
}
export function recordEvent(db,{org,store,user=null},type,ref,{operationKey=null,createdAt=Date.now()}={}){
 if(!types.has(type))throw new Error('Unsupported analytics event.');
 const safe={};for(const [key,value] of Object.entries(ref||{})){
  if(!keys.has(key))continue;
  if(key==='itemCount'){if(Number.isInteger(value)&&value>=0&&value<=20)safe[key]=value;}
  else if(['category','view','previewMode','outcome'].includes(key)){const values={category:['garment','jewellery'],view:['full','portrait','hands','complete'],previewMode:['ai','overlay','mixed'],outcome:['complete','partial']};if(values[key].includes(value))safe[key]=value;}
  else if(key==='garmentIds'||key==='jewelleryItemIds'){if(Array.isArray(value))safe[key]=[...new Set(value.filter(v=>typeof v==='string'&&v.length<=200))].slice(0,20);}
  else if(typeof value==='string'&&value.length<=200)safe[key]=value;
 }
 const id=randomBytes(16).toString('hex');const result=db.prepare('INSERT OR IGNORE INTO events(id,org,store,user,type,refJson,createdAt,operationKey) VALUES(?,?,?,?,?,?,?,?)').run(id,org,store,user,type,JSON.stringify(safe),createdAt,operationKey);return result.changes?id:null;
}
// Never discard a successful provider result because telemetry could not be written.
export function safelyRecord(db,actor,type,ref,options){try{return recordEvent(db,actor,type,ref,options);}catch{console.error(JSON.stringify({event:'analytics_record_failed',type}));return null;}}
export function record(req,type,ref){const store=req.app.locals.accountStore,account=req.account;if(!store||!account)return null;return safelyRecord(store.db,{org:account.org,store:account.id,user:account.user.id},type,ref,{operationKey:ref?.requestId||null});}
