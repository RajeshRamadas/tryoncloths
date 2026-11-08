import {accountUser} from './accounts.js';
import {meter,validRequestId,BillingError,billingFailure} from './billing.js';
import {validateSession,recordTryon} from './analytics-tracking.js';
import {JewelleryStore,jewelleryPng} from './jewellery-store.js';
import {jewelleryTryOn} from './jewellery-tryon.js';
import {ProviderError,providerErrorDetails} from './provider-errors.js';
import {saveJewelleryLook,jewelleryLook} from './jewellery-looks.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function fields(body,allowed){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw fail('Use only the supported jewellery action fields.');}
export function installJewelleryRoutes(app,store,{enabled,provider,apiKey,model,rateLimit=true,femaleEnabled=false,generate=jewelleryTryOn}={}){
  const jewellery=store?new JewelleryStore(store):null;app.locals.jewellery=jewellery;let preflights=0;
  const session=(req,account)=>{
    const current=accountUser(store,req);
    if(!current||current.id!==account.id||current.user.id!==account.user.id)throw fail('The store session ended or changed. Reopen jewellery try-on.',401);
    jewellery.actor(current);return current;
  };
  const wrap=fn=>async(req,res)=>{
    try{
      if(!enabled||!store)throw fail('Jewellery try-on is not enabled on this studio.',404);
      const account=accountUser(store,req);if(!account)throw fail('Sign in to your store account.',401);jewellery.actor(account);
      let same=req.method==='GET';try{const origin=new URL(req.get('origin'));same=origin.host===req.get('host')&&origin.protocol===`${req.protocol}:`;}catch{}
      if(!same)throw fail('Open jewellery actions from this studio website.',403);
      await fn(req,res,account);
    }catch(error){
      if(res.destroyed||res.headersSent)return;
      if(billingFailure(res,error))return;
      if(['AbortError','TimeoutError'].includes(error?.name))error=new ProviderError('timeout');
      if(error instanceof ProviderError){const safe=providerErrorDetails(error,'gemini');res.status(error.code==='jewellery_input'?400:502).json({error:safe.message,code:safe.code});}
      else res.status(error.status||500).json({error:error.status?error.message:'Jewellery try-on could not be completed. No request was automatically retried.'});
    }
  };
  app.get('/api/jewellery/looks/:id',wrap((req,res,account)=>{const row=jewelleryLook(store,account,req.params.id);res.json({id:row.id,avatarId:row.avatarId,view:row.view,name:row.name,itemsJson:JSON.parse(row.itemsJson),image:'data:image/png;base64,'+Buffer.from(row.image).toString('base64')});}));
  app.post('/api/jewellery/looks',wrap(async(req,res,account)=>{
    fields(req.body,['avatarId','view','image','name','itemsJson','receipt','resultId','baseLookId','reviewed','storageConsent','sessionId']);
    res.json(await saveJewelleryLook(store,jewellery,account,req.body,()=>session(req,account)));
  }));
  app.post('/api/jewellery/results/:id/approve',wrap(async(req,res,account)=>{
    fields(req.body,['image','receipt','reviewed','storageConsent']);
    if(!/^[a-f0-9]{64}$/.test(req.params.id))throw fail('Use a valid jewellery result ID.');
    const result=await jewellery.approve(account,req.params.id,req.body,{guard:()=>session(req,account)});res.json(result);
  }));
  app.post('/api/jewellery/tryon',wrap(async(req,res,account)=>{
    const body=req.body||{};
    fields(body,['avatarId','view','base','baseReceipt','baseReviewed','baseResultId','baseLookId','itemId','image','type','attributes','title','secondAngle','side','finger','hand','wrist','count','replaceExisting','consent','consentScope','consentProvider','requestId','sessionId']);
    if(body.consent!==true||body.consentScope!=='view-and-item'||body.consentProvider!=='gemini')throw fail('Customer consent to send this avatar view and jewellery product image to Gemini is required.');
    if(!validRequestId(body.requestId))throw new BillingError('invalid_request_id','Each jewellery request needs a fresh UUID v4 requestId.',400);
    if(store.db.prepare('SELECT 1 FROM ledger WHERE org=? AND requestId=?').get(account.org,body.requestId.toLowerCase()))throw new BillingError('duplicate_request','This request was already submitted. Check its result before starting a new request.');
    if(body.itemId!==undefined&&(typeof body.itemId!=='string'||body.itemId.length>200))throw fail('Use a saved jewellery item ID.');
    if(body.baseLookId!==undefined&&(typeof body.baseLookId!=='string'||body.baseLookId.length>200))throw fail('Use an owned saved jewellery look ID.');
    if(body.baseResultId!==undefined&&(typeof body.baseResultId!=='string'||!/^[a-f0-9]{64}$/.test(body.baseResultId)))throw fail('Use an approved jewellery base result ID.');
    if(body.baseReviewed!==undefined&&typeof body.baseReviewed!=='boolean')throw fail('Confirm review of the current jewellery base.');
    validateSession(store,account,body);
    if(preflights>=2)throw new BillingError('image_busy','The studio is checking other images. Try again shortly.',429);
    let context,job,timer,receipt;const cancelled=new AbortController();
    const stop=()=>{if(!res.writableEnded)cancelled.abort(fail('Jewellery generation stopped. No automatic retry was sent; the provider may still charge.',409));};
    req.on('aborted',stop);res.on('close',stop);
    const active=()=>{if(cancelled.signal.aborted)throw cancelled.signal.reason;session(req,account);};
    try{
      preflights++;try{context=await jewellery.context(account,body,{provider,model,guard:active});}finally{preflights--;}
      const guard=()=>{active();jewellery.current(account,context);};guard();
      const respond=(image,reused)=>res.json({image,provider:'gemini',kind:'jewellery-tryon',view:context.view,type:context.selection.type,reused,
        resultId:context.id,itemId:context.itemId,needsReview:true,creditsUsed:reused?0:1,reuseAvailable:Boolean(context.itemId),
        ...(receipt?{receipt}:{}),...(!receipt&&!reused?{receiptUnavailable:true,note:'Keep or download this preview. Do not regenerate just to obtain a save receipt.'}: {})});
      const recordResult=reused=>recordTryon(store,account,{requestId:body.requestId,sessionId:body.sessionId,avatarId:context.avatarId,garmentId:context.itemId||undefined},{source:'jewellery',reused});
      const cached=jewellery.cached(account,context);if(cached){try{receipt=jewellery.receipt(account,context,cached.image);}catch{}recordResult(true);return respond(cached.image,true);}
      if(provider!=='gemini'||!apiKey)throw fail('Jewellery generation requires the configured Gemini image service.',503);
      if(context.bodyType==='female'&&!femaleEnabled)throw fail('Female jewellery generation is not enabled on this studio.');
      if(context.view==='portrait'){const max=Number(process.env.TRYON_IDENTITY_MAX||.45);if(!Number.isFinite(max)||max<=0||max>1)throw new ProviderError('face_check');}
      job=jewellery.acquire(account,context);
      const live=()=>{guard();jewellery.job(account,context,job);};
      timer=setInterval(()=>{try{live();}catch(error){cancelled.abort(error);}},150);timer.unref();
      const image=await meter(req,{billing:store.billing,account,action:'tryon',beforeReserve:()=>{
        live();
        if(rateLimit){const usage=store.db.prepare("SELECT count(*) n,max(createdAt) last FROM ledger WHERE org=? AND store=? AND user=? AND pool='ai' AND kind='hold' AND action='tryon' AND createdAt>?").get(account.org,account.id,account.user.id,Date.now()-3600000);if(usage.n>=20||usage.last&&Date.now()-usage.last<15000)throw new BillingError('jewellery_rate_limit','Wait before generating again. The pilot allows 20 try-on attempts per hour and 15 seconds between attempts.',429);}
      },beforeCommit:output=>{
        live();
        // Receipt failures cannot throw away a paid, validated image or cause a
        // second provider call. The user can keep/download the delivered PNG.
        try{receipt=jewellery.receipt(account,context,output);}catch{}
      }},()=>store.imageSlots.run({kind:'staff',signal:cancelled.signal},async signal=>{
        live();const output=await generate({base:context.base,product:context.product,secondAngle:context.secondAngle,
          ...context.selection,title:context.title,anchors:context.anchors,apiKey,model,signal});live();
        try{await jewelleryPng(output,context.view);}catch{throw new ProviderError('invalid_image');}live();return output;
      }));
      recordResult(false);
      return respond(image,false);
    }finally{
      clearInterval(timer);req.off('aborted',stop);res.off('close',stop);if(job)jewellery.release(job);
      context?.base.fill(0);context?.product.fill(0);context?.secondAngle?.fill(0);
    }
  }));
}
