import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {profiles,recommendProfile} from '../src/profiles.js';
import {standardAvatar,createApp} from '../server/app.js';
import {detectFaces} from '../server/face-check.js';
import {geminiBodyReference} from '../server/gemini-reference.js';
import {geminiAvatarPrompt} from '../server/avatar-prompt.js';
import {tryOnPrompt} from '../server/gemini-tryon.js';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {customerPhotos} from './helpers/customer-photos.js';
import {AccountStore} from '../server/accounts.js';
import os from 'node:os';import path from 'node:path';

test('female profiles keep stable male identifiers and validate body-specific measurements',()=>{
 assert.deepEqual(profiles.filter(p=>p.body==='male').map(p=>p.id),['slim','regular','athletic','broad']);
 assert.equal(recommendProfile(165,48,'female'),'f-slim');assert.equal(recommendProfile(165,62,'female'),'f-regular');assert.equal(recommendProfile(165,90,'female'),'f-curvy');
 assert.equal(recommendProfile(201,70,'female'),null);assert.equal(recommendProfile(201,70,'male'),'slim');
 assert.equal(recommendProfile(165,60,'unknown'),null);
 assert.match(geminiAvatarPrompt('f-regular',{heightCm:165,weightKg:62}),/grey crew-neck T-shirt/);
 for(const type of ['dress','skirt','saree','lehenga','blouse'])assert.match(tryOnPrompt(type),/Preserve exactly/);
});
test('each female asset has one face and produces a valid anatomy reference',async()=>{
 const face=await readFile(customerPhotos[0].face);
 for(const p of profiles.filter(p=>p.body==='female')){
  const image=await standardAvatar(p.id),meta=await sharp(image).metadata();
  assert.equal(meta.width,384);assert.equal(meta.height,942);
  assert.equal((await detectFaces(image,{upper:true})).length,1);
  const ref=await geminiBodyReference(image,p.id,face);assert.ok(ref.length>1000);
 }
});
test('female avatars save body type and existing male avatars remain male',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'forme-female-'));const store=new AccountStore(dir);
 try { const account=await store.register({email:'female@example.test',name:'Studio',password:'test-password-long'});
 for(const profileId of ['regular','f-regular'])await store.save(account,{image:'data:image/png;base64,'+(await standardAvatar(profileId)).toString('base64'),profileId,name:profileId,heightCm:165,weightKg:62,source:'imported'});
 const rows=store.list(account);assert.equal(rows.find(x=>x.profileId==='f-regular').bodyType,'female');assert.equal(rows.find(x=>x.profileId==='regular').bodyType,'male');
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('female rollout is opt-in and female garment routes enforce the chosen library',async()=>{
 for(const enabled of [false,true]){
  let calls=0;const server=createApp({femaleEnabled:enabled,accessMode:'public',apiKey:'test',rateLimit:false,tryOn:async()=>{calls++;return 'data:image/png;base64,test';}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  try {const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.supportedBodies.includes('female'),enabled);
   const image='data:image/png;base64,'+(await standardAvatar('f-regular')).toString('base64');
   const input={avatar:image,garment:image,garmentType:'dress',consent:true,consentScope:'avatar-and-garment',consentProvider:'gemini'};
   const post=body=>fetch(base+'/api/tryon',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal((await post({...input,bodyType:'male'})).status,400);
   assert.equal((await post({...input,bodyType:'female'})).status,enabled?200:400);
   assert.equal(calls,enabled?1:0);
  }finally{await new Promise(r=>server.close(r));}
 }
});
