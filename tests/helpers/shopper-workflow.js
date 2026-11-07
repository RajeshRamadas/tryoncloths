import {randomBytes,randomUUID} from 'node:crypto';
import {shopifyFixture,publicStudio} from './shopify-shopper.js';
import {standardAvatar} from '../../server/app.js';
import {ProviderError} from '../../server/provider-errors.js';
import {readFile} from 'node:fs/promises';

export const testDisclosure={revision:'reviewed-test-v1',privacyContact:'Test privacy contact: privacy@example.test',privacyUrl:'https://clothing.example.test/privacy',providerTermsUrl:'https://ai.google.dev/gemini-api/terms',processingText:'TEST DISCLOSURE ONLY. Google Gemini processes your photos. Test verification and moderation adapters are mocked; no photos leave this test server.',avatarText:'I request an AI avatar from my own face and full-body photos and approximate measurements. The store pays for this generation.',tryonText:'I request a separate AI clothing preview using my reviewed avatar and this store product. The store pays for this generation.'};
export const testVerificationClient={id:'test-captcha',script:`globalThis.FormeShopperVerification={id:'test-captcha',async challenge({signal}){signal.throwIfAborted();return crypto.randomUUID();},reset(){}};`};

export async function workflowFixture({workflowOptions={},sessionOptions={},appOptions={},secondProduct=false}={}){
  const output='data:image/png;base64,'+(await standardAvatar('regular')).toString('base64'),face='data:image/jpeg;base64,'+(await readFile('tests/fixtures/customers/red-plaid-face.jpg')).toString('base64'),body='data:image/jpeg;base64,'+(await readFile('tests/fixtures/customers/red-plaid-body.jpg')).toString('base64'),calls={avatar:[],tryon:[],moderation:[],verification:[]};let f,mode='',barrier=null,onGenerate=null;
  const generate=action=>async input=>{calls[action].push(input);onGenerate?.(input);if(barrier)await barrier;if(['quota','timeout','blocked'].includes(mode))throw new ProviderError(mode);if(mode==='unknown')throw new Error('private-provider-key-or-photo');return output;};
  f=await shopifyFixture({sessionOptions:{enabled:true,consentRevision:testDisclosure.revision,faceCheck:async()=>{if(mode==='face')throw new Error('bad face');},visibleCheck:async()=>{if(mode==='face')throw new Error('bad face');},captcha:{id:'test-captcha',verify:async input=>{calls.verification.push(input);return {success:mode!=='captcha',action:input.action,hostname:new URL(publicStudio).hostname,issuedAt:new Date(f.app.locals.shopperSessions.now()).toISOString()};}},moderation:{id:'test-moderation',check:async input=>{calls.moderation.push(input);if(mode==='moderation-down')throw new Error('private-adapter-body');return {allowed:mode!=='moderation'&&!(mode==='output-moderation'&&input.stage==='output'),policy:'adult-own-photo-v1'};}},...sessionOptions},appOptions:{provider:'gemini',apiKey:'test-key-only',personalize:generate('avatar'),tryOn:generate('tryon'),shopperWorkflowOptions:{enabled:true,disclosure:testDisclosure,verificationClient:testVerificationClient,...workflowOptions},...appOptions}});
  await f.install();const item=await f.product();await f.enable(item);let otherProduct;
  if(secondProduct){otherProduct=await f.product('456','White T-shirt');await f.service.setProduct(f.a,otherProduct.id,{enabled:true,revision:f.service.row(f.a.id).revision});}
  const sessions=f.app.locals.shopperSessions,workflow=f.app.locals.shopperWorkflow;
  const launch=()=>new URL(f.service.launch(f.proxy({launch_nonce:randomBytes(16).toString('hex')})));
  const request=(path,{method='GET',body,cookie='',csrf='',headers={},signal}={})=>fetch(f.base+'/shopper-api/'+path,{method,signal,headers:{Origin:publicStudio,Cookie:cookie,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Shopper-CSRF':csrf}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  async function open(){const response=await request('session',{method:'POST',body:{ticket:launch().hash.slice(8)}}),data=await response.json();return {cookie:response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),csrf:data.csrf,data};}
  async function authorize(browser,action='avatar'){
    const consent=await (await request('consent',{...browser,method:'POST',body:{action,provider:'gemini',revision:testDisclosure.revision,adult:true,ownPhotos:true,accepted:true}})).json();
    const proof=await (await request('challenge',{...browser,method:'POST',body:{action,consent:consent.consent,token:randomUUID()}})).json();
    return {'X-Shopper-Consent':consent.consent,'X-Shopper-Proof':proof.proof};
  }
  const avatarBody=()=>({requestId:randomUUID(),face,body,profileId:'regular',templateTone:'tan',measurements:{heightCm:175,weightKg:72}});
  return {...f,sessions,workflow,output,item,otherProduct,calls,launch,request,open,authorize,avatarBody,setGenerationMode:value=>{mode=value;},holdGeneration:value=>{barrier=value;},onGenerate:fn=>{onGenerate=fn;}};
}
