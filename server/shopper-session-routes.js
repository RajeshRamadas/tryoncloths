import express from 'express';
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
}

export function installShopperJsonErrors(app){
  app.use('/shopper-api',(err,req,res,next)=>{if(!err)return next();headers(res);res.status(err.status===413?413:err.status===400?400:503).json({error:err.status===413?'This shopper action accepts only a small JSON request.':'This shopper request could not be read. No automatic retry was sent.'});});
}
