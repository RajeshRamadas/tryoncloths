import express from 'express';
import {BillingError} from './billing.js';
const names=production=>({session:production?'__Host-forme_shopper':'forme_shopper',device:production?'__Host-forme_shopper_device':'forme_shopper_device'});
const cookie=(req,name)=>(req.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const headers=res=>res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'});
export function installShopperSessionRoutes(app,service,{production=false}={}){
  if(!service)return;const cookies=names(production),options={secure:production,httpOnly:true,sameSite:'strict',path:'/'};
  const auth=req=>({sessionToken:cookie(req,cookies.session),deviceCookie:cookie(req,cookies.device),csrf:req.get('X-Shopper-CSRF')});
  const error=(res,e)=>{if(e.retryAfter)res.set('Retry-After',String(e.retryAfter));res.status(e.status||503).json({error:e.status?e.message:'Shopper sessions are temporarily unavailable.',...(e.code?{code:e.code}:{})});};
  const gate=(req,res,next)=>{headers(res);try{const origin=service.ready();if(req.method!=='GET'&&req.get('origin')!==origin||req.method==='GET'&&req.get('origin')&&req.get('origin')!==origin)return res.status(403).json({error:'Open shopper actions from this studio page.'});next();}catch(e){error(res,e);}};
  const authenticated=(req,res,next)=>{try{service.auth(auth(req),{mutate:req.method!=='GET'});next();}catch(e){error(res,e);}};
  const guards=(req,res,next)=>{try{service.guardReady();next();}catch(e){error(res,e);}};
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){error(res,e);}};
  app.post('/shopper-api/session',gate,express.json({limit:'1kb'}),wrap((req,res)=>{
    if(!req.body||Object.keys(req.body).length!==1||typeof req.body.ticket!=='string')return res.status(400).json({error:'Use only a product launch ticket.'});
    const result=service.create({ticket:req.body.ticket,deviceCookie:cookie(req,cookies.device),previousToken:cookie(req,cookies.session),ip:service.ip(req)});
    res.cookie(cookies.session,result.raw,{...options,maxAge:result.data.expiresAt-service.now()});res.cookie(cookies.device,result.deviceCookie,{...options,maxAge:result.deviceExpiresAt-service.now()});res.json(result.data);
  }));
  app.get('/shopper-api/session',gate,authenticated,wrap((req,res)=>res.json(service.read(auth(req)))));
  app.delete('/shopper-api/session',gate,wrap((req,res)=>{service.end(auth(req));res.clearCookie(cookies.session,options);res.sendStatus(204);}));
  app.post('/shopper-api/consent',gate,authenticated,guards,express.json({limit:'4kb'}),wrap((req,res)=>res.json(service.consent(auth(req),req.body))));
  app.post('/shopper-api/challenge',gate,authenticated,guards,express.json({limit:'6kb'}),wrap(async(req,res)=>res.json(await service.challenge(auth(req),req.body,service.ip(req)))));
  app.post('/shopper-api/avatar/approve',gate,authenticated,guards,express.json({limit:'1kb'}),wrap((req,res)=>res.json(service.approve(auth(req),req.body))));
  const workflow=(req,res,next)=>{try{service.workflow?.ready();if(!service.workflow)throw new Error();next();}catch(e){error(res,e);}};
  app.get('/shopper-api/verification.js',gate,authenticated,workflow,wrap((req,res)=>res.type('application/javascript').send(service.workflow.verificationClient.script)));
  app.get('/shopper-api/template',gate,authenticated,workflow,wrap(async(req,res)=>res.type('jpeg').send(await service.workflow.preview(auth(req),req.query))));
  app.get('/shopper-api/products',gate,authenticated,workflow,wrap((req,res)=>res.json(service.workflow.products(auth(req)))));
  app.post('/shopper-api/product',gate,authenticated,workflow,express.json({limit:'1kb'}),wrap((req,res)=>res.json(service.workflow.select(auth(req),req.body))));
  app.get('/shopper-api/product-image',gate,authenticated,workflow,wrap(async(req,res)=>res.type('jpeg').send(await service.workflow.productImage(auth(req),req.query.selection))));
  const verified=action=>(req,res,next)=>{try{
    if(!req.is('application/json'))return res.status(415).json({error:'Send a JSON image request.'});
    const current=service.proof(auth(req),action,req.get('X-Shopper-Consent'),req.get('X-Shopper-Proof'));
    // Claim the same global image slot before buffering/decoding the large body.
    // The deadline includes upload time, not just the remote image call.
    const lease=service.store.imageSlots.acquire({kind:'shopper',leaseMs:135000});
    if(!lease)throw new BillingError('image_busy','The studio is processing other images. Try again shortly.',429);
    const controller=new AbortController(),running=service.running.get(current.key)||new Set();running.add(controller);service.running.set(current.key,running);
    const stop=()=>{if(!res.writableFinished)controller.abort(new DOMException('Shopper disconnected.','AbortError'));cleanup();};
    const abort=()=>{if(!req.complete){req.destroy();}};
    const deadline=setTimeout(()=>controller.abort(new BillingError('shopper_timeout','This image request timed out. No automatic retry was sent.',504)),120000);deadline.unref();
    const watch=setInterval(()=>{try{service.auth(auth(req));service.store.imageSlots.assert(lease);}catch(e){controller.abort(e);}},250);watch.unref();
    const cleanup=()=>{clearTimeout(deadline);clearInterval(watch);controller.signal.removeEventListener('abort',abort);req.off('aborted',stop);res.off('close',stop);res.off('finish',cleanup);service.store.imageSlots.release(lease);running.delete(controller);if(!running.size)service.running.delete(current.key);};
    controller.signal.addEventListener('abort',abort,{once:true});req.once('aborted',stop);res.once('close',stop);res.once('finish',cleanup);
    req.shopperUpload={lease,controller,cleanup};if(req.aborted||res.destroyed){stop();return;}next();
  }catch(e){error(res,e);}};
  for(const action of ['avatar','tryon'])app.post('/shopper-api/'+action,gate,authenticated,workflow,verified(action),express.json({limit:'15mb',inflate:false}),wrap(async(req,res)=>{
    const {controller,lease,cleanup}=req.shopperUpload;
    try{controller.signal.throwIfAborted();const output=await service.workflow[action](auth(req),req.body,{consent:req.get('X-Shopper-Consent'),proof:req.get('X-Shopper-Proof')},{ip:service.ip(req),signal:controller.signal,uploadLease:lease});
      if(!controller.signal.aborted&&!res.destroyed)res.json({...output,session:service.read(auth(req))});
    }finally{cleanup();}
  }));
}

export function installShopperJsonErrors(app){
  app.use('/shopper-api',(err,req,res,next)=>{if(!err)return next();headers(res);res.status(err.status===413?413:err.status===400?400:err.status===415?415:503).json({error:err.status===413?'This shopper request exceeds the allowed size. Photos must each be under 5 MB.':'This shopper request could not be read. No automatic retry was sent.'});});
}
