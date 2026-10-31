import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,scryptSync} from 'node:crypto';
import express from 'express';
import {AccountStore,installAccountRoutes,accountUser} from './helpers/pilot-accounts.js';
import {requireRole} from '../server/tenancy.js';

const credentials = n => ({email:`${n}@example.test`,name:n,password:'long-test-password-only'});
const digest = s => createHash('sha256').update(s).digest('hex');
async function fixture(run) {
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-user-sessions-'));
 const store=new AccountStore(directory), app=express(); app.use(express.json());
 installAccountRoutes(app,store);
 app.get('/owner-only',(req,res,next)=>{req.account=accountUser(store,req);next();},requireRole('owner'),(req,res)=>res.json({ok:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,token='',body,origin=base)=>fetch(base+url,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:`forme_session=${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try {await run({store,directory,request});} finally {await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}

test('switch-store role matrix, membership checks, live roles and disabled users',()=>fixture(async({store,request})=>{
 const a=await store.register(credentials('A')), b=await store.register(credentials('B')), outsider=await store.register(credentials('Other'));
 for (const role of ['owner','manager','staff']) {
  const member=await store.register(credentials(role));
  store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(member.user.id,a.id,role);
  store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(member.user.id,b.id,role);
  const token=store.session(member);
  let r=await request('/api/auth/switch-store',token,{storeId:a.id});assert.equal(r.status,200);
  const data=await r.json();assert.equal(data.account.id,a.id);assert.equal(data.role,role);assert.equal(data.user.id,member.user.id);assert.equal(data.stores.length,3);
  assert.equal((await request('/owner-only',token)).status,role==='owner'?200:403);
  r=await request('/api/auth/switch-store',token,{storeId:outsider.id});assert.equal(r.status,403);assert.equal(store.user(token).id,a.id);
  assert.equal((await request('/api/auth/switch-store',token,{storeId:b.id},'https://evil.test')).status,403);
  assert.equal((await request('/api/auth/switch-store',token,{storeId:{id:b.id}})).status,400);
  assert.equal((await request('/api/auth/switch-store',token,{storeId:b.id})).status,200);
  const row=store.db.prepare('SELECT * FROM sessions WHERE token=?').get(digest(token));assert.equal(row.user,member.user.id);assert.equal(row.store,b.id);assert.notEqual(row.token,token);
  store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(member.user.id,b.id);
  assert.equal(store.user(token).user.role,'staff');
  store.db.prepare('DELETE FROM memberships WHERE user=? AND store=?').run(member.user.id,b.id);
  assert.equal((await request('/api/auth/switch-store',token,{storeId:a.id})).status,401);
  const second=store.session(await store.login(credentials(role)));
  store.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(member.user.id);
  assert.equal((await request('/api/account',second)).status,200);assert.equal((await (await request('/api/account',second)).json()).account,null);
  await assert.rejects(store.login(credentials(role)),{status:401});
 }
 assert.equal((await request('/api/auth/switch-store','',{storeId:a.id})).status,401);
 assert.equal((await request('/api/auth/switch-store',store.session(outsider),{storeId:a.id})).status,403);
 assert.equal((await request('/owner-only')).status,401);
}));

test('legacy cookie upgrades once; reset revokes sessions even after switching stores',()=>fixture(async({store,request})=>{
 const a=await store.register(credentials('Legacy')), b=await store.register(credentials('Branch'));
 store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(a.user.id,b.id,'owner');
 store.db.prepare('INSERT INTO sessions(token,account,expires) VALUES(?,?,?)').run(digest('legacy-cookie'),a.id,Date.now()+60000);
 assert.equal((await (await request('/api/account','legacy-cookie')).json()).account.user.id,a.user.id);
 assert.equal(store.db.prepare('SELECT user FROM sessions WHERE token=?').get(digest('legacy-cookie')).user,a.user.id);
 assert.equal((await request('/api/auth/switch-store','legacy-cookie',{storeId:b.id})).status,200);
 await store.resetPassword(a.email,'new-password-for-owner');assert.equal(store.user('legacy-cookie'),null);
 await assert.rejects(store.login(credentials('Legacy')),{status:401});
 assert.equal((await store.login({email:a.email,password:'new-password-for-owner'})).user.id,a.user.id);
}));

test('registration provisions atomically and duplicate staff emails cannot create an account',()=>fixture(async({store})=>{
 const a=await store.register(credentials('First'));
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM memberships WHERE user=?').get(a.user.id).n,1);
 store.db.exec("CREATE TRIGGER fail_member BEFORE INSERT ON memberships BEGIN SELECT RAISE(ABORT,'provision failure'); END;");
 await assert.rejects(store.register(credentials('Failed')),/provision failure/);
 for(const table of ['accounts','stores','orgs','users']) assert.equal(store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,1);
 store.db.exec('DROP TRIGGER fail_member');
 await assert.rejects(store.register(credentials('First')),{status:409});
}));

test('C1 password updates are reconciled once and subsequent startups preserve users',()=>fixture(async({store,directory})=>{
 const a=await store.register(credentials('Reconcile'));
 const salt='legacy-reset',hash=scryptSync('changed-during-C1',salt,64);
 store.db.prepare('UPDATE accounts SET salt=?,password=? WHERE id=?').run(salt,hash,a.id);
 store.db.exec("DELETE FROM auth_migrations WHERE version='c2'");
 const next=new AccountStore(directory);
 try {
  assert.equal((await next.login({email:a.email,password:'changed-during-C1'})).id,a.id);
  next.db.prepare('UPDATE users SET salt=?,password=? WHERE id=?').run('user-new',scryptSync('users-authority','user-new',64),a.user.id);
  const again=new AccountStore(directory);
  try {assert.equal((await again.login({email:a.email,password:'users-authority'})).id,a.id);} finally {again.close();}
 } finally {next.close();}
}));
