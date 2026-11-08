import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../server/app.js';
import {validateMeasurements} from '../server/measurements.js';
import {ringSizeTable,bangleSizeTable,ringSuggestion,bangleSuggestion,validJewelleryMeasurement,necklaceGuides,necklaceLengths,jewelleryMeasurementsForm,jewelleryMeasurementsInput} from '../src/jewellery-sizing.js';
import {normalizeJewelleryView} from '../server/jewellery-tryon.js';
import {fullNecklaceAnchors,saveCustomerSizing} from '../server/jewellery-sizing.js';
const url=b=>'data:image/png;base64,'+b.toString('base64');
const packet={anchors:{neckBase:{x:575,y:1000}},pxPerMm:3,width:1152,height:1536};

test('every pilot ring circumference row and inner-diameter conversion produces its Indian label, with lower confidence for generic measurements',()=>{
  assert.equal(ringSizeTable.length,30);
  for(const row of ringSizeTable){const result=ringSuggestion({fingerCircumferenceMm:row.circumferenceMm});assert.equal(result.size,row.size);assert.equal(result.confidence,'Low');const fromDiameter=ringSuggestion({ringInnerDiameterMm:row.diameterMm});assert.equal(fromDiameter.size,row.size);}
  for(const [circumference,size] of [[41,1],[41.49,1],[41.5,2],[54,14],[54.5,15],[69.9,30],[70,30]])assert.equal(ringSuggestion({fingerCircumferenceMm:circumference}).size,size);
  for(const mm of [35,40.9,70.1,85,NaN,Infinity])assert.equal(ringSuggestion({fingerCircumferenceMm:mm}).size,null);
  assert.equal(ringSuggestion({heightCm:175,weightKg:72}).size,null);assert.equal(ringSuggestion(null).size,null);
});
test('bangle table uses inch/sixteenth labels, exact size rows and the next non-smaller circumference between rows',()=>{
  assert.deepEqual(bangleSizeTable.map(r=>r.size),['2.2','2.4','2.6','2.8','2.10','2.12']);
  for(const [index,row] of bangleSizeTable.entries()){assert.equal(bangleSuggestion({handCircumferenceMm:row.circumferenceMm}).size,row.size);if(index)assert.equal(bangleSuggestion({handCircumferenceMm:row.circumferenceMm-.1}).size,row.size);}
  assert.ok(Math.abs(bangleSizeTable.find(r=>r.size==='2.10').diameterMm-66.675)<.00001);
  assert.equal(bangleSuggestion({handCircumferenceMm:180}).size,'2.6');assert.equal(bangleSuggestion({handCircumferenceMm:140}).size,null);assert.equal(bangleSuggestion({handCircumferenceMm:220}).size,null);assert.equal(bangleSuggestion({wristCircumferenceMm:180}).size,null);
});
test('known sizes take priority, agreement raises confidence only to Medium and conflicting measurements remain advisory',()=>{
  assert.equal(ringSuggestion({ringSizeIn:14}).confidence,'Medium');assert.equal(ringSuggestion({ringSizeIn:14,fingerCircumferenceMm:54}).confidence,'Medium');
  const conflict=ringSuggestion({ringSizeIn:14,fingerCircumferenceMm:60});assert.equal(conflict.size,14);assert.equal(conflict.confidence,'Low');assert.match(conflict.reason,/differs/);
  assert.equal(ringSuggestion({fingerCircumferenceMm:54,ringInnerDiameterMm:20}).size,null);assert.equal(ringSuggestion({ringSizeIn:14,fingerCircumferenceMm:54,ringInnerDiameterMm:20}).confidence,'Low');assert.equal(ringSuggestion({ringSizeIn:14,fingerCircumferenceMm:80}).size,14);
  assert.equal(bangleSuggestion({bangleSizeIn:'2.10'}).size,'2.10');assert.equal(bangleSuggestion({bangleSizeIn:'2.4',handCircumferenceMm:200}).confidence,'Low');assert.equal(bangleSuggestion({bangleSizeIn:'2.4',handCircumferenceMm:179.5}).confidence,'Medium');assert.equal(bangleSuggestion({bangleSizeIn:'2.8',handCircumferenceMm:300}).size,'2.8');
});
test('optional measurement validation and form round-trip preserve 2.10, reject wrong units/types and clear individual fields without permitting clothing-chart changes',()=>{
  const m={fingerCircumferenceMm:54,ringInnerDiameterMm:17.2,handCircumferenceMm:209.5,ringSizeIn:14,bangleSizeIn:'2.10'};assert.deepEqual(validateMeasurements(m),m);assert.deepEqual(jewelleryMeasurementsInput(jewelleryMeasurementsForm(m)),m);
  for(const input of [{ringSizeIn:0},{ringSizeIn:14.5},{ringSizeIn:'14'},{bangleSizeIn:2.1},{bangleSizeIn:'2.1'},{bangleSizeIn:'2.3'},{fingerCircumferenceMm:5.4},{handCircumferenceMm:18},{ringInnerDiameterMm:100},{fingerCircumferenceMm:NaN},{fingerCircumferenceMm:Infinity},{fingerCircumferenceMm:'54'}])assert.throws(()=>validateMeasurements(input),{status:400});
  assert.equal(validateMeasurements({ringSizeIn:null,bangleSizeIn:null}),null);assert.equal(validJewelleryMeasurement('privatePhoto','data:image/png'),false);assert.throws(()=>validateMeasurements({chestCm:98,ringSizeIn:14},{chart:true}),{status:400});
});
test('necklace lines follow neck-base translation, scale and rotation; long curves report truncation instead of squeezing to fit',()=>{
  const guides=necklaceGuides(packet);assert.deepEqual(guides.map(g=>g.lengthCm),[40,45,60,80]);assert.equal(guides[0].neck.x,575);assert.equal(guides[0].drop,60);assert.equal(guides[3].belowView,true);
  const moved=necklaceGuides({...packet,anchors:{neckBase:{x:600,y:1015}}});for(let i=0;i<4;i++){assert.equal(moved[i].bottom.x-guides[i].bottom.x,25);assert.equal(moved[i].bottom.y-guides[i].bottom.y,15);}
  const scaled=necklaceGuides({...packet,pxPerMm:6});assert.equal(scaled[0].drop,guides[0].drop*2);const rotated=necklaceGuides({...packet,angle:90});assert.ok(Math.abs(rotated[0].bottom.x-(575-guides[0].drop))<1e-8);assert.ok(Math.abs(rotated[0].bottom.y-1000)<1e-8);
  assert.equal(necklaceGuides(packet,[{id:'catalogue',label:'Selected',lengthCm:55}])[0].drop,285);
  for(const change of [{pxPerMm:0},{angle:NaN},{anchors:{}},{anchors:{neckBase:{x:-1,y:10}}}])assert.throws(()=>necklaceGuides({...packet,...change}));assert.throws(()=>necklaceGuides(packet,[{lengthCm:200}]));
});
async function fixture(run,{enabled=true,computeFull}={}){
  const directory=await mkdtemp(join(tmpdir(),'forme-j11-')),store=new AccountStore(directory),a=await store.register({email:'j11-a@example.test',name:'A',password:'test-password-long'}),b=await store.register({email:'j11-b@example.test',name:'B',password:'test-password-long'}),token=store.session(a),ca='forme_session='+token,cb='forme_session='+store.session(b),customer=store.customers.save(a,{name:'Customer A',phoneE164:'9876543210',measurements:{heightCm:175,weightKg:72,chestCm:98,ringSizeIn:14}}),image=url(await standardAvatar('regular')),avatar=await store.save(a,{image,customerId:customer.id,name:'Customer A',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
  const context=store.views.context(a,avatar.id,'portrait'),png=await sharp({create:{width:1152,height:1536,channels:3,background:'#dbd8cf'}}).png().toBuffer(),receipt=store.views.receipt(a,avatar.id,'portrait',context,url(png),{tone:'medium',sourceKind:'generated'});await store.views.approve(a,avatar.id,'portrait',{image:url(png),receipt,reviewed:true,storageConsent:true});store.views.anchors=async()=>packet;
  let calls=0;const app=createApp({accountStore:store,accessMode:'public',provider:'gemini',apiKey:'',jewelleryEnabled:enabled,jewelleryOptions:{computeFullGuide:computeFull||(async()=>({...packet,width:1024,height:1536,anchors:{neckBase:{x:510,y:280}},pxPerMm:.5})),generate:async()=>{calls++;throw new Error('Unexpected paid call');}}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port,request=(path,body,cookie=ca,origin=base,method=body===undefined?'GET':'POST')=>fetch(base+path,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{await run({store,a,b,customer,avatar,token,ca,cb,request,directory,calls:()=>calls,image});}finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}
test('profile sizing persists under the same customer, merges clothing values, clears only requested fields and survives restart without credits or AI',async()=>fixture(async({store,a,customer,avatar,request,directory,calls})=>{
  const before=store.billing.balance(a.org),path='/api/jewellery/size',get=path+'?avatarId='+avatar.id;const initial=await(await request(get)).json();assert.equal(initial.customer.id,customer.id);assert.equal(initial.ring.size,14);
  const saved=await request(path,{avatarId:avatar.id,customerId:customer.id,measurements:{fingerCircumferenceMm:54,bangleSizeIn:'2.10',handCircumferenceMm:209.5},storageConsent:true});assert.equal(saved.status,200);const m=(await saved.json()).customer.measurements;assert.equal(m.chestCm,98);assert.equal(m.heightCm,175);assert.equal(m.ringSizeIn,14);assert.equal(m.bangleSizeIn,'2.10');
  await request(path,{avatarId:avatar.id,customerId:customer.id,measurements:{ringSizeIn:null},storageConsent:true});assert.equal((await(await request(get)).json()).customer.measurements.ringSizeIn,undefined);assert.equal(store.customers.get(a,customer.id).measurements.bangleSizeIn,'2.10');const reopened=new AccountStore(directory);try{assert.equal(reopened.customers.get(a,customer.id).measurements.bangleSizeIn,'2.10');}finally{reopened.close();}
  assert.equal(store.billing.balance(a.org),before);assert.equal(calls(),0);assert.equal(store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='hold'").get().n,0);
}));
test('sizing/guide routes enforce role, tenant, origin, explicit storage agreement, input fields and pilot flag',async()=>fixture(async({store,a,b,customer,avatar,cb,request,calls})=>{
  const body={avatarId:avatar.id,customerId:customer.id,measurements:{ringSizeIn:16},storageConsent:true},get='/api/jewellery/size?avatarId='+avatar.id;
  for(const path of [get,'/api/jewellery/necklace-guide?avatarId='+avatar.id+'&view=portrait']){assert.equal((await request(path,undefined,'')).status,401);assert.equal((await request(path,undefined,cb)).status,404);assert.equal((await request(path,undefined,undefined,'https://evil.test')).status,403);}
  for(const changed of [{storageConsent:false},{measurements:{chestCm:100}},{measurements:{ringSizeIn:31}},{measurements:{bangleSizeIn:2.1}},{photo:'private'}])assert.equal((await request('/api/jewellery/size',{...body,...changed})).status,400);
  assert.equal((await request('/api/jewellery/size',{...body,customerId:'different-customer'})).status,409);
  assert.equal((await request('/api/jewellery/size',body,cb)).status,404);assert.equal((await request('/api/jewellery/size',body,undefined,'https://evil.test')).status,403);
  for(const role of ['owner','manager','staff']){store.db.prepare('UPDATE memberships SET role=? WHERE store=? AND user=?').run(role,a.id,a.user.id);assert.equal((await request('/api/jewellery/size',body)).status,200);}
  assert.equal((await request('/api/jewellery/necklace-guide?avatarId='+avatar.id+'&view=hands')).status,400);assert.equal(calls(),0);
}));
test('portrait and full guides are free, recheck the source/session after inference and never return face descriptors',async()=>{
  await fixture(async({store,a,avatar,request,calls})=>{const before=store.billing.balance(a.org);for(const view of ['portrait','full']){const r=await request('/api/jewellery/necklace-guide?avatarId='+avatar.id+'&view='+view);assert.equal(r.status,200);const p=await r.json();assert.equal(p.creditsUsed,0);assert.equal(necklaceGuides(p).length,4);assert.doesNotMatch(JSON.stringify(p),/descriptor|privatePhoto/);}assert.equal(store.billing.balance(a.org),before);assert.equal(calls(),0);});
  let enter,release;const started=new Promise(r=>enter=r),gate=new Promise(r=>release=r);await fixture(async({store,avatar,token,request})=>{const pending=request('/api/jewellery/necklace-guide?avatarId='+avatar.id+'&view=full');await started;store.logout(token);release();assert.equal((await pending).status,401);},{computeFull:async()=>{enter();await gate;return {...packet,width:1024,anchors:{neckBase:{x:510,y:280}}};}});
  await fixture(async({store,a,avatar,request})=>{store.views.anchors=async()=>{store.db.prepare("UPDATE avatar_view_epochs SET portraitRevision=portraitRevision+1 WHERE store=? AND avatarId=?").run(a.id,avatar.id);return packet;};assert.equal((await request('/api/jewellery/necklace-guide?avatarId='+avatar.id+'&view=portrait')).status,409);});
});
test('unlinked avatars get empty suggestions, deleted customers erase sizing with their avatars, and disabled guides cannot reveal data',async()=>{
  await fixture(async({store,a,customer,avatar,request,image})=>{store.db.prepare('UPDATE avatars SET customer=NULL WHERE account=? AND id=?').run(a.id,avatar.id);const result=await(await request('/api/jewellery/size?avatarId='+avatar.id)).json();assert.equal(result.customer,null);assert.equal(result.ring.size,null);assert.equal((await request('/api/jewellery/size',{avatarId:avatar.id,customerId:customer.id,measurements:{ringSizeIn:14},storageConsent:true})).status,409);store.db.prepare('UPDATE avatars SET customer=? WHERE account=? AND id=?').run(customer.id,a.id,avatar.id);store.customers.remove(a,customer.id);assert.equal((await request('/api/jewellery/size?avatarId='+avatar.id)).status,404);assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);});
  await fixture(async({avatar,request})=>{assert.equal((await request('/api/jewellery/size?avatarId='+avatar.id)).status,404);assert.equal((await request('/api/jewellery/necklace-guide?avatarId='+avatar.id+'&view=portrait')).status,404);},{enabled:false});
});
test('real full-body landmarks locate a neck anchor using local shipped models without provider calls',async()=>{
  const packet=await fullNecklaceAnchors(await normalizeJewelleryView(await standardAvatar('regular'),'full'));assert.ok(packet.pxPerMm>0);assert.ok(packet.anchors.neckBase.x>0&&packet.anchors.neckBase.x<1024);assert.ok(packet.anchors.neckBase.y>0&&packet.anchors.neckBase.y<1536);assert.equal(necklaceGuides(packet).length,4);
});
