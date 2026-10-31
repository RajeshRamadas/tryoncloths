import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {AccountStore} from './helpers/pilot-accounts.js';
import {BillingStore,meter,CreditsRequired,trialWatermark} from '../server/billing.js';
import {createApp,standardAvatar} from '../server/app.js';
import {ProviderError} from '../server/provider-errors.js';
import {customerPhotos} from './helpers/customer-photos.js';
const creds=name=>({name,email:`${name}@example.test`,password:'billing-password-long'});
const data=bytes=>`data:image/png;base64,${bytes.toString('base64')}`;
async function fixture(run,options={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-billing-')),store=new AccountStore(directory);
 const a=await store.register(creds('Alpha')),b=await store.register(creds('Beta'));
 const credit=store.billing.balance(a.org);
 store.db.prepare("INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','test-reset',?)").run(randomUUID(),a.org,-credit,Date.now());
 let calls=0;const image=data(await standardAvatar('regular'));
 const generate=async()=>{calls++;if(options.failure)throw new ProviderError(options.failure);return image;};
 const app=createApp({accountStore:store,accessMode:'public',apiKey:'test',rateLimit:false,personalize:generate,tryOn:generate});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const token=store.session(a);
 const request=(url,body,session=token,from=origin)=>fetch(origin+url,{method:body?'POST':'GET',headers:{Origin:from,Cookie:`forme_session=${session}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const reserve=overrides=>store.billing.reserve({org:a.org,store:a.id,user:a.user.id,pool:'ai',requestId:randomUUID(),action:'avatar',...overrides});
 try{await run({directory,store,a,b,image,request,reserve,calls:()=>calls,token});}finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}
async function generationInput(){return {requestId:randomUUID(),face:`data:image/jpeg;base64,${(await readFile(customerPhotos[0].face)).toString('base64')}`,body:`data:image/jpeg;base64,${(await readFile(customerPhotos[0].body)).toString('base64')}`,profileId:'regular',measurements:{heightCm:175,weightKg:72},consent:true,consentScope:'face-and-body',consentProvider:'gemini',accountStorageConsent:true};}
const tryonInput=image=>({requestId:randomUUID(),avatar:image,garment:image,garmentType:'shirt',consent:true,consentScope:'avatar-and-garment',consentProvider:'gemini'});

test('20 concurrent reservations across connections cannot overspend five credits',()=>fixture(async({store,a,directory,reserve})=>{
 store.billing.grant(a.org,'ai',5,'grant_admin','five');const second=new AccountStore(directory);
 try {
  const attempts=await Promise.allSettled(Array.from({length:20},(_,i)=>Promise.resolve().then(()=>i%2?reserve():second.billing.reserve({org:a.org,store:a.id,user:a.user.id,pool:'ai',requestId:randomUUID(),action:'tryon'}))));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,5);assert.equal(store.billing.balance(a.org),0);
  assert.ok(attempts.filter(r=>r.status==='rejected').every(r=>r.reason instanceof CreditsRequired));
 }finally{second.close();}
}));

test('settlement, grants and pilot migration are idempotent and ledger is immutable',()=>fixture(async({store,a,b,directory,reserve})=>{
 const grant=store.billing.grant(a.org,'ai',2,'grant_admin','seed');assert.equal(store.billing.grant(a.org,'ai',2,'grant_admin','seed'),grant);
 assert.throws(()=>store.billing.grant(a.org,'ai',3,'grant_admin','seed'),{code:'grant_conflict'});
 const requestId=randomUUID(),hold=reserve({requestId});assert.equal(store.billing.balance(a.org),1);
 assert.equal(store.billing.commit(hold),true);assert.equal(store.billing.commit(hold),false);assert.equal(store.billing.refund(hold),false);assert.equal(store.billing.balance(a.org),1);
 assert.throws(()=>reserve({requestId}),{code:'duplicate_request'});
 const next=reserve();assert.equal(store.billing.refund(next),true);assert.equal(store.billing.refund(next),false);assert.throws(()=>store.billing.commit(next),{code:'request_expired'});assert.equal(store.billing.balance(a.org),1);
 assert.throws(()=>store.db.prepare('UPDATE ledger SET amount=100 WHERE id=?').run(grant),/immutable/);
 assert.throws(()=>store.db.prepare('DELETE FROM ledger WHERE id=?').run(grant),/immutable/);
 const reopened=new AccountStore(directory);try{assert.equal(reopened.billing.balance(a.org),1);assert.equal(reopened.billing.balance(b.org),1000);}finally{reopened.close();}
 assert.throws(()=>new BillingStore(store.db,{pilotCredits:'-1'}),/TRYON_PILOT_CREDITS/);
 assert.throws(()=>store.billing.grant(a.org,'ai',-1,'grant_admin','bad'),{code:'invalid_grant'});
}));

test('sweeper refunds only unresolved holds older than ten minutes once',()=>fixture(async({store,a,reserve})=>{
 store.billing.grant(a.org,'ai',3,'grant_admin','three');const stale=reserve(),committed=reserve();store.billing.commit(committed);
 assert.equal(store.billing.sweep(),0);
 const later=Date.now()+11*60*1000;
 // A newer hold belongs to the future-clock fixture and must remain reserved.
 const fresh=randomUUID();store.db.prepare("INSERT INTO ledger(id,org,store,user,pool,amount,kind,ref,requestId,action,createdAt) VALUES(?,?,?,?,'ai',-1,'hold','avatar',?,'avatar',?)").run(fresh,a.org,a.id,a.user.id,randomUUID(),later);
 assert.equal(store.billing.sweep(later),1);assert.equal(store.billing.sweep(later),0);assert.equal(store.billing.balance(a.org),1);
 assert.throws(()=>store.billing.commit(stale),{code:'request_expired'});assert.equal(store.billing.refund(fresh),true);
}));

test('paid routes block zero credits before provider calls and require valid request IDs',()=>fixture(async({store,a,image,request,calls})=>{
 for(const [url,input] of [['/api/personalize',await generationInput()],['/api/tryon',tryonInput(image)]]){
  let r=await request(url,input);assert.equal(r.status,402);assert.equal((await r.json()).code,'credits_required');assert.equal(calls(),0);
  r=await request(url,{...input,requestId:undefined});assert.equal(r.status,400);assert.equal((await r.json()).code,'invalid_request_id');
  assert.equal((await request(url,{...input,requestId:'not-a-uuid'})).status,400);
 }
 assert.equal(store.billing.balance(a.org),0);
}));

test('successful avatar and try-on consume one credit, record staff, reject replays and isolate orgs',()=>fixture(async({store,a,b,image,request,calls})=>{
 store.billing.grant(a.org,'ai',3,'grant_admin','three');
 for(const [url,input] of [['/api/personalize',await generationInput()],['/api/tryon',tryonInput(image)]]){
  const before=store.billing.balance(a.org);assert.equal((await request(url,input)).status,200);assert.equal(store.billing.balance(a.org),before-1);
  const count=calls();const r=await request(url,{...input,requestId:input.requestId.toUpperCase()});assert.equal(r.status,409);assert.equal((await r.json()).code,'duplicate_request');assert.equal(calls(),count);
  const entry=store.db.prepare('SELECT * FROM ledger WHERE requestId=?').get(input.requestId);assert.equal(entry.user,a.user.id);assert.equal(entry.store,a.id);assert.equal(entry.org,a.org);
 }
 assert.equal((await request('/api/tryon',tryonInput(image),store.session(b))).status,200);assert.equal(store.billing.balance(b.org),999);assert.equal(store.billing.balance(a.org),1);
}));

for(const failure of ['quota','missing_face'])test(`${failure} failures refund avatar and try-on without retry`,()=>fixture(async({store,a,image,request,calls})=>{
 store.billing.grant(a.org,'ai',2,'grant_admin','two');
 for(const [url,input] of [['/api/personalize',await generationInput()],['/api/tryon',tryonInput(image)]]){
  assert.equal((await request(url,input)).status,502);assert.equal(store.billing.balance(a.org),2);assert.equal((await request(url,input)).status,409);
 }
 assert.equal(calls(),2);
},{failure}));

test('meter refunds unusable results; trial watermark is returned and saved',()=>fixture(async({store,a,image,request})=>{
 store.billing.grant(a.org,'ai',3,'grant_admin','three');const opts={billing:store.billing,account:a,action:'avatar'};
 for(const invalid of [undefined,'data:image/png;base64,ZmFrZQ=='])await assert.rejects(meter({body:{requestId:randomUUID()}},opts,async()=>invalid));
 assert.equal(store.billing.balance(a.org),3);
 const stamp=await trialWatermark(image);assert.notEqual(stamp,image);
 assert.deepEqual(await sharp(Buffer.from(stamp.split(',')[1],'base64')).metadata().then(m=>[m.width,m.height]),await sharp(Buffer.from(image.split(',')[1],'base64')).metadata().then(m=>[m.width,m.height]));
 store.db.prepare("UPDATE orgs SET status='trial',trialEndsAt=9999999999999 WHERE id=?").run(a.org);
 const r=await request('/api/personalize',await generationInput());assert.equal(r.status,200);const result=await r.json();assert.equal(result.image,stamp);assert.equal(store.billing.balance(a.org),2);assert.equal(data(store.image(a,result.avatarId)),stamp);
 const outfit=await request('/api/tryon',tryonInput(image));assert.equal(outfit.status,200);assert.equal((await outfit.json()).image,stamp);assert.equal(store.billing.balance(a.org),1);
}));

test('owner billing summary is session-scoped; manager/staff/anonymous cannot view it',()=>fixture(async({store,a,b,request})=>{
 assert.equal((await request('/api/billing')).status,200);
 assert.equal((await (await request(`/api/billing?org=${a.org}`,undefined,store.session(b))).json()).balances.ai,1000);
 for(const role of ['manager','staff']){store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,a.user.id,a.id);assert.equal((await request('/api/billing')).status,403);}
 assert.equal((await request('/api/billing',undefined,'')).status,401);
}));

test('reserve rechecks membership, disabled status and organisation',()=>fixture(async({store,a,b,reserve})=>{
 store.billing.grant(a.org,'ai',1,'grant_admin','one');assert.throws(()=>reserve({org:b.org}),{code:'account_required'});
 store.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(a.user.id);assert.throws(()=>reserve(),{code:'account_required'});assert.equal(store.billing.balance(a.org),1);
}));

test('configurable pilot grants apply once even when the configured amount later changes',()=>fixture(async({store})=>{
 const org=randomUUID();store.db.prepare("INSERT INTO orgs(id,name,billingEmail,plan,status,createdAt) VALUES(?,'Pilot','pilot@example.test','pilot','active',?)").run(org,Date.now());
 const billing=new BillingStore(store.db,{pilotCredits:5});assert.equal(billing.balance(org),5);
 const restart=new BillingStore(store.db,{pilotCredits:10});assert.equal(restart.balance(org),5);
 assert.equal(store.db.prepare("SELECT count(*) AS n FROM ledger WHERE org=? AND ref='pilot-initial'").get(org).n,1);
}));

test('simultaneous replay cannot start a second provider call while the first is pending',()=>fixture(async({store,a,image})=>{
 store.billing.grant(a.org,'ai',2,'grant_admin','two');const request={body:{requestId:randomUUID()}},opts={billing:store.billing,account:a,action:'tryon'};
 let calls=0,release;const gate=new Promise(r=>{release=r;});
 const first=meter(request,opts,async()=>{calls++;await gate;return image;});
 try{await assert.rejects(meter(request,opts,async()=>{calls++;return image;}),{code:'duplicate_request'});assert.equal(calls,1);}finally{release();}
 await first;assert.equal(store.billing.balance(a.org),1);
}));

test('photo pool reservation is independent of AI credits and accepts the public reserve signature',()=>fixture(async({store,a})=>{
 store.billing.grant(a.org,'photo',1,'grant_admin','photo-one');
 const hold=store.billing.reserve({org:a.org,store:a.id,user:a.user.id,pool:'photo',requestId:randomUUID()});
 assert.equal(store.billing.balance(a.org,'photo'),0);assert.equal(store.billing.balance(a.org,'ai'),0);
 store.billing.refund(hold);assert.equal(store.billing.balance(a.org,'photo'),1);
}));
