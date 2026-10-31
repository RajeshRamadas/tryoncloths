import {randomUUID} from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountStore } from "./helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../server/app.js";
import { customerPhotos } from "./helpers/customer-photos.js";

async function fixture(run) {
 const directory=await mkdtemp(path.join(os.tmpdir(),"forme-accounts-"));
 const store=new AccountStore(directory);
 let calls=0;
 const server=createApp({accountStore:store,accessMode:"public",rateLimit:false,apiKey:"test",personalize:async()=>{calls++;return `data:image/png;base64,${(await standardAvatar("regular")).toString("base64")}`;}}).listen(0,"127.0.0.1");
 await new Promise(r=>server.once("listening",r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method="GET",body,cookie="",origin=base)=>fetch(base+url,{method,headers:{"Content-Type":"application/json",Origin:origin,Cookie:cookie},...(body?{body:JSON.stringify(url==="/api/personalize"?{requestId:randomUUID(),...body}:body)}:{})});
 try{await run({store,request,directory,base,calls:()=>calls});}finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}
const credentials=email=>({email,password:"long-test-password-only",name:email.split("@")[0]});
const cookie=r=>r.headers.get("set-cookie").split(";")[0];
const avatar=async()=>({image:`data:image/png;base64,${(await standardAvatar("regular")).toString("base64")}`,name:"Customer one",profileId:"regular",heightCm:175,weightKg:72,source:"imported",storageConsent:true});

test("account avatars are isolated, survive database reopen, and sign-in works from another session",async()=>fixture(async({request,store,directory})=>{
 const a=await request("/api/account/register","POST",credentials("store-a@example.com"));assert.equal(a.status,200);const ca=cookie(a);
 assert.match(a.headers.get("set-cookie"),/HttpOnly/);assert.match(a.headers.get("set-cookie"),/SameSite=Strict/);
 const b=await request("/api/account/register","POST",credentials("store-b@example.com"));const cb=cookie(b);
 const saved=await request("/api/avatars","POST",await avatar(),ca);assert.equal(saved.status,200);const {id}=await saved.json();
 assert.equal((await request("/api/avatars")).status,401);
 assert.equal((await request(`/api/avatars/${id}/image`)).status,401);
 assert.equal((await request("/api/avatars","GET",undefined,cb)).status,200);
 assert.equal((await (await request("/api/avatars","GET",undefined,cb)).json()).avatars.length,0);
 assert.equal((await request(`/api/avatars/${id}/image`,"GET",undefined,cb)).status,404);
 assert.equal((await request(`/api/avatars/${id}`,"DELETE",undefined,cb)).status,404);
 const login=await request("/api/account/login","POST",credentials("store-a@example.com"));const second=cookie(login);
 assert.notEqual(second,ca);assert.equal((await request(`/api/avatars/${id}/image`,"GET",undefined,second)).status,200);
 // A new store object emulates another process/restart against the persisted volume.
 const reopened=new AccountStore(directory);try{const user=reopened.user(second.split("=")[1]);assert.equal(reopened.list(user).length,1);}finally{reopened.close();}
 await request("/api/account/logout","POST",{},ca);
 assert.equal((await request("/api/avatars","GET",undefined,ca)).status,401);
 assert.equal((await request("/api/avatars","GET",undefined,second)).status,200);
 const rows=store.db.prepare("SELECT * FROM accounts").all();assert.notEqual(Buffer.from(rows[0].password).toString(),credentials("").password);
 assert.equal((await request(`/api/avatars/${id}`,"DELETE",undefined,second)).status,200);
 assert.equal((await (await request("/api/avatars","GET",undefined,second)).json()).avatars.length,0);
}));

test("account mutations require same-origin and consent; passwords and expired sessions are checked",async()=>fixture(async({request,store})=>{
 assert.equal((await request("/api/account/register","POST",credentials("test@example.com"),"","https://evil.example")).status,403);
 assert.equal((await request("/api/account/register","POST",{...credentials("test@example.com"),password:"short"})).status,400);
 const registered=await request("/api/account/register","POST",credentials("test@example.com"));const c=cookie(registered);
 assert.equal((await request("/api/account/login","POST",{email:"test@example.com",password:"wrong"})).status,401);
 assert.equal((await request("/api/avatars","POST",{...await avatar(),storageConsent:false},c)).status,400);
 assert.equal((await request("/api/avatars","POST",await avatar(),c,"https://evil.example")).status,403);
 assert.equal((await request("/api/avatars","POST",{...await avatar(),image:"data:image/png;base64,ZmFrZQ=="},c)).status,400);
 store.db.prepare("UPDATE sessions SET expires=0").run();assert.equal((await request("/api/avatars","GET",undefined,c)).status,401);
}));

test("generation is saved to the requesting account without original photos or a second provider call",async()=>fixture(async({request,store,calls})=>{
 const face=`data:image/jpeg;base64,${(await readFile(customerPhotos[0].face)).toString("base64")}`;
 const body=`data:image/jpeg;base64,${(await readFile(customerPhotos[0].body)).toString("base64")}`;
 const input={face,body,profileId:"regular",measurements:{heightCm:175,weightKg:72},consent:true,consentScope:"face-and-body",consentProvider:"gemini",avatarName:"Customer from generation"};
 assert.equal((await request("/api/personalize","POST",input)).status,401);
 const c=cookie(await request("/api/account/register","POST",credentials("studio@example.com")));
 assert.equal((await request("/api/personalize","POST",input,c)).status,400);
 const r=await request("/api/personalize","POST",{...input,accountStorageConsent:true},c);assert.equal(r.status,200);assert.equal((await r.json()).accountSaved,true);
 const list=(await (await request("/api/avatars","GET",undefined,c)).json()).avatars;assert.equal(list.length,1);assert.equal(list[0].name,input.avatarName);assert.equal(list[0].source,"generated");
 const columns=store.db.prepare("PRAGMA table_info(avatars)").all().map(c=>c.name);assert.ok(!columns.includes("face"));assert.ok(!columns.includes("body"));
 store.save=async()=>{throw new Error("disk full");};
 const failure=await request("/api/personalize","POST",{...input,accountStorageConsent:true},c);const result=await failure.json();assert.equal(failure.status,200);assert.equal(result.accountSaved,false);assert.match(result.image,/^data:image\/png/);assert.match(result.accountSaveError,/do not regenerate/);assert.equal(calls(),2,"one provider call per explicit request, even when saving fails");
}));

test("admin password recovery revokes all previous sessions",async()=>fixture(async({request,store})=>{
 const c=cookie(await request("/api/account/register","POST",credentials("reset@example.com")));
 await store.resetPassword("reset@example.com","replacement-password-long");
 assert.equal((await request("/api/avatars","GET",undefined,c)).status,401);
 assert.equal((await request("/api/account/login","POST",credentials("reset@example.com"))).status,401);
 assert.equal((await request("/api/account/login","POST",{email:"reset@example.com",password:"replacement-password-long"})).status,200);
}));

test("saved looks remain owned by their avatar account and persist across reopen",async()=>fixture(async({request,store,directory})=>{
 const ca=cookie(await request("/api/account/register","POST",credentials("looks-a@example.com")));
 const cb=cookie(await request("/api/account/register","POST",credentials("looks-b@example.com")));
 const image=await avatar();const {id:avatarId}=await (await request("/api/avatars","POST",image,ca)).json();
 const input={avatarId,image:image.image,name:"Blue outfit",garments:["Blue shirt","Jeans"],storageConsent:true};
 assert.equal((await request("/api/looks","POST",input)).status,401);
 assert.equal((await request("/api/looks","POST",input,cb)).status,404);
 assert.equal((await request("/api/looks","POST",{...input,storageConsent:false},ca)).status,400);
 assert.equal((await request("/api/looks","POST",input,ca,"https://evil.example")).status,403);
 const saved=await request("/api/looks","POST",input,ca);assert.equal(saved.status,200);const {id}=await saved.json();
 assert.equal((await request(`/api/looks?avatar=${avatarId}`,"GET",undefined,cb)).status,404);
 assert.equal((await request(`/api/looks/${id}/image`,"GET",undefined,cb)).status,404);
 assert.equal((await request(`/api/looks/${id}`,"DELETE",undefined,cb)).status,404);
 assert.equal((await (await request("/api/looks","GET",undefined,cb)).json()).looks.length,0);
 const second=cookie(await request("/api/account/login","POST",credentials("looks-a@example.com")));
 assert.equal((await request(`/api/looks/${id}/image`,"GET",undefined,second)).status,200);
 const reopened=new AccountStore(directory);try{const owner=reopened.user(second.split("=")[1]);assert.equal(reopened.listLooks(owner,avatarId)[0].name,"Blue outfit");assert.equal(reopened.list(owner)[0].looksCount,1);}finally{reopened.close();}
 // Duplicates update metadata, never create another copy.
 await request("/api/looks","POST",{...input,name:"Updated outfit"},ca);
 assert.equal((await (await request("/api/looks","GET",undefined,ca)).json()).looks.length,1);
 assert.equal((await request(`/api/looks/${id}`,"DELETE",undefined,ca)).status,200);
 assert.equal((await request(`/api/looks/${id}/image`,"GET",undefined,ca)).status,404);
 await request("/api/looks","POST",input,ca);
 await request(`/api/avatars/${avatarId}`,"DELETE",undefined,ca);
 assert.equal((await (await request("/api/looks","GET",undefined,ca)).json()).looks.length,0);
}));

test("look validation, capacity, account cascade and old database upgrade",async()=>fixture(async({store,request,directory})=>{
 const c=cookie(await request("/api/account/register","POST",credentials("look-limits@example.com")));
 const owner=store.user(c.split("=")[1]);const image=await avatar();const {id:avatarId}=await store.save(owner,image);
 // Simulate a pre-feature database: avatar data must survive adding the table.
 store.db.exec("DROP TABLE looks");const upgraded=new AccountStore(directory);upgraded.close();assert.equal(store.list(owner).length,1);
 const input={avatarId,image:image.image,name:"Look",garments:["Shirt"]};
 await assert.rejects(store.saveLook(owner,{...input,garments:Array(11).fill("Shirt")}),{status:400});
 await assert.rejects(store.saveLook(owner,{...input,image:"data:image/png;base64,ZmFrZQ=="}),{status:400});
 const {id}=await store.saveLook(owner,input);
 const insert=store.db.prepare("INSERT INTO looks(id,account,avatarId,name,garments,image,thumbnail,savedAt) SELECT ?,account,avatarId,name,garments,image,thumbnail,savedAt FROM looks WHERE account=? AND id=?");
 for(let i=0;i<199;i++)insert.run(`copy-${i}`,owner.id,id);
 await store.saveLook(owner,{...input,name:"Renamed at limit"});
 store.db.prepare("UPDATE looks SET id='different-id' WHERE id=? AND account=?").run(id,owner.id);
 await assert.rejects(store.saveLook(owner,input),{status:409});
 store.db.prepare("DELETE FROM accounts WHERE id=?").run(owner.id);
 assert.equal(store.db.prepare("SELECT count(*) AS total FROM looks").get().total,0);
}));
