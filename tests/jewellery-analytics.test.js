import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AccountStore} from './helpers/pilot-accounts.js';
import {recordEvent} from '../server/events.js';
import {analyticsCsv,dateRange} from '../server/analytics.js';
const jewelleryReport=(store,account,query,options={})=>store.analytics.report(account,query,Date.now(),{...options,jewelleryEnabled:true});
const when=Date.parse('2026-11-02T04:00:00Z'),query={from:'2026-11-01',to:'2026-11-03',store:'all'};
async function fixture(work){
 const dir=await mkdtemp(path.join(tmpdir(),'forme-jewellery-analytics-')),store=new AccountStore(dir);
 try{
  const a=await store.register({name:'Store A',email:'a@example.test',password:'test-password-long'}),b=await store.register({name:'Store B',email:'b@example.test',password:'test-password-long'});
  store.db.prepare('UPDATE stores SET org=? WHERE id=?').run(a.org,b.id);
  const branch=store.identity(b.user.id,b.id);
  const event=(actor,type,ref,time=when,operationKey=null)=>recordEvent(store.db,{org:actor.org,store:actor.id,user:actor.user.id},type,ref,{createdAt:time,operationKey});
  await work({store,a,branch,event});
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
}
const j={category:'jewellery',view:'portrait'},scores=r=>r.jewellery;

test('jewellery analytics separate AI, reuse, overlays, comparisons, sets, complete looks and store-scoped sessions',async()=>fixture(async({store,a,branch,event})=>{
 const sessionId=randomUUID(),ref={...j,sessionId,garmentId:'same-product'};
 event(a,'tryon_generated',ref);event(a,'tryon_reused',ref);event(a,'jewellery_overlay_applied',ref);
 event(branch,'jewellery_overlay_applied',ref);
 event(a,'tryon_generated',{sessionId,garmentId:'shirt',category:'garment'});
 event(a,'jewellery_compared',{...j,sessionId,outcome:'complete'});event(a,'jewellery_compared',{...j,sessionId,outcome:'partial'});
 event(a,'look_saved',{...j,lookId:'set',itemCount:2});event(a,'look_saved',{...j,lookId:'single',itemCount:1});event(a,'look_saved',{...j,lookId:'board',view:'complete',itemCount:3});
 event(a,'look_shared',{...j,lookId:'set'});event(a,'share_viewed',{...j,lookId:'set'});
 const report=jewelleryReport(store,a,query),r=scores(report);
 assert.equal(report.totals.tryons,3,'generic try-ons remain AI generated/reused only');
 assert.equal(r.totals.tryons,4);assert.equal(r.totals.tryonsGenerated,1);assert.equal(r.totals.tryonsReused,1);assert.equal(r.totals.overlays,2);assert.equal(r.totals.tryonSessions,2);
 assert.equal(r.totals.comparisonsCompleted,1);assert.equal(r.totals.comparisonsPartial,1);assert.equal(r.totals.setsSaved,1);assert.equal(r.totals.completeLooksSaved,1);assert.equal(r.totals.looksSaved,3);assert.equal(r.totals.looksShared,1);assert.equal(r.totals.shareViews,1);
 assert.equal(r.days.reduce((sum,d)=>sum+d.tryons,0),4);assert.equal(r.stores.find(s=>s.id===a.id).tryonSessions,1);assert.equal(r.staff.find(s=>s.id===a.user.id).tryons,3);
 assert.equal(r.productsTracked,2);assert.equal(r.products.find(p=>p.storeId===a.id).tryons,3);assert.equal(r.products.find(p=>p.storeId===branch.id).tryons,1);
 assert.equal(scores(jewelleryReport(store,a,{...query,store:a.id})).totals.overlays,1);
}));

test('purchase snapshots survive deletion, exclude clothing attribution, and respect selected-end undo/re-mark chronology',async()=>fixture(async({store,a,event})=>{
 const sessionId=randomUUID(),ref={...j,sessionId,garmentId:'jewel'};
 event(a,'tryon_generated',ref);
 const mark={...j,sessionId,lookId:'deleted-complete',view:'complete',garmentIds:['jewel','shirt'],jewelleryItemIds:['jewel','jewel']};
 event(a,'purchase_marked',mark);event(a,'purchase_unmarked',mark,when+86400000);
 let r=scores(jewelleryReport(store,a,{from:'2026-11-01',to:'2026-11-02'}));assert.equal(r.totals.purchases,1);assert.equal(r.totals.conversion,100);assert.equal(r.products.length,1);assert.equal(r.products[0].purchases,1);assert.equal(r.products[0].name,'Deleted jewellery');
 r=scores(jewelleryReport(store,a,query));assert.equal(r.totals.purchases,0);assert.equal(r.products[0].purchases,0);
 event(a,'purchase_marked',mark,when+86400001);r=scores(jewelleryReport(store,a,query));assert.equal(r.totals.purchases,1);assert.equal(r.products[0].purchases,1);
 event(a,'purchase_marked',{...j,lookId:'no-session',jewelleryItemIds:[]});r=scores(jewelleryReport(store,a,query));assert.equal(r.totals.unattributedPurchases,1);assert.equal(r.totals.conversion,200);
}));

test('historical source-tagged AI activity is recoverable; unclassified look events are counted as gaps, not inferred',async()=>fixture(async({store,a,event})=>{
 event(a,'tryon_generated',{source:'jewellery',requestId:randomUUID(),garmentId:'deleted'});
 for(const type of ['look_saved','look_shared','share_viewed','purchase_marked'])event(a,type,{lookId:'unknown'});
 event(a,'look_saved',{category:'garment',lookId:'known-clothing'});
 const r=scores(jewelleryReport(store,a,query));assert.equal(r.totals.tryonsGenerated,1);assert.equal(r.unclassifiedLookEvents,4);assert.equal(r.totals.looksSaved,0);assert.equal(r.totals.looksShared,0);assert.equal(r.totals.purchases,0);assert.ok(r.trackingSince>0);
}));

test('jewellery event metadata accepts only enums, bounded counts and opaque IDs; fitting operations deduplicate across modes',async()=>fixture(async({store,a,event})=>{
 const ref={...j,itemCount:2,jewelleryItemIds:['piece','piece',null],image:'private-photo',face:'private-face',price:9999,phone:'secret-phone',apiKey:'secret-key',outcome:'complete',previewMode:'overlay'};
 event(a,'jewellery_overlay_applied',ref,when,'one');event(a,'jewellery_overlay_applied',ref,when,'one');event(a,'tryon_generated',ref,when,'one');
 const rows=store.db.prepare('SELECT refJson FROM events').all();assert.equal(rows.length,1);const saved=JSON.parse(rows[0].refJson);assert.deepEqual(saved.jewelleryItemIds,['piece']);assert.equal(saved.itemCount,2);
 for(const key of ['image','face','price','phone','apiKey'])assert.ok(!Object.hasOwn(saved,key));
 event(a,'jewellery_compared',{category:'private-key',view:'customer-name',outcome:'raw-provider-error',itemCount:999,previewMode:'secret'});
 assert.deepEqual(JSON.parse(store.db.prepare("SELECT refJson FROM events WHERE type='jewellery_compared'").get().refJson),{});
}));

test('IST boundaries, scoped product caps and CSV preserve every jewellery product without prices or invented credits',async()=>fixture(async({store,a,event})=>{
 const range=dateRange(query),sessionId=randomUUID();
 for(let i=0;i<51;i++)event(a,'tryon_generated',{...j,sessionId,garmentId:'piece-'+i});
 event(a,'jewellery_overlay_applied',{...j,sessionId},range.start-1);event(a,'jewellery_overlay_applied',{...j,sessionId},range.end);
 const report=jewelleryReport(store,a,query);assert.equal(report.jewellery.products.length,50);assert.equal(report.jewellery.productsTracked,51);assert.equal(report.jewellery.totals.overlays,0);
 const full=jewelleryReport(store,a,query,{fullProducts:true}),csv=analyticsCsv(full);assert.equal((csv.match(/"Jewellery product",/g)||[]).length,51);assert.match(csv,/"Jewellery total"/);assert.match(csv,/"Purchased looks"/);assert.doesNotMatch(csv,/secret-key|private-photo/);
 const total=csv.split('\r\n').find(line=>line.startsWith('"Jewellery total"')).split(',');assert.equal(total[7],'""','jewellery credit attribution is unavailable, not a fabricated zero');
}));

test('server pilot flag gates JSON and CSV independently per app; query parameters cannot enable it',async()=>fixture(async({store,a,event})=>{
 const {createApp}=await import('../server/app.js');
 event(a,'tryon_generated',{...j,sessionId:randomUUID()});
 const servers=[false,true].map(jewelleryEnabled=>createApp({accountStore:store,accessMode:'public',jewelleryEnabled}).listen(0,'127.0.0.1'));
 try{
  for(const s of servers)if(!s.listening)await new Promise(r=>s.once('listening',r));
  const headers={Cookie:'forme_session='+store.session(a)};
  for(const [i,s] of servers.entries()){
   const base='http://127.0.0.1:'+s.address().port,q='?from=2026-11-01&to=2026-11-03&jewelleryEnabled=1';
   const response=await fetch(base+'/api/analytics'+q,{headers});assert.equal(response.status,200);const report=await response.json();assert.equal(Object.hasOwn(report,'jewellery'),i===1);
   const csv=await(await fetch(base+'/api/analytics.csv'+q,{headers})).text();assert.equal(csv.includes('Jewellery total'),i===1);assert.equal(csv.includes('Free overlays'),i===1);assert.equal(csv.split('\r\n')[0].split(',').length,i===1?17:9);
  }
  const off=await(await fetch('http://127.0.0.1:'+servers[0].address().port+'/api/analytics',{headers})).json();assert.equal(Object.hasOwn(off,'jewellery'),false,'the enabled app must not mutate shared reporting defaults');
 }finally{for(const s of servers)await new Promise(r=>s.close(r));}
}));

test('monthly attachments follow the pilot flag without changing the existing delivery policy',async()=>{
 const {MonthlyAnalytics}=await import('../server/analytics-mail.js');
 for(const jewelleryEnabled of [false,true])await fixture(async({store,a,event})=>{
  event(a,'jewellery_overlay_applied',{...j,sessionId:randomUUID()});const mail=[];
  const service=new MonthlyAnalytics(store,{jewelleryEnabled,publicUrl:'https://studio.example.test',sendMail:async message=>mail.push(message)});
  await service.runDue(Date.parse('2026-12-01T04:00:00Z'));assert.ok(mail.length>0);
  for(const m of mail)assert.equal(m.attachments[0].content.toString().includes('Jewellery total'),jewelleryEnabled);
 });
});
