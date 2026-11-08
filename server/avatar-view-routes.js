import sharp from 'sharp';
import {accountUser} from './accounts.js';
import {meter,validRequestId,BillingError,billingFailure} from './billing.js';
import {generatePortrait} from './avatar-views.js';
import {handsTemplate} from './hands-templates.js';
import {viewKind,viewPng} from './avatar-view-store.js';
import {customerFace} from './face-check.js';
import {ProviderError,providerErrorDetails} from './provider-errors.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const pngUrl=bytes=>'data:image/png;base64,'+bytes.toString('base64');
function fields(input,allowed){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw fail('Use only the supported avatar view fields.');}
async function photo(value){
  let bytes;
  try{
    const match=typeof value==='string'&&value.length<7_000_000&&/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);if(!match)throw new Error();
    bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>5*1024*1024)throw new Error();
    const image=sharp(bytes,{limitInputPixels:25_000_000,animated:false}),m=await image.metadata();if(m.format!==match[1]||m.width<128||m.height<128||m.pages>1)throw new Error();
    return await image.rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).toColourspace('srgb').jpeg({quality:90}).toBuffer();
  }catch{throw new ProviderError('face_input');}finally{bytes?.fill(0);}
}

export function installAvatarViewRoutes(app,store,{enabled,provider,apiKey,model,femaleEnabled=false,rateLimit=true,portrait=generatePortrait,faceCheck=customerFace,computeAnchors}={}){
  if(!store)return;
  const views=store.views;let preflights=0;
  const session=(req,account)=>{const current=accountUser(store,req);if(!current||current.id!==account.id||current.user.id!==account.user.id)throw fail('The store session changed. Reopen this avatar.',401);views.actor(current);return current;};
  const wrap=fn=>async(req,res)=>{
    try{
      const account=accountUser(store,req);if(!account)throw fail('Sign in to your store account.',401);
      views.actor(account);if(!enabled)throw fail('Avatar views are not enabled on this studio.',404);
      if(req.method!=='GET'){let same=false;try{const origin=new URL(req.get('origin'));same=origin.host===req.get('host')&&origin.protocol===`${req.protocol}:`;}catch{}if(!same)throw fail('Open avatar view actions from this studio website.',403);}
      views.avatar(account,req.params.id);if(req.params.kind)viewKind(req.params.kind);
      await fn(req,res,account);
    }catch(error){
      if(res.destroyed||res.headersSent)return;
      if(billingFailure(res,error))return;
      if(error instanceof ProviderError){const safe=providerErrorDetails(error,'gemini');res.status(['face_input','portrait_input'].includes(error.code)?400:502).json({error:safe.message,code:safe.code});}
      else res.status(error.status||500).json({error:error.status?error.message:'The avatar view could not be completed. No request was automatically retried.'});
    }
  };
  app.get('/api/avatars/:id/views',wrap((req,res,account)=>res.json({views:views.list(account,req.params.id)})));
  app.get('/api/avatars/:id/views/portrait/anchors',wrap(async(req,res,account)=>{const result=await views.anchors(account,req.params.id,{...(computeAnchors?{compute:computeAnchors}:{})});session(req,account);res.json(result);}));
  app.get('/api/avatars/:id/views/:kind',wrap((req,res,account)=>{const row=views.get(account,req.params.id,req.params.kind);res.type('png').send(row.image);}));
  app.delete('/api/avatars/:id/views/:kind',wrap((req,res,account)=>res.json(views.remove(account,req.params.id,req.params.kind))));
  app.post('/api/avatars/:id/views/:kind/approve',wrap(async(req,res,account)=>{
    fields(req.body,['image','receipt','reviewed','storageConsent']);const result=await views.approve(account,req.params.id,req.params.kind,req.body,{guard:()=>session(req,account)});res.json(result);
  }));
  app.post('/api/avatars/:id/views',wrap(async(req,res,account)=>{
    const body=req.body||{};viewKind(body.kind);const id=req.params.id,kind=body.kind;
    fields(body,kind==='hands'?['kind','source','tone']:['kind','facePhoto','consent','consentScope','consentProvider','hairBehindEars','hairConsent','requestId','avatarReviewed']);
    const context=views.context(account,id,kind);
    // A live session/ownership check is repeated after each asynchronous stage.
    const guard=()=>{const current=session(req,account);views.current(current,id,kind,context);};
    if(kind==='hands'){
      if(body.source!=='template')throw fail('Choose a prepared hands template. Customer hand photos are not supported yet.');
      const template=await handsTemplate(context.avatar.body_type,Object.hasOwn(body,'tone')?body.tone:context.avatar.template_tone);guard();
      const image=pngUrl(template.png),receipt=views.receipt(account,id,kind,context,image,{tone:template.tone,sourceKind:'template'});
      return res.json({image,receipt,kind,tone:template.tone,sourceKind:'template',anchors:template.anchors,warnings:template.warnings,needsReview:true,creditsUsed:0});
    }
    if(provider!=='gemini'||!apiKey)throw fail('Portrait generation requires the configured Gemini image service.',503);
    if(context.avatar.body_type==='female'&&!femaleEnabled)throw fail('Female portrait generation is not enabled on this studio.');
    if(body.consent!==true||body.consentScope!=='face-for-portrait'||body.consentProvider!=='gemini')throw fail('Customer consent to send the fresh face photo and approved avatar to Gemini is required.');
    if(body.avatarReviewed!==true)throw fail('Confirm the customer approved this saved full-body avatar before creating its portrait.');
    if(body.hairBehindEars!==undefined&&typeof body.hairBehindEars!=='boolean'||body.hairConsent!==undefined&&typeof body.hairConsent!=='boolean'||body.hairBehindEars===true&&body.hairConsent!==true)throw fail('Confirm the customer agreed before placing hair behind the ears.');
    if(!validRequestId(body.requestId))throw new BillingError('invalid_request_id','Each portrait generation needs a fresh UUID v4 requestId.',400);
    if(store.db.prepare('SELECT 1 FROM ledger WHERE org=? AND requestId=?').get(account.org,body.requestId.toLowerCase()))throw new BillingError('duplicate_request','This request was already submitted. Check its preview; do not retry it automatically.');
    const max=Number(process.env.TRYON_IDENTITY_MAX||.45);if(!Number.isFinite(max)||max<=0||max>1)throw new ProviderError('face_check');
    let face,job,timer;const cancelled=new AbortController();
    const stop=()=>{if(!res.writableEnded)cancelled.abort(fail('Portrait generation stopped. No automatic retry was sent; the provider may still charge.',409));};
    req.on('aborted',stop);res.on('close',stop);
    try{
      job=views.acquire(account,id,kind);
      if(preflights>=2)throw new BillingError('image_busy','The studio is checking other photos. Try again shortly.',429);
      preflights++;try{face=await photo(body.facePhoto);delete body.facePhoto;await faceCheck(face);}finally{preflights--;}
      guard();if(cancelled.signal.aborted)throw cancelled.signal.reason;
      const live=()=>{if(cancelled.signal.aborted)throw cancelled.signal.reason;guard();if(store.db.prepare('SELECT status FROM orgs WHERE id=?').get(account.org)?.status==='suspended')throw new BillingError('account_suspended','This organisation is suspended. No portrait was delivered.',403);views.job(account,id,kind,job);};
      timer=setInterval(()=>{try{live();}catch(error){cancelled.abort(error);}},150);timer.unref();let receipt;
      const image=await meter(req,{billing:store.billing,account,action:'avatar',beforeReserve:()=>{
        live();
        if(rateLimit){const usage=store.db.prepare("SELECT count(*) n,max(createdAt) last FROM ledger WHERE org=? AND store=? AND user=? AND pool='ai' AND kind='hold' AND action='avatar' AND createdAt>?").get(account.org,account.id,account.user.id,Date.now()-3600000);if(usage.n>=20||usage.last&&Date.now()-usage.last<15000)throw new BillingError('portrait_rate_limit','Wait before generating again. The pilot allows 20 avatar/portrait attempts per hour and 15 seconds between attempts.',429);}
      },beforeCommit:output=>{live();receipt=views.receipt(account,id,kind,context,output,{tone:context.avatar.template_tone,sourceKind:'generated'});}},()=>store.imageSlots.run({kind:'staff',signal:cancelled.signal},async signal=>{
        live();const output=await portrait({facePhoto:face,avatar:Buffer.from(context.avatar.image),hairBehindEars:body.hairBehindEars===true,apiKey,model,signal});live();await viewPng(output,'portrait');live();return output;
      }));
      res.json({image,receipt,kind,sourceKind:'generated',tone:context.avatar.template_tone,needsReview:true,creditsUsed:1,warnings:[]});
    }finally{clearInterval(timer);req.off('aborted',stop);res.off('close',stop);if(job)views.release(job);face?.fill(0);delete body.facePhoto;}
  }));
}
