import {claimTrial} from './commercial-admin.js';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import PDFDocument from 'pdfkit';
import express from 'express';
import {requireRole} from './tenancy.js';
import {sendMail as defaultMail} from './mailer.js';

const id=()=>randomBytes(16).toString('hex');
const problem=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export const PACKS=Object.freeze({100:{credits:100,base:90000},500:{credits:500,base:400000},2000:{credits:2000,base:1400000}});
export const PLANS=Object.freeze({starter:{credits:300,base:199900},growth:{credits:1000,base:599900},chain:{credits:3000,base:1499900}});
const tax=base=>({base,gst:Math.round(base*18/100),amount:base+Math.round(base*18/100)});
const providerId=value=>typeof value==='string'&&/^[a-z]+_[A-Za-z0-9]{1,100}$/.test(value);
export function validSignature(body,signature,secret){
 if(!secret||typeof signature!=='string'||!/^[a-f0-9]{64}$/i.test(signature))return false;
 return timingSafeEqual(createHmac('sha256',secret).update(body).digest(),Buffer.from(signature,'hex'));
}
const stateCode=value=>typeof value==='string'&&/^(0[1-9]|[12][0-9]|3[0-8]|97)$/.test(value);
function profile(input){
 const name=typeof input?.name==='string'?input.name.trim():'',address=typeof input?.address==='string'?input.address.trim():'';
 const email=typeof input?.billingEmail==='string'?input.billingEmail.trim().toLowerCase():'';
 const gstin=typeof input?.gstin==='string'?input.gstin.trim().toUpperCase():'';
 if(!name||name.length>120||!address||address.length>500||!stateCode(input?.stateCode)||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||
   (gstin&&(!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)||!gstin.startsWith(input.stateCode))))
  throw problem('billing_details_required','Enter legal name, address, billing email, Indian state code and a valid GSTIN if registered.');
 return {name,address,billingEmail:email,stateCode:input.stateCode,gstin};
}
export function paymentConfig(env=process.env){return {
 keyId:env.RAZORPAY_KEY_ID||'',keySecret:env.RAZORPAY_KEY_SECRET||'',webhookSecret:env.RAZORPAY_WEBHOOK_SECRET||'',
 supplier:{name:env.FORME_LEGAL_NAME,address:env.FORME_ADDRESS,billingEmail:env.FORME_BILLING_EMAIL,stateCode:env.FORME_STATE_CODE,gstin:env.FORME_GSTIN},
 planIds:Object.fromEntries(Object.keys(PLANS).flatMap(p=>['monthly','annual'].map(period=>[`${p}:${period}`,env[`RAZORPAY_PLAN_${p.toUpperCase()}${period==='annual'?'_ANNUAL':''}`]||''])))
};}
export class PaymentStore {
 constructor(accounts,{config=paymentConfig(),fetchImpl=fetch,sendMail=defaultMail,now=Date.now}={}){
  this.accounts=accounts;this.db=accounts.db;this.billing=accounts.billing;this.config=config;this.fetch=fetchImpl;this.sendMail=sendMail;this.now=now;this.delivering=new Map();
  this.billing.transaction(()=>{
   this.db.exec(`CREATE TABLE IF NOT EXISTS billing_profiles(org TEXT PRIMARY KEY REFERENCES orgs(id),details TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_orders(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES orgs(id),providerOrderId TEXT UNIQUE NOT NULL,pack TEXT NOT NULL,amountPaise INTEGER NOT NULL,gstPaise INTEGER NOT NULL,credits INTEGER NOT NULL,billingJson TEXT NOT NULL,createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES orgs(id),provider TEXT NOT NULL,providerSubId TEXT UNIQUE NOT NULL,plan TEXT NOT NULL,period TEXT NOT NULL,status TEXT NOT NULL,currentPeriodEnd INTEGER,planId TEXT NOT NULL,amountPaise INTEGER NOT NULL,gstPaise INTEGER NOT NULL,credits INTEGER NOT NULL,billingJson TEXT NOT NULL,createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES orgs(id),providerPaymentId TEXT UNIQUE NOT NULL,providerOrderId TEXT,subscriptionId TEXT,providerInvoiceId TEXT UNIQUE,amountPaise INTEGER NOT NULL,gstPaise INTEGER NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,createdAt INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS payments_captured_order ON payments(providerOrderId) WHERE kind='pack' AND status='captured';
    CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES orgs(id),number TEXT UNIQUE NOT NULL,paymentId TEXT UNIQUE NOT NULL REFERENCES payments(id),pdf BLOB,snapshotJson TEXT NOT NULL,createdAt INTEGER NOT NULL,emailedAt INTEGER);
    CREATE TABLE IF NOT EXISTS invoice_sequences(year TEXT PRIMARY KEY,next INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_events(provider TEXT NOT NULL,eventId TEXT NOT NULL,receivedAt INTEGER NOT NULL,PRIMARY KEY(provider,eventId));`);
   if(!this.db.prepare('PRAGMA table_info(orgs)').all().some(c=>c.name==='pastDueSince'))this.db.exec('ALTER TABLE orgs ADD COLUMN pastDueSince INTEGER');
  });
 }
 ready(){
  if(!this.config.keyId||!this.config.keySecret||!this.config.webhookSecret)throw problem('billing_unavailable','Online payments are not configured on this studio.',503);
  try{if(!profile(this.config.supplier).gstin)throw new Error();}catch{throw problem('billing_unavailable','Supplier invoice details are not configured on this studio.',503);}
 }
 async api(path,body){
  this.ready();let response;
  try {response=await this.fetch(`https://api.razorpay.com/v1/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Basic ${Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString('base64')}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw problem('payment_provider_unavailable','Payment provider could not be reached. Check Billing before trying again.',502);}
  if(!response.ok)throw problem('payment_provider_error','Payment provider could not complete this request.',502);
  try{return await response.json();}catch{throw problem('payment_provider_error','Payment provider returned an invalid response.',502);}
 }
 details(org){const row=this.db.prepare('SELECT details FROM billing_profiles WHERE org=?').get(org);if(!row)throw problem('billing_details_required','Save your billing details before purchasing.');return JSON.parse(row.details);}
 saveDetails(org,input){const value=profile(input);return this.billing.transaction(()=>{if(this.db.prepare('SELECT status FROM orgs WHERE id=?').get(org)?.status==='trial')claimTrial(this.db,org,{email:value.billingEmail,gstin:value.gstin});this.db.prepare('INSERT INTO billing_profiles VALUES(?,?) ON CONFLICT(org) DO UPDATE SET details=excluded.details').run(org,JSON.stringify(value));return value;});}
 assertPurchasable(org){if(this.db.prepare('SELECT status FROM orgs WHERE id=?').get(org)?.status==='suspended')throw problem('account_suspended','This organisation is suspended. Contact your administrator before purchasing.',403);}
 async order(org,pack){
  this.assertPurchasable(org);
  if(!Object.hasOwn(PACKS,String(pack)))throw problem('invalid_pack','Choose 100, 500 or 2000 credits.');
  const selected=PACKS[pack],price=tax(selected.base),details=this.details(org),key=id();
  const order=await this.api('orders',{amount:price.amount,currency:'INR',receipt:key});
  if(!providerId(order.id)||order.amount!==price.amount||order.currency!=='INR')throw problem('payment_provider_error','Payment provider returned an invalid order.',502);
  this.db.prepare('INSERT INTO billing_orders VALUES(?,?,?,?,?,?,?,?,?)').run(key,org,order.id,String(pack),price.amount,price.gst,selected.credits,JSON.stringify(details),this.now());
  return {orderId:order.id,keyId:this.config.keyId,amount:price.amount,currency:'INR',credits:selected.credits};
 }
 async subscribe(org,plan,period){
  this.assertPurchasable(org);
  if(!Object.hasOwn(PLANS,plan)||!['monthly','annual'].includes(period))throw problem('invalid_plan','Choose an available plan and billing period.');
  const details=this.details(org),planId=this.config.planIds[`${plan}:${period}`];
  if(!providerId(planId))throw problem('billing_unavailable','This subscription plan is not configured.',503);
  const price=tax(PLANS[plan].base*(period==='annual'?10:1));
  const providerPlan=await this.api(`plans/${planId}`);
  if(providerPlan.id!==planId||providerPlan.item?.amount!==price.amount||providerPlan.item?.currency!=='INR'||providerPlan.period!==(period==='annual'?'yearly':'monthly')||providerPlan.interval!==1)
   throw problem('plan_configuration','The provider plan does not match the configured price, GST or period.',503);
  const duplicate=this.db.prepare("SELECT 1 FROM subscriptions WHERE org=? AND status NOT IN ('cancelled','completed','expired')").get(org);
  if(duplicate)throw problem('subscription_exists','A subscription already exists. Manage it before starting another.',409);
  // Reserve a local creation slot before the network await. A timed-out creation
  // stays pending for operator reconciliation instead of automatically retrying.
  const key=id();this.db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,org,'razorpay',`pending_${key}`,plan,period,'creating',null,planId,price.amount,price.gst,PLANS[plan].credits*(period==='annual'?12:1),JSON.stringify(details),this.now());
  const sub=await this.api('subscriptions',{plan_id:planId,total_count:period==='annual'?10:120,quantity:1,customer_notify:1,notes:{formeSubscription:key}});
  if(!providerId(sub.id)||sub.plan_id!==planId)throw problem('payment_provider_error','Payment provider returned an invalid subscription.',502);
  this.db.prepare('UPDATE subscriptions SET providerSubId=?,status=? WHERE id=?').run(sub.id,'created',key);
  return {subscriptionId:sub.id,keyId:this.config.keyId};
 }
 async verify(org,{orderId,paymentId,signature}={}){
  this.ready();
  if(!providerId(orderId)||!providerId(paymentId)||!validSignature(`${orderId}|${paymentId}`,signature,this.config.keySecret))throw problem('invalid_signature','Payment signature is invalid.');
  const order=this.db.prepare('SELECT * FROM billing_orders WHERE providerOrderId=? AND org=?').get(orderId,org);
  if(!order)throw problem('order_not_found','Payment order not found.',404);
  const payment=await this.api(`payments/${paymentId}`);
  this.checkPayment(payment,paymentId,order);
  const invoice=this.settle(order,payment,'pack');await this.deliver(invoice);
  return {ok:true,invoiceId:invoice.id};
 }
 checkPayment(payment,paymentId,record){
  if(payment.id!==paymentId||payment.status!=='captured'||payment.captured!==true||(payment.amount_refunded||0)>0||payment.amount!==record.amountPaise||payment.currency!=='INR'||(record.providerOrderId&&payment.order_id!==record.providerOrderId))
   throw problem('payment_not_captured','The captured payment does not match this purchase. No credits were added.',409);
 }
 settle(record,payment,kind){
  return this.billing.transaction(()=>{
   const existing=this.db.prepare('SELECT i.* FROM invoices i JOIN payments p ON p.id=i.paymentId WHERE p.providerPaymentId=?').get(payment.id);
   if(existing){if(existing.org!==record.org)throw problem('payment_conflict','Payment already belongs to another organisation.',409);return existing;}
   const time=this.now(),date=new Date(time+330*60000),year=date.getUTCFullYear()-(date.getUTCMonth()<3?1:0),fy=`FY${String(year).slice(-2)}-${String(year+1).slice(-2)}`;
   this.db.prepare('INSERT INTO invoice_sequences VALUES(?,1) ON CONFLICT(year) DO NOTHING').run(fy);
   const sequence=this.db.prepare('SELECT next FROM invoice_sequences WHERE year=?').get(fy).next;
   this.db.prepare('UPDATE invoice_sequences SET next=next+1 WHERE year=?').run(fy);
   const previousPayment=this.db.prepare('SELECT id,org FROM payments WHERE providerPaymentId=?').get(payment.id);
   if(previousPayment&&previousPayment.org!==record.org)throw problem('payment_conflict','Payment belongs to another organisation.',409);
   const number=`${fy}/${String(sequence).padStart(4,'0')}`,paymentKey=previousPayment?.id||id(),invoiceId=id();
   this.db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(providerPaymentId) DO UPDATE SET status=excluded.status,subscriptionId=excluded.subscriptionId,providerInvoiceId=excluded.providerInvoiceId').run(paymentKey,record.org,payment.id,payment.order_id||null,kind==='subscription'?record.id:null,kind==='subscription'?payment.invoice_id:null,record.amountPaise,record.gstPaise,kind,'captured',time);
   this.billing.recordGrant(record.org,'ai',record.credits,kind==='pack'?'grant_pack':'grant_plan',payment.id);
   const buyer=JSON.parse(record.billingJson),supplier=profile(this.config.supplier),local=buyer.stateCode===supplier.stateCode;
   const snapshot={number,date:new Date(time).toISOString(),supplier,buyer,paymentId:payment.id,description:kind==='pack'?`${record.credits} AI credits`:`${record.plan} ${record.period} subscription (${record.credits} AI credits)`,sac:'998314',base:record.amountPaise-record.gstPaise,total:record.amountPaise,cgst:local?Math.floor(record.gstPaise/2):0,sgst:local?record.gstPaise-Math.floor(record.gstPaise/2):0,igst:local?0:record.gstPaise};
   this.db.prepare('INSERT INTO invoices(id,org,number,paymentId,snapshotJson,createdAt) VALUES(?,?,?,?,?,?)').run(invoiceId,record.org,number,paymentKey,JSON.stringify(snapshot),time);
   return this.db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  });
 }
 async pdf(invoice){
  if(invoice.pdf)return Buffer.from(invoice.pdf);
  const s=JSON.parse(invoice.snapshotJson),doc=new PDFDocument({size:'A4',margin:45,compress:false});
  const chunks=[],ready=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const money=p=>`INR ${(p/100).toFixed(2)}`;
  doc.fontSize(20).text('Tax Invoice').moveDown();doc.fontSize(10).text(`Invoice: ${s.number}`).text(`Date: ${s.date.slice(0,10)}`).text(`Payment: ${s.paymentId}`).moveDown();
  for(const [label,p] of [['Supplier',s.supplier],['Bill to',s.buyer]])doc.text(label).text(p.name).text(p.address).text(`State code: ${p.stateCode}`).text(`GSTIN: ${p.gstin||'Unregistered'}`).text(p.billingEmail).moveDown();
  doc.text(s.description).text(`SAC: ${s.sac}`).text(`Place of supply: state ${s.buyer.stateCode}`).text(`Taxable value: ${money(s.base)}`);
  if(s.igst)doc.text(`IGST (18%): ${money(s.igst)}`);else doc.text(`CGST (9%): ${money(s.cgst)}`).text(`SGST (9%): ${money(s.sgst)}`);
  doc.moveDown().fontSize(14).text(`Total paid: ${money(s.total)}`);doc.fontSize(9).moveDown().text('Reverse charge: No. Computer-generated invoice.');doc.end();
  const bytes=await ready;this.db.prepare('UPDATE invoices SET pdf=? WHERE id=? AND pdf IS NULL').run(bytes,invoice.id);return bytes;
 }
 async deliver(invoice){
  if(invoice.emailedAt)return;
  if(this.delivering.has(invoice.id))return this.delivering.get(invoice.id);
  const task=(async()=>{try{
   const pdf=await this.pdf(invoice),s=JSON.parse(invoice.snapshotJson);
   await this.sendMail({to:s.buyer.billingEmail,subject:`Forme invoice ${invoice.number}`,text:`Your payment was received. Invoice ${invoice.number} is attached.`,attachments:[{filename:invoice.number.replace('/','-')+'.pdf',content:pdf,contentType:'application/pdf'}]});
   this.db.prepare('UPDATE invoices SET emailedAt=? WHERE id=?').run(this.now(),invoice.id);
  }catch{console.error(JSON.stringify({event:'invoice_delivery_pending',invoiceId:invoice.id}));}finally{this.delivering.delete(invoice.id);}})();this.delivering.set(invoice.id,task);return task;
 }
 async retryInvoices(){for(const row of this.db.prepare('SELECT * FROM invoices WHERE emailedAt IS NULL ORDER BY createdAt LIMIT 10').all())await this.deliver(row);}
 async webhook(raw,signature,eventId){
  if(!this.config.webhookSecret)throw problem('billing_unavailable','Payment webhook is not configured.',503);
  if(!Buffer.isBuffer(raw)||!validSignature(raw,signature,this.config.webhookSecret))throw problem('invalid_signature','Webhook signature is invalid.');
  if(typeof eventId!=='string'||!eventId||eventId.length>200)throw problem('invalid_event','A webhook event id is required.');
  if(this.db.prepare("SELECT 1 FROM webhook_events WHERE provider='razorpay' AND eventId=?").get(eventId))return {ok:true};
  let event;try{event=JSON.parse(raw.toString('utf8'));}catch{throw problem('invalid_event','Malformed webhook.');}
  const payload=event.payload||{};
  if(event.event==='payment.captured'){
   const p=payload.payment?.entity,order=this.db.prepare('SELECT * FROM billing_orders WHERE providerOrderId=?').get(p?.order_id||'');
   if(order){
    if(!providerId(p.id))throw problem('invalid_event','Invalid payment id.');
    const current=await this.api(`payments/${p.id}`);this.checkPayment(current,p.id,order);await this.deliver(this.settle(order,current,'pack'));
   }
  }else if(event.event==='payment.failed'){
   const p=payload.payment?.entity,order=this.db.prepare('SELECT * FROM billing_orders WHERE providerOrderId=?').get(p?.order_id||'');
   if(order&&providerId(p.id)&&p.status==='failed'&&p.amount===order.amountPaise&&p.currency==='INR')
    this.db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(providerPaymentId) DO NOTHING').run(id(),order.org,p.id,p.order_id,null,null,p.amount,order.gstPaise,'pack','failed',this.now());
  }else if(['subscription.activated','subscription.charged','subscription.halted','subscription.cancelled','subscription.completed','subscription.resumed'].includes(event.event)){
   const sid=payload.subscription?.entity?.id;
   let record=this.db.prepare('SELECT * FROM subscriptions WHERE providerSubId=?').get(sid||'');
   // Reconcile a lost create response only using a signed provider webhook and
   // a locally reserved subscription id. Never trust notes to select an org.
   if(!record&&providerId(sid)){
    const local=payload.subscription?.entity?.notes?.formeSubscription;
    record=this.db.prepare("SELECT * FROM subscriptions WHERE id=? AND status='creating'").get(typeof local==='string'?local:'');
    if(record&&payload.subscription.entity.plan_id===record.planId)this.db.prepare('UPDATE subscriptions SET providerSubId=? WHERE id=?').run(sid,record.id);else record=null;
   }
   if(record){
    const current=await this.api(`subscriptions/${sid}`);
    if(current.id!==sid||current.plan_id!==record.planId)throw problem('invalid_event','Subscription does not match this plan.');
    if(event.event==='subscription.charged'){
     const supplied=payload.payment?.entity;
     if(!providerId(supplied?.id))throw problem('invalid_event','Invalid payment id.');
     const p=await this.api(`payments/${supplied.id}`);this.checkPayment(p,supplied.id,record);
     if(!providerId(p.invoice_id))throw problem('invalid_event','Subscription invoice reference is missing.');
     const bill=await this.api(`invoices/${p.invoice_id}`);
     if(bill.subscription_id!==sid||bill.payment_id!==p.id||bill.amount_paid!==record.amountPaise)throw problem('invalid_event','Subscription invoice does not match payment.');
     await this.deliver(this.settle(record,p,'subscription'));
    }
    this.billing.transaction(()=>{
     const end=Number.isSafeInteger(current.current_end)?current.current_end*1000:null;
     this.db.prepare('UPDATE subscriptions SET status=?,currentPeriodEnd=? WHERE id=?').run(current.status,end,record.id);
     const newer=this.db.prepare("SELECT 1 FROM subscriptions WHERE org=? AND id<>? AND createdAt>=? AND status='active'").get(record.org,record.id,record.createdAt);
     if(newer)return;
     if(current.status==='active')this.db.prepare("UPDATE orgs SET plan=?,status=CASE WHEN status='suspended' THEN status ELSE 'active' END,pastDueSince=NULL WHERE id=?").run(record.plan,record.org);
     else if(['halted','cancelled','completed','paused'].includes(current.status)){
      const since=current.status==='halted'?this.now():Math.max(this.now(),end||0);
      this.db.prepare("UPDATE orgs SET status=CASE WHEN status='suspended' THEN status ELSE 'past_due' END,pastDueSince=coalesce(pastDueSince,?) WHERE id=?").run(since,record.org);
     }
    });
   }
  }
  this.db.prepare("INSERT OR IGNORE INTO webhook_events VALUES('razorpay',?,?)").run(eventId,this.now());return {ok:true};
 }
}
export function installPaymentWebhook(app,payments){
 if(!payments)return;
 app.post('/api/billing/webhook',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
  try{res.json(await payments.webhook(req.body,req.get('x-razorpay-signature'),req.get('x-razorpay-event-id')));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Payment event could not be processed.',code:e.code||'payment_error'});}
 });
}
export function installPaymentRoutes(app,payments,{requireUser,sameOrigin,wrap}){
 if(!payments)return;
 const owner=[requireUser,requireRole('owner')],mutation=[sameOrigin,...owner];
 app.get('/api/billing/details',...owner,wrap((req,res)=>{const row=payments.db.prepare('SELECT details FROM billing_profiles WHERE org=?').get(req.account.org);res.json({details:row?JSON.parse(row.details):null});}));
 app.put('/api/billing/details',...mutation,wrap((req,res)=>res.json(payments.saveDetails(req.account.org,req.body))));
 app.post('/api/billing/order',...mutation,wrap(async(req,res)=>res.json(await payments.order(req.account.org,req.body?.pack))));
 app.post('/api/billing/subscribe',...mutation,wrap(async(req,res)=>res.json(await payments.subscribe(req.account.org,req.body?.plan,req.body?.period))));
 app.post('/api/billing/verify',...mutation,wrap(async(req,res)=>res.json(await payments.verify(req.account.org,req.body))));
 app.get('/api/billing/invoices',...owner,wrap((req,res)=>res.json({invoices:payments.db.prepare('SELECT id,number,createdAt,emailedAt FROM invoices WHERE org=? ORDER BY createdAt DESC').all(req.account.org)})));
 app.get('/api/billing/invoices/:id',...owner,wrap(async(req,res)=>{
  const row=payments.db.prepare('SELECT * FROM invoices WHERE org=? AND id=?').get(req.account.org,req.params.id);
  if(!row)throw problem('invoice_not_found','Invoice not found.',404);
  res.set('Content-Disposition',`attachment; filename="${row.number.replace('/','-')}.pdf"`).type('pdf').send(await payments.pdf(row));
 }));
}
