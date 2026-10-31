import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {AccountStore,installAccountRoutes} from './helpers/pilot-accounts.js';
import {createMailer} from '../server/mailer.js';
import {createHash} from 'node:crypto';
const password='staff-test-password-long';
const input=name=>({name,email:`${name}@example.test`,password});
const hash=s=>createHash('sha256').update(s).digest('hex');
async function fixture(run,{mailFails=false}={}) {
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-staff-'));
 const store=new AccountStore(directory),app=express(),mail=[];app.use(express.json());
 const sendMail=createMailer({from:'Forme <staff@example.test>',transport:{sendMail:async message=>{if(mailFails)throw new Error('smtp-secret');mail.push(message);return {accepted:[message.to]};}}});
 installAccountRoutes(app,store,{publicUrl:'https://studio.example.test',sendMail});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,token='',method='GET',body,origin=base)=>fetch(base+url,{method,headers:{Origin:origin,Cookie:`forme_session=${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const owner=await store.register(input('owner')),other=await store.register(input('other'));
 async function invite(role='staff',email='new@example.test',token=store.session(owner),storeId=owner.id){return request('/api/invites',token,'POST',{email,role,storeId});}
 const token=()=>mail.at(-1).text.match(/\/invite#([A-Za-z0-9_-]{43})/)[1];
 async function join(role,name){assert.equal((await invite(role,`${name}@example.test`)).status,200);const r=await request('/api/invites/accept','','POST',{token:token(),name,password});assert.equal(r.status,200);const user=await store.login({email:`${name}@example.test`,password});return {user,session:store.session(user)};}
 try {await run({store,request,mail,owner,other,invite,token,join,directory});}finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}

test('emailed invitations are hashed, single use, expire, and never expose tokens or credentials',()=>fixture(async({store,request,mail,invite,token,owner})=>{
 const response=await invite();assert.equal(response.status,200);const body=await response.json();assert.deepEqual(Object.keys(body).sort(),['expiresAt','ok']);
 const t=token(),row=store.db.prepare('SELECT * FROM invites').get();assert.equal(row.tokenHash,hash(t));assert.ok(!JSON.stringify(row).includes(t));
 assert.ok(row.expiresAt>Date.now()+6*24*3600*1000);assert.equal(mail[0].to,'new@example.test');assert.match(mail[0].html,/https:\/\/studio.example.test\/invite#/);
 const accept=token=>request('/api/invites/accept','','POST',{token,name:'New person',password});
 assert.equal((await accept(t.slice(0,-1)+'!')).status,400);
 assert.equal((await accept(t)).status,200);assert.equal((await accept(t)).status,400);
 const user=await store.login({email:'new@example.test',password});assert.equal(user.id,owner.id);assert.equal(user.user.role,'staff');
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM accounts').get().n,2,'staff get users, not duplicate store accounts');
 assert.equal((await invite('staff','expired@example.test')).status,200);const expired=token();store.db.prepare('UPDATE invites SET expiresAt=0 WHERE tokenHash=?').run(hash(expired));assert.equal((await accept(expired)).status,400);
 const info=await (await request('/api/staff',store.session(owner))).json();assert.ok(info.staff.every(u=>!('salt'in u)&&!('password'in u)));
}));

test('staff route role matrix and same-origin checks prevent privilege escalation',()=>fixture(async({store,request,owner,other,join,invite})=>{
 const manager=await join('manager','manager'),staff=await join('staff','staff');
 const ownerToken=store.session(owner),outside=store.session(other);
 for(const [token,expected] of [[ownerToken,200],[manager.session,200],[staff.session,403],[outside,200],['',401]]) {
  const r=await request('/api/staff',token);assert.equal(r.status,expected);
  if(token===outside)assert.equal((await r.json()).staff.length,1);
 }
 for(const token of [staff.session,outside,'']) {
  const expected=!token?401:403;
  assert.equal((await invite('staff','attempt@example.test',token)).status,expected);
  assert.equal((await request(`/api/staff/${staff.user.user.id}`,token,'PATCH',{storeId:owner.id,disabled:true})).status,expected);
 }
 assert.equal((await invite('owner','badowner@example.test',manager.session)).status,403);
 assert.equal((await invite('manager','badmanager@example.test',manager.session)).status,403);
 assert.equal((await invite('staff','cross@example.test',manager.session,other.id)).status,403);
 assert.equal((await invite('staff','allowed@example.test',manager.session)).status,200);
 assert.equal((await request(`/api/staff/${owner.user.id}`,manager.session,'PATCH',{disabled:true})).status,403);
 assert.equal((await request(`/api/staff/${staff.user.user.id}`,manager.session,'PATCH',{role:'manager'})).status,403);
 assert.equal((await request(`/api/staff/${staff.user.user.id}`,manager.session,'PATCH',{disabled:true})).status,200);
 assert.equal(store.user(staff.session),null);assert.equal(store.db.prepare('SELECT count(*) AS n FROM sessions WHERE user=?').get(staff.user.user.id).n,0);
 assert.equal((await request('/api/invites',ownerToken,'POST',{email:'x@example.test',role:'staff'},'https://evil.test')).status,403);
 assert.equal((await request(`/api/staff/${manager.user.user.id}`,ownerToken,'PATCH',{role:'staff'},'https://evil.test')).status,403);
 assert.equal((await request('/api/invites/accept','','POST',{token:'x',name:'X',password},'https://evil.test')).status,403);
 assert.equal((await request(`/api/staff/${manager.user.user.id}`,ownerToken,'PATCH',{disabled:'true'})).status,400);
 assert.equal((await request(`/api/staff/${manager.user.user.id}`,ownerToken,'PATCH',{role:'admin'})).status,400);
}));

test('last active owners are protected and disable cannot cross store authority',()=>fixture(async({store,request,owner,other,join})=>{
 const token=store.session(owner),patch=(id,body)=>request(`/api/staff/${id}`,token,'PATCH',body);
 assert.equal((await patch(owner.user.id,{role:'manager'})).status,409);
 assert.equal((await patch(owner.user.id,{disabled:true})).status,409);
 const second=await join('owner','coowner');
 assert.equal((await patch(second.user.user.id,{role:'manager'})).status,200);
 assert.equal((await patch(owner.user.id,{role:'staff'})).status,409);
 assert.equal((await patch(second.user.user.id,{role:'owner'})).status,200);
 assert.equal((await patch(second.user.user.id,{disabled:true,role:'staff'})).status,200);
 assert.equal((await patch(owner.user.id,{disabled:true})).status,409);
 const staff=await join('staff','multistore');
 store.db.prepare("INSERT INTO memberships VALUES(?,?,'staff')").run(staff.user.user.id,other.id);
 assert.equal((await patch(staff.user.user.id,{disabled:true})).status,403);assert.ok(store.user(staff.session));
}));

test('existing users must prove their password; acceptance never resets or downgrades them',()=>fixture(async({store,request,other,invite,token,owner})=>{
 assert.equal((await invite('staff',other.email)).status,200);const t=token();
 const accept=p=>request('/api/invites/accept','','POST',{token:t,name:'Overwrite attempt',password:p});
 assert.equal((await accept('wrong-password-long')).status,403);assert.equal((await accept(password)).status,200);
 const user=await store.login(input('other'));assert.equal(user.user.name,'other');
 assert.equal(store.db.prepare('SELECT role FROM memberships WHERE user=? AND store=?').get(other.user.id,other.id).role,'owner');
 assert.equal(store.db.prepare('SELECT role FROM memberships WHERE user=? AND store=?').get(other.user.id,owner.id).role,'staff');
 assert.equal((await invite('owner',other.email)).status,409);
}));

test('mail delivery failure is sanitized and leaves no usable invitation',()=>fixture(async({store,invite})=>{
 const r=await invite();assert.equal(r.status,503);assert.ok(!JSON.stringify(await r.json()).includes('smtp-secret'));
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM invites').get().n,0);
},{mailFails:true}));

test('owner may manage another member store in their org, but managers cannot',()=>fixture(async({store,request,owner,other,invite})=>{
 // Build a second store in the same organisation without granting cross-org authority.
 store.db.prepare('UPDATE stores SET org=? WHERE id=?').run(owner.org,other.id);
 store.db.prepare("INSERT INTO memberships VALUES(?,?,'owner')").run(owner.user.id,other.id);
 assert.equal((await invite('manager','branch-manager@example.test',store.session(owner),other.id)).status,200);
 assert.equal((await request(`/api/staff?storeId=${other.id}`,store.session(owner))).status,200);
}));

test('acceptance is atomic under concurrent use and database failures',()=>fixture(async({store,request,invite,token})=>{
 await invite();const t=token(),body={token:t,name:'Concurrent',password};
 const responses=await Promise.all([request('/api/invites/accept','','POST',body),request('/api/invites/accept','','POST',body)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
 await invite('staff','rollback@example.test');const rollbackToken=token();
 store.db.exec("CREATE TRIGGER fail_staff BEFORE INSERT ON memberships WHEN NEW.role='staff' BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 assert.equal((await request('/api/invites/accept','','POST',{token:rollbackToken,name:'Rollback',password})).status,500);
 assert.equal(store.db.prepare("SELECT id FROM users WHERE email='rollback@example.test'").get(),undefined);
 assert.equal(store.db.prepare('SELECT acceptedAt FROM invites WHERE tokenHash=?').get(hash(rollbackToken)).acceptedAt,null);
 store.db.exec('DROP TRIGGER fail_staff');
 assert.equal((await request('/api/invites/accept','','POST',{token:rollbackToken,name:'Rollback',password})).status,200);
}));

test('mailer requires server configuration and sanitizes rejected recipients',async()=>{
 await assert.rejects(createMailer({smtpUrl:'',from:''})({to:'x@example.test'}),{status:503});
 await assert.rejects(createMailer({from:'Forme <from@example.test>',transport:{sendMail:async()=>({rejected:['x@example.test']})}})({to:'x@example.test'}),{status:503});
});
