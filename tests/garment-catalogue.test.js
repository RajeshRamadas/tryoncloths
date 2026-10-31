import {randomUUID} from "node:crypto";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { AccountStore } from './helpers/pilot-accounts.js';
import { createApp, standardAvatar } from '../server/app.js';
import { canonicalProductUrl } from '../server/garment-store.js';
import { ProviderError } from '../server/provider-errors.js';

const dataUrl = bytes => `data:image/png;base64,${bytes.toString('base64')}`;
const product = async (colour='#2560aa') => dataUrl(await sharp({ create:{width:200,height:300,channels:3,background:colour} }).png().toBuffer());
const account = email => ({email,name:'Test store',password:'long-enough-test-password'});
async function fixture(run, options={}) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'forme-garments-')),store=new AccountStore(dir);
  let calls=0;
  const avatar=dataUrl(await standardAvatar('regular'));
  const app=createApp({accountStore:store,accessMode:'public',provider:'gemini',apiKey:'test',rateLimit:false,
    tryOn:async input=>{calls++;return options.generate?options.generate(input):avatar;},...options.app});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(url,body,cookie='',method=body===undefined?'GET':'POST',from=origin)=>fetch(origin+url,{method,headers:{Origin:from,Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(url==='/api/tryon'?{requestId:randomUUID(),...body}:body)})});
  const login=async email=>{const response=await request('/api/account/register',account(email));return response.headers.get('set-cookie').split(';')[0];};
  const ca=await login('a@example.com'),cb=await login('b@example.com');
  const a=store.user(ca.split('=')[1]),b=store.user(cb.split('=')[1]);
  const {id:avatarId}=await store.save(a,{image:avatar,name:'Customer',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
  const garmentInput={image:await product(),name:'Blue shirt',garmentType:'shirt',variant:'Blue / M',sourceUrl:'https://shop.example/product/42?colour=blue&utm_source=test',storageConsent:true};
  const {garment}=await store.garments.save(a,garmentInput);
  const input={avatar,avatarId,garmentId:garment.id,garmentType:'shirt',bodyType:'male',consent:true,consentScope:'avatar-and-garment',consentProvider:'gemini'};
  try{await run({store,dir,request,ca,cb,a,b,garment,garmentInput,input,calls:()=>calls});}
  finally{await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
}

test('product identity removes tracking but preserves retailer and SKU/colour variants',()=>{
  assert.equal(canonicalProductUrl('https://shop.example/p?size=M&utm_campaign=x&colour=blue#photos'),'https://shop.example/p?colour=blue&size=M');
  assert.notEqual(canonicalProductUrl('https://shop.example/p?colour=red'),canonicalProductUrl('https://shop.example/p?colour=blue'));
  assert.equal(canonicalProductUrl('https://www.amazon.in/shirt-name/dp/B012345678/ref=abc?tag=affiliate'), 'https://www.amazon.in/dp/B012345678');
  for(const url of ['http://127.0.0.1','file:///tmp/photo','https://user:secret@shop.example'])assert.throws(()=>canonicalProductUrl(url));
});
test('catalogue recognizes exact pixels and links, suggests similar photos, preserves distinct variants and survives restart',async()=>fixture(async({store,a,dir,garment,garmentInput})=>{
  const same=await store.garments.save(a,{...garmentInput,sourceUrl:'https://shop.example/product/42?colour=blue&utm_source=second'});
  assert.equal(same.duplicate,true);assert.equal(same.garment.id,garment.id);
  const encoded=await sharp(Buffer.from(garmentInput.image.split(',')[1],'base64')).withMetadata().png().toBuffer();
  assert.equal((await store.garments.matches(a,{image:dataUrl(encoded)})).exact[0].id,garment.id);
  assert.equal((await store.garments.matches(a,{url:'https://shop.example/product/42?utm_source=another&colour=blue'})).linked[0].id,garment.id);
  assert.equal((await store.garments.matches(a,{image:await product('#2560ab')})).similar[0].id,garment.id);
  assert.equal((await store.garments.matches(a,{image:await product('#ff0000')})).similar.length,0);
  const variant=await store.garments.save(a,{...garmentInput,variant:'Blue / L'});assert.notEqual(variant.garment.id,garment.id);
  const differentUrl=await store.garments.save(a,{...garmentInput,sourceUrl:'https://shop.example/product/42?colour=red'});assert.notEqual(differentUrl.garment.id,garment.id,'same retailer picture must not merge distinct URL variants');
  await assert.rejects(store.garments.save(a,{...garmentInput,image:await product('#f00')}),{status:409});
  const reopened=new AccountStore(dir);try{assert.equal(reopened.garments.list(a).length,3);assert.ok(reopened.garments.get(a,garment.id).image.startsWith('data:image/png'));}finally{reopened.close();}
}));
test('catalogue routes enforce account ownership, same-origin and explicit product storage',async()=>fixture(async({request,ca,cb,garment,garmentInput,input,calls})=>{
  assert.equal((await request('/api/garments')).status,401);
  assert.deepEqual((await (await request('/api/garments',undefined,cb)).json()).garments,[]);
  assert.equal((await request(`/api/garments/${garment.id}`,undefined,cb)).status,404);
  assert.equal((await request(`/api/garments/${garment.id}`,undefined,cb,'DELETE')).status,404);
  assert.equal((await request('/api/garments',garmentInput,ca,'POST','https://evil.example')).status,403);
  assert.equal((await request('/api/garments',{...garmentInput,storageConsent:false},ca)).status,400);
  const matches=await (await request('/api/garments/match',{image:garmentInput.image},cb)).json();assert.deepEqual(matches,{exact:[],linked:[],similar:[]});
  assert.equal((await request(`/api/garments/${garment.id}/reuse`,input,cb)).status,404);
  assert.equal((await request('/api/tryon',input,cb)).status,404);assert.equal(calls(),0);
}));
test('only a reviewed, signed provider result is reusable; exact reuse skips paid limits and persists',async()=>fixture(async({store,request,ca,cb,a,dir,garment,input,calls})=>{
  const endpoint=`/api/garments/${garment.id}`;
  assert.equal((await (await request(endpoint+'/reuse',input,ca)).json()).match,false);
  const generated=await request('/api/tryon',input,ca);assert.equal(generated.status,200);const result=await generated.json();
  assert.ok(result.reuseReceipt);assert.equal(calls(),1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM garment_results').get().n,0,'generation alone must not persist the result');
  const save={image:result.image,receipt:result.reuseReceipt,reviewed:true,storageConsent:true};
  assert.equal((await request(endpoint+'/results',{...save,reviewed:false},ca)).status,400);
  assert.equal((await request(endpoint+'/results',{...save,storageConsent:false},ca)).status,400);
  assert.equal((await request(endpoint+'/results',{...save,receipt:save.receipt+'0'},ca)).status,400);
  assert.equal((await request(endpoint+'/results',save,cb)).status,400);
  const changed=dataUrl(await sharp(Buffer.from(result.image.split(',')[1],'base64')).modulate({brightness:.5}).png().toBuffer());
  assert.equal((await request(endpoint+'/results',{...save,image:changed},ca)).status,400);
  const accepted=await request(endpoint+'/results',save,ca);assert.equal(accepted.status,200);
  assert.equal((await request(endpoint+'/results',save,ca)).status,200,'saving again is idempotent');
  const reuse=await (await request(endpoint+'/reuse',input,ca)).json();assert.equal(reuse.match,true);assert.ok(reuse.image);
  const remaining=store.billing.balance(a.org);
  store.db.prepare("INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','reuse-test-zero',?)").run(randomUUID(),a.org,-remaining,Date.now());
  const ledgerRows=store.db.prepare('SELECT count(*) AS n FROM ledger').get().n;
  const automatic=await request('/api/tryon',input,ca);assert.equal(automatic.status,200);assert.equal((await automatic.json()).reused,true);assert.equal(calls(),1);
  assert.equal(store.billing.balance(a.org),0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM ledger').get().n,ledgerRows,'approved reuse creates no ledger entries at zero credits');
  const reopened=new AccountStore(dir);try{const context=await reopened.garments.context(a,input,{provider:'gemini',model:'gemini-2.5-flash-image'});assert.ok(reopened.garments.cached(a,context));}finally{reopened.close();}
  assert.equal((await request(`${endpoint}/results/${reuse.id}`,undefined,cb,'DELETE')).status,404);
  assert.equal((await request(`${endpoint}/results/${reuse.id}`,undefined,ca,'DELETE')).status,200);
  assert.equal((await (await request(endpoint+'/reuse',input,ca)).json()).match,false);
},{app:{rateLimit:true}}));
test('changed outfit, avatar, category, product or model cannot reuse a previous adaptation',async()=>fixture(async({store,a,request,ca,input,garment,garmentInput})=>{
  const result=await (await request('/api/tryon',input,ca)).json();
  await store.garments.saveResult(a,garment.id,{image:result.image,receipt:result.reuseReceipt,reviewed:true,storageConsent:true});
  const encoded=dataUrl(await sharp(Buffer.from(input.avatar.split(',')[1],'base64')).withMetadata().png().toBuffer());
  assert.equal((await (await request(`/api/garments/${garment.id}/reuse`,{...input,avatar:encoded},ca)).json()).match,true,'metadata/PNG encoding cannot cause a paid miss');
  const changed=dataUrl(await sharp(Buffer.from(input.avatar.split(',')[1],'base64')).modulate({brightness:.7}).png().toBuffer());
  assert.equal((await (await request(`/api/garments/${garment.id}/reuse`,{...input,avatar:changed},ca)).json()).match,false);
  assert.equal((await request(`/api/garments/${garment.id}/reuse`,{...input,garmentType:'shoes'},ca)).status,400);
  assert.equal((await request(`/api/garments/${garment.id}/reuse`,{...input,avatarId:'not-owned'},ca)).status,404);
  const context=await store.garments.context(a,input,{provider:'gemini',model:'different-model'});assert.equal(store.garments.cached(a,context),null);
  const {garment:other}=await store.garments.save(a,{...garmentInput,variant:'Blue / L'});
  assert.equal((await (await request(`/api/garments/${other.id}/reuse`,{...input,garmentId:other.id},ca)).json()).match,false);
}));
test('simultaneous identical adaptations start only one provider call',async()=>{
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  await fixture(async({request,ca,input,calls})=>{
    const first=request('/api/tryon',input,ca);
    try{await started;assert.equal((await request('/api/tryon',input,ca)).status,409);assert.equal(calls(),1);}
    finally{release();await first;}
  },{generate:async({avatar})=>{entered();await gate;return dataUrl(avatar);}});
});
test('provider and receipt failures never trigger another generation or silently save a result',async()=>{
  await fixture(async({request,ca,input,store,calls})=>{
    const response=await request('/api/tryon',input,ca);assert.equal(response.status,502);assert.equal((await response.json()).code,'quota');
    assert.equal(calls(),1);assert.equal(store.db.prepare('SELECT count(*) AS n FROM garment_results').get().n,0);
  },{generate:async()=>{throw new ProviderError('quota',429);}});
  await fixture(async({request,ca,input,store,calls})=>{
    store.garments.receipt=async()=>{throw new Error('storage details');};
    const response=await request('/api/tryon',input,ca);assert.equal(response.status,200);const result=await response.json();
    assert.ok(result.image);assert.match(result.reuseWarning,/do not regenerate/);assert.equal(calls(),1);
  });
});
test('a deletion or newly approved result during decoding is respected before charging',async()=>{
  await fixture(async({store,request,ca,a,input,calls})=>{
    const context=store.garments.context.bind(store.garments);
    store.garments.context=async(...args)=>{
      const result=await context(...args);
      store.garments.remove(a,result.garmentId);
      return result;
    };
    const response=await request('/api/tryon',input,ca);
    assert.equal(response.status,404);assert.equal(calls(),0);
  });
  await fixture(async({store,request,ca,input,calls})=>{
    let checks=0;
    store.garments.cached=()=>++checks===1?null:{id:'approved-in-another-tab',image:input.avatar};
    const response=await request('/api/tryon',input,ca);
    assert.equal(response.status,200);assert.equal((await response.json()).reused,true);
    assert.equal(checks,2);assert.equal(calls(),0);
  });
});
test('garment limits and deletion remove adaptations without deleting unrelated customer avatars',async()=>fixture(async({store,a,input,garment,garmentInput,request,ca})=>{
  const result=await (await request('/api/tryon',input,ca)).json();
  const save={image:result.image,receipt:result.reuseReceipt,reviewed:true,storageConsent:true};
  await store.garments.saveResult(a,garment.id,save);
  const copy=store.db.prepare('INSERT INTO garments SELECT account,?,name,garmentType,variant,sourceUrl,?,signature,colour,image,thumbnail,savedAt FROM garments WHERE account=? AND id=?');
  for(let i=0;i<199;i++)copy.run(`copy-${i}`,`hash-${i}`,a.id,garment.id);
  assert.equal((await store.garments.save(a,garmentInput)).duplicate,true);
  await assert.rejects(store.garments.save(a,{...garmentInput,variant:'another'}),{status:409});
  const copyResult=store.db.prepare('INSERT INTO garment_results SELECT account,?,avatarId,garmentId,image,savedAt FROM garment_results WHERE account=? AND id=?');
  const savedRow=store.db.prepare('SELECT id FROM garment_results').get();
  for(let i=0;i<199;i++)copyResult.run(`result-${i}`,a.id,savedRow.id);
  await store.garments.saveResult(a,garment.id,save);
  const otherContext=await store.garments.context(a,{...input,avatar:dataUrl(await standardAvatar('broad'))},{provider:'gemini',model:'gemini-2.5-flash-image'});
  const receipt=await store.garments.receipt(a,otherContext,result.image);
  await assert.rejects(store.garments.saveResult(a,garment.id,{...save,receipt}),{status:409});
  store.remove(a,input.avatarId);assert.equal(store.db.prepare('SELECT count(*) AS n FROM garment_results').get().n,0);
  assert.equal(store.garments.list(a).length,200);
  store.garments.remove(a,garment.id);assert.equal(store.db.prepare('SELECT count(*) AS n FROM garment_links WHERE garmentId=?').get(garment.id).n,0);
  store.db.prepare('DELETE FROM accounts WHERE id=?').run(a.id);assert.equal(store.garments.list(a).length,0);
}));
