import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../server/app.js';
import {ProviderError} from '../server/provider-errors.js';
import {portraitAnchors} from '../server/avatar-view-store.js';
import {detectFaces} from '../server/face-check.js';

const url=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const portrait=url(await sharp({create:{width:1152,height:1536,channels:3,background:'#bca58d'}}).png().toBuffer());
const face='data:image/jpeg;base64,'+(await readFile(new URL('fixtures/customers/red-plaid-face.jpg',import.meta.url))).toString('base64');
const consent={kind:'portrait',facePhoto:face,consent:true,consentScope:'face-for-portrait',consentProvider:'gemini',avatarReviewed:true};
const hands={kind:'hands',source:'template'};
const approve=p=>({image:p.image,receipt:p.receipt,reviewed:true,storageConsent:true});
async function fixture(run,{app:extra={},generate}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-avatar-views-')),store=new AccountStore(directory);
 const a=await store.register({email:'views-a@example.test',name:'A store',password:'test-password-long'}),b=await store.register({email:'views-b@example.test',name:'B store',password:'test-password-long'});
 const token=store.session(a),ca='forme_session='+token,cb='forme_session='+store.session(b);let calls=0,anchorCalls=0;
 const baseImage=url(await standardAvatar('regular'));
 const av=await store.save(a,{image:baseImage,name:'Customer A',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
 const bv=await store.save(b,{image:url(await standardAvatar('f-regular')),name:'Customer B',profileId:'f-regular',heightCm:165,weightKg:62,source:'imported'});
 const app=createApp({accountStore:store,accessMode:'public',apiKey:'test',provider:'gemini',rateLimit:false,jewelleryEnabled:true,...extra,avatarViewOptions:{faceCheck:async()=>{},portrait:async input=>{calls++;return generate?generate(input):portrait;},computeAnchors:async()=>{anchorCalls++;return {anchors:{neckBase:{x:500,y:1100}},pxPerMm:3};},...extra.avatarViewOptions}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(endpoint,method='GET',body,cookie=ca,origin=base)=>fetch(base+endpoint,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const endpoint='/api/avatars/'+av.id+'/views';
 const create=(body=consent,cookie=ca)=>request(endpoint,'POST',{...body,...(body.kind==='portrait'?{requestId:randomUUID()}: {})},cookie);
 try{await run({store,a,b,av,bv,ca,cb,token,baseImage,endpoint,request,create,directory,calls:()=>calls,anchorCalls:()=>anchorCalls});}
 finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}

test('free hands preview requires review, persists in its account, survives restart and cascades with the avatar',async()=>fixture(async({store,a,av,baseImage,create,endpoint,request,directory,calls})=>{
 const balance=store.billing.balance(a.org),response=await create(hands);assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.needsReview,true);assert.equal(preview.creditsUsed,0);assert.ok(preview.anchors.left.ring);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n,0);
 assert.equal((await request(endpoint+'/hands/approve','POST',{image:preview.image})).status,400);
 assert.equal((await request(endpoint+'/hands/approve','POST',{...approve(preview),receipt:undefined})).status,409);
 const altered=url(await sharp(Buffer.from(preview.image.split(',')[1],'base64')).modulate({brightness:.6}).png().toBuffer());assert.equal((await request(endpoint+'/hands/approve','POST',{...approve(preview),image:altered})).status,409);
 const reopened=new AccountStore(directory);try{await reopened.views.approve(a,av.id,'hands',approve(preview));assert.equal(reopened.views.get(a,av.id,'hands').tone,'medium');assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{reopened.close();}
 assert.equal((await request(endpoint+'/hands/approve','POST',approve(preview))).status,200,'approval is idempotent');
 const saved=await request(endpoint+'/hands');assert.equal(saved.headers.get('cache-control'),'no-store');assert.equal(saved.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await saved.arrayBuffer()),Buffer.from(preview.image.split(',')[1],'base64'));
 assert.equal((await (await request(endpoint)).json()).views.length,1);assert.equal(store.billing.balance(a.org),balance);assert.equal(calls(),0);
 await store.save(a,{image:baseImage,name:'Renamed customer',profileId:'regular',heightCm:176,weightKg:73,source:'imported'});assert.equal(store.views.list(a,av.id).length,1,'nonvisual metadata changes must preserve approved views');
 store.remove(a,av.id);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n,0);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_view_epochs').get().n,0);assert.equal((await request(endpoint+'/hands')).status,404);
}));

test('every view route isolates tenants, anonymous users, origins, selectors and preview ownership',async()=>fixture(async({store,a,b,endpoint,request,create,cb,ca,bv,calls})=>{
 const preview=await (await create(hands)).json();
 const routes=[[endpoint,'GET'],[endpoint,'POST',hands],[endpoint+'/hands','GET'],[endpoint+'/hands','DELETE'],[endpoint+'/hands/approve','POST',approve(preview)],[endpoint+'/portrait/anchors','GET']];
 for(const [path,method,body] of routes){assert.equal((await request(path,method,body,cb)).status,404,path);assert.equal((await request(path,method,body,'')).status,401,path);}
 for(const [path,method,body] of routes.filter(([,method])=>method!=='GET'))assert.equal((await request(path,method,body,ca,'https://evil.test')).status,403);
 assert.equal((await request(endpoint,'POST',{...hands,store:b.id})).status,400);assert.equal((await request(endpoint+'/unknown')).status,400);assert.equal((await request(endpoint,'POST',{...hands,kind:'portraitRevision=0'})).status,400);
 assert.equal((await request('/api/avatars/'+bv.id+'/views','POST',hands)).status,404);
 store.db.prepare("INSERT INTO memberships VALUES(?,?,'staff')").run(b.user.id,a.id);const staff=store.identity(b.user.id,a.id),cookie='forme_session='+store.session(staff);
 assert.equal((await request(endpoint,'GET',undefined,cookie)).status,200);assert.equal((await request(endpoint+'/hands/approve','POST',approve(preview),cookie)).status,409,'receipts bind the initiating user');
 const own=await (await request(endpoint,'POST',hands,cookie)).json();assert.equal((await request(endpoint+'/hands/approve','POST',approve(own),cookie)).status,200);
 assert.equal(calls(),0);
}));

test('flag-off routes stay unavailable; free hands work without a key or credits while portraits require Gemini',async()=>{
 await fixture(async({endpoint,request,create,calls})=>{const h=await (await request('/api/health')).json();assert.equal(h.avatarViewsAvailable,false);for(const [path,method,body] of [[endpoint,'GET'],[endpoint,'POST',hands],[endpoint+'/portrait','GET'],[endpoint+'/hands','DELETE'],[endpoint+'/portrait/approve','POST',{}],[endpoint+'/portrait/anchors','GET']])assert.equal((await request(path,method,body)).status,404);assert.equal(calls(),0);},{app:{jewelleryEnabled:false}});
 await fixture(async({store,a,create,request,calls})=>{const balance=store.billing.balance(a.org);store.db.prepare("INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','zero-test',?)").run(randomUUID(),a.org,-balance,Date.now());
  const h=await (await request('/api/health')).json();assert.equal(h.avatarViewsAvailable,true);assert.equal(h.portraitGenerationAvailable,false);assert.equal(h.jewelleryAvailable,false);assert.equal((await create(hands)).status,200);assert.equal((await create()).status,503);assert.equal(store.billing.balance(a.org),0);assert.equal(calls(),0);
 },{app:{provider:'openai',apiKey:''}});
});

test('portrait creation requires precise consent, approved-avatar attestation and hair consent, uses one credit and stores only after approval',async()=>fixture(async({store,a,endpoint,request,create,calls})=>{
 const balance=store.billing.balance(a.org);
 for(const change of [{consent:false},{consentScope:'face-and-body'},{consentProvider:'openai'},{avatarReviewed:false},{hairBehindEars:true,hairConsent:false}])assert.equal((await create({...consent,...change})).status,400);
 assert.equal((await request(endpoint,'POST',consent)).status,400);assert.equal((await create({...consent,facePhoto:'bad'})).status,400);assert.equal(calls(),0);assert.equal(store.billing.balance(a.org),balance);
 const requestId=randomUUID(),result=await request(endpoint,'POST',{...consent,requestId,hairBehindEars:true,hairConsent:true});assert.equal(result.status,200);const p=await result.json();assert.equal(p.creditsUsed,1);assert.equal(p.needsReview,true);assert.equal(store.billing.balance(a.org),balance-1);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n,0);
 assert.equal((await request(endpoint,'POST',{...consent,requestId})).status,409);assert.equal(calls(),1);
 assert.equal((await request(endpoint+'/portrait/approve','POST',{...approve(p),reviewed:false})).status,400);assert.equal((await request(endpoint+'/portrait/approve','POST',{...approve(p),storageConsent:false})).status,400);
 assert.equal((await request(endpoint+'/portrait/approve','POST',approve(p))).status,200);assert.equal(store.views.list(a,endpoint.split('/')[3])[0].sourceKind,'generated');
}));

test('provider errors, invalid output and busy shared slots refund credits without automatic retry',async()=>{
 for(const generate of [async()=>{throw new ProviderError('quota');},async()=>url(await sharp({create:{width:300,height:400,channels:3,background:'#ccc'}}).png().toBuffer())])await fixture(async({store,a,create,calls})=>{const before=store.billing.balance(a.org),response=await create();assert.ok(response.status>=400);assert.equal(store.billing.balance(a.org),before);assert.equal(calls(),1);assert.equal(store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='refund'").get().n,1);},{generate});
 await fixture(async({store,a,create,calls})=>{const one=store.imageSlots.acquire(),two=store.imageSlots.acquire(),before=store.billing.balance(a.org);try{assert.equal((await create()).status,429);assert.equal(store.billing.balance(a.org),before);assert.equal(calls(),0);}finally{store.imageSlots.release(one);store.imageSlots.release(two);}});
});

test('one avatar view cannot dispatch concurrent paid calls; session revocation cancels and refunds even if a provider finishes late',async()=>{
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 await fixture(async({store,a,token,create,calls})=>{const before=store.billing.balance(a.org),pending=create();await started;
  try{assert.equal((await create()).status,409);assert.equal(calls(),1);store.logout(token);const response=await pending;assert.equal(response.status,401);assert.equal(store.billing.balance(a.org),before);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n,0);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_view_jobs').get().n,0);}finally{release();await pending;}
 },{generate:async()=>{entered();await gate;return portrait;}});
});

test('deletion during generation cannot return or save a paid view and an old receipt cannot revive a deleted avatar',async()=>{
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 await fixture(async({store,a,av,create,calls})=>{const before=store.billing.balance(a.org),pending=create();await started;try{store.remove(a,av.id);assert.equal((await pending).status,404);assert.equal(store.billing.balance(a.org),before);assert.equal(calls(),1);}finally{release();await pending;}},{generate:async()=>{entered();await gate;return portrait;}});
 await fixture(async({store,a,av,endpoint,create,request,baseImage})=>{const p=await (await create(hands)).json();store.remove(a,av.id);const same=await store.save(a,{image:baseImage,name:'Recreated',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});assert.equal(same.id,av.id);assert.equal((await request(endpoint+'/hands/approve','POST',approve(p))).status,409);});
});

test('view deletion, avatar metadata changes and expired or altered receipts invalidate old approvals',async()=>fixture(async({store,a,av,endpoint,create,request})=>{
 const p=await (await create(hands)).json();assert.equal((await request(endpoint+'/hands','DELETE')).status,200);assert.equal((await request(endpoint+'/hands/approve','POST',approve(p))).status,409);
 const next=await (await create(hands)).json();store.db.prepare("UPDATE avatars SET template_tone='light' WHERE account=? AND id=?").run(a.id,av.id);store.db.prepare("UPDATE avatars SET template_tone='medium' WHERE account=? AND id=?").run(a.id,av.id);assert.equal((await request(endpoint+'/hands/approve','POST',approve(next))).status,409);
 const current=await (await create(hands)).json();assert.equal((await request(endpoint+'/hands/approve','POST',{...approve(current),receipt:current.receipt+'0'})).status,409);
 const now=Date.now;try{const future=now()+31*60000;Date.now=()=>future;assert.equal((await request(endpoint+'/hands/approve','POST',approve(current))).status,409);}finally{Date.now=now;}
 const claims=store.views.claims(a,av.id,'hands',current.receipt);assert.equal(Object.hasOwn(claims,'facePhoto'),false);assert.equal(Object.hasOwn(claims,'descriptor'),false);
 assert.equal((await request(endpoint+'/hands/approve','POST',approve(current))).status,200);store.db.prepare("UPDATE avatars SET template_tone='light' WHERE account=? AND id=?").run(a.id,av.id);assert.equal((await request(endpoint+'/hands')).status,404);
}));

test('session is checked again after asynchronous approval decoding, before any image is persisted',async()=>fixture(async({store,a,av,token,endpoint,create,request})=>{
 const p=await (await create(hands)).json(),original=store.views.claims.bind(store.views);store.views.claims=(...args)=>{const result=original(...args);store.logout(token);return result;};
 assert.equal((await request(endpoint+'/hands/approve','POST',approve(p))).status,401);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n,0);
}));

test('portrait anchors are scoped and cached by approved image hash; deletion invalidates them and customer deletion cascades views',async()=>fixture(async({store,a,av,endpoint,create,request,anchorCalls})=>{
 const p=await (await create()).json();await request(endpoint+'/portrait/approve','POST',approve(p));assert.equal((await request(endpoint+'/portrait/anchors')).status,200);assert.equal((await request(endpoint+'/portrait/anchors')).status,200);assert.equal(anchorCalls(),1);
 const value=await store.views.anchors(a,av.id);value.anchors.neckBase.x=0;assert.notEqual((await store.views.anchors(a,av.id)).anchors.neckBase.x,0);
 assert.equal((await request(endpoint+'/portrait','DELETE')).status,200);assert.equal(store.views.cache.size,0);assert.equal((await request(endpoint+'/portrait/anchors')).status,404);
 const customer=store.customers.save(a,{name:'A customer',phoneE164:'+919876543210'});store.db.prepare('UPDATE avatars SET customer=? WHERE account=? AND id=?').run(customer.id,a.id,av.id);
 const h=await (await create(hands)).json();await request(endpoint+'/hands/approve','POST',approve(h));store.customers.remove(a,customer.id);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n,0);assert.equal((await request(endpoint)).status,404);
}));

test('portrait rate limits count failed attempts durably, while a trial receipt binds the watermarked delivered image',async()=>{
 await fixture(async({store,a,create,calls})=>{assert.equal((await create()).status,200);assert.equal((await create()).status,429);assert.equal(calls(),1);},{app:{rateLimit:true}});
 await fixture(async({store,a,endpoint,create,request})=>{store.db.prepare("UPDATE orgs SET plan='trial',status='trial',trialEndsAt=? WHERE id=?").run(Date.now()+86400000,a.org);const p=await (await create()).json();assert.notEqual(p.image,portrait);assert.equal((await request(endpoint+'/portrait/approve','POST',{...approve(p),image:portrait})).status,409);assert.equal((await request(endpoint+'/portrait/approve','POST',approve(p))).status,200);});
});

test('twenty refunded hourly attempts block another call until the window expires',async()=>fixture(async({store,a,create,calls})=>{
 const before=store.billing.balance(a.org),now=Date.now;
 for(let i=0;i<20;i++){const hold=randomUUID();store.db.prepare("INSERT INTO ledger(id,org,store,user,pool,amount,kind,ref,requestId,action,createdAt) VALUES(?,?,?,?,'ai',-1,'hold','avatar',?,'avatar',?)").run(hold,a.org,a.id,a.user.id,randomUUID(),now()-60000-i*16000);store.billing.refund(hold,'fixture');}
 assert.equal((await create()).status,429);assert.equal(calls(),0);assert.equal(store.billing.balance(a.org),before);
 try{const future=now()+3601000;Date.now=()=>future;assert.equal((await create()).status,200);assert.equal(calls(),1);}finally{Date.now=now;}
},{app:{rateLimit:true}}));

test('disconnecting the HTTP client aborts the provider signal and refunds the reserved credit',async()=>{
 let entered,release,signal;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 await fixture(async({store,a,endpoint,request,ca,calls})=>{
  const controller=new AbortController(),before=store.billing.balance(a.org),root=new URL((await request('/api/health')).url).origin;
  const pending=fetch(root+endpoint,{method:'POST',headers:{Cookie:ca,Origin:root,'Content-Type':'application/json'},body:JSON.stringify({...consent,requestId:randomUUID()}),signal:controller.signal});await started;
  try{controller.abort();await assert.rejects(pending,{name:'AbortError'});for(let i=0;i<100&&store.billing.balance(a.org)!==before;i++)await new Promise(r=>setTimeout(r,10));assert.equal(signal.aborted,true);assert.equal(store.billing.balance(a.org),before);assert.equal(calls(),1);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n,0);}finally{release();await pending.catch(()=>{});}
 },{generate:async input=>{signal=input.signal;entered();await gate;return portrait;}});
});

test('suspending an organisation during generation stops delivery and refunds the hold',async()=>{
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 await fixture(async({store,a,create})=>{const before=store.billing.balance(a.org),pending=create();await started;try{store.db.prepare("UPDATE orgs SET status='suspended' WHERE id=?").run(a.org);assert.equal((await pending).status,403);assert.equal(store.billing.balance(a.org),before);}finally{release();await pending;}},{generate:async()=>{entered();await gate;return portrait;}});
});

test('female sample hands remain free while female paid portraits honour the existing pilot flag',async()=>fixture(async({store,a,request,calls})=>{
 const av=await store.save(a,{image:url(await standardAvatar('f-regular')),name:'Female customer',profileId:'f-regular',heightCm:165,weightKg:62,source:'imported'}),endpoint='/api/avatars/'+av.id+'/views';
 assert.equal((await request(endpoint,'POST',hands)).status,200);assert.equal((await request(endpoint,'POST',{...consent,requestId:randomUUID()})).status,400);assert.equal(calls(),0);
}));

test('photo validation is bounded to two concurrent preflights before any credits are reserved',async()=>{
 let entered,release,n=0;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 await fixture(async({store,a,endpoint,request,calls})=>{
  const extra=[];for(const profileId of ['athletic','broad'])extra.push(await store.save(a,{image:url(await standardAvatar(profileId)),name:profileId,profileId,heightCm:175,weightKg:72,source:'imported'}));
  const one=request(endpoint,'POST',{...consent,requestId:randomUUID()}),two=request('/api/avatars/'+extra[0].id+'/views','POST',{...consent,requestId:randomUUID()});await started;
  try{const third=await request('/api/avatars/'+extra[1].id+'/views','POST',{...consent,requestId:randomUUID()});assert.equal(third.status,429);assert.equal(calls(),0);assert.equal(store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='hold'").get().n,0);}finally{release();await Promise.all([one,two]);}
 },{app:{avatarViewOptions:{faceCheck:async()=>{if(++n===2)entered();await gate;}}}});
});

test('real portrait anchors use full 68-point landmarks and return placement coordinates rather than descriptors',async()=>{
 const source=await readFile(new URL('fixtures/customers/red-plaid-face.jpg',import.meta.url)),[f]=await detectFaces(source),scale=1536*.45/f.box.height;
 const image=await sharp({create:{width:1152,height:1536,channels:3,background:'#ddd'}}).composite([{input:await sharp(source).extract({left:20,top:0,width:160,height:210}).resize(Math.round(160*scale),Math.round(210*scale)).png().toBuffer(),left:Math.round((1152-160*scale)/2),top:80}]).png().toBuffer();
 const result=await portraitAnchors(image);assert.equal(result.width,1152);assert.equal(result.height,1536);assert.equal(result.coordinateSide,'image');assert.ok(result.pxPerMm>1);assert.ok(result.anchors.leftEarlobe.x<result.anchors.rightEarlobe.x);assert.ok(result.anchors.neckBase.y>result.anchors.hairParting.y);assert.doesNotMatch(JSON.stringify(result),/descriptor|facePhoto|positions/);
 for(const p of Object.values(result.anchors)){assert.ok(p.x>=0&&p.x<=1152);assert.ok(p.y>=0&&p.y<=1536);}
});
