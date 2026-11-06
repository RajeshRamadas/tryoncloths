import {randomBytes} from 'node:crypto';
import {encrypt,decrypt} from './secrets.js';
import {integrationFetch} from './integration-http.js';
import {ShopCatalogue,shopUrl} from './shop-catalogue.js';
import {safeFetch,normalizeGarmentImage} from './product-link.js';
import {productImage} from './garment-store.js';
import {transaction,catalogueLimit,legacyGarmentColumns,assertCatalogueWritable} from './catalogue-fields.js';
import {garmentTypes} from './gemini-tryon.js';
import {requireRole} from './tenancy.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const id=()=>randomBytes(16).toString('hex');
const providers=['shopify','woo'];
const errorText='Shop sync could not finish. Check the connection, product data and images. No catalogue changes were published.';
export function installSyncSchema(db){transaction(db,()=>db.exec(`
 CREATE TABLE IF NOT EXISTS catalogue_integrations(store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,provider TEXT NOT NULL CHECK(provider IN ('shopify','woo')),baseUrl TEXT NOT NULL,credentials TEXT NOT NULL,revision TEXT NOT NULL,connectedAt INTEGER NOT NULL,createdBy TEXT REFERENCES users(id) ON DELETE SET NULL,lastAttemptAt INTEGER,lastSyncAt INTEGER,lastScheduledDay TEXT,lastError TEXT,reportJson TEXT,PRIMARY KEY(store,provider));
 CREATE TABLE IF NOT EXISTS catalogue_connection_errors(store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,provider TEXT NOT NULL,lastError TEXT NOT NULL,PRIMARY KEY(store,provider));
 CREATE TABLE IF NOT EXISTS catalogue_source_origins(store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,provider TEXT NOT NULL,baseUrl TEXT NOT NULL,PRIMARY KEY(store,provider));
 CREATE TABLE IF NOT EXISTS catalogue_sync_locks(store TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,token TEXT NOT NULL UNIQUE,expiresAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS catalogue_sync_staging(token TEXT NOT NULL REFERENCES catalogue_sync_locks(token) ON DELETE CASCADE,externalId TEXT NOT NULL,fieldsJson TEXT NOT NULL,image BLOB,thumbnail BLOB,imageHash TEXT,signature TEXT,colour TEXT,PRIMARY KEY(token,externalId));
 `));}
export function nightlyDay(now){const local=new Date(now+330*60000);return local.getUTCHours()>=2?local.toISOString().slice(0,10):null;}
export class CatalogueSync {
 constructor(store,{fetchImpl=integrationFetch,fetchImage=safeFetch,secretKey=process.env.TRYON_SECRET_KEY,deadlineMs=5*60000,shopifyVersion=process.env.SHOPIFY_API_VERSION||'2026-10'}={}){this.store=store;this.db=store.db;this.key=secretKey;this.client=new ShopCatalogue({fetchImpl,shopifyVersion});this.fetchImage=fetchImage;this.deadlineMs=Math.min(deadlineMs,5*60000);this.running=false;this.scheduling=false;}
 enabled(){return typeof this.key==='string'&&/^[a-f0-9]{64}$/i.test(this.key);}
 actor(account,roles=['owner','manager']){const current=this.store.identity(account.user.id,account.id);if(!current||current.org!==account.org||!roles.includes(current.user.role))throw fail('Your store role cannot perform this action.',403);return current;}
 assertUnlocked(account){if(this.db.prepare('SELECT 1 FROM catalogue_sync_locks WHERE store=? AND expiresAt>?').get(account.id,Date.now()))throw fail('A catalogue sync is running. Wait before changing this connection.',409);}
 summary(account){this.actor(account);const rows=this.db.prepare('SELECT provider,baseUrl,connectedAt,lastAttemptAt,lastSyncAt,lastError,reportJson FROM catalogue_integrations WHERE store=? ORDER BY provider').all(account.id);return {available:this.enabled(),connections:providers.map(provider=>{const row=rows.find(r=>r.provider===provider),error=this.db.prepare('SELECT lastError FROM catalogue_connection_errors WHERE store=? AND provider=?').get(account.id,provider);return {provider,connected:Boolean(row),...(row?{...row,report:row.reportJson?JSON.parse(row.reportJson):null,reportJson:undefined}:{}),lastError:error?.lastError||row?.lastError||null};}),syncing:Boolean(this.db.prepare('SELECT 1 FROM catalogue_sync_locks WHERE store=? AND expiresAt>?').get(account.id,Date.now())),...this.master(account)};}
 master(account){const plan=this.db.prepare('SELECT plan FROM orgs WHERE id=?').get(account.org)?.plan,master=this.db.prepare('SELECT m.store,s.name FROM catalogue_master m JOIN stores s ON s.id=m.store WHERE m.org=?').get(account.org);return {chain:plan==='chain',master:master||null,stores:account.user.role==='owner'?this.db.prepare('SELECT id,name FROM stores WHERE org=? ORDER BY name,id').all(account.org):[]};}
 setMaster(account,storeId){this.actor(account,['owner']);if(this.db.prepare('SELECT plan FROM orgs WHERE id=?').get(account.org)?.plan!=='chain')throw fail('A shared master catalogue requires the Chain plan.',403);transaction(this.db,()=>{if(this.db.prepare('SELECT 1 FROM catalogue_sync_locks l JOIN stores s ON s.id=l.store WHERE s.org=? AND l.expiresAt>?').get(account.org,Date.now()))throw fail('Wait for the organisation’s catalogue sync to finish.',409);if(storeId===null)this.db.prepare('DELETE FROM catalogue_master WHERE org=?').run(account.org);else{if(typeof storeId!=='string'||!this.db.prepare('SELECT 1 FROM stores WHERE id=? AND org=?').get(storeId,account.org))throw fail('Choose a store in your organisation.',403);this.db.prepare('INSERT INTO catalogue_master VALUES(?,?) ON CONFLICT(org) DO UPDATE SET store=excluded.store').run(account.org,storeId);}});return this.master(account);}
 async connect(account,provider,input={}){
  this.actor(account,['owner']);if(!providers.includes(provider))throw fail('Choose Shopify or WooCommerce.');if(!this.enabled())throw fail('Configure TRYON_SECRET_KEY on the server first.',503);this.assertUnlocked(account);
  const base=shopUrl(provider,input),credentials=provider==='shopify'?{token:input.token}:{key:input.key,secret:input.secret};
  if(Object.values(credentials).some(v=>typeof v!=='string'||!v||v.length>1500||/[\x00-\x20\x7f]/.test(v))||provider==='woo'&&(!/^ck_[a-zA-Z0-9]+$/.test(input.key)||!/^cs_[a-zA-Z0-9]+$/.test(input.secret)))throw fail('Enter the shop’s read-only API credentials without spaces.');
  if(provider==='woo'&&input.currency!=='INR')throw fail('Confirm this WooCommerce shop uses INR before connecting.');
  const encrypted=encrypt(JSON.stringify(credentials),this.key,account.id+':'+provider),previous=this.db.prepare('SELECT revision FROM catalogue_integrations WHERE store=? AND provider=?').get(account.id,provider)?.revision;
  try{await this.client.check(provider,base,credentials,Date.now()+30000);}catch(e){this.actor(account,['owner']);this.db.prepare('INSERT INTO catalogue_connection_errors VALUES(?,?,?) ON CONFLICT(store,provider) DO UPDATE SET lastError=excluded.lastError').run(account.id,provider,e.status?e.message:errorText);throw e;}
  transaction(this.db,()=>{this.actor(account,['owner']);this.assertUnlocked(account);if(this.db.prepare('SELECT revision FROM catalogue_integrations WHERE store=? AND provider=?').get(account.id,provider)?.revision!==previous)throw fail('The connection changed in another tab. Refresh before reconnecting.',409);
   const current=this.db.prepare('SELECT baseUrl FROM catalogue_source_origins WHERE store=? AND provider=?').get(account.id,provider)||this.db.prepare('SELECT baseUrl FROM catalogue_integrations WHERE store=? AND provider=?').get(account.id,provider);if(current&&current.baseUrl!==base&&this.db.prepare('SELECT 1 FROM garments WHERE account=? AND source=?').get(account.id,provider))throw fail('This store has products from a different shop address. Use a separate store for a different shop to preserve product identities.',409);
   this.db.prepare('INSERT INTO catalogue_source_origins VALUES(?,?,?) ON CONFLICT(store,provider) DO UPDATE SET baseUrl=excluded.baseUrl').run(account.id,provider,base);
   this.db.prepare('INSERT INTO catalogue_integrations(store,provider,baseUrl,credentials,revision,connectedAt,createdBy) VALUES(?,?,?,?,?,?,?) ON CONFLICT(store,provider) DO UPDATE SET baseUrl=excluded.baseUrl,credentials=excluded.credentials,revision=excluded.revision,connectedAt=excluded.connectedAt,createdBy=excluded.createdBy,lastError=NULL').run(account.id,provider,base,encrypted,id(),Date.now(),account.user.id);this.db.prepare('DELETE FROM catalogue_connection_errors WHERE store=? AND provider=?').run(account.id,provider);
  });return this.summary(account);
 }
 disconnect(account,provider){this.actor(account,['owner']);this.assertUnlocked(account);this.db.prepare('DELETE FROM catalogue_integrations WHERE store=? AND provider=?').run(account.id,provider);this.db.prepare('DELETE FROM catalogue_connection_errors WHERE store=? AND provider=?').run(account.id,provider);return this.summary(account);}
 checkRun(account,connection,token,deadline){this.actor(account);if(Date.now()>=deadline)throw fail('Catalogue sync time limit reached. No catalogue changes were published.',504);if(!this.db.prepare('SELECT 1 FROM catalogue_sync_locks WHERE store=? AND token=? AND expiresAt>?').get(account.id,token,Date.now())||this.db.prepare('SELECT revision FROM catalogue_integrations WHERE store=? AND provider=?').get(account.id,connection.provider)?.revision!==connection.revision)throw fail('Catalogue sync lost its lock or the connection changed. No catalogue changes were published.',409);}
 async run(account,provider,{scheduledDay=null}={}){
  this.actor(account);if(!providers.includes(provider))throw fail('Choose Shopify or WooCommerce.');if(this.running)throw fail('Another catalogue sync is running on this server. Try again when it finishes.',409);
  const connection=this.db.prepare('SELECT * FROM catalogue_integrations WHERE store=? AND provider=?').get(account.id,provider);if(!connection)throw fail('Connect this shop first.',409);const token=id(),now=Date.now(),deadline=now+this.deadlineMs;
  transaction(this.db,()=>{this.db.prepare('DELETE FROM catalogue_sync_staging WHERE token IN (SELECT token FROM catalogue_sync_locks WHERE expiresAt<=?)').run(now);this.db.prepare('DELETE FROM catalogue_sync_locks WHERE expiresAt<=?').run(now);this.assertUnlocked(account);this.db.prepare('INSERT INTO catalogue_sync_locks VALUES(?,?,?)').run(account.id,token,now+10*60000);this.db.prepare('UPDATE catalogue_integrations SET lastAttemptAt=?,lastScheduledDay=COALESCE(?,lastScheduledDay),lastError=NULL WHERE store=? AND provider=?').run(now,scheduledDay,account.id,provider);});this.running=true;
  try{
   let credentials;try{credentials=JSON.parse(decrypt(connection.credentials,this.key,account.id+':'+provider));}catch{throw fail('The shop key could not be opened. Ask the owner to reconnect this shop.',503);}
   await this.client.check(provider,connection.baseUrl,credentials,deadline);let total=0;const seen=new Set(),insert=this.db.prepare('INSERT INTO catalogue_sync_staging VALUES(?,?,?,?,?,?,?,?)');
   for await(const page of this.client.pages(provider,connection.baseUrl,credentials,deadline)){
    const items=page.map(item=>this.client.map(provider,connection.baseUrl,item));for(const item of items){if(seen.has(item.externalId))throw fail('The shop returned a duplicate product ID. No changes were published.',502);seen.add(item.externalId);if(++total>50000)throw fail('Sync supports up to 50,000 products. No changes were published.',413);}
    let next=0;const worker=async()=>{while(next<items.length){const item=items[next++];this.checkRun(account,connection,token,deadline);if(item.inactive){insert.run(token,item.externalId,JSON.stringify(item),null,null,null,null,null);continue;}
     const fetched=await this.fetchImage(item.imageUrl,{maxBytes:5*1024*1024,accept:'image/*',timeoutMs:Math.max(1,Math.min(12000,deadline-Date.now()))});const image=await productImage(`data:image/jpeg;base64,${(await normalizeGarmentImage(fetched.body)).toString('base64')}`);this.checkRun(account,connection,token,deadline);insert.run(token,item.externalId,JSON.stringify(item),image.image,image.thumbnail,image.imageHash,image.signature,image.colour);
    }};const work=await Promise.allSettled([worker(),worker(),worker()]);const failed=work.find(r=>r.status==='rejected');if(failed)throw failed.reason;
   }
   return transaction(this.db,()=>{this.checkRun(account,connection,token,deadline);const fresh=this.db.prepare('SELECT count(*) AS n FROM catalogue_sync_staging t WHERE t.token=? AND json_extract(t.fieldsJson,\'$.inactive\') IS NULL AND NOT EXISTS(SELECT 1 FROM garments g WHERE g.account=? AND g.source=? AND g.externalId=t.externalId)').get(token,account.id,provider).n;
    const count=this.db.prepare("SELECT count(*) AS n FROM garments WHERE account=? AND source<>'master'").get(account.id).n;if(count+fresh>catalogueLimit(this.db,account))throw fail('Sync would exceed this store’s catalogue limit. No changes were published.',409);
    const report={created:0,updated:0,unchanged:0,markedOut:0,needsTypeReview:0,products:total};
    for(const staged of this.db.prepare('SELECT * FROM catalogue_sync_staging WHERE token=?').iterate(token)){
     const item=JSON.parse(staged.fieldsJson),row=this.db.prepare('SELECT * FROM garments WHERE account=? AND source=? AND externalId=?').get(account.id,provider,item.externalId);
     if(item.inactive){if(row&&row.stock!=='out'){this.db.prepare("UPDATE garments SET stock='out',updatedAt=? WHERE account=? AND id=?").run(Date.now(),account.id,row.id);report.markedOut++;}continue;}
     // A staff-confirmed type survives metadata-only updates to an unmapped item.
     if(row&&!row.needsTypeReview&&item.needsTypeReview){item.garmentType=row.garmentType;item.needsTypeReview=0;}
     if(item.needsTypeReview)report.needsTypeReview++;
     const values={name:item.name,garmentType:item.garmentType,needsTypeReview:item.needsTypeReview,variant:provider+':'+item.externalId,sourceUrl:item.sourceUrl,sku:item.sku,brand:item.brand,priceInr:item.priceInr,mrpInr:item.mrpInr,sizesJson:item.sizesJson,stock:item.stock,colourLabel:item.colourLabel,imageHash:staged.imageHash};
     if(row&&Object.entries(values).every(([k,v])=>row[k]===v)){report.unchanged++;continue;}
     const garmentId=row?.id||id(),time=Date.now();
     if(row){const fields=Object.keys(values);this.db.prepare(`UPDATE garments SET ${fields.map(k=>k+'=?').join(',')},updatedAt=? WHERE account=? AND id=?`).run(...Object.values(values),time,account.id,garmentId);if(row.imageHash!==staged.imageHash)this.db.prepare('UPDATE garments SET image=?,thumbnail=?,signature=?,colour=? WHERE account=? AND id=?').run(staged.image,staged.thumbnail,staged.signature,staged.colour,account.id,garmentId);if(row.imageHash!==staged.imageHash||row.garmentType!==item.garmentType||row.name!==item.name)this.db.prepare('DELETE FROM garment_results WHERE account=? AND garmentId=?').run(account.id,garmentId);report.updated++;}
     else{this.db.prepare(`INSERT INTO garments(${legacyGarmentColumns},sku,brand,priceInr,mrpInr,sizesJson,stock,externalId,source,updatedAt,colourLabel,needsTypeReview) VALUES(${Array(23).fill('?').join(',')})`).run(account.id,garmentId,item.name,item.garmentType,values.variant,item.sourceUrl,staged.imageHash,staged.signature,staged.colour,staged.image,staged.thumbnail,time,item.sku,item.brand,item.priceInr,item.mrpInr,item.sizesJson,item.stock,item.externalId,provider,time,item.colourLabel,item.needsTypeReview);report.created++;}
     this.store.garments.addLink(account,garmentId,item.sourceUrl);
    }
    const removed=this.db.prepare("UPDATE garments SET stock='out',updatedAt=? WHERE account=? AND source=? AND stock<>'out' AND NOT EXISTS(SELECT 1 FROM catalogue_sync_staging t WHERE t.token=? AND t.externalId=garments.externalId)").run(Date.now(),account.id,provider,token);report.markedOut+=removed.changes;
    this.db.prepare('UPDATE catalogue_integrations SET lastSyncAt=?,lastError=NULL,reportJson=? WHERE store=? AND provider=?').run(Date.now(),JSON.stringify(report),account.id,provider);this.db.prepare('DELETE FROM catalogue_connection_errors WHERE store=? AND provider=?').run(account.id,provider);return report;
   });
  }catch(e){const message=e.status?e.message:errorText;this.db.prepare('UPDATE catalogue_integrations SET lastError=? WHERE store=? AND provider=? AND revision=?').run(message,account.id,provider,connection.revision);throw fail(message,e.status||502);}
  finally{this.running=false;try{transaction(this.db,()=>{this.db.prepare('DELETE FROM catalogue_sync_staging WHERE token=?').run(token);this.db.prepare('DELETE FROM catalogue_sync_locks WHERE store=? AND token=?').run(account.id,token);});}catch{console.error(JSON.stringify({event:'catalogue_sync_cleanup_failed'}));}}
 }
 async runDue(now=Date.now()){
  if(this.running||this.scheduling||!this.enabled())return;const day=nightlyDay(now);if(!day)return;this.scheduling=true;
  try{const pending=this.db.prepare("SELECT i.store,i.provider,(SELECT m.user FROM memberships m JOIN users u ON u.id=m.user WHERE m.store=i.store AND m.role='owner' AND u.disabled=0 ORDER BY m.user LIMIT 1) AS user FROM catalogue_integrations i JOIN stores s ON s.id=i.store JOIN orgs o ON o.id=s.org WHERE o.status<>'suspended' AND (i.lastScheduledDay IS NULL OR i.lastScheduledDay<?) ORDER BY i.store,i.provider LIMIT 50").all(day);
   for(const row of pending){if(!row.user)continue;try{const account=this.store.identity(row.user,row.store);await this.run(account,row.provider,{scheduledDay:day});}catch{console.error(JSON.stringify({event:'catalogue_scheduled_sync_failed'}));}}
  }finally{this.scheduling=false;}
 }
}
export function installSyncRoutes(app,store,service,{requireUser,sameOrigin,wrap}){
 const manager=requireRole('owner','manager'),owner=requireRole('owner');
 app.get('/api/integrations',requireUser,manager,wrap((req,res)=>res.json(service.summary(req.account))));
 app.put('/api/integrations/master',sameOrigin,requireUser,owner,wrap((req,res)=>res.json(service.setMaster(req.account,req.body?.storeId))));
 for(const provider of providers){
  app.put('/api/integrations/'+provider,sameOrigin,requireUser,owner,wrap(async(req,res)=>res.json(await service.connect(req.account,provider,req.body))));
  app.delete('/api/integrations/'+provider,sameOrigin,requireUser,owner,wrap((req,res)=>res.json(service.disconnect(req.account,provider))));
  app.post('/api/integrations/'+provider+'/sync',sameOrigin,requireUser,manager,wrap(async(req,res)=>res.json(await service.run(req.account,provider))));
 }
 app.patch('/api/catalogue/:id/type',sameOrigin,requireUser,manager,wrap((req,res)=>{assertCatalogueWritable(store.db,req.account,req.params.id);if(!Object.hasOwn(garmentTypes,req.body?.garmentType))throw fail('Choose a supported clothing type.');if(!store.db.prepare('SELECT 1 FROM garments WHERE account=? AND id=?').get(req.account.id,req.params.id))throw fail('Garment not found.',404);transaction(store.db,()=>{store.db.prepare('UPDATE garments SET garmentType=?,needsTypeReview=0,updatedAt=? WHERE account=? AND id=?').run(req.body.garmentType,Date.now(),req.account.id,req.params.id);store.db.prepare('DELETE FROM garment_results WHERE account=? AND garmentId=?').run(req.account.id,req.params.id);});res.json({garment:store.garments.get(req.account,req.params.id)});}));
}
