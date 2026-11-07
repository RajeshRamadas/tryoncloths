import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {shopifyFixture,publicStudio} from './helpers/shopify-shopper.js';
import {ShopperSessions,canonicalIp,SESSION_MS} from '../server/shopper-sessions.js';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../server/app.js';
import {shopperInputs,shopperPhoto} from '../server/shopper-photos.js';
import {geminiTryOn} from '../server/gemini-tryon.js';

const fixture=run=>async()=>{
  let sessions,faceFailure=false,inputRejected=false,outputRejected=false,verificationInvalid=false;const checks=[],captchas=[];
  const f=await shopifyFixture({sessionOptions:{enabled:true,consentRevision:'reviewed-test-v1',faceCheck:async()=>{if(faceFailure)throw new Error('faces');},visibleCheck:async()=>{if(faceFailure)throw new Error('faces');},
    captcha:{id:'test-captcha',verify:async input=>{captchas.push(input);return {success:!verificationInvalid,action:input.action,hostname:'studio.example.test',issuedAt:new Date(sessions.now()).toISOString()};}},
    moderation:{id:'test-moderation',check:async input=>{checks.push(input);return {allowed:!(input.stage==='input'?inputRejected:outputRejected),policy:'adult-own-photo-v1'};}}}});
  sessions=f.app.locals.shopperSessions;await f.install();const item=await f.product();await f.enable(item);
  const png=await sharp({create:{width:192,height:288,channels:3,background:'#886644'}}).png().toBuffer(),image='data:image/png;base64,'+png.toString('base64');
  const open=(deviceCookie,ip='203.0.113.5',previousToken)=>{const url=new URL(f.service.launch(f.proxy({launch_nonce:randomBytes(16).toString('hex')})));return sessions.create({ticket:url.hash.slice(8),deviceCookie,ip,previousToken});};
  const auth=created=>({sessionToken:created.raw,deviceCookie:created.deviceCookie,csrf:created.data.csrf});
  const authorize=async(current,action='avatar')=>{const c=sessions.consent(current,{action,provider:'gemini',revision:'reviewed-test-v1',adult:true,ownPhotos:true,accepted:true});const challenge=await sessions.challenge(current,{action,consent:c.consent,token:randomUUID()},'203.0.113.5');return {requestId:randomUUID(),action,consent:c.consent,proof:challenge.proof,images:action==='avatar'?{face:image,body:image}:{avatar:image}};};
  try{await run({...f,sessions,item,png,image,open,auth,authorize,checks,captchas,
    faceFailure:v=>{faceFailure=v;},inputRejected:v=>{inputRejected=v;},outputRejected:v=>{outputRejected=v;},verificationInvalid:v=>{verificationInvalid=v;}});}finally{await f.close();}
};

test('shopper sessions consume launch tickets once, expire absolutely and never accept staff cookies, forged device ids or CSRF proofs',fixture(async f=>{
  const started=f.open(),auth=f.auth(started),read=f.sessions.read(auth);assert.equal(read.expiresAt-read.createdAt,SESSION_MS);assert.equal(read.shopperGenerationAvailable,false);assert.equal(read.brand.displayName,'River Clothing');assert.ok(!JSON.stringify(read).includes(f.a.id));
  assert.throws(()=>f.sessions.auth({...auth,csrf:'wrong'}),{status:403});assert.throws(()=>f.sessions.auth({...auth,deviceCookie:'forged'}),{status:403});
  assert.throws(()=>f.sessions.auth({sessionToken:f.staffToken,csrf:auth.csrf,deviceCookie:auth.deviceCookie}),{status:401});
  f.advance(20*60000);assert.equal(f.sessions.read(auth).expiresAt,read.expiresAt);f.advance(10*60000);assert.throws(()=>f.sessions.read(auth),{status:410});
  assert.equal(f.ai(),0);assert.equal(f.store.billing.balance(f.a.org),1000);
}));

test('session creation enforces rolling 2/device and 10/IP limits without trusting forwarded client headers',fixture(async f=>{
  const one=f.open(),two=f.open(one.deviceCookie);assert.throws(()=>f.open(one.deviceCookie),{status:429});
  for(let i=0;i<8;i++)f.open(undefined);assert.throws(()=>f.open(undefined),{status:429});
  f.sessions.end(f.auth(one));assert.throws(()=>f.open(one.deviceCookie),{status:429});
  f.advance(3600001);assert.ok(f.open(one.deviceCookie));
  const req={socket:{remoteAddress:'::ffff:127.0.0.1'},get:()=> '203.0.113.99'};assert.equal(f.sessions.ip(req),'127.0.0.1');
  const locked=new ShopperSessions(f.service,{enabled:true,trustProxy:1,trustedProxies:'172.18.0.0/16'});
  assert.throws(()=>locked.ip(req),{status:403});assert.equal(locked.ip({socket:{remoteAddress:'172.18.0.2'},get:()=> '203.0.113.9'}),'203.0.113.9');
  assert.throws(()=>locked.ip({socket:{remoteAddress:'172.18.0.2'},get:()=> '1.1.1.1, 2.2.2.2'}),{status:403});
  assert.throws(()=>new ShopperSessions(f.service,{enabled:true,trustProxy:1}).ready(),{status:503});
  assert.equal(canonicalIp('2001:0DB8:0000:0000:0000:0000:0000:0001'),'2001:db8::1');
  void two;
}));

test('anonymous sessions cannot borrow another session’s device, CSRF, consent or approval',fixture(async f=>{
  const one=f.open(),two=f.open(),first=f.auth(one),second=f.auth(two);
  assert.throws(()=>f.sessions.auth({...first,deviceCookie:second.deviceCookie}),{status:403});assert.throws(()=>f.sessions.auth({...second,csrf:first.csrf}),{status:403});assert.throws(()=>f.sessions.auth({...first,csrf:'é'.repeat(43)}),{status:403});
  const consent=f.sessions.consent(first,{action:'avatar',provider:'gemini',revision:'reviewed-test-v1',adult:true,ownPhotos:true,accepted:true});
  await assert.rejects(f.sessions.challenge(second,{action:'avatar',consent:consent.consent,token:'other-session'},'203.0.113.5'),{code:'shopper_consent_required'});
  const result=await f.sessions.run(first,await f.authorize(first),async()=>f.image,{ip:'203.0.113.5'});
  assert.throws(()=>f.sessions.approve(second,{approved:true,approval:result.approval}),{status:403});
}));

test('a new launch supersedes the previous session; pause, product changes and uninstall revoke existing sessions',fixture(async f=>{
  const one=f.open(),two=f.open(one.deviceCookie,'203.0.113.5',one.raw);assert.throws(()=>f.sessions.read(f.auth(one)),{status:410});assert.ok(f.sessions.read(f.auth(two)));
  f.store.shoppers.update(f.a,{action:'pause'});assert.throws(()=>f.sessions.read(f.auth(two)),{status:410});
  f.configure();const three=f.open(undefined,'203.0.113.8');assert.equal((await f.webhook('products/update',{id:123})).status,200);assert.throws(()=>f.sessions.read(f.auth(three)),{status:410});
  await f.enable(f.item);const four=f.open(undefined,'203.0.113.9');await f.webhook('app/uninstalled');assert.throws(()=>f.sessions.read(f.auth(four)),{status:410});
}));

test('reviewed purpose/provider consent and fresh CAPTCHA are required, scoped, single-use and unavailable checks fail closed',fixture(async f=>{
  const created=f.open(),auth=f.auth(created);
  assert.throws(()=>f.sessions.consent(auth,{action:'avatar',provider:'gemini',revision:'wrong',adult:true,ownPhotos:true,accepted:true}),{status:400});
  assert.throws(()=>f.sessions.consent(auth,{action:'avatar',provider:'openai',revision:'reviewed-test-v1',adult:true,ownPhotos:true,accepted:true}),{status:400});
  const c=f.sessions.consent(auth,{action:'avatar',provider:'gemini',revision:'reviewed-test-v1',adult:true,ownPhotos:true,accepted:true});
  f.verificationInvalid(true);await assert.rejects(f.sessions.challenge(auth,{action:'avatar',consent:c.consent,token:'bad-token'},'203.0.113.5'),{status:403});
  f.verificationInvalid(false);await assert.rejects(f.sessions.challenge(auth,{action:'avatar',consent:c.consent,token:'bad-token'},'203.0.113.5'),{code:'shopper_challenge_replayed'});
  f.sessions.captcha=null;assert.throws(()=>f.sessions.consent(auth,{action:'avatar'}),{status:503});assert.equal(f.checks.length,0);assert.equal(f.store.billing.balance(f.a.org),1000);
}));

test('guarded avatar and two try-ons use consent/proofs once, verify the exact approved avatar and keep photos out of persistent/session records',fixture(async f=>{
  const created=f.open(),auth=f.auth(created),request=await f.authorize(auth);let calls=0;
  const result=await f.sessions.run(auth,request,async({images,signal})=>{calls++;assert.ok(Buffer.isBuffer(images.face));assert.equal((await sharp(images.face).metadata()).exif,undefined);assert.equal(signal.aborted,false);return f.image;},{ip:'203.0.113.5'});
  assert.equal(calls,1);assert.equal(f.checks.length,2);assert.equal(f.store.billing.balance(f.a.org),999);assert.ok(result.approval);
  await assert.rejects(f.sessions.run(auth,request,async()=>{calls++;return f.image;},{ip:'203.0.113.5'}),{code:'duplicate_request'});assert.equal(calls,1);
  assert.throws(()=>f.sessions.consent(auth,{action:'tryon',provider:'gemini',revision:'reviewed-test-v1',adult:true,ownPhotos:true,accepted:true}),{code:'shopper_review_required'});
  f.sessions.approve(auth,{approved:true,approval:result.approval});
  for(let i=0;i<2;i++){const attempt=await f.authorize(auth,'tryon');attempt.images.avatar=result.image;await f.sessions.run(auth,attempt,async({images,context})=>{assert.equal(context.garmentId,f.item.id);assert.ok(Buffer.isBuffer(images.garment));calls++;return f.image;},{ip:'203.0.113.5'});}
  assert.equal(calls,3);assert.equal(f.store.billing.balance(f.a.org),997);assert.equal(f.sessions.read(auth).attemptsRemaining,0);
  const attempt=await f.authorize(auth,'tryon');attempt.images.avatar=result.image;await assert.rejects(f.sessions.run(auth,attempt,async()=>{calls++;return f.image;},{ip:'203.0.113.5'}),{status:429});assert.equal(calls,3);
  const stateRows=JSON.stringify(f.state.db.prepare('SELECT kind,key,value FROM shopper_state').all());assert.ok(!stateRows.includes('data:image'));assert.ok(!stateRows.includes(f.image));
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM avatars').get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM customers').get().n,0);
  f.sessions.end(auth);assert.equal(f.state.db.prepare("SELECT count(*) n FROM shopper_state WHERE kind IN ('session','consent','proof','attempt')").get().n,0);
}));

test('output rejection and provider failure refund credits while preserving attempt consumption, and no automatic retry occurs',fixture(async f=>{
  const auth=f.auth(f.open());let calls=0;f.outputRejected(true);
  await assert.rejects(f.sessions.run(auth,await f.authorize(auth),async()=>{calls++;return f.image;},{ip:'203.0.113.5'}),{code:'shopper_image_rejected'});
  f.outputRejected(false);await assert.rejects(f.sessions.run(auth,await f.authorize(auth),async()=>{calls++;throw new Error('secret provider response');},{ip:'203.0.113.5'}),e=>e.code==='shopper_image_failed'&&!e.message.includes('secret'));
  assert.equal(calls,2);assert.equal(f.store.billing.balance(f.a.org),1000);assert.equal(f.store.shoppers.view(f.a).store.dispatched,2);assert.equal(f.store.shoppers.view(f.a).store.held,0);
  assert.equal(f.sessions.read(auth).attemptsRemaining,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM image_call_leases').get().n,0);
}));

test('bad photos, unsafe inputs, expired verification and moderation outages cannot trigger a generation or debit AI credits',fixture(async f=>{
  const auth=f.auth(f.open());let calls=0;const work=async()=>{calls++;return f.image;};
  f.faceFailure(true);await assert.rejects(f.sessions.run(auth,await f.authorize(auth),work,{ip:'203.0.113.5'}),{code:'shopper_photo_invalid'});assert.equal(f.checks.length,0);
  f.faceFailure(false);f.inputRejected(true);await assert.rejects(f.sessions.run(auth,await f.authorize(auth),work,{ip:'203.0.113.5'}),{code:'shopper_image_rejected'});
  f.inputRejected(false);const late=await f.authorize(auth);f.advance(120001);await assert.rejects(f.sessions.run(auth,late,work,{ip:'203.0.113.5'}),{code:'shopper_consent_required'});
  f.sessions.moderation={id:'test-moderation',check:async()=>{throw new Error('private-service-key');}};
  await assert.rejects(f.sessions.run(auth,await f.authorize(auth),work,{ip:'203.0.113.5'}),e=>e.code==='shopper_checks_unavailable'&&!e.message.includes('private'));
  assert.equal(calls,0);assert.equal(f.store.billing.balance(f.a.org),1000);assert.equal(f.store.shoppers.view(f.a).store.dispatched,0);
}));

test('ending a session or changing the store aborts in-flight work, discards late output and refunds once',fixture(async f=>{
  const auth=f.auth(f.open()),request=await f.authorize(auth);let entered,release,signal;
  const started=new Promise(r=>{entered=r;}),blocked=new Promise(r=>{release=r;});
  const running=f.sessions.run(auth,request,async input=>{signal=input.signal;entered();await blocked;return f.image;},{ip:'203.0.113.5'});
  await started;f.sessions.end(auth);await assert.rejects(running,{code:'shopper_session_ended'});assert.equal(signal.aborted,true);release();
  assert.equal(f.store.billing.balance(f.a.org),1000);assert.equal(f.store.shoppers.view(f.a).store.dispatched,1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM image_call_leases').get().n,0);
  assert.throws(()=>f.sessions.read(auth),{status:410});
}));

test('another worker’s revocation is observed during generation and preserves billed-failure attempt limits',fixture(async f=>{
  const auth=f.auth(f.open()),input=await f.authorize(auth);let started,release,signal;const ready=new Promise(r=>{started=r;}),blocked=new Promise(r=>{release=r;});
  const running=f.sessions.run(auth,input,async data=>{signal=data.signal;started();await blocked;return f.image;},{ip:'203.0.113.5'});
  const rejected=assert.rejects(running,{status:410});try{await ready;const other=new ShopperSessions(f.service,{enabled:true,now:f.sessions.now});other.end(auth);await rejected;assert.equal(signal.aborted,true);}finally{release();}
  assert.equal(f.store.billing.balance(f.a.org),1000);assert.equal(f.store.shoppers.view(f.a).store.dispatched,1);
}));

test('12/IP generation attempts span devices and ending a session does not restore its device allowance',fixture(async f=>{
  for(let i=0;i<4;i++){
    const created=f.open(),auth=f.auth(created),avatar=await f.sessions.run(auth,await f.authorize(auth),async()=>f.image,{ip:'203.0.113.5'});f.sessions.approve(auth,{approved:true,approval:avatar.approval});
    for(let j=0;j<2;j++){const request=await f.authorize(auth,'tryon');request.images.avatar=avatar.image;await f.sessions.run(auth,request,async()=>f.image,{ip:'203.0.113.5'});}f.sessions.end(auth);
  }
  const auth=f.auth(f.open());await assert.rejects(f.sessions.run(auth,await f.authorize(auth),async()=>{throw new Error('Must not dispatch');},{ip:'203.0.113.5'}),{status:429});
  assert.equal(f.store.shoppers.view(f.a).store.dispatched,12);assert.equal(f.store.billing.balance(f.a.org),988);
}));

test('ending a session cancels an in-flight CAPTCHA verification without issuing a reusable proof',fixture(async f=>{
  const auth=f.auth(f.open()),consent=f.sessions.consent(auth,{action:'avatar',provider:'gemini',revision:'reviewed-test-v1',adult:true,ownPhotos:true,accepted:true});let entered,release,signal;const ready=new Promise(r=>{entered=r;}),blocked=new Promise(r=>{release=r;});
  f.sessions.captcha.verify=async input=>{signal=input.signal;entered();await blocked;return {success:true,action:'avatar',hostname:'studio.example.test',issuedAt:new Date(f.sessions.now()).toISOString()};};
  const running=f.sessions.challenge(auth,{action:'avatar',consent:consent.consent,token:'cancel-verification'},'203.0.113.5'),rejected=assert.rejects(running,{status:410});
  try{await ready;f.sessions.end(auth);await rejected;assert.equal(signal.aborted,true);assert.equal(f.state.db.prepare("SELECT count(*) n FROM shopper_state WHERE kind='proof'").get().n,0);}finally{release();}
}));

test('HTTP shopper cookies are isolated from staff auth, Origin/CSRF gates apply, end is idempotent, and no photo generation endpoint exists',fixture(async f=>{
  const location=new URL(f.service.launch(f.proxy({launch_nonce:randomBytes(16).toString('hex')}))),ticket=location.hash.slice(8);
  const request=(url,method='GET',body,cookies='',csrf='',origin=publicStudio)=>fetch(f.base+url,{method,headers:{Origin:origin,Cookie:cookies,'X-Shopper-CSRF':csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('/shopper-api/session','POST',{ticket},'', '', 'https://attacker.test')).status,403);
  const r=await request('/shopper-api/session','POST',{ticket});assert.equal(r.status,200);const data=await r.json(),cookies=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  assert.match(cookies,/forme_shopper=/);assert.match(cookies,/forme_shopper_device=/);assert.ok(!cookies.includes('forme_session='));assert.ok(r.headers.getSetCookie().every(s=>s.includes('HttpOnly')&&s.includes('SameSite=Strict')));
  assert.equal((await request('/shopper-api/session','GET',undefined,'forme_session='+f.staffToken)).status,401);
  assert.equal((await request('/shopper-api/session','DELETE',undefined,cookies,'wrong')).status,403);assert.equal((await request('/shopper-api/session','GET',undefined,cookies)).status,200);
  assert.equal((await request('/shopper-api/session','DELETE',undefined,cookies,data.csrf)).status,204);assert.equal((await request('/shopper-api/session','DELETE',undefined,cookies,data.csrf)).status,204);
  assert.equal((await request('/shopper-api/avatar','POST',{})).status,404);assert.equal(f.ai(),0);
  const bad=await fetch(f.base+'/shopper-api/session',{method:'POST',headers:{Origin:publicStudio,'Content-Type':'application/json'},body:'{"private-photo-data":'});assert.equal(bad.status,400);assert.ok(!(await bad.text()).includes('private-photo-data'));
}));

test('production shopper cookies are host-only/Secure, protected staff API tokens do not gate sessions, and missing safety providers deny consent before parsing photos',fixture(async f=>{
  const app=createApp({production:true,accountStore:f.store,accessMode:'protected',mobileToken:'x'.repeat(32),shopifyShopperOptions:f.options,shopperSessionOptions:{enabled:true,now:f.sessions.now}}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const location=new URL(f.service.launch(f.proxy({launch_nonce:randomBytes(16).toString('hex')})));
  try{const response=await fetch(base+'/shopper-api/session',{method:'POST',headers:{Origin:publicStudio,'Content-Type':'application/json'},body:JSON.stringify({ticket:location.hash.slice(8)})});assert.equal(response.status,200);const data=await response.json(),headers=response.headers.getSetCookie(),cookies=headers.map(value=>value.split(';')[0]).join('; ');
    assert.ok(headers.every(value=>value.startsWith('__Host-')&&value.includes('Secure')&&value.includes('HttpOnly')&&value.includes('SameSite=Strict')&&value.includes('Path=/')&&!value.includes('Domain=')));
    assert.equal(data.checksAvailable,false);const denied=await fetch(base+'/shopper-api/consent',{method:'POST',headers:{Origin:publicStudio,Cookie:cookies,'X-Shopper-CSRF':data.csrf,'Content-Type':'application/json'},body:JSON.stringify({privatePhoto:'data:image/png;base64,'+'A'.repeat(8000)})});assert.equal(denied.status,503);assert.ok(!(await denied.text()).includes('privatePhoto'));
    assert.equal((await fetch(base+'/api/shopper-settings')).status,401);
  }finally{await new Promise(r=>server.close(r));}
}));

test('device cookies have a signed absolute 24-hour expiry and do not acquire a sliding expiry on new sessions',fixture(async f=>{
  const first=f.open();const expires=first.deviceExpiresAt;f.advance(3600001);const second=f.open(first.deviceCookie);assert.equal(second.deviceExpiresAt,expires);
  f.advance(23*3600000);const third=f.open(first.deviceCookie);assert.notEqual(third.deviceCookie,first.deviceCookie);assert.ok(third.deviceExpiresAt>expires);
}));

test('the shared limiter blocks staff provider calls and refunds holds while other image workloads occupy both slots',fixture(async f=>{
  let calls=0;const app=createApp({accountStore:f.store,accessMode:'public',apiKey:'test',rateLimit:false,tryOn:async()=>{calls++;return f.image;}}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const first=f.store.imageSlots.acquire({kind:'catalogue'}),second=f.store.imageSlots.acquire({kind:'shopper'}),image='data:image/png;base64,'+(await standardAvatar('regular')).toString('base64');
  try{const response=await fetch(base+'/api/tryon',{method:'POST',headers:{Origin:base,Cookie:'forme_session='+f.staffToken,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),avatar:image,garment:image,garmentType:'shirt',consent:true,consentProvider:'gemini',consentScope:'avatar-and-garment'})});assert.equal(response.status,429);assert.equal((await response.json()).code,'image_busy');assert.equal(calls,0);assert.equal(f.store.billing.balance(f.a.org),1000);
  }finally{f.store.imageSlots.release(first);f.store.imageSlots.release(second);await new Promise(r=>server.close(r));}
}));

test('image slots coordinate independent connections, reserve only one shopper slot and block photo claims without settling their credits',fixture(async f=>{
  const other=new AccountStore(f.directory);try{
    const first=f.store.imageSlots.acquire({kind:'shopper'});assert.ok(first);assert.equal(other.imageSlots.acquire({kind:'shopper'}),null);
    const second=other.imageSlots.acquire({kind:'staff'});assert.ok(second);assert.equal(f.store.imageSlots.acquire(),null);
    f.store.billing.grant(f.a.org,'photo',1,'grant_admin','test-slot');const job=f.app.locals.photoJobs;
    job.apiKey='test';job.create(f.a,{requestId:randomUUID(),garmentIds:[f.item.id],model:{profileId:'regular',tone:'medium'},poses:['front'],formats:['1:1'],generationConsent:true,maxCredits:1});
    assert.equal(job.claim(),null);assert.equal(f.store.billing.balance(f.a.org,'photo'),0);assert.equal(f.store.db.prepare("SELECT state FROM photo_items").get().state,'pending');
    f.store.imageSlots.release(first);f.store.imageSlots.release(second);const claim=job.claim();assert.ok(claim);assert.equal(f.store.db.prepare('SELECT count(*) n FROM image_call_leases').get().n,1);f.store.imageSlots.release(claim.token);
  }finally{other.close();}
}));

test('photo normalization rejects oversized/mislabeled images and real local face checks reject a headless reference',async()=>{
  const png=await sharp({create:{width:192,height:288,channels:3,background:'#aaaaaa'}}).png().toBuffer(),image='data:image/png;base64,'+png.toString('base64');
  await assert.rejects(shopperPhoto(image.replace('image/png','image/jpeg')),{code:'shopper_photo_invalid'});
  const huge='data:image/png;base64,'+(await sharp({create:{width:4000,height:3100,channels:3,background:'#aaaaaa'}}).png().toBuffer()).toString('base64');
  await assert.rejects(shopperPhoto(huge),{code:'shopper_photo_invalid'});await assert.rejects(shopperInputs('avatar',{face:image,body:image}),{code:'shopper_photo_invalid'});
});

test('Gemini transport honors external cancellation without a retry',async()=>{
  const avatar=await standardAvatar('regular'),controller=new AbortController();let started,seen,calls=0;const began=new Promise(r=>{started=r;});
  const running=geminiTryOn({avatar,garment:avatar,garmentType:'shirt',apiKey:'test',signal:controller.signal,fetchImpl:async(_url,options)=>{calls++;seen=options.signal;started();await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));}});
  await began;controller.abort();await assert.rejects(running,{code:'timeout'});assert.equal(seen.aborted,true);assert.equal(calls,1);
});
