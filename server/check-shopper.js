import {access,stat,statfs,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {loadShopperConfiguration} from './shopper-config.js';
import {ShopifyShopper} from './shopify-shopper.js';
import {ShopperSessions} from './shopper-sessions.js';
import {ShopperWorkflow} from './shopper-workflow.js';
import {geminiPersonalize} from './gemini.js';
import {geminiTryOn} from './gemini-tryon.js';
import {standardAvatar} from './app.js';
import {liveShopperChecks} from './shopper-readiness.js';

// Offline preflight: inspect configuration and directory accessibility only.
// Do not open/migrate account databases, create state files or probe providers.
export async function checkShopperConfiguration({env=process.env}={}){
  const config=await loadShopperConfiguration({env,production:true}),checks=[];
  const check=(id,ok,detail)=>checks.push({id,state:ok?'pass':'blocked',detail});
  const provider={provider:env.TRYON_PROVIDER||'gemini',apiKey:env.TRYON_GEMINI_API_KEY,model:env.TRYON_GEMINI_MODEL||'gemini-2.5-flash-image'};
  const shopify=new ShopifyShopper({db:null},{clientId:env.SHOPIFY_APP_CLIENT_ID||'',clientSecret:env.SHOPIFY_APP_CLIENT_SECRET||'',secretKey:env.TRYON_SECRET_KEY||'',publicUrl:env.TRYON_PUBLIC_URL||'',version:env.SHOPIFY_API_VERSION||'2026-10',state:{}});
  const sessions=new ShopperSessions(shopify,{...config.shopperSessionOptions,enabled:env.TRYON_SHOPPER_SESSIONS==='true',provider:provider.provider,trustProxy:env.TRYON_TRUST_PROXY_HOPS==='1'?1:false,trustedProxies:env.TRYON_SHOPPER_PROXY_CIDRS||''});
  const workflow=new ShopperWorkflow(sessions,{...provider,...config.shopperWorkflowOptions,enabled:env.TRYON_SHOPPER_WORKFLOW==='true',personalize:geminiPersonalize,tryOn:geminiTryOn,template:standardAvatar});
  const shape=workflow.configuration();
  check('module',config.source.status==='loaded','Load a readable, bounded .mjs service module without group/world write permission.');
  check('sessions',sessions.enabled,'Enable temporary shopper sessions after the independent launch review.');
  check('workflow',workflow.enabled,'Enable the shopper workflow after the independent launch review.');
  let shopifyReady=false;try{shopify.ready();shopifyReady=true;}catch{}
  check('shopify',shopifyReady,'Configure Shopify app credentials, the persistent secret key and public HTTPS studio origin.');
  check('provider',Boolean(shape.provider),'Configure Gemini and an image model. This is not a quota, billing or image-quality probe.');
  check('verification',Boolean(shape.verificationClient&&typeof sessions.captcha?.verify==='function'),'Configure matching server verification and browser widget dependencies.');
  check('moderation',Boolean(typeof sessions.moderation?.check==='function'&&/^[a-z0-9-]{1,60}$/.test(sessions.moderation?.id||'')),'Configure a reviewed input/output safety policy adapter.');
  check('disclosure',Boolean(shape.disclosure),'Configure reviewed disclosure text, contact, policy/terms URLs and matching consent revision.');
  check('proxy',env.TRYON_TRUST_PROXY_HOPS==='1'&&!sessions.proxyError&&sessions.proxyCount>0,'Use one explicitly trusted proxy peer for client-IP limits.');
  async function directory(value,{tmpfs=false}={}){try{if(!value||!path.isAbsolute(value))return false;const meta=await stat(value);if(!meta.isDirectory()||tmpfs&&(meta.mode&0o077||meta.uid!==process.getuid()))return false;await access(value,constants.R_OK|constants.W_OK);const stats=await statfs(value);return !tmpfs||Number(stats.type)===0x01021994;}catch{return false;}}
  check('account-directory',await directory(env.TRYON_DATA_DIR),'The existing account directory must be absolute and accessible; this check makes no database writes.');
  check('state-directory',await directory(env.TRYON_SHOPPER_STATE_DIR,{tmpfs:true}),'Use a writable dedicated tmpfs directory outside the persistent account volume.');
  let separate=false;try{const relative=path.relative(await realpath(env.TRYON_DATA_DIR),await realpath(env.TRYON_SHOPPER_STATE_DIR));separate=relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative);}catch{}
  check('storage-separation',separate,'Transient capability state must be outside the persistent account/backup directory.');
  const constrained=process.constrainedMemory();
  return {schemaVersion:1,scope:'offline-server-configuration',configurationReady:checks.every(c=>c.state==='pass'),liveVerified:false,source:config.source,checks,
    runtime:{nodeMajor:Number(process.versions.node.split('.')[0]),memoryLimitMiB:Math.floor(Math.min(os.totalmem(),constrained>0?constrained:Infinity)/1048576)},manualChecks:liveShopperChecks.map(c=>({...c,state:'unverified'}))};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const result=await checkShopperConfiguration();console.log(JSON.stringify(result));process.exitCode=result.configurationReady?0:1;}
  catch{console.log(JSON.stringify({schemaVersion:1,scope:'offline-server-configuration',configurationReady:false,liveVerified:false,error:'Preflight could not complete. Check server configuration locally.'}));process.exitCode=1;}
}
