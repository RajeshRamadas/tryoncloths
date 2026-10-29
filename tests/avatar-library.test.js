import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {avatarVariants,approximateSelection,templateLibrary} from '../src/profiles.js';
import {standardAvatar,createApp} from '../server/app.js';
import {detectFaces} from '../server/face-check.js';
import {geminiBodyReference} from '../server/gemini-reference.js';
import {customerPhotos} from './helpers/customer-photos.js';
import {AccountStore} from '../server/accounts.js';

test('48 unique templates retain default assets and validate selectors and measurement ranges',()=>{
 assert.equal(avatarVariants.length,48);assert.equal(new Set(avatarVariants.map(v=>v.id)).size,48);
 assert.equal(templateLibrary('male'),'/avatar-library.png');assert.equal(templateLibrary('female'),'/avatar-library-female.png');
 for(const value of ['../secret','',null,'MEDIUM'])assert.throws(()=>templateLibrary('male',value));
 assert.throws(()=>templateLibrary('unknown'));
 for(const body of ['male','female']){
  for(const [h,w] of [[140,35],[175,72],[179.5,74.8],[200,200]]){
   const result=approximateSelection(h,w,body);assert.ok(result);
   assert.ok(result.heightBand.min<=h && result.heightBand.max>=h);
   assert.ok(result.weightBand.min<=w && result.weightBand.max>=w);
  }
  for(const [h,w] of [[139,60],[175,201],[NaN,70],[175,34]])assert.equal(approximateSelection(h,w,body),null);
 }
 assert.equal(approximateSelection(210,72,'female'),null);assert.ok(approximateSelection(210,72,'male'));
 assert.equal(approximateSelection(165,48,'female').profileId,'f-slim');
 assert.equal(approximateSelection(175,95,'male').profileId,'broad');
});

test('all 48 complete crops have a detectable head and a valid customer anatomy reference',async()=>{
 const face=await readFile(customerPhotos[0].face);
 for(const variant of avatarVariants){
  const image=await standardAvatar(variant.profileId,variant.templateTone);
  const meta=await sharp(image).metadata();assert.equal(meta.width,384,variant.id);assert.equal(meta.height,942,variant.id);
  const [target]=await detectFaces(image,{upper:true,landmarks:true});assert.ok(target,variant.id);
  const ref=await geminiBodyReference(image,variant.profileId,face);
  const reference=await sharp(ref).metadata();assert.equal(reference.width/reference.height,2/3,variant.id);
  const faces=await detectFaces(ref,{upper:true,landmarks:true});assert.equal(faces.length,1,variant.id);
  for(const side of ["left","right"]){
   assert.ok(Math.abs(faces[0].eyes[side].x-154-target.eyes[side].x)<8,variant.id+" horizontal head alignment");
   assert.ok(Math.abs(faces[0].eyes[side].y-48-target.eyes[side].y)<8,variant.id+" vertical head alignment");
  }
 }
});

test('API selects the requested complexion and rejects unknown tones before any provider call',async()=>{
 let calls=0;const expected=await standardAvatar('regular','deep');
 const image='data:image/png;base64,'+expected.toString('base64');
 const server=createApp({accessMode:'public',apiKey:'test',rateLimit:false,personalize:async({avatar})=>{calls++;assert.deepEqual(avatar,expected);return image;}}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.templateVariantCount,48);assert.deepEqual(health.templateBodies,['male','female']);
  const input={face:image,body:image,profileId:'regular',templateTone:'deep',measurements:{heightCm:175,weightKg:72},consent:true,consentScope:'face-and-body',consentProvider:'gemini'};
  const post=body=>fetch(base+'/api/personalize',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({...input,templateTone:'../../secret'})).status,400);assert.equal(calls,0);
  const response=await post(input);assert.equal(response.status,200);assert.equal((await response.json()).templateTone,'deep');assert.equal(calls,1);
 }finally{await new Promise(r=>server.close(r));}
});

test('account tone metadata survives restart and legacy schema migrates without changing image bytes',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'forme-tones-'));let store=new AccountStore(dir);
 try{
  const account=await store.register({email:'tones@example.test',name:'Studio',password:'test-password-long'});
  const image='data:image/png;base64,'+(await standardAvatar('f-regular','very-deep')).toString('base64');
  const input={image,profileId:'f-regular',templateTone:'very-deep',name:'Customer',heightCm:165,weightKg:62,source:'imported'};
  await store.save(account,input);assert.equal(store.list(account)[0].templateTone,'very-deep');
  await assert.rejects(store.save(account,{...input,templateTone:'invalid'}));
  const before=store.db.prepare('SELECT image FROM avatars').get().image;
  store.close();store=new AccountStore(dir);assert.equal(store.list(account)[0].templateTone,'very-deep');
  store.db.exec('ALTER TABLE avatars DROP COLUMN template_tone');store.close();store=new AccountStore(dir);
  assert.equal(store.list(account)[0].templateTone,'medium');assert.deepEqual(store.db.prepare('SELECT image FROM avatars').get().image,before);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
