import sharp from 'sharp';
import express from 'express';
import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {encrypt,decrypt} from './secrets.js';
import {recordEvent,safelyRecord} from './events.js';
import {validRequestId} from './billing.js';
import {requireRole} from './tenancy.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=()=>randomBytes(16).toString('hex');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const publicHeaders=res=>res.set({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});
export class WhatsApp {
 constructor(store,{fetchImpl=fetch,secretKey=process.env.TRYON_SECRET_KEY,appSecret=process.env.WHATSAPP_APP_SECRET,verifyToken=process.env.WHATSAPP_VERIFY_TOKEN,publicUrl=process.env.TRYON_PUBLIC_URL,version=process.env.WHATSAPP_GRAPH_VERSION||'v23.0'}={}){
  this.generating=new Set();this.store=store;this.db=store.db;this.fetch=fetchImpl;this.key=secretKey;this.appSecret=appSecret;this.verifyToken=verifyToken;this.publicUrl=publicUrl;this.version=/^v\d+\.\d+$/.test(version)?version:'v23.0';
 }
 enabled(){return /^[a-f0-9]{64}$/i.test(this.key||'')&&Boolean(this.appSecret&&this.verifyToken);}
 access(account){const org=this.db.prepare('SELECT plan,status,trialEndsAt,pastDueSince FROM orgs WHERE id=?').get(account.org);if(!org||org.status==='suspended')throw fail('This organisation cannot send WhatsApp messages.',403);if(org.status==='trial'&&Date.now()>=(org.trialEndsAt||0))throw fail('The trial has ended. Subscribe before sending WhatsApp messages.',402);if(org.status==='past_due'&&Date.now()>=(org.pastDueSince||0)+3*86400000)throw fail('Subscription payment is overdue.',402);if(!['growth','chain','pilot','trial'].includes(org.plan))throw fail('WhatsApp automation requires the Growth or Chain plan.',403);}
 base(){let url;try{url=new URL(this.publicUrl);}catch{}if(!url||url.protocol!=='https:'||url.username||url.password)throw fail('Configure TRYON_PUBLIC_URL with the public HTTPS studio address.',503);return url.origin;}
 integration(account){const row=this.db.prepare('SELECT * FROM whatsapp_integrations WHERE store=?').get(account.id);if(!row)throw fail('Connect this store’s WhatsApp Business number first.',409);return row;}
 checkConnection(account){if(!this.enabled())throw fail('Configure WhatsApp encryption and webhook secrets first.',503);this.base();const integration=this.integration(account);decrypt(integration.token,this.key,account.id);return integration;}
 summary(account){this.access(account);const row=this.db.prepare('SELECT phoneId,wabaId,language,connectedAt FROM whatsapp_integrations WHERE store=?').get(account.id);return {available:this.enabled(),connected:Boolean(row),...(row||{})};}
 async graph(path,token,body){
  try{const response=await this.fetch(`https://graph.facebook.com/${this.version}/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),redirect:'error'});const text=await response.text();if(text.length>128000)throw new Error();let data;try{data=JSON.parse(text);}catch{throw new Error();}if(!response.ok)throw fail('Meta did not accept the request. Check the Business account, token and approved templates.',response.status>=400&&response.status<500?502:504);return data;}catch(e){if(e.status)throw e;throw fail('Meta did not confirm the request. Check the delivery history before trying a new send.',504);}
 }
 async connect(account,input){
  this.access(account);if(!this.enabled())throw fail('Configure the server encryption key and WhatsApp webhook secrets first.',503);this.base();
  if(!/^\d{5,30}$/.test(input.phoneId||'')||!/^\d{5,30}$/.test(input.wabaId||'')||!/^\w{2,12}$/.test(input.language||'en_US'))throw fail('Enter the Meta phone number ID, business account ID and template language.');
  const cipher=encrypt(input.token,this.key,account.id);
  const phone=await this.graph(`${input.phoneId}?fields=id,display_phone_number`,input.token);
  const business=await this.graph(`${input.wabaId}/phone_numbers?fields=id&limit=100`,input.token);
  if(phone.id!==input.phoneId||!business.data?.some(p=>p.id===input.phoneId))throw fail('This phone number does not belong to the supplied WhatsApp Business account.');
  // A changed token/number may be saved only while the owner still has access.
  const member=this.db.prepare("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user WHERE m.store=? AND m.user=? AND m.role='owner' AND u.disabled=0").get(account.id,account.user.id);if(!member)throw fail('Owner access is required.',403);
  try{this.db.prepare('INSERT INTO whatsapp_integrations VALUES(?,?,?,?,?,?) ON CONFLICT(store) DO UPDATE SET phoneId=excluded.phoneId,wabaId=excluded.wabaId,token=excluded.token,language=excluded.language,connectedAt=excluded.connectedAt').run(account.id,input.phoneId,input.wabaId,cipher,input.language||'en_US',Date.now());}catch(e){if(e.message.includes('UNIQUE'))throw fail('This WhatsApp number is already connected to another store.',409);throw e;}
  return this.summary(account);
 }
 consent(account,customerId,template){
  this.access(account);const customer=this.store.customers.get(account,customerId);
  if(template==='new_arrivals'){
   if(!['owner','manager'].includes(account.user.role))throw fail('Only an owner or manager can send marketing lookbooks.',403);
   if(!customer.marketingOptIn)throw fail('This customer has not opted in to marketing.',409);
   const previous=this.db.prepare("SELECT 1 FROM whatsapp_messages WHERE store=? AND customer=? AND template='new_arrivals' AND state IN ('sending','accepted','unknown') AND createdAt>?").get(account.id,customer.id,Date.now()-7*86400000);if(previous)throw fail('This customer can receive at most one marketing lookbook every 7 days.',429);
  }else if(template==='look_share'){if(!customer.whatsappConsentAt||customer.whatsappConsentSource!=='in_store')throw fail('Record the customer’s in-store agreement to receive outfits on WhatsApp first.',409);}
  else throw fail('Choose look_share or new_arrivals.');
  return customer;
 }
 looks(account,customerId,lookIds){
  if(!Array.isArray(lookIds)||lookIds.length<1||lookIds.length>6||new Set(lookIds).size!==lookIds.length||lookIds.some(x=>typeof x!=='string'))throw fail('Choose 1–6 saved looks for this customer.');
  for(const look of lookIds)if(!this.db.prepare('SELECT 1 FROM looks l JOIN avatars a ON a.account=l.account AND a.id=l.avatarId WHERE l.account=? AND l.id=? AND a.customer=?').get(account.id,look,customerId))throw fail('Choose only this customer’s saved looks from the active store.',404);
 }
 async send(account,input){
  if(!validRequestId(input.requestId))throw fail('Use a fresh request ID for an intentional send.');
  const previous=this.db.prepare('SELECT id,state,delivery FROM whatsapp_messages WHERE store=? AND requestId=?').get(account.id,input.requestId);if(previous)return {...previous,duplicate:true};
  if(!this.enabled())throw fail('Configure WhatsApp encryption and webhook secrets first.',503);
  const integration=this.integration(account),customer=this.consent(account,input.customerId,input.template);this.looks(account,customer.id,input.lookIds);
  if(input.sendConsent!==true)throw fail('Confirm customer agreement to publish and send these saved outfits.');
  for(const look of input.lookIds){const pending=this.db.prepare("SELECT 1 FROM whatsapp_campaign_items WHERE store=? AND look=? AND state<>'approved'").get(account.id,look);if(pending)throw fail('Review and approve the generated outfit before sending.',409);}
  const base=this.base(),token=randomBytes(32).toString('base64url'),book=hash(token),message=id(),now=Date.now();
  const accessToken=decrypt(integration.token,this.key,account.id);
  this.db.exec('BEGIN IMMEDIATE');try{
   this.consent(account,customer.id,input.template);
   this.db.prepare('INSERT INTO whatsapp_books VALUES(?,?,?,?)').run(book,account.id,customer.id,now+30*86400000);
   input.lookIds.forEach((look,position)=>this.db.prepare('INSERT INTO whatsapp_book_looks VALUES(?,?,?,?)').run(book,account.id,look,position));
   this.db.prepare("INSERT INTO whatsapp_messages(id,store,customer,requestId,template,state,book,createdAt,updatedAt) VALUES(?,?,?,?,?,'sending',?,?,?)").run(message,account.id,customer.id,input.requestId,input.template,book,now,now);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  const payload={messaging_product:'whatsapp',to:customer.phoneE164.slice(1),type:'template',template:{name:input.template,language:{code:integration.language},components:[{type:'header',parameters:[{type:'image',image:{link:`${base}/w/${token}/${input.lookIds[0]}/image`}}]},{type:'body',parameters:[{type:'text',text:customer.name},{type:'text',text:account.name}]},{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:token}]}]}};
  try{
   const result=await this.graph(`${integration.phoneId}/messages`,accessToken,payload);const providerId=result.messages?.[0]?.id;if(typeof providerId!=='string')throw fail('Meta did not return a message ID. Check delivery history; do not resend automatically.',504);
   this.db.prepare("UPDATE whatsapp_messages SET state='accepted',providerId=?,updatedAt=? WHERE id=?").run(providerId,Date.now(),message);
   const pending=this.db.prepare('SELECT status FROM whatsapp_delivery WHERE store=? AND providerId=?').get(account.id,providerId);if(pending)this.delivery(account.id,providerId,pending.status);
   // Customer may have been erased while Meta was accepting the request.
   if(this.db.prepare('SELECT 1 FROM whatsapp_messages WHERE id=?').get(message)){try{recordEvent(this.db,{org:account.org,store:account.id,user:account.user.id},'whatsapp_sent',{messageId:message,template:input.template});}catch{}}
   return {id:message,state:'accepted'};
  }catch(e){const state=e.status===502?'failed':'unknown';this.db.prepare('UPDATE whatsapp_messages SET state=?,updatedAt=? WHERE id=?').run(state,Date.now(),message);if(state==='failed')this.db.prepare('DELETE FROM whatsapp_books WHERE hash=?').run(book);return {id:message,state,error:state==='failed'?'Meta rejected this send. Check the token and approved template.':'Delivery is uncertain. Check Meta before sending again; this request will not be retried.'};}
 }
 delivery(storeId,providerId,status){
  const rank={sent:1,delivered:2,read:3,failed:0};
  if(typeof providerId!=='string'||providerId.length>250||!Object.hasOwn(rank,status))return;
  const row=this.db.prepare('SELECT id,delivery FROM whatsapp_messages WHERE store=? AND providerId=?').get(storeId,providerId);
  if(row){if(!row.delivery||rank[row.delivery]<=rank[status])this.db.prepare('UPDATE whatsapp_messages SET delivery=?,updatedAt=? WHERE id=?').run(status,Date.now(),row.id);this.db.prepare('DELETE FROM whatsapp_delivery WHERE store=? AND providerId=?').run(storeId,providerId);}
  else {const previous=this.db.prepare('SELECT status FROM whatsapp_delivery WHERE store=? AND providerId=?').get(storeId,providerId);if(!previous||rank[previous.status]<=rank[status])this.db.prepare('INSERT INTO whatsapp_delivery VALUES(?,?,?,?) ON CONFLICT(store,providerId) DO UPDATE SET status=excluded.status,receivedAt=excluded.receivedAt').run(storeId,providerId,status,Date.now());}
 }
 webhook(body){
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare('DELETE FROM whatsapp_delivery WHERE receivedAt<?').run(Date.now()-86400000);
   for(const entry of body.entry||[])for(const change of entry.changes||[]){const value=change.value||{},integration=this.db.prepare('SELECT store FROM whatsapp_integrations WHERE phoneId=?').get(value.metadata?.phone_number_id||'');if(!integration)continue;
    for(const message of value.messages||[]){const text=message.text?.body||message.button?.payload||message.button?.text||message.interactive?.button_reply?.id||message.interactive?.button_reply?.title||'';
     if(typeof text!=='string'||!/^(stop|unsubscribe|opt_out|stop_marketing)$/i.test(text.trim())||typeof message.id!=='string'||!/^\d{8,15}$/.test(message.from||''))continue;
     const key=hash(integration.store+':'+message.id);if(!this.db.prepare('INSERT OR IGNORE INTO whatsapp_inbound VALUES(?,?)').run(key,Date.now()).changes)continue;
     this.db.prepare('UPDATE customers SET marketingOptIn=0,optInAt=NULL,optInSource=NULL,whatsappConsentAt=NULL,whatsappConsentSource=NULL WHERE store=? AND phoneE164=?').run(integration.store,'+'+message.from);
    }
    for(const status of value.statuses||[])this.delivery(integration.store,status.id,status.status);
   }
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
}
export function installWhatsAppWebhook(app,service){
 app.get('/api/whatsapp/webhook',(req,res)=>{if(!service?.verifyToken)return res.sendStatus(503);if(req.query['hub.mode']!=='subscribe'||typeof req.query['hub.verify_token']!=='string'||!timingSafeEqual(Buffer.from(hash(req.query['hub.verify_token']),'hex'),Buffer.from(hash(service.verifyToken),'hex'))||typeof req.query['hub.challenge']!=='string')return res.sendStatus(403);res.type('text').send(req.query['hub.challenge']);});
 app.post('/api/whatsapp/webhook',express.raw({type:'application/json',limit:'256kb'}),(req,res)=>{
  if(!service?.appSecret)return res.sendStatus(503);const signature=req.get('x-hub-signature-256')||'';if(!Buffer.isBuffer(req.body)||!/^sha256=[a-f0-9]{64}$/i.test(signature))return res.sendStatus(403);
  const expected=createHmac('sha256',service.appSecret).update(req.body).digest();if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))return res.sendStatus(403);
  try{const payload=JSON.parse(req.body.toString('utf8'));if(payload.object!=='whatsapp_business_account')return res.sendStatus(400);service.webhook(payload);res.json({ok:true});}catch{res.sendStatus(400);}
 });
}
export function installWhatsAppRoutes(app,store,service,{requireUser,sameOrigin,wrap}){
 const staff=requireRole('owner','manager','staff'),owner=requireRole('owner');
 app.get('/api/integrations/whatsapp',requireUser,staff,wrap((req,res)=>res.json(service.summary(req.account))));
 app.put('/api/integrations/whatsapp',sameOrigin,requireUser,owner,wrap(async(req,res)=>res.json(await service.connect(req.account,req.body||{}))));
 app.delete('/api/integrations/whatsapp',sameOrigin,requireUser,owner,wrap((req,res)=>{store.db.prepare('DELETE FROM whatsapp_integrations WHERE store=?').run(req.account.id);res.json({ok:true});}));
 app.post('/api/whatsapp/send',sameOrigin,requireUser,staff,wrap(async(req,res)=>res.json(await service.send(req.account,req.body||{}))));
 app.delete('/api/whatsapp/messages/:id/link',sameOrigin,requireUser,staff,wrap((req,res)=>{const message=store.db.prepare('SELECT book FROM whatsapp_messages WHERE store=? AND id=?').get(req.account.id,req.params.id);if(!message)throw fail('Message not found.',404);if(message.book)store.db.prepare('DELETE FROM whatsapp_books WHERE hash=?').run(message.book);res.json({ok:true});}));
 app.get('/api/whatsapp/messages',requireUser,staff,wrap((req,res)=>res.json({messages:store.db.prepare('SELECT id,customer,template,state,delivery,createdAt FROM whatsapp_messages WHERE store=? ORDER BY createdAt DESC LIMIT 100').all(req.account.id)})));
 app.use('/w',(_req,res,next)=>{publicHeaders(res);next();});
 const resolve=token=>/^[\w-]{43}$/.test(token)?store.db.prepare('SELECT * FROM whatsapp_books WHERE hash=? AND expiresAt>?').get(hash(token),Date.now()):null;
 const gone=res=>res.status(410).type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><h1>This lookbook is no longer available.</h1>');
 app.get('/w/:token/:look/image',wrap(async(req,res)=>{const book=resolve(req.params.token);if(!book||!store.db.prepare('SELECT 1 FROM whatsapp_book_looks WHERE book=? AND look=?').get(book.hash,req.params.look))return gone(res);const image=store.lookImage({id:book.store},req.params.look);if(!image)return gone(res);const preview=await sharp(image,{limitInputPixels:16000000}).resize(1024,1536,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();if(!resolve(req.params.token))return gone(res);return res.type('jpeg').send(preview);}));
 app.get('/w/:token',wrap((req,res)=>{const book=resolve(req.params.token);if(!book)return gone(res);const looks=store.db.prepare('SELECT l.id,l.garments FROM whatsapp_book_looks b JOIN looks l ON l.account=b.store AND l.id=b.look WHERE b.book=? ORDER BY position').all(book.hash);if(!looks.length)return gone(res);const owner=store.db.prepare('SELECT name,org FROM stores WHERE id=?').get(book.store);const name=owner?.name;if(req.method==='GET'&&owner)safelyRecord(store.db,{org:owner.org,store:book.store},'share_viewed',{shareId:book.hash,source:'whatsapp'});res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Outfit lookbook</title><style>body{font:16px/1.6 system-ui;margin:0;padding:16px;background:#f7f8f3;color:#234b3a}main{max-width:560px;margin:auto}img{display:block;max-width:100%;max-height:80vh;width:auto;height:auto;margin:auto}article{padding:16px;margin:16px 0;background:white;border-radius:12px}h1,li{overflow-wrap:anywhere}</style></head><body><main><h1>${escape(name)}</h1>${looks.map(l=>`<article><img src="/w/${req.params.token}/${escape(l.id)}/image" alt="Outfit preview"><ul>${JSON.parse(l.garments).map(g=>`<li>${escape(g)}</li>`).join('')}</ul></article>`).join('')}<p>Approximate styling, not a prediction of size or fit.</p></main></body></html>`);}));
}
