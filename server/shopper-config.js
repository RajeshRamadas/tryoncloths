import {stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createTurnstile} from './turnstile.js';
import {createGeminiModeration} from './gemini-moderation.js';

// An operator-supplied module is trusted server code, never an HTTP upload. Only
// these shopper dependencies are accepted; flags, billing and providers stay in
// the existing server configuration. No factory or provider probe is invoked.
export async function loadShopperConfiguration({env=process.env,production=true}={}){
  const source={status:'not-configured',code:'module_missing'},dependencies={};
  const filename=env.TRYON_SHOPPER_CONFIG_MODULE;
  if(filename){
    try{
      if(!path.isAbsolute(filename)||path.extname(filename)!=='.mjs')throw new Error();
      const file=await stat(filename);if(!file.isFile()||file.size>128*1024||file.mode&0o022)throw new Error();
      let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),5000);});
      let module;try{module=await Promise.race([import(pathToFileURL(filename).href),timeout]);}finally{clearTimeout(timer);}
      const config=module.default;
      if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(key=>!['disclosure','moderation','captcha','verificationClient'].includes(key)))throw new Error();
      Object.assign(dependencies,config);Object.assign(source,{status:'loaded',code:'module_loaded'});
    }catch{Object.assign(source,{status:'invalid',code:'module_invalid'});}
  }
  if(env.TRYON_SHOPPER_CAPTCHA){
    try{
      if(env.TRYON_SHOPPER_CAPTCHA!=='turnstile'||dependencies.captcha||dependencies.verificationClient)throw new Error();
      Object.assign(dependencies,createTurnstile({siteKey:env.TRYON_TURNSTILE_SITE_KEY,secretKey:env.TRYON_TURNSTILE_SECRET_KEY,production}));
    }catch{Object.assign(source,{status:'invalid',code:'verification_invalid'});}
  }
  if(env.TRYON_SHOPPER_MODERATION){
    try{
      if(env.TRYON_SHOPPER_MODERATION!=='gemini'||dependencies.moderation)throw new Error();
      dependencies.moderation=createGeminiModeration({apiKey:env.TRYON_SHOPPER_MODERATION_API_KEY||env.TRYON_GEMINI_API_KEY,model:env.TRYON_SHOPPER_MODERATION_MODEL||undefined});
    }catch{Object.assign(source,{status:'invalid',code:'moderation_invalid'});}
  }
  if(source.status==='invalid')return {source,shopperSessionOptions:{consentRevision:'',captcha:undefined,moderation:undefined},shopperWorkflowOptions:{disclosure:undefined,verificationClient:undefined}};
  const {disclosure,moderation,captcha,verificationClient}=dependencies;
  if(disclosure?.revision&&env.TRYON_SHOPPER_CONSENT_REVISION&&disclosure.revision!==env.TRYON_SHOPPER_CONSENT_REVISION)return {source:{status:'invalid',code:'consent_revision_mismatch'},shopperSessionOptions:{consentRevision:'',captcha:undefined,moderation:undefined},shopperWorkflowOptions:{disclosure:undefined,verificationClient:undefined}};
  return {source,shopperSessionOptions:{consentRevision:disclosure?.revision||env.TRYON_SHOPPER_CONSENT_REVISION||'',moderation,captcha},shopperWorkflowOptions:{disclosure,verificationClient}};
}
