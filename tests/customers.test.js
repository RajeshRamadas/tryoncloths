import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AccountStore} from './helpers/pilot-accounts.js';
import {normalizePhone} from '../server/customers.js';
import {createApp,standardAvatar} from '../server/app.js';
import {customerPhotos} from './helpers/customer-photos.js';

async function fixture(run){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-customers-')),store=new AccountStore(directory);
 const a=await store.register({email:'a@example.test',name:'Store A',password:'test-password-long'}),b=await store.register({email:'b@example.test',name:'Store B',password:'test-password-long'});
 const ca=`forme_session=${store.session(a)}`,cb=`forme_session=${store.session(b)}`;let calls=0,onGenerate=()=>{};
 const image=`data:image/png;base64,${(await standardAvatar('regular')).toString('base64')}`;
 const server=createApp({accountStore:store,accessMode:'public',rateLimit:false,apiKey:'test',personalize:async()=>{calls++;onGenerate();return image;}}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method='GET',body,cookie=ca,origin=base)=>fetch(base+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{await run({store,a,b,ca,cb,directory,request,image,calls:()=>calls,onGenerate:fn=>{onGenerate=fn;}});}finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}
const input={name:'Asha',phoneE164:'98765 43210'};
const avatar=(image,customerId)=>({image,customerId,name:'Asha avatar',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});

test('mobile normalization accepts local Indian and explicit international numbers, rejects malformed input',()=>{
 for(const value of ['9876543210','09876543210','91 98765 43210','+91 (98765) 43210'])assert.equal(normalizePhone(value),'+919876543210');
 assert.equal(normalizePhone('+1 (415) 555-0123'),'+14155550123');
 for(const value of ['',null,'123','+01234567890','1234567890123456','9876543210 ext 1','++919876543210',{}])assert.throws(()=>normalizePhone(value),{status:400});
});

test('customer CRUD normalizes numbers, prevents same-store duplicates and isolates lookup, editing and erasure',async()=>fixture(async({request,cb,a,b,store,directory})=>{
 const created=await request('/api/customers','POST',input);assert.equal(created.status,201);const customer=(await created.json()).customer;
 assert.equal(customer.phoneE164,'+919876543210');assert.equal(customer.marketingOptIn,false);
 assert.equal((await request('/api/customers','POST',{...input,phoneE164:'+919876543210'})).status,409);
 const other=(await (await request('/api/customers','POST',{...input,name:'Other store customer'},cb)).json()).customer;
 assert.notEqual(other.id,customer.id);
 for(const [method,body] of [['GET',undefined],['PATCH',{name:'Stolen'}],['DELETE',undefined]])assert.equal((await request(`/api/customers/${customer.id}`,method,body,cb)).status,404);
 for(const phone of ['987','9876543210','+91 98765 43210']){
  const rows=(await (await request(`/api/customers/search?phone=${encodeURIComponent(phone)}`)).json()).customers;
  assert.deepEqual(rows.map(c=>c.id),[customer.id]);
 }
 assert.equal((await (await request('/api/customers/search?phone=765')).json()).customers.length,0,'prefix only');
 assert.equal((await request('/api/customers/search?phone=98')).status,400);
 const short=store.customers.save(a,{name:'International',phoneE164:'+3545551234'});
 assert.equal(store.customers.list(a,'354555')[0].id,short.id);
 assert.equal((await request('/api/customers/search?phone=%25')).status,400);
 const updated=(await (await request(`/api/customers/${customer.id}`,'PATCH',{name:'Asha updated',notes:'Prefers blue',measurements:{heightCm:164,weightKg:62},store:b.id})).json()).customer;
 assert.equal(updated.store,a.id);assert.equal(updated.measurements.heightCm,164);
 const reopened=new AccountStore(directory);try{assert.equal(reopened.customers.get(a,customer.id).notes,'Prefers blue');}finally{reopened.close();}
 assert.match(store.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM customers WHERE store=? AND phoneSearch>=? AND phoneSearch<?').get(a.id,'987','987:').detail,/customers_phone/);
}));

test('consent defaults off, has server timestamps, survives ordinary edits and clears on opt-out',async()=>fixture(async({store,a})=>{
 const c=store.customers.save(a,input);assert.equal(c.optInAt,null);assert.equal(c.optInSource,null);
 const opted=store.customers.save(a,{marketingOptIn:true,optInAt:1,optInSource:'in_store'},c.id);
 assert.ok(opted.optInAt>1);assert.equal(opted.optInSource,'in_store');
 const edited=store.customers.save(a,{notes:'New note'},c.id);assert.equal(edited.optInAt,opted.optInAt);
 const out=store.customers.save(a,{marketingOptIn:false},c.id);assert.equal(out.optInAt,null);assert.equal(out.optInSource,null);
 const whatsapp=store.customers.save(a,{marketingOptIn:true,optInSource:'whatsapp'},c.id);assert.equal(whatsapp.optInSource,'whatsapp');
 for(const patch of [{marketingOptIn:'yes'},{marketingOptIn:true,optInSource:'guessed'},{name:''},{name:{trim:'bad'}},{notes:'x'.repeat(2001)},{measurements:{heightCm:99,weightKg:72}}])assert.throws(()=>store.customers.save(a,patch,c.id),{status:400});
}));

test('all staff roles can manage customers, sessions and same-origin protect every mutation',async()=>fixture(async({store,a,request,ca})=>{
 assert.equal((await request('/api/customers','GET',undefined,'')).status,401);
 for(const role of ['owner','manager','staff']){
  store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,a.user.id,a.id);
  const result=await request('/api/customers','POST',{...input,phoneE164:role==='owner'?'9876543210':role==='manager'?'9876543211':'9876543212'});assert.equal(result.status,201);
  const c=(await result.json()).customer;
  for(const url of ['/api/customers','/api/customers/search?phone=987',`/api/customers/${c.id}`])assert.equal((await request(url)).status,200);
  for(const [url,method,body] of [['/api/customers','GET',undefined],['/api/customers/search?phone=987','GET',undefined],[`/api/customers/${c.id}`,'GET',undefined],['/api/customers','POST',input],[`/api/customers/${c.id}`,'PATCH',{name:'Unauthenticated'}],[`/api/customers/${c.id}`,'DELETE',undefined]])assert.equal((await request(url,method,body,'')).status,401);
  for(const [url,method,body] of [['/api/customers','POST',input],[`/api/customers/${c.id}`,'PATCH',{name:'Attack'}],[`/api/customers/${c.id}`,'DELETE',undefined]])assert.equal((await request(url,method,body,ca,'https://evil.example')).status,403);
  assert.equal((await request(`/api/customers/${c.id}`,'PATCH',{notes:role})).status,200);
  assert.equal((await request(`/api/customers/${c.id}`,'DELETE')).status,200);
 }
 store.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(a.user.id);assert.equal((await request('/api/customers')).status,401);
}));

test('customer avatar association cannot cross stores or move identical images between customers',async()=>fixture(async({store,a,b,image})=>{
 const c=store.customers.save(a,input),d=store.customers.save(a,{...input,phoneE164:'9876543211'}),outside=store.customers.save(b,input);
 await assert.rejects(store.save(a,avatar(image,outside.id)),{status:404});
 const av=await store.save(a,avatar(image,c.id)),other=await store.save(a,avatar(image,d.id)),unassigned=await store.save(a,avatar(image));
 assert.notEqual(av.id,other.id);assert.notEqual(av.id,unassigned.id);
 assert.equal((await store.save(a,{...avatar(image,c.id),name:'Renamed'})).id,av.id);
 assert.equal(store.list(a).find(x=>x.id===av.id).customerName,c.name);
 assert.throws(()=>store.db.prepare('UPDATE avatars SET customer=? WHERE account=? AND id=?').run(outside.id,a.id,av.id),/Customer does not belong/);
 const look={image,name:'Look',garments:['Shirt']};
 const l1=await store.saveLook(a,{...look,avatarId:av.id}),l2=await store.saveLook(a,{...look,avatarId:other.id});assert.notEqual(l1.id,l2.id);
 store.customers.remove(a,c.id);assert.equal(store.listLooks(a,other.id).length,1);assert.ok(store.image(a,unassigned.id));
}));

test('customer erasure cascades to avatars, looks, adaptations and share links while retaining catalogue and other stores',async()=>fixture(async({store,a,b,image,request})=>{
 const c=store.customers.save(a,input),other=store.customers.save(b,input);
 const av=await store.save(a,avatar(image,c.id)),avOther=await store.save(b,avatar(image,other.id));
 const look=await store.saveLook(a,{image,avatarId:av.id,name:'Look',garments:['Shirt']});
 store.db.prepare('INSERT INTO garments(account,id,name,garmentType,variant,sourceUrl,imageHash,signature,colour,image,thumbnail,savedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(a.id,'shirt','Shirt','top','','','hash','sig','blue',Buffer.from('png'),Buffer.from('png'),Date.now());
 store.db.prepare('INSERT INTO garment_results(account,id,avatarId,garmentId,image,savedAt) VALUES(?,?,?,?,?,?)').run(a.id,'adaptation',av.id,'shirt',Buffer.from('png'),Date.now());
 store.db.prepare('INSERT INTO share_links(tokenHash,store,look,expiresAt,createdBy) VALUES(?,?,?,?,?)').run('hash',a.id,look.id,Date.now()+10000,a.user.id);
 const deleted=await request(`/api/customers/${c.id}`,'DELETE');assert.equal(deleted.status,200);
 for(const [table,column] of [['customers','store'],['avatars','account'],['looks','account'],['garment_results','account'],['share_links','store']])assert.equal(store.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=?`).get(a.id).n,0,table);
 assert.ok(store.image(b,avOther.id));assert.equal(store.db.prepare('SELECT count(*) AS n FROM garments').get().n,1);
 assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal((await request(`/api/customers/${c.id}`,'DELETE')).status,404);
}));

test('customer deletion while decoding an avatar cannot resurrect saved customer images',async()=>fixture(async({store,a,image})=>{
 const c=store.customers.save(a,input);
 const pending=store.save(a,avatar(image,c.id));store.customers.remove(a,c.id);
 await assert.rejects(pending,{status:404});assert.equal(store.list(a).length,0);
}));

test('generation validates customer before provider charge, auto-links output, and retains paid output if customer is deleted in-flight',async()=>fixture(async({store,a,b,request,calls,onGenerate})=>{
 const c=store.customers.save(a,input),other=store.customers.save(b,input);
 const face=`data:image/jpeg;base64,${(await readFile(customerPhotos[0].face)).toString('base64')}`,body=`data:image/jpeg;base64,${(await readFile(customerPhotos[0].body)).toString('base64')}`;
 const payload=()=>({requestId:randomUUID(),face,body,profileId:'regular',measurements:{heightCm:175,weightKg:72},consent:true,consentScope:'face-and-body',consentProvider:'gemini',accountStorageConsent:true,customerId:c.id});
 assert.equal((await request('/api/personalize','POST',{...payload(),customerId:other.id})).status,404);assert.equal(calls(),0);
 const generated=await request('/api/personalize','POST',payload());assert.equal(generated.status,200);assert.equal((await generated.json()).accountSaved,true);assert.equal(store.list(a)[0].customerId,c.id);
 onGenerate(()=>store.customers.remove(a,c.id));
 const pending=await request('/api/personalize','POST',payload()),result=await pending.json();assert.equal(pending.status,200);assert.equal(result.accountSaved,false);assert.match(result.image,/^data:image\/png/);assert.equal(store.list(a).length,0);assert.equal(calls(),2);
}));


test('C6 upgrade preserves legacy avatars and is idempotent; customer lists paginate within the active store',async()=>fixture(async({store,a,directory,image})=>{
 const legacy=await store.save(a,avatar(image));
 store.db.exec('DROP TRIGGER avatars_customer_insert; DROP TRIGGER avatars_customer_update; DROP TRIGGER customers_erase; DROP TABLE share_links; DROP TABLE customers;');
 const upgraded=new AccountStore(directory);
 try {
  assert.ok(upgraded.image(a,legacy.id));assert.equal(upgraded.list(a)[0].customerId,null);
  for(let i=0;i<52;i++)upgraded.customers.save(a,{name:`Customer ${i}`,phoneE164:String(9876543200+i)});
  assert.equal(upgraded.customers.list(a).length,50);assert.equal(upgraded.customers.list(a,undefined,50).length,2);
  assert.equal(upgraded.customers.list(a,'987').length,50);assert.equal(upgraded.customers.list(a,'987',50).length,2);
  assert.throws(()=>upgraded.customers.list(a,undefined,-1),{status:400});
  assert.deepEqual(upgraded.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{upgraded.close();}
 const again=new AccountStore(directory);try{assert.equal(again.customers.list(a).length,50);assert.ok(again.image(a,legacy.id));}finally{again.close();}
}));
