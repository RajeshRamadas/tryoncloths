import express from 'express';
import {randomBytes} from 'node:crypto';
import {escapeBrand} from './branding.js';
import {requireRole} from './tenancy.js';
import {shopperSessionPage} from './shopper-session-page.js';
import {shopperWorkflowPage} from './shopper-workflow-page.js';
const browserCookie=production=>production?'__Host-forme_shopify_oauth':'forme_shopify_oauth';
const cookie=(req,name)=>(req.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const rawQuery=req=>req.originalUrl.split('?').slice(1).join('?');
const headers=res=>res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
const page=(title,message)=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeBrand(title)}</title><style>body{max-width:600px;margin:10vh auto;padding:24px;font:18px/1.6 system-ui;color:#215b4a}a{color:inherit}</style><h1>${escapeBrand(title)}</h1><p>${escapeBrand(message)}</p><a href="/shopper-spending">Back to store settings</a></html>`;

export function installShopifyShopperPublic(app,service,{production=false,sessions}={}){
  if(!service)return;
  app.get('/shopify/callback',async(req,res)=>{
    headers(res);
    try{const redirect=await service.callback(rawQuery(req),cookie(req,browserCookie(production)));res.clearCookie(browserCookie(production),{path:'/',secure:production,httpOnly:true,sameSite:'lax'});res.redirect(303,redirect);}
    catch(e){res.status(e.status||502).type('html').send(page('Shopify connection not completed',e.status?e.message:'The connection could not be completed. Start a new connection from the store settings.'));}
  });
  app.post('/shopify/webhooks/:id/:epoch',express.raw({type:'application/json',limit:'128kb'}),async(req,res)=>{
    headers(res);try{await service.webhook(req.params.id,req.params.epoch,req.get('X-Shopify-Topic'),req.body,req.get('X-Shopify-Hmac-Sha256'));res.sendStatus(200);}
    catch(e){res.status(e.status||502).json({error:e.status?e.message:'Shopify lifecycle verification could not complete.'});}
  });
  app.get('/shopper/launch',(req,res)=>{
    headers(res);try{res.redirect(302,service.launch(rawQuery(req)));}
    catch(e){res.status(e.status||503).type('html').send(page('Try-on preview unavailable',e.status&&e.status<500?e.message:'This store preview is temporarily unavailable. Return to the product page and try again later.'));}
  });
  app.get('/shopper',(req,res)=>{
    const nonce=randomBytes(16).toString('base64'),verification=sessions?.workflow?.metadata()?sessions.workflow.verificationClient:{};
    headers(res).set('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}' ${(verification.scriptOrigins||[]).join(' ')}; style-src 'nonce-${nonce}'; connect-src 'self' ${(verification.connectOrigins||[]).join(' ')}; img-src 'self' data: blob:; frame-src ${(verification.frameOrigins?.length?verification.frameOrigins:["'none'"]).join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    if(sessions?.enabled&&sessions.workflow?.enabled)return res.type('html').send(shopperWorkflowPage(nonce));
    if(sessions?.enabled)return res.type('html').send(shopperSessionPage(nonce));
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Store try-on preview</title><style nonce="${nonce}">body{margin:0;background:#f7f8f4;color:#254b3b;font:17px/1.6 system-ui}main{max-width:600px;margin:6vh auto;padding:24px}header,section{padding:24px;border:1px solid #dce4da;border-radius:16px;background:white;margin-bottom:20px}header img{max-width:220px;max-height:80px}h1{font-size:30px;line-height:1.2}a{color:inherit;display:inline-block;padding:12px 0}p{overflow-wrap:anywhere}</style></head><body><main><header id="brand"><h1 id="name">Store try-on preview</h1></header><section><h2 id="product">Opening product…</h2><p id="message" role="status">Checking the store’s product launch.</p><a id="return" hidden>Return to product</a></section></main><script nonce="${nonce}">
    (async()=>{const p=new URLSearchParams(location.hash.slice(1)),ticket=p.get('launch');history.replaceState(null,'','/shopper');const text=document.getElementById('message');
    try{if(!ticket)throw new Error('Open the Try it on me button from a store product page.');const r=await fetch('/shopper-api/launch-preview',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});const d=await r.json();if(!r.ok)throw new Error(d.error||'This launch is unavailable.');document.getElementById('name').textContent=d.brand.displayName;document.getElementById('product').textContent=d.product.name;
    document.getElementById('brand').style.borderTop='6px solid '+d.brand.primaryColor;if(d.brand.logo){const logo=document.createElement('img');logo.src=d.brand.logo;logo.alt=d.brand.displayName+' logo';document.getElementById('brand').prepend(logo);}const a=document.getElementById('return');a.href=d.product.url;a.textContent='Return to product';a.hidden=false;text.textContent='This store connection is ready for setup preview. Customer photo upload and AI try-on are not available yet. No photos were collected and no AI credits were used.';
    }catch(e){document.getElementById('product').textContent='Try-on preview unavailable';text.textContent=e.message;}})();</script></body></html>`);
  });
  app.post('/shopper-api/launch-preview',express.json({limit:'1kb'}),(req,res)=>{
    headers(res);try{
      if(req.get('origin')!==service.ready())return res.status(403).json({error:'Open this preview from the hosted studio page.'});
      if(!req.body||Object.keys(req.body).some(k=>k!=='ticket'))return res.status(400).json({error:'Use a product launch ticket.'});
      const context=service.redeem(req.body.ticket),branding=service.store.branding.read(context.store),logo=service.store.branding.logo(context.store);
      res.json({stage:'launch-preview',shopperGenerationAvailable:false,product:context.product,brand:{displayName:branding.displayName,primaryColor:branding.primaryColor,logo:logo?'data:image/png;base64,'+Buffer.from(logo).toString('base64'):null}});
    }catch(e){res.status(e.status||503).json({error:e.status&&e.status<500?e.message:'This preview is temporarily unavailable. Return to the product page.'});}
  });
}

export function installShopifyShopperOwner(app,service,{requireUser,sameOrigin,wrap,production=false}){
  if(!service)return;const owner=requireRole('owner'),read=requireRole('owner','manager');
  app.get('/api/shopify-shopper',requireUser,read,wrap((req,res)=>res.json(service.summary(req.account))));
  app.get('/api/shopify-shopper/products',requireUser,read,wrap((req,res)=>res.json(service.browse(req.account,req.query))));
  app.post('/api/shopify-shopper/connect',sameOrigin,requireUser,owner,wrap((req,res)=>{
    const result=service.start(req.account,req.body,cookie(req,'forme_session'));
    res.cookie(browserCookie(production),result.browser,{secure:production,httpOnly:true,sameSite:'lax',path:'/',maxAge:10*60000});
    res.json({authorizationUrl:result.authorizationUrl});
  }));
  app.put('/api/shopify-shopper',sameOrigin,requireUser,owner,wrap((req,res)=>res.json(service.update(req.account,req.body))));
  app.delete('/api/shopify-shopper',sameOrigin,requireUser,owner,wrap((req,res)=>res.json(service.disconnect(req.account))));
  app.put('/api/shopify-shopper/products/:id',sameOrigin,requireUser,owner,wrap(async(req,res)=>res.json(await service.setProduct(req.account,req.params.id,req.body))));
}
