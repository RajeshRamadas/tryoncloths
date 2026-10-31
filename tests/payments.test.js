import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createHmac,randomUUID} from 'node:crypto';
import {AccountStore} from '../server/accounts.js';
import {createApp} from '../server/app.js';
import {PaymentStore} from '../server/payments.js';
const config={keyId:'rzp_test_id',keySecret:'test-secret',webhookSecret:'hook-secret',supplier:{name:'Forme Test',address:'Bengaluru Karnataka',billingEmail:'billing@example.test',stateCode:'29',gstin:'29ABCDE1234F1Z5'},planIds:{'starter:monthly':'plan_starter','starter:annual':'plan_annual'}};
const details={name:'Buyer',address:'Bengaluru',billingEmail:'buyer@example.test',stateCode:'29',gstin:''};
const sign=(value,secret=config.keySecret)=>createHmac('sha256',secret).update(value).digest('hex');
async function fixture(run,{protectedMode=false}={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'forme-payments-')),store=new AccountStore(dir);
 const owner=await store.register({name:'Store',email:'owner@example.test',password:'payments-password-long'});
 const other=await store.register({name:'Other',email:'other@example.test',password:'payments-password-long'});
 const responses=new Map(),calls=[],mail=[];let orderNo=0,subNo=0,mailFails=false;
 const fetchImpl=async(url,opts)=>{
  const resource=url.replace('https://api.razorpay.com/v1/','');calls.push({resource,opts});assert.equal(opts.headers.Authorization,`Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`);
  let value=responses.get(resource);
  if(!value&&resource==='orders')value={id:`order_${++orderNo}`,...JSON.parse(opts.body)};
  if(!value&&resource==='subscriptions')value={id:`sub_${++subNo}`,...JSON.parse(opts.body),status:'created'};
  if(!value&&resource==='plans/plan_starter')value={id:'plan_starter',item:{amount:235882,currency:'INR'},period:'monthly',interval:1};
  if(!value&&resource==='plans/plan_annual')value={id:'plan_annual',item:{amount:2358820,currency:'INR'},period:'yearly',interval:1};
  assert.ok(value,resource);return new Response(JSON.stringify(value));
 };
 const app=createApp({accountStore:store,accessMode:protectedMode?'protected':'public',mobileToken:protectedMode?'test-store-token-12345678901234567890':'',paymentOptions:{config,fetchImpl},sendMail:async m=>{if(mailFails)throw new Error('smtp unavailable');mail.push(m);}});
 const service=app.locals.payments;service.saveDetails(owner.org,details);service.saveDetails(other.org,details);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`,cookie=store.session(owner);
 const request=(url,body,token=cookie,method=body?'POST':'GET',origin=base)=>fetch(base+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:`forme_session=${token}`,...(protectedMode?{Authorization:'Bearer test-store-token-12345678901234567890'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const hook=(event,eventId=randomUUID(),signature)=>{const body=JSON.stringify(event);return fetch(base+'/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-razorpay-signature':signature||sign(body,config.webhookSecret),'x-razorpay-event-id':eventId},body});};
 const captured=(order,paymentId='pay_one')=>{const p={id:paymentId,order_id:order.orderId,amount:order.amount,currency:'INR',status:'captured',captured:true};responses.set(`payments/${paymentId}`,p);return p;};
 try{await run({store,owner,other,service,request,hook,responses,calls,mail,captured,cookie,dir,setMailFailure:v=>{mailFails=v;}});}finally{await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
}

test('server-priced credit pack verifies capture, grants once, creates GST PDF and emails once across callback/webhook replays',()=>fixture(async({request,hook,responses,store,owner,captured,mail})=>{
 const r=await request('/api/billing/order',{pack:100,amount:1,credits:999999});assert.equal(r.status,200);const order=await r.json();assert.equal(order.amount,106200);
 const payment=captured(order);responses.set('payments/pay_one',payment);
 const input={orderId:order.orderId,paymentId:payment.id,signature:sign(`${order.orderId}|${payment.id}`)};
 const before=store.billing.balance(owner.org);
 const out=await request('/api/billing/verify',input);assert.equal(out.status,200);const {invoiceId}=await out.json();
 assert.equal(store.billing.balance(owner.org),before+100);assert.equal((await request('/api/billing/verify',input)).status,200);
 const event={event:'payment.captured',payload:{payment:{entity:payment}}};assert.equal((await hook(event,'evt1')).status,200);assert.equal((await hook(event,'evt1')).status,200);assert.equal((await hook(event,'evt2')).status,200);
 assert.equal(store.billing.balance(owner.org),before+100);assert.equal(mail.length,1);assert.ok(mail[0].attachments[0].content.toString().startsWith('%PDF'));
 const row=store.db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId),snapshot=JSON.parse(row.snapshotJson);
 assert.equal(snapshot.cgst,8100);assert.equal(snapshot.sgst,8100);assert.equal(snapshot.igst,0);
 const pdf=await request(`/api/billing/invoices/${invoiceId}`);assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/pdf/);
 assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 assert.equal((await (await request('/api/billing/invoices')).json()).invoices.length,1);
}));

test('bad signatures, un-captured/mismatched payments and other-store orders never grant credits',()=>fixture(async({request,responses,store,owner,other,captured})=>{
 const order=await (await request('/api/billing/order',{pack:100})).json();const before=store.billing.balance(owner.org);
 const input={orderId:order.orderId,paymentId:'pay_one',signature:sign(`${order.orderId}|pay_one`)};
 assert.equal((await request('/api/billing/verify',{...input,signature:'bad'})).status,400);
 assert.equal((await request('/api/billing/verify',input,store.session(other))).status,404);
 for(const change of [{status:'authorized',captured:false},{amount:1},{currency:'USD'},{order_id:'order_other'},{amount_refunded:100}]){
  responses.set('payments/pay_one',{...captured(order),...change});assert.equal((await request('/api/billing/verify',input)).status,409);
 }
 assert.equal(store.billing.balance(owner.org),before);assert.equal(store.db.prepare('SELECT count(*) AS n FROM invoices').get().n,0);
}));

test('signed raw webhooks work without browser credentials in protected mode; invalid signatures change nothing',()=>fixture(async({request,hook,store,owner,captured})=>{
 const order=await (await request('/api/billing/order',{pack:100})).json(),event={event:'payment.captured',payload:{payment:{entity:captured(order)}}};
 assert.equal((await hook(event,'bad','f'.repeat(64))).status,400);assert.equal(store.billing.balance(owner.org),1000);
 assert.equal((await hook(event,'good')).status,200);assert.equal(store.billing.balance(owner.org),1100);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM webhook_events').get().n,1);
},{protectedMode:true}));

test('concurrent payments allocate unique gap-free financial-year invoice numbers, with IGST outside supplier state',()=>fixture(async({service,store,owner,request,responses,captured})=>{
 service.saveDetails(owner.org,{...details,stateCode:'27'});
 const orders=await Promise.all(Array.from({length:6},()=>service.order(owner.org,100)));
 await Promise.all(orders.map(async(order,i)=>{
  const p=captured(order,`pay_${i}`);responses.set(`payments/${p.id}`,p);
  assert.equal((await request('/api/billing/verify',{orderId:order.orderId,paymentId:p.id,signature:sign(`${order.orderId}|${p.id}`)})).status,200);
 }));
 const rows=store.db.prepare('SELECT number,snapshotJson FROM invoices ORDER BY number').all();assert.equal(rows.length,6);
 assert.deepEqual(rows.map(r=>r.number.split('/')[1]),['0001','0002','0003','0004','0005','0006']);
 for(const row of rows){const s=JSON.parse(row.snapshotJson);assert.equal(s.igst,16200);assert.equal(s.cgst+s.sgst,0);}
}));

test('failed transaction does not consume an invoice number or grant credits; retry recovers',()=>fixture(async({service,store,owner,captured})=>{
 const order=await service.order(owner.org,100),record=store.db.prepare('SELECT * FROM billing_orders').get(),payment=captured(order);
 store.db.exec("CREATE TRIGGER fail_invoice BEFORE INSERT ON invoices BEGIN SELECT RAISE(ABORT,'test invoice failure'); END");
 assert.throws(()=>service.settle(record,payment,'pack'),/test invoice failure/);assert.equal(store.billing.balance(owner.org),1000);assert.equal(store.db.prepare('SELECT count(*) AS n FROM payments').get().n,0);
 store.db.exec('DROP TRIGGER fail_invoice');const invoice=service.settle(record,payment,'pack');assert.match(invoice.number,/\/0001$/);assert.equal(store.billing.balance(owner.org),1100);
}));

test('pending invoice email survives restart and does not affect payment success',()=>fixture(async({request,responses,captured,store,service,owner,dir,setMailFailure,mail})=>{
 const order=await service.order(owner.org,100);responses.set('payments/pay_one',captured(order));setMailFailure(true);
 assert.equal((await request('/api/billing/verify',{orderId:order.orderId,paymentId:'pay_one',signature:sign(`${order.orderId}|pay_one`)})).status,200);
 assert.equal(store.billing.balance(owner.org),1100);assert.equal(store.db.prepare('SELECT emailedAt FROM invoices').get().emailedAt,null);
 const reopened=new AccountStore(dir);const retry=new PaymentStore(reopened,{config,sendMail:async m=>mail.push(m)});
 try{await retry.retryInvoices();await retry.retryInvoices();assert.equal(mail.length,1);assert.equal(reopened.billing.balance(owner.org),1100);}finally{reopened.close();}
}));

test('subscription prices are checked, signed charged events grant once, halted plans get a three-day grace and recover',()=>fixture(async({service,request,responses,hook,store,owner})=>{
 const r=await request('/api/billing/subscribe',{plan:'starter',period:'monthly',amount:1});assert.equal(r.status,200);const sub=await r.json();
 assert.equal((await request('/api/billing/subscribe',{plan:'starter',period:'monthly'})).status,409);
 const current={id:sub.subscriptionId,plan_id:'plan_starter',status:'active',current_end:Math.floor(Date.now()/1000)+30*86400};responses.set(`subscriptions/${sub.subscriptionId}`,current);
 const payment={id:'pay_subscription',status:'captured',captured:true,amount:235882,currency:'INR',invoice_id:'inv_one'};
 responses.set('payments/pay_subscription',payment);
 responses.set('invoices/inv_one',{subscription_id:sub.subscriptionId,payment_id:payment.id,amount_paid:235882});
 const event={event:'subscription.charged',payload:{subscription:{entity:current},payment:{entity:payment}}};
 assert.equal((await hook(event,'charge1')).status,200);assert.equal((await hook(event,'charge2')).status,200);assert.equal(store.billing.balance(owner.org),1300);
 assert.equal(store.db.prepare('SELECT plan FROM orgs WHERE id=?').get(owner.org).plan,'starter');
 const reserve=()=>store.billing.reserve({org:owner.org,store:owner.id,user:owner.user.id,requestId:randomUUID()});
 responses.set(`subscriptions/${sub.subscriptionId}`,{...current,status:'halted'});
 assert.equal((await hook({event:'subscription.halted',payload:{subscription:{entity:current}}})).status,200);
 store.billing.refund(reserve());
 store.db.prepare('UPDATE orgs SET pastDueSince=? WHERE id=?').run(Date.now()-4*86400000,owner.org);
 assert.throws(reserve,{code:'subscription_past_due',status:402});
 // An old activated delivery must consult the provider's current halted state.
 await hook({event:'subscription.activated',payload:{subscription:{entity:current}}});assert.throws(reserve,{code:'subscription_past_due'});
 responses.set(`subscriptions/${sub.subscriptionId}`,current);await hook({event:'subscription.activated',payload:{subscription:{entity:current}}});store.billing.refund(reserve());
 assert.equal(store.db.prepare('SELECT pastDueSince FROM orgs WHERE id=?').get(owner.org).pastDueSince,null);
 responses.set(`subscriptions/${sub.subscriptionId}`,{...current,status:'cancelled',current_end:Math.floor(Date.now()/1000)-86400});
 await hook({event:'subscription.cancelled',payload:{subscription:{entity:current}}});assert.equal(store.db.prepare('SELECT status FROM subscriptions').get().status,'cancelled');
}));

test('role matrix protects every owner payment route; invoices stay organisation-scoped',()=>fixture(async({request,store,owner,other,service,captured})=>{
 const order=await service.order(owner.org,100),record=store.db.prepare('SELECT * FROM billing_orders').get(),invoice=service.settle(record,captured(order),'pack');
 const routes=[['/api/billing/details','GET'],['/api/billing/details','PUT',details],['/api/billing/order','POST',{pack:100}],['/api/billing/subscribe','POST',{plan:'starter',period:'monthly'}],['/api/billing/verify','POST',{}],['/api/billing/invoices','GET'],[`/api/billing/invoices/${invoice.id}`,'GET']];
 for(const role of ['manager','staff']){
  store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,owner.user.id,owner.id);
  for(const [url,method,body] of routes)assert.equal((await request(url,body,undefined,method)).status,403,url);
 }
 for(const [url,method,body] of routes)assert.equal((await request(url,body,'',method)).status,401,url);
 const otherToken=store.session(other);assert.equal((await request(`/api/billing/invoices/${invoice.id}`,undefined,otherToken)).status,404);
 assert.equal((await (await request('/api/billing/invoices',undefined,otherToken)).json()).invoices.length,0);
 store.db.prepare("UPDATE memberships SET role='owner' WHERE user=? AND store=?").run(owner.user.id,owner.id);
 assert.equal((await request('/api/billing/order',{pack:100},undefined,'POST','https://evil.test')).status,403);
 assert.equal((await request('/api/billing/details',{...details,gstin:'27ABCDE1234F1Z5'},undefined,'PUT')).status,400);
}));

test('failed payment events never grant credits and cannot overwrite an already captured payment',()=>fixture(async({service,hook,store,owner,captured})=>{
 const order=await service.order(owner.org,100),payment=captured(order);
 const failed={event:'payment.failed',payload:{payment:{entity:{...payment,status:'failed',captured:false}}}};
 assert.equal((await hook(failed)).status,200);assert.equal(store.billing.balance(owner.org),1000);
 assert.equal(store.db.prepare('SELECT status FROM payments').get().status,'failed');
 assert.equal((await hook({event:'payment.captured',payload:{payment:{entity:payment}}})).status,200);
 assert.equal(store.billing.balance(owner.org),1100);assert.equal(store.db.prepare('SELECT status FROM payments').get().status,'captured');
 await hook(failed);assert.equal(store.db.prepare('SELECT status FROM payments').get().status,'captured');
}));

test('wrong provider plan price is blocked; annual subscription uses ten months price and twelve months credits',()=>fixture(async({service,responses,store,owner})=>{
 responses.set('plans/plan_starter',{id:'plan_starter',item:{amount:199900,currency:'INR'},period:'monthly',interval:1});
 await assert.rejects(service.subscribe(owner.org,'starter','monthly'),{code:'plan_configuration'});
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM subscriptions').get().n,0);
 await service.subscribe(owner.org,'starter','annual');const sub=store.db.prepare('SELECT * FROM subscriptions').get();
 assert.equal(sub.amountPaise,2358820);assert.equal(sub.credits,3600);
}));

test('a second captured payment cannot grant a pack twice for one order',()=>fixture(async({service,store,owner,captured})=>{
 const order=await service.order(owner.org,100),record=store.db.prepare('SELECT * FROM billing_orders').get();
 service.settle(record,captured(order,'pay_first'),'pack');
 assert.throws(()=>service.settle(record,captured(order,'pay_second'),'pack'),/UNIQUE/);
 assert.equal(store.billing.balance(owner.org),1100);assert.equal(store.db.prepare('SELECT count(*) AS n FROM invoices').get().n,1);
 assert.equal(store.db.prepare('SELECT next FROM invoice_sequences').get().next,2);
}));

test('meter blocks an overdue subscription before AI and leaves saved data accessible',()=>fixture(async({store,owner,request})=>{
 store.db.prepare("UPDATE orgs SET status='past_due',pastDueSince=? WHERE id=?").run(Date.now()-4*86400000,owner.org);
 // The meter is exercised directly with a provider spy: route-level API image
 // validation is separately covered by the existing paid-generation tests.
 const {meter}=await import('../server/billing.js');let calls=0;
 await assert.rejects(meter({body:{requestId:randomUUID()}},{billing:store.billing,account:owner,action:'avatar'},async()=>{calls++;return 'unused';}),{code:'subscription_past_due',status:402});
 assert.equal(calls,0);assert.equal((await request('/api/avatars')).status,200);
}));

test('invoice financial-year sequence changes at April 1 midnight in India',()=>fixture(async({service,store,owner,captured})=>{
 const before=await service.order(owner.org,100),after=await service.order(owner.org,100);
 const row=order=>store.db.prepare('SELECT * FROM billing_orders WHERE providerOrderId=?').get(order.orderId);
 service.now=()=>Date.parse('2027-03-31T18:29:59Z');
 assert.equal(service.settle(row(before),captured(before,'pay_march'),'pack').number,'FY26-27/0001');
 service.now=()=>Date.parse('2027-03-31T18:30:00Z');
 assert.equal(service.settle(row(after),captured(after,'pay_april'),'pack').number,'FY27-28/0001');
}));
