import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountStore } from "../server/accounts.js";
import { createApp, standardAvatar } from "../server/app.js";
import { customerPhotos } from "./helpers/customer-photos.js";

async function fixture(run) {
 const directory=await mkdtemp(path.join(os.tmpdir(),"forme-accounts-"));
 const store=new AccountStore(directory);
 let calls=0;
 const server=createApp({accountStore:store,accessMode:"public",rateLimit:false,apiKey:"test",personalize:async()=>{calls++;return `data:image/png;base64,${(await standardAvatar("regular")).toString("base64")}`;}}).listen(0,"127.0.0.1");
 await new Promise(r=>server.once("listening",r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method="GET",body,cookie="",origin=base)=>fetch(base+url,{method,headers:{"Content-Type":"application/json",Origin:origin,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
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
