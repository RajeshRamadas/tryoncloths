import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../server/app.js';
import {customerHandsFixture} from './helpers/customer-hands-fixture.js';
import {customerHandAnchors} from '../server/customer-hands.js';
import {createJewelleryTryOn} from '../server/jewellery-tryon.js';
import {ProviderError} from '../server/provider-errors.js';
const f=await customerHandsFixture(),url=b=>'data:image/png;base64,'+b.toString('base64'),approve=p=>({image:p.image,receipt:p.receipt,reviewed:true,storageConsent:true});
async function fixture(run,{generate,extra={},rateLimit=false}={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'forme-hand-photo-')),store=new AccountStore(dir);
 const a=await store.register({email:'hands-a@example.test',name:'A',password:'test-password-long'}),b=await store.register({email:'hands-b@example.test',name:'B',password:'test-password-long'}),token=store.session(a),ca='forme_session='+token,cb='forme_session='+store.session(b);
 const avatar=await store.save(a,{image:url(await standardAvatar('regular')),name:'Customer',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
 const item=(await store.garments.save(a,{category:'jewellery',garmentType:'ring',name:'Gold ring',attributes:{metal:'yellow_gold'},image:url(await sharp({create:{width:220,height:220,channels:3,background:'#c9a724'}}).png().toBuffer()),overlayPng:url(await sharp(Buffer.from('<svg width="220" height="220"><rect x="10" y="90" width="200" height="40" fill="#c9a724"/></svg>')).png().toBuffer()),overlayAnchor:'finger'},{jewelleryEnabled:true})).garment;
 let calls=0,jewelleryCalls=0;const seen=[],handInputs=[];const app=createApp({accountStore:store,accessMode:'public',apiKey:'test-key-only',provider:'gemini',model:'test-model',jewelleryEnabled:true,rateLimit,...extra,avatarViewOptions:{hands:async input=>{calls++;handInputs.push(input);return generate?generate(input):url(input.handPhoto);}},jewelleryOptions:{generate:async input=>{jewelleryCalls++;seen.push(input);return createJewelleryTryOn()({...input,fetchImpl:async()=>{const p=input.anchors[input.hand][input.finger],image=await sharp(input.base).composite([{input:{create:{width:Math.round(p.widthPx),height:12,channels:3,background:'#c9a724'}},left:Math.round(p.x-p.widthPx/2),top:Math.round(p.y-6)}]).png().toBuffer();return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:image.toString('base64')}}]}}]}));}});}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port,endpoint='/api/avatars/'+avatar.id+'/views';
 const request=(p,body,cookie=ca,origin=base,method='POST')=>fetch(base+p,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const input={kind:'hands',source:'photo',tone:'medium',handPhoto:f.url,handPoints:f.points,handsConfirmed:true,avatarReviewed:true,consent:true,consentScope:'hands-for-cleanup',consentProvider:'gemini'};
 const create=(changes={},cookie=ca)=>request(endpoint,{...input,requestId:randomUUID(),...changes},cookie);
 try{await run({store,a,b,dir,app,avatar,item,token,base,endpoint,request,create,input,ca,cb,calls:()=>calls,jewelleryCalls:()=>jewelleryCalls,seen,handInputs});}
 finally{await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
}

test('customer hands charge one credit, persist only after scoped review, survive restart and cascade with the avatar',async()=>fixture(async({store,a,avatar,dir,endpoint,request,create,calls,handInputs})=>{
 const before=store.billing.balance(a.org),r=await create();assert.equal(r.status,200,await r.clone().text());const p=await r.json();assert.equal(p.sourceKind,'photo');assert.equal(p.contract,'customer-hands-v1');assert.equal(p.creditsUsed,1);assert.deepEqual(p.anchors,customerHandAnchors(f.points));assert.equal(store.views.list(a,avatar.id).length,0);assert.equal(calls(),1);assert.equal(store.billing.balance(a.org),before-1);assert.ok(handInputs[0].handPhoto.every(n=>n===0));
 assert.equal((await request(endpoint+'/hands/approve',{...approve(p),reviewed:false})).status,400);assert.equal((await request(endpoint+'/hands/approve',{...approve(p),storageConsent:false})).status,400);
 assert.equal((await request(endpoint+'/hands/approve',approve(p))).status,200);assert.equal((await request(endpoint+'/hands/approve',approve(p))).status,200);
 const reopened=new AccountStore(dir);try{assert.equal(reopened.views.get(a,avatar.id,'hands').sourceKind,'photo');assert.deepEqual(await reopened.views.handAnchors(a,avatar.id),p.anchors);assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{reopened.close();}
 assert.equal((await request(endpoint+'/hands',undefined,undefined,undefined,'GET')).status,200);const data=await(await request(endpoint+'/hands/anchors',undefined,undefined,undefined,'GET')).json();assert.deepEqual(data.anchors,p.anchors);assert.equal(calls(),1);
 store.remove(a,avatar.id);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n,0);
}));

test('fresh photo, exact scope, own-hands/marker review, request UUID and valid geometry are required before any charge',async()=>fixture(async({store,a,create,calls})=>{
 const balance=store.billing.balance(a.org);
 for(const changes of [{consent:false},{consentScope:'face-for-portrait'},{consentProvider:'openai'},{handsConfirmed:false},{avatarReviewed:false},{handPoints:{}},{handPhoto:'bad'},{handPhoto:url(await sharp({create:{width:1024,height:1024,channels:3,background:'white'}}).png().toBuffer())},{requestId:'bad'},{tone:'invalid'},{extra:'private'}]){const r=await create(changes);assert.equal(r.status,400,await r.clone().text());}
 assert.equal(calls(),0);assert.equal(store.billing.balance(a.org),balance);assert.equal(store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='hold'").get().n,0);
}));

test('flag, provider, female pilot, zero balance, account/origin and active store roles guard the photo flow',async()=>{
 for(const config of [{jewelleryEnabled:false},{apiKey:''},{provider:'openai'}])await fixture(async({create,request,calls})=>{assert.equal((await create()).status,config.jewelleryEnabled===false?404:503);const h=await(await request('/api/health',undefined,undefined,undefined,'GET')).json();assert.equal(h.customerHandsGenerationAvailable,false);assert.equal(calls(),0);},{extra:config});
 await fixture(async({store,a,avatar,request,endpoint,create,cb,calls})=>{
  assert.equal((await create({},'')).status,401);assert.equal((await create({},cb)).status,404);assert.equal((await request(endpoint,{},undefined,'https://evil.test')).status,403);
  for(const role of ['owner','manager','staff']){store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,a.user.id,a.id);assert.equal((await create()).status,200);}
  const female=await store.save(a,{image:url(await standardAvatar('f-regular')),name:'Female',profileId:'f-regular',heightCm:165,weightKg:62,source:'imported'});assert.equal((await request('/api/avatars/'+female.id+'/views',{kind:'hands',source:'photo'})).status,400);
  const balance=store.billing.balance(a.org);store.db.prepare("INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','test',?)").run(randomUUID(),a.org,-balance,Date.now());assert.equal((await create()).status,402);assert.equal(calls(),3);
 });
});

test('changed hands/provider failures refund once, return no image/receipt and never retry',async()=>{
 for(const code of ['quota','timeout','blocked','hands_changed'])await fixture(async({store,a,create,calls})=>{const before=store.billing.balance(a.org),r=await create();assert.equal(r.status,502);const data=await r.json();assert.equal(data.code,code);assert.equal(data.image,undefined);assert.equal(data.receipt,undefined);assert.doesNotMatch(JSON.stringify(data),/test-key-only|PRIVATE/);assert.equal(calls(),1);assert.equal(store.billing.balance(a.org),before);assert.equal(store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='refund'").get().n,1);assert.equal(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n,0);},{generate:async()=>{throw new ProviderError(code);}});
 await fixture(async({store,a,create})=>{const before=store.billing.balance(a.org),r=await create();assert.equal(r.status,502);assert.equal((await r.json()).code,'hands_changed');assert.equal(store.billing.balance(a.org),before);},{generate:async()=>url(await sharp(f.image).modulate({brightness:.2}).png().toBuffer())});
});

test('receipts bind both pixels and authored markers; stale same-image geometry is not silently approved',async()=>fixture(async({store,a,avatar,create,request,endpoint})=>{
 const p=await(await create()).json(),context=store.views.context(a,avatar.id,'hands'),points=structuredClone(f.points);points['left.ring'].widthPx=50;
 const other=store.views.receipt(a,avatar.id,'hands',context,p.image,{tone:'medium',sourceKind:'photo',handPoints:points});
 assert.equal((await request(endpoint+'/hands/approve',{...approve(p),handPoints:points})).status,400);
 const [payload,signature]=p.receipt.split('.'),claims=JSON.parse(Buffer.from(payload,'base64url'));claims.handPoints=points;const forged=Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+signature;
 assert.equal((await request(endpoint+'/hands/approve',{...approve(p),receipt:forged})).status,409);
 assert.equal((await request(endpoint+'/hands/approve',approve(p))).status,200);assert.equal((await request(endpoint+'/hands/approve',{...approve(p),receipt:other})).status,409);assert.equal((await store.views.handAnchors(a,avatar.id)).left.ring.widthPx,52);
}));

test('saved custom hands drive AI, free overlays and saved-look reuse with their own geometry after replacing the root view',async()=>fixture(async({store,a,avatar,item,create,endpoint,request,seen,calls,jewelleryCalls})=>{
 const p=await(await create()).json();assert.equal((await request(endpoint+'/hands/approve',approve(p))).status,200);
 const input={avatarId:avatar.id,itemId:item.id,view:'hands',hand:'left',finger:'ring',consent:true,consentScope:'view-and-item',consentProvider:'gemini'};
 const firstResponse=await request('/api/jewellery/tryon',{...input,requestId:randomUUID()});assert.equal(firstResponse.status,200,await firstResponse.clone().text());const first=await firstResponse.json();assert.equal(seen[0].handsSourceKind,'photo');assert.equal(seen[0].anchors.left.ring.y,295);assert.equal((await request('/api/jewellery/results/'+first.resultId+'/approve',approve(first))).status,200);
 const reused=await(await request('/api/jewellery/tryon',{...input,requestId:randomUUID()})).json();assert.equal(reused.reused,true);assert.equal(jewelleryCalls(),1);
 const look=await(await request('/api/jewellery/looks',{avatarId:avatar.id,view:'hands',image:first.image,receipt:first.receipt,name:'Customer ring',itemsJson:[{itemId:item.id,name:item.name,type:'ring',attributes:item.attributes,hand:'left',finger:'ring'}],reviewed:true,storageConsent:true})).json();assert.ok(look.id);assert.equal(JSON.parse(store.db.prepare('SELECT handsGeometryJson FROM looks WHERE account=? AND id=?').get(a.id,look.id).handsGeometryJson).sourceKind,'photo');
 const storedGeometry=store.db.prepare('SELECT handsGeometryJson FROM looks WHERE account=? AND id=?').get(a.id,look.id).handsGeometryJson;store.db.prepare('UPDATE looks SET handsGeometryJson=NULL WHERE account=? AND id=?').run(a.id,look.id);
 assert.equal((await request('/api/jewellery/tryon',{...input,base:first.image,baseLookId:look.id,baseReviewed:true,requestId:randomUUID()})).status,409);store.db.prepare('UPDATE looks SET handsGeometryJson=? WHERE account=? AND id=?').run(storedGeometry,a.id,look.id);
 const overlay=await(await request('/api/jewellery/overlay/prepare',{avatarId:avatar.id,itemId:item.id,view:'hands',hand:'left',finger:'ring'})).json();assert.equal(overlay.placements[0].y,295);assert.equal(overlay.placements[0].x,190);
 const template=await(await request(endpoint,{kind:'hands',source:'template',tone:'medium'})).json();assert.equal((await request(endpoint+'/hands/approve',approve(template))).status,200);assert.equal(store.views.get(a,avatar.id,'hands').handPointsJson,null);assert.equal(store.db.prepare('SELECT count(*) n FROM garment_results').get().n,0);
 const next=await request('/api/jewellery/tryon',{...input,finger:'index',base:first.image,baseLookId:look.id,baseReviewed:true,requestId:randomUUID()});assert.equal(next.status,200,await next.clone().text());assert.equal(seen[1].handsSourceKind,'photo');assert.equal(seen[1].anchors.left.index.y,300);assert.equal(calls(),1);
 store.remove(a,avatar.id);assert.equal(store.db.prepare('SELECT count(*) n FROM looks').get().n,0);assert.equal(store.db.prepare('SELECT count(*) n FROM garment_results').get().n,0);
}));

test('request IDs, rate limits and in-flight view replacement prevent duplicate work',async()=>{
 await fixture(async({create,calls})=>{const requestId=randomUUID();assert.equal((await create({requestId})).status,200);assert.equal((await create({requestId})).status,409);assert.equal((await create()).status,429);assert.equal(calls(),1);},{rateLimit:true});
 for(const change of ['session','view','avatar']){
  let enter,release;const started=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  await fixture(async({store,a,avatar,token,create,calls})=>{const before=store.billing.balance(a.org),pending=create();await started;assert.equal((await create()).status,409);if(change==='session')store.logout(token);if(change==='view')store.views.remove(a,avatar.id,'hands');if(change==='avatar')store.remove(a,avatar.id);release();const response=await pending;assert.ok([401,404,409].includes(response.status));assert.equal(calls(),1);assert.equal(store.billing.balance(a.org),before);assert.equal(store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='refund'").get().n,1);},{generate:async input=>{enter();await gate;return url(input.handPhoto);}});
 }
});
