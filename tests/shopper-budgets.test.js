import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {AccountStore} from './helpers/pilot-accounts.js';
import {ShopperBudgets,shopperMonth} from '../server/shopper-budgets.js';
import {createApp} from '../server/app.js';
import {usage} from '../server/commercial-admin.js';

const input=(store,overrides={})=>({store,requestId:randomUUID(),action:'avatar',bodyHash:'ab'.repeat(32),sessionHash:'cd'.repeat(32),...overrides});
function configure(store,account,{storeLimit=50,organisationLimit=200,paused=false}={}){
  const previous=store.shoppers.view(account);
  return store.shoppers.update(account,{storeLimit,organisationLimit,paused,storeRevision:previous.storeRevision,organisationRevision:previous.organisationRevision});
}
async function fixture(run){
  const directory=await mkdtemp(path.join(os.tmpdir(),'forme-shopper-')),store=new AccountStore(directory);
  const a=await store.register({name:'Alpha',email:'alpha@example.test',password:'test-password-long'}),b=await store.register({name:'Beta',email:'beta@example.test',password:'test-password-long'});
  store.db.prepare("UPDATE orgs SET plan='growth' WHERE id=?").run(a.org);
  try{await run({directory,store,a,b});}finally{store.close();await rm(directory,{recursive:true,force:true});}
}

test('shopper settings start paused/zero, migrate idempotently, enforce ceilings and recheck current owner membership',()=>fixture(async({directory,store,a,b})=>{
  const before=store.shoppers.view(a);assert.equal(before.store.monthlyLimit,0);assert.equal(before.organisation.monthlyLimit,0);assert.equal(before.paused,true);assert.equal(before.widgetAvailable,false);
  assert.throws(()=>store.shoppers.reserve(input(a.id)),{code:'shopper_paused'});
  for(const values of [{storeLimit:51},{organisationLimit:201},{storeLimit:1.5},{paused:'false'},{storeLimit:'5'}])assert.throws(()=>configure(store,a,values),{code:'invalid_shopper_settings'});
  // Unknown tenant fields are rejected rather than selecting a different store.
  assert.throws(()=>store.shoppers.update(a,{storeId:b.id}),{code:'invalid_shopper_settings'});
  const saved=configure(store,a);assert.equal(saved.store.monthlyLimit,50);assert.equal(saved.organisation.monthlyLimit,200);assert.equal(saved.paused,false);
  assert.throws(()=>store.shoppers.update(a,{storeLimit:5,organisationLimit:5,paused:false,storeRevision:before.storeRevision,organisationRevision:before.organisationRevision}),{code:'shopper_settings_changed'});
  const second=new AccountStore(directory);try{assert.equal(second.shoppers.view(a).store.monthlyLimit,50);}finally{second.close();}
  store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(a.user.id,a.id);
  assert.throws(()=>store.shoppers.view(a),{status:403});assert.throws(()=>store.shoppers.update(a,{action:'pause'}),{status:403});
}));

test('owner/manager/staff/other-store/anonymous API matrix, origin and stale revisions protect active-store settings',()=>fixture(async({store,a,b})=>{
  store.db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(b.user.id,a.id);
  const manager=store.identity(b.user.id,a.id),ownerCookie=store.session(a),managerCookie=store.session(manager),otherCookie=store.session(b);
  const app=createApp({accountStore:store,accessMode:'public'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const request=(method,cookie,body,origin=base)=>fetch(base+'/api/shopper-settings',{method,headers:{Origin:origin,Cookie:cookie?`forme_session=${cookie}`:'','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  try{
    for(const [cookie,status] of [[ownerCookie,200],[managerCookie,200],[otherCookie,200],['',401]])assert.equal((await request('GET',cookie)).status,status);
    let response=await request('GET',ownerCookie);assert.equal(response.headers.get('cache-control'),'no-store');const before=await response.json();
    const body={storeLimit:25,organisationLimit:100,paused:false,storeRevision:before.storeRevision,organisationRevision:before.organisationRevision};
    assert.equal((await request('PUT',managerCookie,body)).status,403);assert.equal((await request('PUT','',body)).status,401);
    assert.equal((await request('PUT',ownerCookie,body,'https://elsewhere.example')).status,403);
    assert.equal((await request('PUT',ownerCookie,{...body,storeId:b.id})).status,400);
    assert.equal((await request('PUT',ownerCookie,body)).status,200);
    assert.equal((await request('PUT',ownerCookie,body)).status,409);
    assert.equal((await request('PUT',ownerCookie,{action:'pause'})).status,200);
    assert.equal((await (await request('GET',otherCookie)).json()).store.monthlyLimit,0);
    assert.equal((await (await request('GET',managerCookie)).json()).canEdit,false);
    store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(b.user.id,a.id);
    assert.equal((await request('GET',managerCookie)).status,403);assert.equal((await request('PUT',managerCookie,{action:'pause'})).status,403);
    // No anonymous shopper generation/meter API was introduced.
    assert.equal((await fetch(base+'/shopper-api/avatar',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
  }finally{await new Promise(r=>server.close(r));}
}));

test('scoped shopper ledger holds reserve and settle once, preserve staff rules, reject payload/id reuse and insufficient funds atomically',()=>fixture(async({store,a,b})=>{
  configure(store,a);const initial=store.billing.balance(a.org),body=input(a.id),first=store.shoppers.reserve(body);
  assert.equal(first.fresh,true);assert.equal(store.shoppers.reserve(body).fresh,false);assert.equal(store.billing.balance(a.org),initial-1);
  const hold=store.db.prepare('SELECT * FROM ledger WHERE id=?').get(first.operation.hold);
  assert.equal(hold.user,null);assert.equal(hold.org,a.org);assert.equal(hold.store,a.id);assert.equal(hold.action,'shopper_avatar');assert.equal(hold.pool,'ai');
  for(const values of [{store:b.id},{action:'tryon'},{bodyHash:'ef'.repeat(32)},{sessionHash:'12'.repeat(32)}])assert.throws(()=>store.shoppers.reserve({...body,...values}),{code:'duplicate_request'});
  assert.throws(()=>store.shoppers.commit(body.requestId),{code:'shopper_operation_settled'});
  assert.throws(()=>store.billing.reserve({org:a.org,store:a.id,user:null,requestId:randomUUID(),action:'avatar'}),{code:'account_required'});
  assert.throws(()=>store.billing.reserve({org:a.org,store:a.id,user:a.user.id,requestId:randomUUID(),action:'shopper_avatar'}),{code:'invalid_meter'});
  assert.throws(()=>store.billing.reserveShopper(body.requestId),/operation transaction/);
  store.shoppers.dispatch(body.requestId);assert.throws(()=>store.shoppers.dispatch(body.requestId),{code:'duplicate_request'});
  assert.equal(store.shoppers.commit(body.requestId),true);assert.equal(store.shoppers.commit(body.requestId),false);assert.equal(store.shoppers.refund(body.requestId),false);
  const view=store.shoppers.view(a);assert.equal(view.store.committed,1);assert.equal(view.store.dispatched,1);assert.equal(view.store.held,0);assert.equal(view.store.pendingAttempts,0);
  assert.equal(usage(store,a).staff.find(row=>row.id==='shopper-self-service').name,'Shopper self-service');
  assert.equal(store.analytics.report(a).staff.find(row=>row.id==='shopper-self-service').name,'Shopper self-service');
  const duplicate=randomUUID(),staffHold=store.billing.reserve({org:a.org,store:a.id,user:a.user.id,requestId:duplicate,action:'tryon'});
  assert.throws(()=>store.shoppers.reserve(input(a.id,{requestId:duplicate})),{code:'duplicate_request'});store.billing.refund(staffHold);
  const rest=store.billing.balance(a.org);store.db.prepare("INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','shopper-reset',?)").run(randomUUID(),a.org,-rest,Date.now());
  assert.throws(()=>store.shoppers.reserve(input(a.id)),{code:'credits_required'});assert.equal(store.db.prepare('SELECT count(*) n FROM shopper_operations').get().n,1);
  assert.equal(store.shoppers.view(a).store.held,0);
}));

test('failed dispatched calls exhaust the 50-attempt store cap even after refunds/restarts; undelivered reservations restore attempt room',()=>fixture(async({directory,store,a})=>{
  configure(store,a);const balance=store.billing.balance(a.org),cancel=input(a.id);store.shoppers.reserve(cancel);assert.equal(store.shoppers.refund(cancel.requestId),true);
  assert.equal(store.shoppers.view(a).store.attemptRemaining,50);
  for(let i=0;i<50;i++){const op=input(a.id);store.shoppers.reserve(op);store.shoppers.dispatch(op.requestId);assert.equal(store.shoppers.refund(op.requestId),true);assert.equal(store.shoppers.refund(op.requestId),false);}
  assert.equal(store.billing.balance(a.org),balance);assert.equal(store.shoppers.view(a).store.dispatched,50);assert.equal(store.shoppers.view(a).store.committed,0);
  assert.throws(()=>store.shoppers.reserve(input(a.id)),{code:'shopper_cap_reached'});
  const second=new AccountStore(directory);try{assert.throws(()=>second.shoppers.reserve(input(a.id)),{code:'shopper_cap_reached'});assert.equal(second.shoppers.view(a).store.dispatched,50);}finally{second.close();}
  configure(store,a);assert.throws(()=>store.shoppers.reserve(input(a.id)),{code:'shopper_cap_reached'});
}));

test('200-attempt organisation ceiling spans stores and no other organisation shares its counters',()=>fixture(async({store,a,b})=>{
  const stores=[a];
  for(let i=0;i<4;i++){
    const local=await store.register({name:'Branch '+i,email:`branch${i}@example.test`,password:'test-password-long'});
    store.db.prepare('UPDATE stores SET org=? WHERE id=?').run(a.org,local.id);stores.push(store.identity(local.user.id,local.id));
  }
  for(const account of stores)configure(store,account);
  for(const account of stores.slice(0,4))for(let i=0;i<50;i++){const op=input(account.id);store.shoppers.reserve(op);store.shoppers.dispatch(op.requestId);store.shoppers.refund(op.requestId);}
  assert.equal(store.shoppers.view(a).organisation.dispatched,200);assert.equal(store.shoppers.view(stores[4]).store.dispatched,0);
  assert.throws(()=>store.shoppers.reserve(input(stores[4].id)),{code:'shopper_cap_reached'});
  assert.equal(store.shoppers.view(b).organisation.dispatched,0);
}));

test('global shopper concurrency spans organisations and releases without charging an undispatched attempt',()=>fixture(async({store,a,b})=>{
  store.db.prepare("UPDATE orgs SET plan='chain' WHERE id=?").run(b.org);configure(store,a);configure(store,b);
  const one=input(a.id);store.shoppers.reserve(one);assert.throws(()=>store.shoppers.reserve(input(b.id)),{code:'shopper_busy'});
  assert.equal(store.shoppers.view(b).store.held,0);store.shoppers.refund(one.requestId);
  const two=input(b.id);store.shoppers.reserve(two);store.shoppers.refund(two.requestId);assert.equal(store.shoppers.view(b).organisation.dispatched,0);
}));

test('400-call organisation moderation cap cannot be evaded by moving to another store',()=>fixture(async({store,a})=>{
  const accounts=[a];
  for(let i=0;i<4;i++){
    const local=await store.register({name:'Moderation branch '+i,email:`moderation${i}@example.test`,password:'test-password-long'});
    store.db.prepare('UPDATE stores SET org=? WHERE id=?').run(a.org,local.id);accounts.push(store.identity(local.user.id,local.id));
  }
  for(const account of accounts)configure(store,account);
  for(const account of accounts.slice(0,4))for(let i=0;i<100;i++)store.shoppers.reserveModeration({store:account.id,requestId:randomUUID()});
  assert.throws(()=>store.shoppers.reserveModeration({store:accounts[4].id,requestId:randomUUID()}),{code:'shopper_moderation_cap'});
  assert.equal(store.shoppers.view(a).organisation.moderation,400);assert.equal(store.shoppers.view(accounts[4]).store.moderation,0);
}));

test('pause and policy/plan changes before dispatch or completion refund holds without resetting dispatched counters',()=>fixture(async({store,a})=>{
  for(const timing of ['reserved','dispatching']){
    configure(store,a);const before=store.billing.balance(a.org),op=input(a.id);store.shoppers.reserve(op);
    if(timing==='dispatching')store.shoppers.dispatch(op.requestId);
    store.shoppers.update(a,{action:'pause'});
    assert.throws(()=>timing==='reserved'?store.shoppers.dispatch(op.requestId):store.shoppers.commit(op.requestId),{code:'shopper_paused'});
    assert.equal(store.shoppers.operation(op.requestId).state,'refunded');assert.equal(store.billing.balance(a.org),before);assert.equal(store.shoppers.view(a).store.held,0);
  }
  configure(store,a);const op=input(a.id);store.shoppers.reserve(op);configure(store,a,{storeLimit:1});
  assert.throws(()=>store.shoppers.dispatch(op.requestId),{code:'shopper_settings_changed'});
  for(const [plan,status] of [['starter','active'],['trial','trial'],['photo','active'],['pilot','active'],['growth','past_due'],['growth','suspended']]){
    store.db.prepare('UPDATE orgs SET plan=?,status=? WHERE id=?').run(plan,status,a.org);
    assert.throws(()=>store.shoppers.reserve(input(a.id)),{code:'shopper_plan_required'});
    assert.throws(()=>configure(store,a),{code:'shopper_plan_required'});
    assert.equal(store.shoppers.update(a,{action:'pause'}).paused,true);
  }
  store.db.prepare("UPDATE orgs SET plan='growth',status='active' WHERE id=?").run(a.org);configure(store,a);
  const active=input(a.id);store.shoppers.reserve(active);store.shoppers.dispatch(active.requestId);store.db.prepare("UPDATE orgs SET status='suspended' WHERE id=?").run(a.org);
  assert.throws(()=>store.shoppers.commit(active.requestId),{code:'shopper_plan_required'});assert.equal(store.shoppers.operation(active.requestId).state,'refunded');
}));

test('IST month boundary, cross-month delivery and non-resetting cap changes use the reserved month',()=>fixture(async({store,a})=>{
  let clock=Date.parse('2026-11-30T18:29:59.000Z');store.shoppers=new ShopperBudgets(store,{now:()=>clock});configure(store,a,{storeLimit:1});
  assert.equal(shopperMonth(clock).month,'2026-11');assert.equal(shopperMonth(clock).resetsAt,Date.parse('2026-11-30T18:30:00.000Z'));
  const op=input(a.id);store.shoppers.reserve(op);store.shoppers.dispatch(op.requestId);clock+=2000;assert.equal(shopperMonth(clock).month,'2026-12');store.shoppers.commit(op.requestId);
  assert.equal(store.shoppers.view(a).store.committed,0);assert.equal(store.shoppers.counts(a.org,a.id,'2026-11').committed,1);
  const december=input(a.id);store.shoppers.reserve(december);store.shoppers.dispatch(december.requestId);store.shoppers.commit(december.requestId);
  configure(store,a,{storeLimit:0,paused:true});configure(store,a,{storeLimit:1});assert.throws(()=>store.shoppers.reserve(input(a.id)),{code:'shopper_cap_reached'});
  assert.equal(shopperMonth(Date.parse('2026-12-31T18:30:00Z')).month,'2027-01');
}));

test('dedicated crash recovery refunds unknown work once, protects cap consistency and keeps request/session fingerprints out of persistent accounting',()=>fixture(async({store,a,directory})=>{
  let clock=Date.now();store.shoppers=new ShopperBudgets(store,{now:()=>clock});configure(store,a);
  const initial=store.billing.balance(a.org),op=input(a.id);store.shoppers.reserve(op);store.shoppers.dispatch(op.requestId);
  assert.equal(store.billing.sweep(clock+11*60000),0);assert.equal(store.billing.balance(a.org),initial-1);
  clock+=120001;assert.equal(store.shoppers.sweep(),1);assert.equal(store.shoppers.sweep(),0);assert.equal(store.shoppers.operation(op.requestId).reason,'unknown');
  assert.equal(store.billing.balance(a.org),initial);assert.equal(store.shoppers.view(a).store.dispatched,1);assert.equal(store.shoppers.view(a).store.held,0);
  assert.equal(store.shoppers.reserve(op).fresh,false);assert.throws(()=>store.shoppers.dispatch(op.requestId),{code:'duplicate_request'});
  const second=new AccountStore(directory);try{assert.throws(()=>second.shoppers.reserve(op),{code:'duplicate_request'});}finally{second.close();}
  const columns=store.db.prepare('PRAGMA table_info(shopper_operations)').all().map(row=>row.name);assert.ok(!columns.includes('bodyHash'));assert.ok(!columns.includes('sessionHash'));
  clock+=30*60000;store.shoppers.sweep();assert.equal(store.shoppers.bindings.size,0);
  assert.throws(()=>store.shoppers.reserve(op),{code:'duplicate_request'});
  const expired=input(a.id);store.shoppers.reserve(expired);clock+=120001;assert.throws(()=>store.shoppers.dispatch(expired.requestId),{code:'shopper_request_expired'});assert.equal(store.shoppers.view(a).store.pendingAttempts,0);
}));

test('moderation has a separate durable cap, counts failures, dedupes calls and permits output moderation with the last held AI credit',()=>fixture(async({store,a,b})=>{
  configure(store,a,{storeLimit:1});
  const before=store.billing.balance(a.org),key=randomUUID();assert.equal(store.shoppers.reserveModeration({store:a.id,requestId:key}).fresh,true);assert.equal(store.shoppers.reserveModeration({store:a.id,requestId:key}).fresh,false);
  assert.throws(()=>store.shoppers.reserveModeration({store:b.id,requestId:key}),{code:'duplicate_request'});
  for(let i=1;i<100;i++)store.shoppers.reserveModeration({store:a.id,requestId:randomUUID()});
  assert.equal(store.billing.balance(a.org),before);assert.throws(()=>store.shoppers.reserveModeration({store:a.id,requestId:randomUUID()}),{code:'shopper_moderation_cap'});
  assert.equal(store.shoppers.view(a).store.moderation,100);
  // A different month restores moderation allowance, never credits.
  store.shoppers=new ShopperBudgets(store,{now:()=>Date.parse('2030-02-01T00:00:00Z')});
  const balance=store.billing.balance(a.org);store.db.prepare("INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','last-credit',?)").run(randomUUID(),a.org,-balance+1,Date.now());
  const op=input(a.id);store.shoppers.reserve(op);store.shoppers.dispatch(op.requestId);assert.equal(store.billing.balance(a.org),0);
  assert.equal(store.shoppers.reserveModeration({store:a.id,requestId:randomUUID(),operationId:op.requestId}).fresh,true);
  assert.throws(()=>store.shoppers.reserveModeration({store:a.id,requestId:randomUUID()}),{code:'shopper_cap_reached'});store.shoppers.commit(op.requestId);
}));

test('settlement SQL failure rolls ledger and both budget scopes back together',()=>fixture(async({store,a})=>{
  configure(store,a);const op=input(a.id);store.shoppers.reserve(op);store.shoppers.dispatch(op.requestId);
  const before=store.billing.balance(a.org);store.db.exec("CREATE TRIGGER fail_shopper_settle BEFORE UPDATE ON shopper_budgets WHEN NEW.committed>OLD.committed BEGIN SELECT RAISE(ABORT,'test disk failure'); END;");
  assert.throws(()=>store.shoppers.commit(op.requestId),/test disk failure/);assert.equal(store.shoppers.operation(op.requestId).state,'dispatching');assert.equal(store.shoppers.view(a).store.held,1);assert.equal(store.billing.balance(a.org),before);
  assert.equal(store.db.prepare("SELECT count(*) n FROM ledger WHERE ref=? AND kind='commit'").get(store.shoppers.operation(op.requestId).hold).n,0);
  store.db.exec('DROP TRIGGER fail_shopper_settle');store.shoppers.commit(op.requestId);assert.equal(store.shoppers.view(a).organisation.committed,1);
}));

test('independent worker connections cannot reserve more than one global shopper slot or overspend a one-credit allowance',()=>fixture(async({directory,store,a})=>{
  configure(store,a,{storeLimit:1,organisationLimit:1});
  const workers=Array.from({length:3},()=>new Worker(new URL('./helpers/shopper-worker.js',import.meta.url),{workerData:{directory,store:a.id}}));
  try{
    await Promise.all(workers.map(w=>new Promise((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);})));
    const results=await Promise.all(workers.map(w=>new Promise((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);w.postMessage('reserve');})));
    assert.equal(results.filter(r=>r.ok).length,1);assert.ok(results.filter(r=>!r.ok).every(r=>['shopper_cap_reached','shopper_busy'].includes(r.code)));
    assert.equal(store.shoppers.view(a).store.held,1);assert.equal(store.shoppers.view(a).organisation.held,1);assert.equal(store.shoppers.view(a).store.pendingAttempts,1);
  }finally{await Promise.all(workers.map(w=>w.terminate()));}
}));
