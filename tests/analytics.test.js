import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../server/app.js';
import {recordEvent} from '../server/events.js';
import {dateRange,analyticsCsv} from '../server/analytics.js';
import {MonthlyAnalytics,monthlyWindow} from '../server/analytics-mail.js';
const uid=()=>randomBytes(16).toString('hex');
async function fixture(run){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-analytics-')),store=new AccountStore(directory);
 const register=(email,name)=>store.register({email,name,password:'test-password-long'});
 const a=await register('a@example.test','Store A'),b=await register('b@example.test','Store B'),initialBranch=await register('branch@example.test','Branch A');
 store.db.prepare('UPDATE stores SET org=? WHERE id=?').run(a.org,initialBranch.id);const branch=store.identity(initialBranch.user.id,initialBranch.id);
 store.db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(b.user.id,a.id);const manager=store.identity(b.user.id,a.id);
 const ca=`forme_session=${store.session(a)}`,cb=`forme_session=${store.session(b)}`,cm=`forme_session=${store.session(manager)}`;
 const customer=store.customers.save(a,{name:'Private Customer',phoneE164:'9876543210'}),image=`data:image/png;base64,${(await standardAvatar('regular')).toString('base64')}`;
 const avatar=await store.save(a,{image,customerId:customer.id,name:'Customer avatar',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
 const garment=(await store.garments.save(a,{image,name:'Blue shirt',garmentType:'shirt',variant:'Blue'})).garment;
 const otherGarment=(await store.garments.save(a,{image,name:'Other shirt',garmentType:'shirt',variant:'Other'})).garment;
 const branchGarment=(await store.garments.save(branch,{image,name:'Branch shirt',garmentType:'shirt',variant:'Branch'})).garment;
 // Same opaque product ID in two stores must remain distinct in organisation reports.
 store.db.prepare('UPDATE garments SET id=? WHERE account=? AND id=?').run(garment.id,branch.id,branchGarment.id);
 let ai=0,fail=false;const mail=[];
 const app=createApp({accountStore:store,accessMode:'public',apiKey:'test',rateLimit:false,publicUrl:'https://studio.example.test',sendMail:async message=>{mail.push(message);},tryOn:async()=>{ai++;if(fail)throw new Error('provider failure');return image;}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method='GET',body,cookie=ca,origin=base)=>fetch(base+url,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const event=(account,type,ref,time)=>recordEvent(store.db,{org:account.org,store:account.id,user:account.user.id},type,ref,{createdAt:time});
 try{await run({store,a,b,branch,manager,ca,cb,cm,customer,avatar,garment,otherGarment,image,request,event,mail,app,directory,ai:()=>ai,setFail:v=>{fail=v;}});}finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}
const when=Date.parse('2026-10-01T04:00:00Z'),later=Date.parse('2026-10-02T04:00:00Z');
function ledger(store,actor,pool,time,terminal='commit'){
 const hold=uid();store.db.prepare('INSERT INTO ledger(id,org,store,user,pool,amount,kind,ref,requestId,action,createdAt) VALUES(?,?,?,?,?,-1,?,?,?,?,?)').run(hold,actor.org,actor.id,actor.user.id,pool,'hold','tryon',randomUUID(),pool==='photo'?'catalogue':'tryon',time);
 if(terminal)store.db.prepare('INSERT INTO ledger(id,org,store,user,pool,amount,kind,ref,action,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid(),actor.org,actor.id,actor.user.id,pool,terminal==='refund'?1:0,terminal,hold,'test',time);
}
function seed({store,a,b,branch,manager,garment,otherGarment,event}){
 const s1=randomUUID(),s2=randomUUID(),s3=randomUUID();
 event(a,'avatar_generated',{requestId:randomUUID()},when);
 event(a,'tryon_generated',{sessionId:s1,garmentId:garment.id,requestId:randomUUID()},when);
 event(a,'tryon_reused',{sessionId:s1,garmentId:garment.id,requestId:randomUUID()},when+1);
 event(manager,'tryon_generated',{sessionId:s2,garmentId:otherGarment.id,requestId:randomUUID()},when+2);
 event(branch,'tryon_generated',{sessionId:s3,garmentId:garment.id,requestId:randomUUID()},later);
 event(b,'tryon_generated',{sessionId:randomUUID(),garmentId:garment.id,requestId:randomUUID()},when);
 event(a,'look_saved',{lookId:'first-look'},when);
 event(a,'look_shared',{lookId:'first-look'},when);
 for(let i=0;i<2;i++)recordEvent(store.db,{org:a.org,store:a.id},'share_viewed',{shareId:'opaque-share'},{createdAt:when});
 event(a,'purchase_marked',{lookId:'first-look',sessionId:s1,garmentIds:[garment.id],size:'M'},when+3);
 event(manager,'purchase_marked',{lookId:'undone-look',sessionId:s2,garmentIds:[otherGarment.id],size:'L'},when+4);
 event(manager,'purchase_unmarked',{lookId:'undone-look'},later);
 event(a,'whatsapp_sent',{messageId:'message'},when);
 ledger(store,a,'ai',when);ledger(store,a,'photo',later);ledger(store,branch,'ai',later);ledger(store,a,'ai',when,'refund');ledger(store,a,'ai',when,null);ledger(store,b,'ai',when);
 return {s1,s2,s3};
}

test('analytics dates are inclusive India-time days, validate calendar dates and bound the range',()=>{
 const r=dateRange({from:'2026-10-01',to:'2026-10-02'});assert.equal(new Date(r.start).toISOString(),'2026-09-30T18:30:00.000Z');assert.equal(new Date(r.end).toISOString(),'2026-10-02T18:30:00.000Z');
 for(const query of [{from:'2026-02-30'},{from:'2026-10-02',to:'2026-10-01'},{from:'2025-01-01',to:'2026-10-01'},{from:['2026-10-01']},{to:'invalid'}])assert.throws(()=>dateRange(query),{status:400});
 assert.deepEqual(monthlyWindow(Date.parse('2024-03-01T03:29:59Z')),null);assert.deepEqual(monthlyWindow(Date.parse('2024-03-01T03:30:00Z')),{period:'2024-02',from:'2024-02-01',to:'2024-02-29'});assert.equal(monthlyWindow(Date.parse('2026-01-01T03:30:00Z')).period,'2025-12');
});

test('organisation aggregates match exact event counts, undo state, product/session sets, staff and committed credits',async()=>fixture(async context=>{
 seed(context);const {store,a,branch,manager,garment,otherGarment}=context;
 const report=store.analytics.report(a,{store:'all',from:'2026-10-01',to:'2026-10-02'}),t=report.totals;
 assert.equal(t.tryons,4);assert.equal(t.tryonsGenerated,3);assert.equal(t.tryonsReused,1);assert.equal(t.tryonSessions,3);assert.equal(t.purchases,1);assert.equal(t.conversion,33.3);assert.equal(t.creditsUsed,3);assert.equal(t.aiCredits,2);assert.equal(t.photoCredits,1);assert.equal(t.avatarsGenerated,1);assert.equal(t.looksSaved,1);assert.equal(t.looksShared,1);assert.equal(t.shareViews,2);assert.equal(t.whatsappSent,1);
 assert.equal(report.days.length,2);assert.equal(report.days[0].tryons,3);assert.equal(report.days[1].tryons,1);assert.equal(report.days[1].purchases,0);assert.equal(report.days.reduce((sum,d)=>sum+d.creditsUsed,0),3);
 const main=report.products.find(p=>p.storeId===a.id&&p.id===garment.id),branchRow=report.products.find(p=>p.storeId===branch.id&&p.id===garment.id);assert.equal(main.tries,2);assert.equal(main.sessions,1);assert.equal(main.purchases,1);assert.equal(main.conversion,100);assert.equal(branchRow.tries,1);assert.equal(branchRow.name,'Branch shirt');assert.equal(report.triedNotBought.length,2);assert.ok(report.triedNotBought.some(p=>p.id===otherGarment.id));
 const staff=report.staff.find(s=>s.storeId===a.id&&s.id===manager.user.id);assert.equal(staff.tryons,1);assert.equal(staff.purchases,0);assert.equal(staff.creditsUsed,0);
 const own=store.analytics.report(a,{from:'2026-10-01',to:'2026-10-02'});assert.equal(own.totals.tryonSessions,2);assert.equal(own.totals.purchases,1);assert.equal(own.totals.conversion,50);
}));

test('date boundaries, purchase correction chronology and multiple looks per visit have explicit ratios',async()=>fixture(async context=>{
 const {store,a,event,garment}=context,sid=randomUUID(),range=dateRange({from:'2026-10-01',to:'2026-10-02'});
 event(a,'tryon_generated',{sessionId:sid,garmentId:garment.id},range.start);event(a,'tryon_generated',{sessionId:randomUUID(),garmentId:garment.id},range.start-1);event(a,'tryon_generated',{sessionId:randomUUID(),garmentId:garment.id},range.end);
 for(const lookId of ['one','two'])event(a,'purchase_marked',{lookId,sessionId:sid,garmentIds:[garment.id]},when);
 event(a,'purchase_unmarked',{lookId:'one'},range.end+1);
 const historical=store.analytics.report(a,{from:'2026-10-01',to:'2026-10-02'});assert.equal(historical.totals.tryons,1);assert.equal(historical.totals.purchases,2);assert.equal(historical.totals.conversion,200);
 const corrected=store.analytics.report(a,{from:'2026-10-01',to:'2026-10-03'});assert.equal(corrected.totals.purchases,1);
}));

test('owners can select any store in their org, managers only their active store, staff and foreign orgs are denied',async()=>fixture(async({store,a,b,branch,request,cm,ca,cb})=>{
 assert.equal((await request(`/api/analytics?store=${branch.id}`)).status,200);assert.equal((await request(`/api/analytics?store=${b.id}`)).status,403);assert.equal((await request('/api/analytics?store=all','GET',undefined,cm)).status,403);assert.equal((await request(`/api/analytics?store=${branch.id}`,'GET',undefined,cm)).status,403);assert.equal((await request('/api/analytics','GET',undefined,cm)).status,200);
 assert.equal((await request('/api/analytics.csv','GET',undefined,cm)).status,200);assert.equal((await request(`/api/analytics.csv?store=${branch.id}`,'GET',undefined,cm)).status,403);assert.equal((await request('/api/analytics/preferences','GET',undefined,cm)).status,403);assert.equal((await request('/api/analytics/preferences','PUT',{monthlyEmail:false},cm)).status,403);
 for(const url of ['/api/analytics','/api/analytics.csv','/api/analytics/preferences'])assert.equal((await request(url,'GET',undefined,'')).status,401);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(b.user.id,a.id);assert.equal((await request('/api/analytics','GET',undefined,cm)).status,403);assert.equal((await request('/api/analytics.csv','GET',undefined,cm)).status,403);assert.equal((await request('/api/analytics/preferences','GET',undefined,cm)).status,403);
 assert.equal((await request('/api/analytics/preferences','PUT',{monthlyEmail:false},ca,'https://evil.test')).status,403);assert.equal((await request('/api/analytics/preferences','PUT',{monthlyEmail:'no'})).status,400);
}));

test('event refs are whitelisted, operations deduplicate and CSV does not expose images or execute formulas',async()=>fixture(async context=>{
 const {store,a,event,garment}=context;const ref={requestId:randomUUID(),sessionId:randomUUID(),garmentId:garment.id,image:'data:image/png;base64,private',phone:'9876543210',apiKey:'secret',face:'private'};
 const actor={org:a.org,store:a.id,user:a.user.id};recordEvent(store.db,actor,'tryon_generated',ref,{operationKey:'same',createdAt:when});recordEvent(store.db,actor,'tryon_generated',ref,{operationKey:'same',createdAt:when});recordEvent(store.db,actor,'tryon_reused',ref,{operationKey:'same',createdAt:when});const rows=store.db.prepare('SELECT * FROM events').all();assert.equal(rows.length,1);for(const forbidden of ['image','phone','apiKey','face'])assert.ok(!Object.hasOwn(JSON.parse(rows[0].refJson),forbidden));
 store.db.prepare('UPDATE garments SET name=? WHERE account=? AND id=?').run('=HYPERLINK("evil")',a.id,garment.id);const report=store.analytics.report(a,{from:'2026-10-01',to:'2026-10-02'}),csv=analyticsCsv(report);assert.ok(csv.includes("'=HYPERLINK"));assert.ok(!csv.includes('9876543210'));assert.ok(!csv.includes('data:image'));
}));

test('provider success, cached-use actions and saves/purchases produce validated attribution; lookups and failures do not',async()=>fixture(async({store,a,b,avatar,garment,customer,request,ai,setFail,image,cm,cb,ca})=>{
 const sessionId=randomUUID(),body={sessionId,requestId:randomUUID(),avatar:image,avatarId:avatar.id,garmentId:garment.id,garmentType:'shirt',bodyType:'male',consent:true,consentScope:'avatar-and-garment',consentProvider:'gemini'};
 const generated=await request('/api/tryon','POST',body);assert.equal(generated.status,200);const output=await generated.json();assert.equal(ai(),1);
 const context={avatar:image,avatarId:avatar.id,garmentType:'shirt',bodyType:'male'};await request(`/api/garments/${garment.id}/results`,'POST',{image:output.image,receipt:output.reuseReceipt,reviewed:true,storageConsent:true});
 await request(`/api/garments/${garment.id}/reuse`,'POST',context);assert.equal(store.db.prepare("SELECT count(*) AS n FROM events WHERE type='tryon_reused'").get().n,0);
 const reuse={...context,sessionId,requestId:randomUUID()};assert.equal((await request(`/api/garments/${garment.id}/reuse/use`,'POST',reuse)).status,200);await request(`/api/garments/${garment.id}/reuse/use`,'POST',reuse);assert.equal(store.db.prepare("SELECT count(*) AS n FROM events WHERE type='tryon_reused'").get().n,1);assert.equal(ai(),1);
 const look=await store.saveLook(a,{image,avatarId:avatar.id,sessionId,garmentIds:[garment.id],name:'Confirmed look',garments:['Blue shirt']});await store.saveLook(a,{image,avatarId:avatar.id,sessionId,garmentIds:[garment.id],name:'Renamed look',garments:['Blue shirt']});assert.equal(store.db.prepare("SELECT count(*) AS n FROM events WHERE type='look_saved'").get().n,1);
 await request(`/api/looks/${look.id}/purchase`,'POST',{size:'M'});const mark=JSON.parse(store.db.prepare("SELECT refJson FROM events WHERE type='purchase_marked'").get().refJson);assert.equal(mark.sessionId,sessionId);assert.deepEqual(mark.garmentIds,[garment.id]);
 setFail(true);assert.equal((await request('/api/tryon','POST',{...body,garmentId:undefined,garment:image,requestId:randomUUID()})).status,502);const report=store.analytics.report(a);assert.equal(report.totals.tryons,2);assert.equal(report.totals.tryonSessions,1);assert.equal(report.totals.purchases,1);assert.equal(report.totals.creditsUsed,1);
 const outside=(await store.garments.save(b,{image,name:'Other',garmentType:'shirt',variant:''})).garment;await assert.rejects(store.saveLook(a,{image,avatarId:avatar.id,sessionId,garmentIds:[outside.id],name:'Bad',garments:[]}),{status:404});
 const url=`/api/garments/${garment.id}/reuse/use`,open=()=>({...reuse,requestId:randomUUID()});
 assert.equal((await request(url,'POST',open(),'')).status,401);assert.equal((await request(url,'POST',open(),cb)).status,404);assert.equal((await request(url,'POST',open(),ca,'https://evil.test')).status,403);assert.equal((await request(url,'POST',open(),cm)).status,200);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(b.user.id,a.id);assert.equal((await request(url,'POST',open(),cm)).status,200);assert.equal(ai(),2,'cached actions never call AI, including for staff');
}));

test('dashboard caps product tables but CSV exports every product for the scoped range',async()=>fixture(async({a,event,request})=>{
 for(let i=0;i<51;i++)event(a,'tryon_generated',{sessionId:randomUUID(),garmentId:'historical-product-'+i},when);
 const query='?from=2026-10-01&to=2026-10-02';const report=await (await request('/api/analytics'+query)).json();assert.equal(report.productsTracked,51);assert.equal(report.products.length,50);assert.equal(report.triedNotBought.length,50);
 const csv=await (await request('/api/analytics.csv'+query)).text();assert.equal((csv.match(/"Product",/g)||[]).length,51);
}));

test('monthly reports send once per owner/org after 09:00 IST, protect other organisations and include safe unsubscribe links',async()=>fixture(async context=>{
 seed(context);const {store,a,b,branch,app,mail,request}=context,reports=app.locals.analyticsReports;
 assert.equal((await reports.runDue(Date.parse('2026-11-01T03:29:59Z'))).sent,0);assert.equal(mail.length,0);
 const due=Date.parse('2026-11-01T03:30:00Z');const sent=await reports.runDue(due);assert.equal(sent.sent,3);await reports.runDue(due+60000);assert.equal(mail.length,3);
 const own=mail.find(m=>m.to==='a@example.test'),foreign=mail.find(m=>m.to==='b@example.test');assert.match(own.text,/Try-ons: 4/);assert.match(foreign.text,/Try-ons: 1/);assert.ok(!foreign.text.includes('Store A'));assert.ok(!JSON.stringify(own).includes('Private Customer'));assert.ok(!JSON.stringify(own).includes('9876543210'));assert.ok(own.attachments[0].content.toString().includes('Product'));assert.match(own.headers['List-Unsubscribe-Post'],/One-Click/);
 const url=own.text.match(/https:\/\/studio\.example\.test\/reports\/unsubscribe\/[\w-]+/)[0],token=new URL(url).pathname.split('/').at(-1);assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM analytics_unsubscribe').all()).includes(token));
 const page=await request(new URL(url).pathname,'GET',undefined,'');assert.equal(page.status,200);assert.equal(store.analytics.preferences(a.user.id).monthlyEmail,true,'GET link scanners do not unsubscribe');assert.match(await page.text(),/Stop monthly reports/);
 assert.equal((await request(new URL(url).pathname,'POST',{},'')).status,200);assert.equal(store.analytics.preferences(a.user.id).monthlyEmail,false);await reports.runDue(Date.parse('2026-12-01T03:30:00Z'));assert.equal(mail.filter(m=>m.to==='a@example.test').length,1);
 store.analytics.setPreferences(a.user.id,true);assert.equal((await request(new URL(url).pathname,'GET',undefined,'')).status,410,'old links are revoked when the owner subscribes again');
}));

test('monthly email failure is uncertain, concurrent runs/restarts never duplicate and unsubscribed/disabled owners are skipped',async()=>fixture(async({store,a,b,branch,directory})=>{
 store.analytics.setPreferences(b.user.id,false);store.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(branch.user.id);
 let sends=0;const service=new MonthlyAnalytics(store,{publicUrl:'https://studio.example.test',sendMail:async()=>{sends++;throw new Error('SMTP response lost');}}),now=Date.parse('2026-11-01T03:30:00Z');await Promise.all([service.runDue(now),service.runDue(now)]);assert.equal(sends,1);assert.equal(store.db.prepare('SELECT state FROM analytics_monthly WHERE user=?').get(a.user.id).state,'unknown');
 const reopened=new AccountStore(directory);try{const restarted=new MonthlyAnalytics(reopened,{publicUrl:'https://studio.example.test',sendMail:async()=>{sends++;}});await restarted.runDue(now+60000);assert.equal(sends,1);}finally{reopened.close();}
 assert.equal(new MonthlyAnalytics(store,{publicUrl:'http://localhost',sendMail:async()=>{}}).enabled(),false);
}));
