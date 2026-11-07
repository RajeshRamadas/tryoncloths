import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../server/app.js';
import {encrypt,decrypt} from '../server/secrets.js';
const key='ab'.repeat(32),secret='app-secret',verify='verify-secret',accessToken='private-meta-token';
async function fixture(run){
 const dir=await mkdtemp(path.join(os.tmpdir(),'forme-wa-')),store=new AccountStore(dir);
 const a=await store.register({name:'Store A',email:'a@example.test',password:'test-password-long'}),b=await store.register({name:'Store B',email:'b@example.test',password:'test-password-long'});
 const ca=`forme_session=${store.session(a)}`,cb=`forme_session=${store.session(b)}`;
 const customer=store.customers.save(a,{name:'Asha',phoneE164:'9876543210',marketingOptIn:true,whatsappConsent:true});
 const image=`data:image/png;base64,${(await standardAvatar('regular')).toString('base64')}`;
 const av=await store.save(a,{image,customerId:customer.id,name:'Asha avatar',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
 const look=await store.saveLook(a,{image,avatarId:av.id,name:'Asha outfit',garments:['Blue shirt']});
 const garment=(await store.garments.save(a,{image,name:'New shirt',garmentType:'shirt',variant:'blue',sourceUrl:''})).garment;
 let sends=0,ai=0,mode='ok',aiFailure=false,onAi=()=>{};
 const app=createApp({accountStore:store,accessMode:'public',rateLimit:false,apiKey:'test',publicUrl:'https://studio.example.test',tryOn:async()=>{ai++;if(aiFailure)throw new Error('provider failed');onAi();return image;},whatsappOptions:{secretKey:key,appSecret:secret,verifyToken:verify,fetchImpl:async(url,options)=>{
  assert.equal(options.headers.Authorization,`Bearer ${accessToken}`);
  if(url.includes('/messages')){sends++;if(mode==='timeout')throw new Error('token='+accessToken);if(mode==='reject')return new Response(JSON.stringify({error:{message:accessToken}}),{status:400});if(mode==='server')return new Response('{}',{status:500});return new Response(JSON.stringify({messages:[{id:'wamid_'+sends}]}));}
  if(url.includes('/phone_numbers'))return new Response(JSON.stringify({data:[{id:'123456789'}]}));
  return new Response(JSON.stringify({id:'123456789',display_phone_number:'+918000000000'}));
 }}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method='GET',body,cookie=ca,origin=base)=>fetch(base+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const webhook=async(value,signature=true)=>{const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123456789'},...value}}]}]});return fetch(base+'/api/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature?'sha256='+createHmac('sha256',secret).update(body).digest('hex'):'sha256='+'0'.repeat(64)},body});};
 const connect=()=>request('/api/integrations/whatsapp','PUT',{phoneId:'123456789',wabaId:'987654321',token:accessToken,language:'en_US'});
 const send=(extra={},cookie=ca)=>request('/api/whatsapp/send','POST',{customerId:customer.id,template:'new_arrivals',lookIds:[look.id],sendConsent:true,requestId:randomUUID(),...extra},cookie);
 try{await run({store,a,b,ca,cb,customer,av,look,garment,image,base,dir,app,request,webhook,connect,send,sends:()=>sends,ai:()=>ai,setMode:m=>{mode=m;},setAiFailure:v=>{aiFailure=v;},onAi:fn=>{onAi=fn;}});}finally{await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
}

test('integration encryption uses random authenticated IVs and store AAD; malformed ciphertext and keys fail closed',()=>{
 const one=encrypt(accessToken,key,'store-a'),two=encrypt(accessToken,key,'store-a');assert.notEqual(one,two);assert.match(one,/^v1:/);assert.equal(decrypt(one,key,'store-a'),accessToken);assert.ok(!one.includes(accessToken));
 for(const action of [()=>decrypt(one,key,'store-b'),()=>decrypt(one+'00',key,'store-a'),()=>decrypt(one,'cd'.repeat(32),'store-a'),()=>encrypt('token','bad')])assert.throws(action);
});

test('owner verifies phone and WABA, stores ciphertext only, hides tokens, enforces roles, tenancy, and origins',async()=>fixture(async({store,a,request,connect,cb})=>{
 for(const role of ['staff','manager']){store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,a.user.id,a.id);assert.equal((await connect()).status,403);assert.equal((await request('/api/integrations/whatsapp')).status,200);assert.equal((await request('/api/integrations/whatsapp','DELETE')).status,403);}
 store.db.prepare("UPDATE memberships SET role='owner' WHERE user=? AND store=?").run(a.user.id,a.id);const result=await connect();assert.equal(result.status,200);assert.ok(!(await result.text()).includes(accessToken));
 const row=store.db.prepare('SELECT * FROM whatsapp_integrations').get();assert.notEqual(row.token,accessToken);assert.equal(decrypt(row.token,key,a.id),accessToken);
 assert.equal((await request('/api/integrations/whatsapp','GET',undefined,'')).status,401);assert.equal((await request('/api/integrations/whatsapp','PUT',{phoneId:'123456789',wabaId:'987654321',token:accessToken},cb)).status,409);
 assert.equal((await request('/api/integrations/whatsapp','DELETE',{},undefined,'https://evil.test')).status,403);
 assert.equal((await (await request('/api/integrations/whatsapp','GET',undefined,cb)).json()).connected,false);
}));

test('send validates opt-in, utility permission and same-customer looks before any Meta request',async()=>fixture(async({store,a,b,customer,look,send,connect,sends,request,ca,cb})=>{
 await connect();store.customers.save(a,{marketingOptIn:false,whatsappConsent:false},customer.id);
 assert.equal((await send()).status,409);assert.equal((await send({template:'look_share'})).status,409);assert.equal(sends(),0);
 store.customers.save(a,{whatsappConsent:true},customer.id);assert.equal((await send({template:'look_share'})).status,200);
 const other=store.customers.save(a,{name:'Other',phoneE164:'9876543211',marketingOptIn:true});assert.equal((await send({customerId:other.id})).status,404);
 assert.equal((await send({lookIds:['missing']})).status,409); // missing marketing consent is checked first
 assert.equal((await send({},cb)).status,409); // other store has no integration
 for(const role of ['owner','manager','staff']){store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,a.user.id,a.id);assert.equal((await send({template:'look_share',requestId:randomUUID()})).status,200);assert.equal((await request('/api/whatsapp/messages')).status,200);}
 assert.equal((await send()).status,403);
 assert.equal((await send({},'')).status,401);assert.equal((await request('/api/whatsapp/send','POST',{},ca,'https://evil.test')).status,403);
 assert.equal((await request('/api/whatsapp/messages','GET',undefined,cb)).status,200);assert.equal((await (await request('/api/whatsapp/messages','GET',undefined,cb)).json()).messages.length,0);
}));

test('marketing is serialized per customer for 7 days; duplicate request IDs never send twice, including uncertain requests',async()=>fixture(async({store,send,connect,sends,setMode,customer,a})=>{
 await connect();const requestId=randomUUID();const both=await Promise.all([send({requestId}),send({requestId:randomUUID()})]);assert.deepEqual(both.map(r=>r.status).sort(),[200,429]);assert.equal(sends(),1);
 const acceptedRequest=store.db.prepare('SELECT requestId FROM whatsapp_messages').get().requestId;const repeat=await send({requestId:acceptedRequest});const data=await repeat.json();assert.equal(data.duplicate,true);assert.equal(sends(),1);
 store.db.prepare('UPDATE whatsapp_messages SET createdAt=?').run(Date.now()-8*86400000);setMode('timeout');const uncertain=await (await send()).json();assert.equal(uncertain.state,'unknown');assert.equal((await send()).status,429);assert.equal(sends(),2);
 assert.ok(!JSON.stringify(uncertain).includes(accessToken));
}));

test('explicit Meta rejections allow deliberate correction; 5xx and timeouts remain uncertain with no automatic retry',async()=>fixture(async({send,connect,setMode,sends})=>{
 await connect();setMode('reject');const failed=await (await send()).json();assert.equal(failed.state,'failed');assert.ok(!JSON.stringify(failed).includes(accessToken));setMode('server');assert.equal((await (await send()).json()).state,'unknown');assert.equal(sends(),2);assert.equal((await send()).status,429);
}));

test('signed webhooks bypass account auth, record monotonic delivery, and STOP/button opt-outs are scoped and deduplicated',async()=>fixture(async({store,a,b,customer,connect,send,request,webhook,base})=>{
 await connect();await send();const other=store.customers.save(b,{name:'Other Asha',phoneE164:customer.phoneE164,marketingOptIn:true,whatsappConsent:true});
 assert.equal((await webhook({messages:[{id:'stop1',from:customer.phoneE164.slice(1),text:{body:'STOP'}}]},false)).status,403);assert.equal(store.customers.get(a,customer.id).marketingOptIn,true);
 assert.equal((await webhook({statuses:[{id:'wamid_1',status:'read'}]})).status,200);await webhook({statuses:[{id:'wamid_1',status:'sent'}]});assert.equal(store.db.prepare('SELECT delivery FROM whatsapp_messages').get().delivery,'read');
 await webhook({messages:[{id:'stop1',from:customer.phoneE164.slice(1),text:{body:' STOP '}}]});assert.equal(store.customers.get(a,customer.id).marketingOptIn,false);assert.equal(store.customers.get(a,customer.id).whatsappConsentAt,null);assert.equal(store.customers.get(b,other.id).marketingOptIn,true);
 store.customers.save(a,{marketingOptIn:true,whatsappConsent:true},customer.id);await webhook({messages:[{id:'stop1',from:customer.phoneE164.slice(1),text:{body:'STOP'}}]});assert.equal(store.customers.get(a,customer.id).marketingOptIn,true,'old STOP replay must not erase newly recorded permission');
 await webhook({messages:[{id:'stop2',from:customer.phoneE164.slice(1),interactive:{button_reply:{id:'OPT_OUT'}}}]});assert.equal(store.customers.get(a,customer.id).marketingOptIn,false);
 assert.equal((await request('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token='+verify+'&hub.challenge=123','GET',undefined,'')).status,200);assert.equal((await request('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123','GET',undefined,'')).status,403);
}));

test('public lookbooks use opaque hashes, omit customer metadata, expire and are erased with customer data',async()=>fixture(async({store,a,customer,connect,app,look,send,request})=>{
 await connect();let url;const old=app.locals.whatsapp.fetch;app.locals.whatsapp.fetch=async(u,o)=>{if(u.includes('/messages'))url=JSON.parse(o.body).template.components[0].parameters[0].image.link;return old(u,o);};
 const sent=await (await send()).json();assert.equal(sent.state,'accepted');const path=new URL(url).pathname,bookPath=path.split('/').slice(0,3).join('/');
 const page=await request(bookPath,'GET',undefined,'');assert.equal(page.status,200);const html=await page.text();assert.ok(!html.includes('Asha'));assert.ok(!html.includes(customer.phoneE164));assert.match(html,/Blue shirt/);const preview=await request(path,'GET',undefined,'');assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/jpeg');assert.ok((await preview.arrayBuffer()).byteLength<5*1024*1024);
 const token=bookPath.split('/')[2];assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM whatsapp_books').all()).includes(token));
 assert.equal((await request(`/api/whatsapp/messages/${sent.id}/link`,'DELETE')).status,200);assert.equal((await request(path,'GET',undefined,'')).status,410);
 store.db.prepare('UPDATE whatsapp_messages SET createdAt=?').run(Date.now()-8*86400000);await send();store.customers.remove(a,customer.id);assert.equal(store.db.prepare('SELECT count(*) AS n FROM whatsapp_books').get().n,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM whatsapp_messages').get().n,0);assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
}));

test('campaign validates selection, explicit credit consent, paid metering, visual review and send permission',async()=>fixture(async({store,a,customer,av,garment,connect,request,send,ai})=>{
 await connect();const selection={customers:[{customerId:customer.id,avatarId:av.id}],garmentIds:[garment.id]};
 const quote=await request('/api/whatsapp/campaigns/quote','POST',selection);assert.equal(quote.status,200);const cost=await quote.json();assert.equal(cost.maxCredits,1);
 assert.equal((await request('/api/whatsapp/campaigns','POST',selection)).status,400);
 const created=await (await request('/api/whatsapp/campaigns','POST',{...selection,generationConsent:true,maxCredits:1})).json();const item=created.items[0],balance=store.billing.balance(a.org);
 const generated=await request(`/api/whatsapp/campaigns/${created.id}/items/${item.id}/generate`,'POST',{generationConsent:true});assert.equal(generated.status,200);const ready=(await generated.json()).items[0];assert.equal(ready.state,'ready');assert.equal(ai(),1);assert.equal(store.billing.balance(a.org),balance-1);
 assert.equal((await request(`/api/whatsapp/campaigns/${created.id}/items/${item.id}/generate`,'POST',{generationConsent:true})).status,409);assert.equal(ai(),1);
 assert.equal((await send({lookIds:[ready.look]})).status,409);assert.equal((await request(`/api/whatsapp/campaigns/${created.id}/items/${item.id}/review`,'POST',{approved:true})).status,200);assert.equal((await send({lookIds:[ready.look]})).status,200);
}));

test('campaign generation shares studio image slots and refunds a busy attempt without dispatch',async()=>fixture(async({store,a,customer,av,garment,connect,request,ai})=>{
 await connect();const selection={customers:[{customerId:customer.id,avatarId:av.id}],garmentIds:[garment.id]};
 const created=await (await request('/api/whatsapp/campaigns','POST',{...selection,generationConsent:true,maxCredits:1})).json(),item=created.items[0],balance=store.billing.balance(a.org);
 const staff=store.imageSlots.acquire({kind:'staff'}),shopper=store.imageSlots.acquire({kind:'shopper'});assert.ok(staff&&shopper);
 try{const result=await request(`/api/whatsapp/campaigns/${created.id}/items/${item.id}/generate`,'POST',{generationConsent:true});assert.equal(result.status,429);assert.equal(ai(),0);assert.equal(store.billing.balance(a.org),balance);assert.equal((await (await request(`/api/whatsapp/campaigns/${created.id}`)).json()).items[0].state,'failed');}
 finally{store.imageSlots.release(staff);store.imageSlots.release(shopper);}
}));

test('failed campaign generation refunds its credit and cannot be retried automatically; opt-out blocks quotes',async()=>fixture(async({store,a,customer,av,garment,connect,request,setAiFailure,ai})=>{
 await connect();const selection={customers:[{customerId:customer.id,avatarId:av.id}],garmentIds:[garment.id]};const created=await (await request('/api/whatsapp/campaigns','POST',{...selection,generationConsent:true,maxCredits:1})).json();const item=created.items[0],balance=store.billing.balance(a.org);setAiFailure(true);
 assert.equal((await request(`/api/whatsapp/campaigns/${created.id}/items/${item.id}/generate`,'POST',{generationConsent:true})).status,502);assert.equal(store.billing.balance(a.org),balance);assert.equal(ai(),1);assert.equal((await (await request(`/api/whatsapp/campaigns/${created.id}`)).json()).items[0].state,'failed');
 store.customers.save(a,{marketingOptIn:false},customer.id);assert.equal((await request('/api/whatsapp/campaigns/quote','POST',selection)).status,409);
}));

test('campaign and workspace role matrix, foreign-store IDs and mutating origins are enforced',async()=>fixture(async({store,a,customer,av,garment,connect,request,ca,cb})=>{
 await connect();const selection={customers:[{customerId:customer.id,avatarId:av.id}],garmentIds:[garment.id]};
 const created=await (await request('/api/whatsapp/campaigns','POST',{...selection,generationConsent:true,maxCredits:1})).json(),item=created.items[0];
 for(const role of ['owner','manager','staff']){
  store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,a.user.id,a.id);
  assert.equal((await request('/api/whatsapp/workspace')).status,200);
  const routes=[[`/api/whatsapp/campaigns/${created.id}`,'GET',undefined],[`/api/whatsapp/campaigns/${created.id}/items/${item.id}/generate`,'POST',{generationConsent:false}],[`/api/whatsapp/campaigns/${created.id}/items/${item.id}/review`,'POST',{approved:true}],['/api/whatsapp/campaigns/quote','POST',selection],['/api/whatsapp/campaigns','POST',selection]];
  for(const [url,method,body] of routes){assert.equal((await request(url,method,body,'')).status,401);assert.equal((await request(url,method,body,cb)).status,url.endsWith('quote')||url==='/api/whatsapp/campaigns'?409:404);if(method!=='GET')assert.equal((await request(url,method,body,ca,'https://evil.test')).status,403);}
  assert.equal((await request(`/api/whatsapp/campaigns/${created.id}`)).status,role==='staff'?403:200);
  assert.equal((await request('/api/whatsapp/campaigns/quote','POST',selection)).status,role==='staff'?403:200);
 }
}));

test('unconfigured integrations fail closed, Starter is gated, and campaign opt-out during generation refunds credits',async()=>fixture(async({store,a,customer,av,garment,connect,request,app,ai,onAi})=>{
 await connect();app.locals.whatsapp.key=undefined;assert.equal((await request('/api/whatsapp/send','POST',{customerId:customer.id,template:'look_share',lookIds:[],sendConsent:true,requestId:randomUUID()})).status,503);app.locals.whatsapp.key=key;
 store.db.prepare("UPDATE orgs SET plan='starter' WHERE id=?").run(a.org);assert.equal((await request('/api/integrations/whatsapp')).status,403);store.db.prepare("UPDATE orgs SET plan='pilot' WHERE id=?").run(a.org);
 const selection={customers:[{customerId:customer.id,avatarId:av.id}],garmentIds:[garment.id]};const created=await (await request('/api/whatsapp/campaigns','POST',{...selection,generationConsent:true,maxCredits:1})).json(),item=created.items[0];
 // Record an opt-out after preparation; no provider call may begin.
 store.customers.save(a,{marketingOptIn:false},customer.id);const before=store.billing.balance(a.org);assert.equal((await request(`/api/whatsapp/campaigns/${created.id}/items/${item.id}/generate`,'POST',{generationConsent:true})).status,409);assert.equal(ai(),0);assert.equal(store.billing.balance(a.org),before);
 store.customers.save(a,{marketingOptIn:true},customer.id);onAi(()=>store.customers.save(a,{marketingOptIn:false},customer.id));assert.equal((await request(`/api/whatsapp/campaigns/${created.id}/items/${item.id}/generate`,'POST',{generationConsent:true})).status,409);assert.equal(ai(),1);assert.equal(store.billing.balance(a.org),before,'opt-out while the provider worked must refund undelivered credits');
}));

test('delivery arriving before send confirmation is reconciled and restarting never resends an uncertain request',async()=>fixture(async({store,a,connect,send,app,webhook,request,dir})=>{
 await connect();const old=app.locals.whatsapp.fetch;app.locals.whatsapp.fetch=async(url,options)=>{if(url.includes('/messages'))await webhook({statuses:[{id:'wamid_1',status:'delivered'}]});return old(url,options);};
 const requestId=randomUUID(),sent=await (await send({requestId})).json();assert.equal(sent.state,'accepted');assert.equal(store.db.prepare('SELECT delivery FROM whatsapp_messages').get().delivery,'delivered');assert.equal(store.db.prepare('SELECT count(*) AS n FROM whatsapp_delivery').get().n,0);
 store.db.prepare("UPDATE whatsapp_messages SET state='unknown' WHERE id=?").run(sent.id);const reopened=new AccountStore(dir);try{assert.equal(reopened.db.prepare('SELECT state FROM whatsapp_messages WHERE id=?').get(sent.id).state,'unknown');}finally{reopened.close();}
 const duplicate=await (await send({requestId})).json();assert.equal(duplicate.state,'unknown');assert.equal(duplicate.duplicate,true);
 store.db.prepare('UPDATE whatsapp_books SET expiresAt=?').run(Date.now()-1);assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
}));

test('signed webhook is installed before protected access-code middleware',async()=>fixture(async({store,connect,customer,a})=>{
 await connect();const app=createApp({accountStore:store,accessMode:'protected',mobileToken:'x'.repeat(32),whatsappOptions:{secretKey:key,appSecret:secret,verifyToken:verify}}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{assert.equal((await fetch(base+'/api/account')).status,401);const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123456789'},messages:[{id:'protected-stop',from:'919876543210',button:{payload:'STOP'}}]}}]}]});assert.equal((await fetch(base+'/api/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')},body})).status,200);assert.equal(store.customers.get(a,customer.id).marketingOptIn,false);}finally{await new Promise(r=>server.close(r));}
}));
