import {randomBytes,randomUUID,createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {BlockList,isIP} from 'node:net';
import {BillingError,validRequestId} from './billing.js';
import {abortable} from './image-slots.js';
import {shopperInputs,shopperPhoto} from './shopper-photos.js';
import {requireVisibleFace} from './face-check.js';

export const SESSION_MS=30*60000;
const HOUR=3600000,proofMs=2*60000,consentMs=5*60000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const fail=(code,message,status=409)=>new BillingError(code,message,status);
const only=(input,keys)=>input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>keys.includes(k));

export function canonicalIp(raw){
  let ip=String(raw||'').toLowerCase();if(ip.startsWith('::ffff:')&&isIP(ip.slice(7))===4)ip=ip.slice(7);
  if(isIP(ip)===6)return new URL('http://['+ip+']/').hostname.slice(1,-1);
  if(isIP(ip)===4)return ip;throw fail('shopper_ip_unavailable','This connection could not be checked.',403);
}

export class ShopperSessions {
  constructor(shopify,{enabled=process.env.TRYON_SHOPPER_SESSIONS==='true',provider='gemini',consentRevision=process.env.TRYON_SHOPPER_CONSENT_REVISION||'',
    captcha,moderation,trustProxy=false,trustedProxies=process.env.TRYON_SHOPPER_PROXY_CIDRS||'',now=Date.now,faceCheck,visibleCheck=requireVisibleFace,pollMs=250}={}){
    this.shopify=shopify;this.store=shopify.store;this.state=shopify.state;this.enabled=enabled;this.provider=provider;this.consentRevision=consentRevision;
    this.captcha=captcha;this.moderation=moderation;this.trustProxy=trustProxy;this.now=now;this.faceCheck=faceCheck;this.visibleCheck=visibleCheck;this.pollMs=pollMs;this.running=new Map();
    this.proxies=new BlockList();this.proxyCount=0;this.proxyError=false;
    try{for(const raw of String(trustedProxies).split(',').map(s=>s.trim()).filter(Boolean)){const [ip,bits,...extra]=raw.split('/'),type=isIP(ip);if(!type||extra.length)throw new Error();
      if(bits!==undefined&&!/^\d{1,3}$/.test(bits))throw new Error();const prefix=bits===undefined?(type===4?32:128):Number(bits);if(!Number.isInteger(prefix)||prefix<1||prefix>(type===4?32:128))throw new Error();this.proxies.addSubnet(ip,prefix,type===4?'ipv4':'ipv6');this.proxyCount++;}}
    catch{this.proxyError=true;}
  }
  ready(){
    if(!this.enabled)throw fail('shopper_sessions_unavailable','Temporary shopper sessions are not enabled.',503);
    const origin=this.shopify.ready();if(this.proxyError||this.trustProxy&&this.proxyCount===0)throw fail('shopper_proxy_unavailable','Shopper connection checks are unavailable.',503);return origin;
  }
  guardReady(){this.ready();if(!/^[A-Za-z0-9._-]{1,100}$/.test(this.consentRevision)||typeof this.captcha?.verify!=='function'||typeof this.moderation?.check!=='function'||!/^[a-z0-9-]{1,60}$/.test(this.captcha?.id||'')||!/^[a-z0-9-]{1,60}$/.test(this.moderation?.id||''))
    throw fail('shopper_checks_unavailable','Customer image generation checks are unavailable. No photos have been sent.',503);}
  ip(req){
    const direct=canonicalIp(req.socket?.remoteAddress);
    if(!this.trustProxy)return direct;
    if(this.proxyError||!this.proxyCount||!this.proxies.check(direct,isIP(direct)===4?'ipv4':'ipv6'))throw fail('shopper_proxy_untrusted','This shopper connection could not be verified.',403);
    const supplied=req.get('x-forwarded-for');if(typeof supplied!=='string'||supplied.includes(','))throw fail('shopper_proxy_untrusted','This shopper connection could not be verified.',403);return canonicalIp(supplied.trim());
  }
  hmac(purpose,value){return createHmac('sha256',Buffer.from(this.shopify.key,'hex')).update('forme-shopper-v1|'+purpose+'|'+value).digest('hex');}
  device(value){
    if(typeof value==='string'){const [id,issued,signature,...extra]=value.split('.'),stamp=Number(issued);if(!extra.length&&opaque(id)&&/^\d{13}$/.test(issued)&&stamp<=this.now()+5000&&stamp>this.now()-86400000&&equal(signature,this.hmac('device-cookie',id+'.'+issued)))return {cookie:value,key:this.hmac('device',id),expiresAt:stamp+86400000};}
    const id=token(),issued=String(this.now());return {cookie:id+'.'+issued+'.'+this.hmac('device-cookie',id+'.'+issued),key:this.hmac('device',id),expiresAt:this.now()+86400000};
  }
  save(kind,key,value,expiresAt){this.state.take(kind,key);this.state.put(kind,key,value,expiresAt);}
  quota(kind,identity,limit,{consume=false}={}){
    const key=this.hmac('rate-'+kind,identity),now=this.now(),prior=this.state.get('rate',key),times=(prior?.times||[]).filter(t=>t>now-HOUR);
    if(times.length>=limit){const error=fail('shopper_rate_limited','Please wait before starting another shopper attempt.',429);error.retryAfter=Math.max(1,Math.ceil((times[0]+HOUR-now)/1000));throw error;}
    if(consume)this.save('rate',key,{times:[...times,now]},now+HOUR);return key;
  }
  context(saved){
    const row=this.store.db.prepare('SELECT * FROM shopper_shopify_installations WHERE id=?').get(saved.installation),current=this.shopify.launchContext(row,saved.productId);
    for(const key of ['installationRevision','fingerprint','storeRevision','organisationRevision'])if(saved[key]!==current[key])throw fail('shopper_session_changed','The store or product changed. Open its product button again.',410);
    return current;
  }
  csrf(raw){return createHmac('sha256',Buffer.from(this.shopify.key,'hex')).update('shopper-csrf|'+raw).digest('base64url');}
  create({ticket,deviceCookie,ip,previousToken}){
    this.ready();const device=this.device(deviceCookie),address=canonicalIp(ip),raw=token(),key=hash(raw);
    const result=this.state.transaction(()=>{
      this.quota('sessions-device',device.key,2);this.quota('sessions-ip',address,10);
      const context=this.shopify.redeem(ticket),createdAt=this.now(),session={context,device:device.key,createdAt,expiresAt:Math.min(createdAt+SESSION_MS,device.expiresAt),attempts:0,avatars:0,tryons:0,avatarApproved:false};
      this.quota('sessions-device',device.key,2,{consume:true});this.quota('sessions-ip',address,10,{consume:true});
      if(opaque(previousToken))this.revoke(hash(previousToken));
      this.save('session',key,session,session.expiresAt);return session;
    });
    return {raw,deviceCookie:device.cookie,deviceExpiresAt:device.expiresAt,data:this.describe(raw,result)};
  }
  auth({sessionToken,deviceCookie,csrf},{mutate=true}={}){
    this.ready();if(!opaque(sessionToken))throw fail('shopper_session_required','Open a fresh product button to start a shopper session.',401);
    const key=hash(sessionToken),session=this.state.get('session',key),device=this.device(deviceCookie);
    if(!session||session.expiresAt<=this.now())throw fail('shopper_session_expired','This shopper session ended or expired. Open the product button again.',410);
    if(device.key!==session.device||mutate&&!equal(csrf,this.csrf(sessionToken)))throw fail('shopper_session_invalid','This shopper session could not be verified.',403);
    try{this.context(session.context);}catch{this.revoke(key);throw fail('shopper_session_changed','This store or product is no longer available. Open the product button again.',410);}
    return {key,session,raw:sessionToken,device:device.key};
  }
  describe(raw,session){
    const brand=this.store.branding.read(session.context.store),logo=this.store.branding.logo(session.context.store);
    let checksAvailable=true;try{this.guardReady();}catch{checksAvailable=false;}
    return {stage:'session-guards',expiresAt:session.expiresAt,createdAt:session.createdAt,csrf:this.csrf(raw),product:session.context.product,
      brand:{displayName:brand.displayName,primaryColor:brand.primaryColor,logo:logo?'data:image/png;base64,'+Buffer.from(logo).toString('base64'):null},
      provider:this.provider,consentRevision:this.consentRevision||null,verificationProvider:this.captcha?.id||null,moderationProvider:this.moderation?.id||null,checksAvailable,shopperGenerationAvailable:false,attemptsRemaining:Math.max(0,3-session.attempts)};
  }
  read(auth){const current=this.auth(auth,{mutate:false});return this.describe(current.raw,current.session);}
  revoke(key){
    this.state.transaction(()=>{this.state.take('session',key);this.state.db.prepare("DELETE FROM shopper_state WHERE kind IN ('consent','proof','attempt') AND json_extract(value,'$.session')=?").run(key);});
    for(const controller of this.running.get(key)||[])controller.abort(fail('shopper_session_ended','The shopper session ended. No automatic retry was sent.',410));
  }
  end(auth){
    this.ready();if(!opaque(auth.sessionToken)||!this.state.get('session',hash(auth.sessionToken)))return;
    const current=this.auth(auth);this.revoke(current.key);
  }
  consent(auth,input){
    this.guardReady();const current=this.auth(auth);
    if(!only(input,['action','provider','revision','adult','ownPhotos','accepted'])||!['avatar','tryon'].includes(input.action)||input.provider!==this.provider||input.revision!==this.consentRevision
      ||input.adult!==true||input.ownPhotos!==true||input.accepted!==true)throw fail('shopper_consent_required','Confirm adult own-photo consent for this purpose and active provider.',400);
    if(input.action==='avatar'&&current.session.avatars>=1||input.action==='tryon'&&!current.session.avatarApproved)throw fail('shopper_review_required','Review the generated avatar before trying on this product.');
    const id=token();this.state.transaction(()=>this.save('consent',hash(id),{session:current.key,action:input.action,provider:this.provider,revision:this.consentRevision,captcha:this.captcha.id,moderation:this.moderation.id,acceptedAt:this.now()},Math.min(current.session.expiresAt,this.now()+consentMs)));
    return {consent:id,expiresAt:Math.min(current.session.expiresAt,this.now()+consentMs)};
  }
  async challenge(auth,input,ip){
    this.guardReady();const current=this.auth(auth),address=canonicalIp(ip);
    if(!only(input,['action','consent','token'])||!['avatar','tryon'].includes(input.action)||!opaque(input.consent)||typeof input.token!=='string'||!input.token||input.token.length>4096)throw fail('shopper_challenge_invalid','Complete the verification for this image action.',400);
    const consent=this.state.get('consent',hash(input.consent));if(!consent||consent.session!==current.key||consent.action!==input.action||consent.revision!==this.consentRevision||consent.captcha!==this.captcha.id||consent.moderation!==this.moderation.id)throw fail('shopper_consent_required','Confirm fresh generation consent first.',400);
    const replay=hash(input.token);
    this.state.transaction(()=>{
      if(this.state.get('captcha-replay',replay))throw fail('shopper_challenge_replayed','Complete a new verification challenge.');
      this.quota('challenge-device',current.device,6,{consume:true});this.quota('challenge-ip',address,36,{consume:true});
      this.state.put('captcha-replay',replay,true,this.now()+10*60000);
    });
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),running=this.running.get(current.key)||new Set();running.add(controller);this.running.set(current.key,running);
    const watch=setInterval(()=>{try{this.auth(auth);}catch(e){controller.abort(e);}},this.pollMs);watch.unref();let verdict;
    try{verdict=await abortable(()=>this.captcha.verify({token:input.token,action:input.action,hostname:new URL(this.shopify.ready()).hostname,signal}),signal);}
    catch{if(signal.aborted&&signal.reason instanceof BillingError)throw signal.reason;throw fail('shopper_checks_unavailable','Verification is unavailable. No image request was sent.',503);}
    finally{clearInterval(watch);running.delete(controller);if(!running.size)this.running.delete(current.key);}
    const issued=Date.parse(verdict?.issuedAt);
    if(verdict?.success!==true||verdict.action!==input.action||verdict.hostname!==new URL(this.shopify.ready()).hostname||!Number.isFinite(issued)||issued>this.now()+5000||issued<this.now()-proofMs)
      throw fail('shopper_challenge_invalid','Verification did not pass. Complete a new challenge.',403);
    this.auth(auth);const proof=token();this.state.transaction(()=>{
      const fresh=this.state.get('consent',hash(input.consent));if(!fresh||fresh.session!==current.key||fresh.revision!==this.consentRevision||fresh.captcha!==this.captcha.id||fresh.moderation!==this.moderation.id)throw fail('shopper_consent_required','Generation consent expired.',400);
      this.state.put('proof',hash(proof),{session:current.key,action:input.action,consent:hash(input.consent)},Math.min(current.session.expiresAt,this.now()+proofMs));
    });return {proof,expiresAt:Math.min(current.session.expiresAt,this.now()+proofMs)};
  }
  async moderate(current,images,stage,signal,operationId=null){
    this.auth(current);this.store.shoppers.reserveModeration({store:this.auth(current).session.context.store,requestId:randomUUID(),operationId});
    let result;try{result=await abortable(()=>this.moderation.check({images,stage,policy:'adult-own-photo-v1',signal}),signal);}catch{if(signal.aborted&&signal.reason instanceof BillingError)throw signal.reason;throw fail('shopper_checks_unavailable','Image safety checks are unavailable. No new image was accepted.',503);}
    if(result?.allowed!==true||result.policy!=='adult-own-photo-v1')throw fail('shopper_image_rejected','This image did not pass the shopper safety checks.',422);
  }
  async run(auth,{action,requestId,consent,proof,images},work,{ip,signal:externalSignal}={}){
    this.guardReady();const before=this.auth(auth),address=canonicalIp(ip);
    if(!validRequestId(requestId)||!['avatar','tryon'].includes(action)||!opaque(consent)||!opaque(proof)||typeof work!=='function')throw fail('shopper_attempt_invalid','Use a valid explicit image request.',400);
    if(this.state.get('attempt',requestId.toLowerCase()))throw fail('duplicate_request','This image request was already submitted. No automatic retry was sent.');
    const lease=this.store.imageSlots.acquire({kind:'shopper',leaseMs:135000});if(!lease)throw fail('image_busy','The studio is processing other images. Try again shortly.',429);
    const controller=new AbortController(),combined=AbortSignal.any([controller.signal,AbortSignal.timeout(120000),...(externalSignal?[externalSignal]:[])]);
    const running=this.running.get(before.key)||new Set();running.add(controller);this.running.set(before.key,running);
    const watch=setInterval(()=>{try{this.auth(auth);this.store.imageSlots.assert(lease);}catch(e){controller.abort(e);}},this.pollMs);watch.unref();let operation=null;
    try{
      this.state.transaction(()=>{
        const current=this.auth(auth),cons=this.state.get('consent',hash(consent)),verified=this.state.get('proof',hash(proof));
        if(!cons||cons.session!==current.key||cons.action!==action||cons.provider!==this.provider||cons.revision!==this.consentRevision||cons.captcha!==this.captcha.id||cons.moderation!==this.moderation.id||!verified||verified.session!==current.key||verified.action!==action||verified.consent!==hash(consent))throw fail('shopper_consent_required','Fresh consent and verification are required for this image request.',403);
        this.checkAttempts(current,action,address);
        this.state.take('consent',hash(consent));this.state.take('proof',hash(proof));
        this.state.put('attempt',requestId.toLowerCase(),{session:current.key,action},current.session.expiresAt);
      });
      let source=images;
      if(action==='tryon'){
        if(!only(images,['avatar'])||Object.keys(images).length!==1)throw fail('shopper_attempt_invalid','Use the reviewed session avatar and selected store product.',400);
        const original=await shopperPhoto(images.avatar,{png:true}),current=this.auth(auth);
        if(!current.session.avatarApproved||hash(original.raw)!==current.session.avatarHash)throw fail('shopper_review_required','Use the exact avatar reviewed in this shopper session.',403);
        const garment=this.store.db.prepare('SELECT image FROM garments WHERE account=? AND id=?').get(current.session.context.store,current.session.context.garmentId);
        source={avatar:images.avatar,garment:'data:image/png;base64,'+Buffer.from(garment.image).toString('base64')};
      }
      const normalized=await abortable(()=>shopperInputs(action,source,{faceCheck:this.faceCheck,visibleCheck:this.visibleCheck}),combined);
      await this.moderate(auth,Object.values(normalized),'input',combined);
      const bodyHash=hash(JSON.stringify(Object.entries(normalized).map(([key,bytes])=>[key,hash(bytes)]))),reservation=this.store.shoppers.reserve({store:before.session.context.store,requestId,action,bodyHash,sessionHash:before.key});
      if(!reservation.fresh)throw fail('duplicate_request','This request was already reserved. No automatic retry was sent.');operation=requestId.toLowerCase();
      this.state.transaction(()=>{
        const current=this.auth(auth);this.checkAttempts(current,action,address);combined.throwIfAborted();this.store.imageSlots.assert(lease);
        this.store.shoppers.dispatch(operation);this.quota('generation-device',current.device,3,{consume:true});this.quota('generation-ip',address,12,{consume:true});
        current.session.attempts++;this.save('session',current.key,current.session,current.session.expiresAt);
      });
      const output=await abortable(()=>work({images:normalized,context:this.auth(auth).session.context,signal:combined}),combined);
      const result=await abortable(async()=>{const image=await shopperPhoto(output,{output:true,png:true});await this.visibleCheck(image.bytes);return image.bytes;},combined);
      await this.moderate(auth,[result],'output',combined,operation);
      const approval=action==='avatar'?token():null;
      this.state.transaction(()=>{
        const current=this.auth(auth);combined.throwIfAborted();this.store.imageSlots.assert(lease);
        if(action==='avatar'){current.session.avatars++;current.session.avatarCandidate=hash(result);current.session.approvalHash=hash(approval);current.session.avatarApproved=false;}
        else current.session.tryons++;
        this.save('session',current.key,current.session,current.session.expiresAt);this.store.shoppers.commit(operation);
      });
      return {image:'data:image/png;base64,'+result.toString('base64'),needsReview:true,...(approval?{approval}:{})};
    }catch(e){if(operation)this.store.shoppers.refund(operation);if(e instanceof BillingError)throw e;throw fail('shopper_image_failed','The image request could not complete. A provider charge may still apply; no automatic retry was sent.',502);}
    finally{clearInterval(watch);running.delete(controller);if(!running.size)this.running.delete(before.key);this.store.imageSlots.release(lease);}
  }
  checkAttempts(current,action,ip){
    if(current.session.attempts>=3||action==='avatar'&&current.session.avatars>=1||action==='tryon'&&(!current.session.avatarApproved||current.session.tryons>=2))throw fail('shopper_attempt_limit','This session has reached its image limit. Open a fresh product session.',429);
    this.quota('generation-device',current.device,3);this.quota('generation-ip',ip,12);
  }
  approve(auth,input){
    if(!only(input,['approval','approved'])||!opaque(input.approval)||input.approved!==true)throw fail('shopper_review_required','Confirm approval of the generated session avatar.',400);
    return this.state.transaction(()=>{const current=this.auth(auth);
      if(!current.session.avatarCandidate||!equal(hash(input.approval),current.session.approvalHash))throw fail('shopper_review_required','This avatar was not generated for this session.',403);
      current.session.avatarHash=current.session.avatarCandidate;current.session.avatarApproved=true;delete current.session.approvalHash;
      this.save('session',current.key,current.session,current.session.expiresAt);return {approved:true};
    });
  }
}
