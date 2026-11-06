import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../server/app.js';
import {recommendSize,estimateSizeMeasurements,sizeChartTemplate} from '../server/size.js';
const chart=(size,chestCm,waistCm,sortOrder=0)=>({size,measurements:{chestCm,waistCm},sortOrder});
const rows=[chart('M',98,84,20),chart('L',110,100,30)];

test('exact ease-adjusted scoring picks the lowest sum and High confidence requires measured separation',()=>{
 const result=recommendSize(rows,{chestCm:98,waistCm:84});assert.equal(result.size,'M');assert.equal(result.confidence,'High');assert.equal(result.score,0);assert.equal(result.source,'measured');assert.match(result.reason,/chest 98 cm/);
 const measured={chestCm:102,waistCm:90},close=recommendSize(rows,measured);const expected=Math.max(0,Math.abs(102-98)-2)/98+Math.max(0,Math.abs(90-84)-2)/84;assert.equal(close.score,Number(expected.toFixed(6)));assert.equal(close.confidence,'Medium');assert.equal(close.alternatives[0].size,'L');
 const hips=recommendSize([{size:'M',measurements:{hipCm:100}},{size:'L',measurements:{hipCm:110}}],{hipCm:103});assert.equal(hips.score,0,'hip ease is 3 cm');assert.equal(hips.confidence,'Medium');
});

test('one measured field and tied or close second sizes are Medium, with stable chart order',()=>{
 assert.equal(recommendSize(rows,{chestCm:98}).confidence,'Medium');
 const tied=recommendSize([chart('L',100,86,30),chart('M',98,84,20)],{chestCm:99,waistCm:85});assert.equal(tied.size,'M');assert.equal(tied.confidence,'Medium','two perfect scores must not be reported as High');
 const partial=recommendSize([{size:'M',measurements:{chestCm:98}},{size:'L',measurements:{chestCm:104,waistCm:90}}],{chestCm:98,waistCm:84});assert.equal(partial.confidence,'Medium','compare the same fields in every size');
});

test('insufficient comparison is Low and a missing comparable field produces no guessed size',()=>{
 assert.equal(recommendSize([rows[0]],{chestCm:98,waistCm:84}).confidence,'Low');
 assert.equal(recommendSize(rows,{hipCm:100}).size,null);assert.equal(recommendSize(rows,null).confidence,'Low');
});

test('height/weight/profile estimates are illustrative and always capped at Low, even with perfect separation',()=>{
 assert.deepEqual(estimateSizeMeasurements({heightCm:175,weightKg:72,bodyProfileId:'regular'}),{chestCm:98,waistCm:84});
 for(const bodyProfileId of ['slim','regular','athletic','broad','f-slim','f-regular','f-athletic','f-curvy']){const estimate=estimateSizeMeasurements({heightCm:175,weightKg:72,bodyProfileId});const result=recommendSize([chart('M',estimate.chestCm,estimate.waistCm),chart('L',180,190)],estimate,{estimated:true});assert.equal(result.confidence,'Low');assert.equal(result.source,'estimated');assert.match(result.reason,/not measured/);}
 assert.equal(estimateSizeMeasurements({heightCm:99,weightKg:72,bodyProfileId:'regular'}),null);assert.equal(estimateSizeMeasurements({heightCm:175,weightKg:72}),null);
});

async function fixture(run){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-size-')),store=new AccountStore(directory),a=await store.register({name:'Store A',email:'a@example.test',password:'test-password-long'}),b=await store.register({name:'Store B',email:'b@example.test',password:'test-password-long'});
 const ca=`forme_session=${store.session(a)}`,cb=`forme_session=${store.session(b)}`;
 const customer=store.customers.save(a,{name:'Asha',phoneE164:'9876543210',measurements:{heightCm:175,weightKg:72,chestCm:98,waistCm:84}});
 const image=`data:image/png;base64,${(await standardAvatar('regular')).toString('base64')}`;
 const avatar=await store.save(a,{image,customerId:customer.id,name:'Asha avatar',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
 const garment=(await store.garments.save(a,{image,name:'Example shirt',variant:'M',garmentType:'shirt'})).garment;store.db.prepare('UPDATE garments SET brand=? WHERE account=? AND id=?').run('Example',a.id,garment.id);
 const look=await store.saveLook(a,{image,avatarId:avatar.id,name:'Asha look',garments:['Shirt']});
 const input={brand:'Example',garmentType:'shirt',size:'M',measurements:{chestCm:98,waistCm:84},sortOrder:20};
 store.sizes.save(a,input);store.sizes.save(a,{...input,size:'L',measurements:{chestCm:110,waistCm:100},sortOrder:30});
 const server=createApp({accountStore:store,accessMode:'public'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method='GET',body,cookie=ca,origin=base)=>fetch(base+url,{method,headers:{Cookie:cookie,Origin:origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
 try{await run({store,a,b,ca,cb,customer,garment,avatar,look,image,input,directory,request,base});}finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}

test('recommendation is scoped by store, exact brand and type; no chart uses a distinct no_chart response',async()=>fixture(async({store,a,b,request,customer,garment,cb})=>{
 const path=`/api/size?customer=${customer.id}&garment=${garment.id}`;const before=store.billing.balance(a.org);const good=await request(path);assert.equal(good.status,200);assert.equal((await good.json()).confidence,'High');assert.equal((await request(path,'GET',undefined,cb)).status,404);assert.equal((await request(path,'GET',undefined,'')).status,401);assert.equal(store.billing.balance(a.org),before);
 store.db.prepare('UPDATE garments SET brand=? WHERE account=? AND id=?').run('Other brand',a.id,garment.id);const no=await request(path);assert.equal(no.status,404);assert.equal((await no.json()).code,'no_chart');
 store.db.prepare('UPDATE garments SET brand=? WHERE account=? AND id=?').run(' example ',a.id,garment.id);assert.equal((await request(path)).status,200);
 const other=store.customers.save(b,{name:'Other',phoneE164:'9876543210'});assert.equal((await request(`/api/size?customer=${other.id}&garment=${garment.id}`)).status,404);
}));

test('profile edits validate and merge real measurements, clear individual values, and use Low-only fallback from a saved avatar',async()=>fixture(async({store,a,request,customer,garment})=>{
 const path=`/api/customers/${customer.id}`;const edited=await request(path,'PATCH',{measurements:{hipCm:100}});assert.equal(edited.status,200);const body=(await edited.json()).customer;assert.equal(body.measurements.chestCm,98);assert.equal(body.measurements.heightCm,175);assert.equal(body.measurements.hipCm,100);
 for(const measurements of [{chestCm:12},{waistCm:300},{hipCm:40},{heightCm:300},{weightKg:10},{bodyProfileId:'made-up'},[],3,{face:'data:image/png,private'}])assert.equal((await request(path,'PATCH',{measurements})).status,400);
 await request(path,'PATCH',{measurements:{chestCm:null,waistCm:null,hipCm:null}});const result=await (await request(`/api/size?customer=${customer.id}&garment=${garment.id}`)).json();assert.equal(result.confidence,'Low');assert.equal(result.source,'estimated');assert.equal(result.size,'M');
 const noAvatar=store.customers.save(a,{name:'No estimate',phoneE164:'9876543211',measurements:{heightCm:175,weightKg:72}});const unavailable=await (await request(`/api/size?customer=${noAvatar.id}&garment=${garment.id}`)).json();assert.equal(unavailable.size,null);assert.equal(unavailable.confidence,'Low');
}));

test('chart CRUD requires owner/manager, isolates stores, validates dimensions and protects origins',async()=>fixture(async({store,a,b,input,request,cb,ca})=>{
 let row;for(const role of ['owner','manager']){store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,a.user.id,a.id);const created=await request('/api/size-charts','POST',{...input,size:role==='owner'?'S':'XL'});assert.equal(created.status,201);row=(await created.json()).chart;assert.equal((await request(`/api/size-charts/${row.id}`)).status,200);assert.equal((await request(`/api/size-charts/${row.id}`,'PATCH',{measurements:{chestCm:102}})).status,200);assert.equal(store.sizes.get(a,row.id).measurements.waistCm,84);}
 for(const [url,method,body] of [['/api/size-charts','GET',undefined],[`/api/size-charts/${row.id}`,'GET',undefined],[`/api/size-charts/${row.id}`,'PATCH',{size:'XXL'}],[`/api/size-charts/${row.id}`,'DELETE',undefined],['/api/size-charts','POST',input],['/api/size-charts/template.csv','GET',undefined]]){assert.equal((await request(url,method,body,'')).status,401);if(url.includes(row.id))assert.equal((await request(url,method,body,cb)).status,404);if(method!=='GET')assert.equal((await request(url,method,body,ca,'https://evil.test')).status,403);}
 for(const invalid of [{measurements:{}},{measurements:{chestCm:40}},{measurements:{weightKg:72}},{measurements:[]},{garmentType:'shoes'},{sortOrder:-1}])assert.equal((await request('/api/size-charts','POST',{...input,size:'BAD',...invalid})).status,400);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(a.user.id,a.id);for(const [url,method,body] of [['/api/size-charts','GET',undefined],['/api/size-charts','POST',input],[`/api/size-charts/${row.id}`,'GET',undefined],[`/api/size-charts/${row.id}`,'PATCH',{size:'Y'}],[`/api/size-charts/${row.id}`,'DELETE',undefined],['/api/size-charts/template.csv','GET',undefined]])assert.equal((await request(url,method,body)).status,403);
}));

test('chart CSV imports upsert stable identities, report bad rows, clear blank dimensions and reject malformed/large files',async()=>fixture(async({store,a,request,ca,cb,input})=>{
 const data='brand,type,size,chest_cm,waist_cm,hip_cm,sort_order\nOther,shirt,M,98,84,,20\nOther,shirt,L,110,100,,30\nOther,shirt,BAD,12,20,,40\n';
 const upload=(content,cookie=ca,origin)=>{const form=new FormData();form.append('file',new Blob([content]),'charts.csv');return request('/api/size-charts/import','POST',form,cookie,origin);};
 const first=await upload(data);assert.equal(first.status,200);const report=await first.json();assert.equal(report.created,2);assert.equal(report.skipped,1);assert.equal(report.errors.length,1);const id=store.sizes.list(a,{brand:'Other'}).charts[0].id;
 const repeat=await (await upload(data)).json();assert.equal(repeat.created,0);assert.equal(repeat.updated,0);assert.equal(repeat.skipped,3);assert.equal(store.sizes.list(a,{brand:'Other'}).charts[0].id,id);
 store.sizes.save(a,{...input,brand:'Third',size:'M',measurements:{chestCm:98,waistCm:84,hipCm:100}});const clearing=Buffer.from('brand,type,size,chest_cm,waist_cm,hip_cm,sort_order\nThird,shirt,M,98,84,,20\n');assert.equal((await (await upload(clearing)).json()).updated,1);assert.equal(store.sizes.list(a,{brand:'Third'}).charts[0].measurements.hipCm,undefined);assert.equal((await (await upload(clearing)).json()).skipped,1);
 assert.equal((await upload('bad,headers\nA,B')).status,400);assert.equal((await upload(Buffer.alloc(5*1024*1024+1,65))).status,413);assert.equal((await upload(data,'')).status,401);assert.equal((await upload(data,ca,'https://evil.test')).status,403);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(a.user.id,a.id);assert.equal((await upload(data)).status,403);assert.throws(()=>store.sizes.import(a,Buffer.from(data)),{status:403},'recheck manager role after the upload has finished');
}));

test('purchase marks use server time/staff, are idempotent, undo cleanly and never charge credits',async()=>fixture(async({store,a,b,request,look,ca,cb})=>{
 const path=`/api/looks/${look.id}/purchase`,before=store.billing.balance(a.org);
 for(const role of ['owner','manager','staff']){
  store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,a.user.id,a.id);
  const r=await request(path,'POST',{size:'M',staffUser:b.user.id,purchasedAt:1});assert.equal(r.status,200);const result=await r.json();assert.ok(result.purchasedAt>1);assert.equal(result.staffUser,a.user.id);assert.equal((await request(path,'GET',undefined,cb)).status,404);assert.equal((await request(path,'POST',{size:'M'},cb)).status,404);assert.equal((await request(path,'DELETE',undefined,cb)).status,404);
  const count=store.db.prepare("SELECT count(*) AS n FROM events WHERE type='purchase_marked'").get().n;await request(path,'POST',{size:'M'});assert.equal(store.db.prepare("SELECT count(*) AS n FROM events WHERE type='purchase_marked'").get().n,count);assert.equal((await request(path,'POST',{size:'L'})).status,409);
  const list=store.listLooks(a);assert.equal(list[0].purchasedSize,'M');assert.equal(list[0].staffUser,a.user.id);assert.equal((await request(path,'DELETE')).status,200);await request(path,'DELETE');assert.equal((await (await request(path)).json()).purchasedAt,null);
 }
 for(const [method,body] of [['GET',undefined],['POST',{size:'M'}],['DELETE',undefined]]){assert.equal((await request(path,method,body,'')).status,401);if(method!=='GET')assert.equal((await request(path,method,body,ca,'https://evil.test')).status,403);}
 assert.equal((await request(path,'POST',{size:''})).status,400);assert.equal(store.billing.balance(a.org),before);assert.equal(store.db.prepare("SELECT count(*) AS n FROM events WHERE type='purchase_unmarked'").get().n,3);
}));

test('size charts and purchase state survive restart and customer erasure keeps unrelated store charts',async()=>fixture(async({store,a,customer,look,directory})=>{
 store.sizes.purchase(a,look.id,{size:'M'});const reopened=new AccountStore(directory);try{assert.equal(reopened.sizes.list(a).total,2);assert.equal(reopened.listLooks(a)[0].purchasedSize,'M');assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{reopened.close();}
 store.customers.remove(a,customer.id);assert.equal(store.listLooks(a).length,0);assert.equal(store.sizes.list(a).total,2);
}));
