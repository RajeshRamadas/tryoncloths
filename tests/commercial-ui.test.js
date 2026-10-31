import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {PaymentStore} from '../server/payments.js';
import {AccountStore} from '../server/accounts.js';import {createApp,standardAvatar} from '../server/app.js';
import {adminCommand,usage,usageCsv} from '../server/commercial-admin.js';import {meter} from '../server/billing.js';
const credentials=(name,extra={})=>({name,email:`${name}@example.test`,password:'test-password-long',...extra});
async function fixture(run){const dir=await mkdtemp(path.join(os.tmpdir(),'forme-c6-')),store=new AccountStore(dir);try{await run({store,dir});}finally{store.close();await rm(dir,{recursive:true,force:true});}}
const reserve=(store,a,action='avatar')=>store.billing.reserve({org:a.org,store:a.id,user:a.user.id,requestId:randomUUID(),action});
test('default signups get one 14-day trial grant; supplied identity duplicates roll back atomically',()=>fixture(async({store,dir})=>{
 const start=Date.now(),a=await store.register(credentials('trial',{phone:'9876543210',gstin:'29ABCDE1234F1Z5',plan:'chain'}));
 const org=store.db.prepare('SELECT * FROM orgs WHERE id=?').get(a.org);assert.equal(org.plan,'trial');assert.equal(org.status,'trial');assert.ok(org.trialEndsAt>=start+14*86400000);assert.equal(store.billing.balance(a.org),30);
 for(const input of [credentials('trial'),credentials('repeat-phone',{phone:'+919876543210'}),credentials('repeat-gst',{gstin:'29ABCDE1234F1Z5'})])await assert.rejects(store.register(input),{status:409});
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM orgs').get().n,1);assert.equal(store.db.prepare("SELECT count(*) AS n FROM ledger WHERE kind='trial'").get().n,1);
 const second=new AccountStore(dir);try{assert.equal(second.billing.balance(a.org),30);}finally{second.close();}
 await assert.rejects(store.register(credentials('invalid',{phone:'not-a-phone'})),{status:400});
}));
test('trial output is watermarked and trial expiry blocks paid calls without spending credits',()=>fixture(async({store})=>{
 const a=await store.register(credentials('watermark')),image='data:image/png;base64,'+(await standardAvatar('regular')).toString('base64');let calls=0;
 const output=await meter({body:{requestId:randomUUID()}},{billing:store.billing,account:a,action:'avatar'},async()=>{calls++;return image;});assert.notEqual(output,image);assert.equal(store.billing.balance(a.org),29);
 store.db.prepare('UPDATE orgs SET trialEndsAt=? WHERE id=?').run(Date.now()-1,a.org);
 await assert.rejects(meter({body:{requestId:randomUUID()}},{billing:store.billing,account:a,action:'avatar'},async()=>{calls++;return image;}),{code:'trial_expired',status:402});
 assert.equal(calls,1);assert.equal(store.billing.balance(a.org),29);
}));
test('usage counts only commits and isolates the active store; CSV quotes unsafe staff names',()=>fixture(async({store})=>{
 const a=await store.register(credentials('a')),b=await store.register(credentials('b'));
 store.billing.commit(reserve(store,a));store.billing.commit(reserve(store,a,'tryon'));store.billing.refund(reserve(store,a));reserve(store,a);store.billing.commit(reserve(store,b));
 store.db.prepare('UPDATE users SET name=? WHERE id=?').run(' =HYPERLINK("bad")',a.user.id);
 const report=usage(store,a);assert.equal(report.total,2);assert.equal(report.days.length,30);assert.equal(report.days.reduce((s,d)=>s+d.credits,0),2);assert.equal(report.staff[0].credits,2);
 assert.deepEqual(report.actions.map(a=>a.action).sort(),['avatar','tryon']);assert.match(usageCsv(report),/"' =HYPERLINK/);
 assert.equal(usage(store,b).total,1);
}));
test('billing/usage/credit endpoints enforce the role matrix and ignore other-store selectors',()=>fixture(async({store})=>{
 const a=await store.register(credentials('owner')),b=await store.register(credentials('outside'));store.billing.commit(reserve(store,b));
 const app=createApp({accountStore:store,accessMode:'public'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`,token=store.session(a),get=(url,cookie=token)=>fetch(base+url,{headers:{Cookie:`forme_session=${cookie}`}});
 try{
  for(const role of ['owner','manager','staff']){
   store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,a.user.id,a.id);
   assert.equal((await get('/api/billing')).status,role==='owner'?200:403);
   for(const url of ['/api/usage','/api/usage.csv'])assert.equal((await get(url)).status,role==='staff'?403:200);
   const credit=await (await get('/api/credits')).json();assert.equal(credit.remaining,30);assert.equal(credit.low,false);
  }
  store.db.prepare("UPDATE memberships SET role='manager' WHERE user=? AND store=?").run(a.user.id,a.id);
  const scoped=await (await get(`/api/usage?store=${b.id}&org=${b.org}`)).json();assert.equal(scoped.storeId,a.id);assert.equal(scoped.total,0);
  for(const url of ['/api/billing','/api/usage','/api/usage.csv','/api/credits'])assert.equal((await get(url,'')).status,401);
  for(let i=0;i<27;i++)store.billing.commit(reserve(store,a));assert.equal((await (await get('/api/credits')).json()).low,true);
 }finally{await new Promise(r=>server.close(r));}
}));
test('admin grants are idempotent; plan changes, extensions and suspensions are audited; CLI lists safely',()=>fixture(async({store,dir})=>{
 const a=await store.register(credentials('admin'));
 const grant=['grant-credits',a.org,'ai','10','operator-ref-1'];adminCommand(store,grant);adminCommand(store,grant);assert.equal(store.billing.balance(a.org),40);
 assert.throws(()=>adminCommand(store,['grant-credits',a.org,'ai','-1','bad']),{status:400});
 const expiry=store.db.prepare('SELECT trialEndsAt FROM orgs WHERE id=?').get(a.org).trialEndsAt;
 adminCommand(store,['extend-trial',a.org,'7']);assert.equal(store.db.prepare('SELECT trialEndsAt FROM orgs WHERE id=?').get(a.org).trialEndsAt,expiry+7*86400000);
 adminCommand(store,['suspend',a.org]);assert.throws(()=>reserve(store,a),{code:'account_suspended'});
 const payments=new PaymentStore(store);await assert.rejects(payments.order(a.org,100),{status:403});await assert.rejects(payments.subscribe(a.org,'starter','monthly'),{status:403});
 adminCommand(store,['set-plan',a.org,'starter']);assert.equal(store.billing.balance(a.org),40);store.billing.refund(reserve(store,a));
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM billing_admin_audit').get().n,3);
 const {stdout}=await promisify(execFile)(process.execPath,['server/account-admin.js','list-orgs'],{env:{...process.env,TRYON_DATA_DIR:dir}});const rows=JSON.parse(stdout);assert.equal(rows[0].plan,'starter');assert.equal('password'in rows[0],false);assert.equal('salt'in rows[0],false);
}));
