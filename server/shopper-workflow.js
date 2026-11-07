import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {profiles,skinTones,recommendProfile,validTemplateTone,DEFAULT_TEMPLATE_TONE} from '../src/profiles.js';
import {BillingError} from './billing.js';
import {parseProductUrl} from './public-url.js';
import {GEMINI_REFERENCE_VERSION} from './gemini.js';
import {TRYON_CONTRACT} from './gemini-tryon.js';

const fail=(message,status=400,code='shopper_request_invalid')=>new BillingError(code,message,status);
const only=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const digest=value=>createHash('sha256').update(value).digest('hex');
const publicLink=value=>{const url=parseProductUrl(value);if(url.protocol!=='https:')throw new Error('HTTPS required.');return url.href;};
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);

// All adapters, disclosure wording and CSP origins are trusted server configuration,
// never supplied by a shopper. Missing launch review keeps the flow unavailable.
export class ShopperWorkflow {
  constructor(sessions,{enabled=process.env.TRYON_SHOPPER_WORKFLOW==='true',apiKey,model,quality,personalize,tryOn,template,femaleEnabled=false,disclosure,verificationClient}={}){
    Object.assign(this,{sessions,enabled,apiKey,model,quality,personalize,tryOn,template,femaleEnabled,disclosure,verificationClient});this.previews=new Map();
  }
  ready(){
    this.sessions.guardReady();const d=this.disclosure,v=this.verificationClient;
    try{
      if(!this.enabled||this.sessions.provider!=='gemini'||typeof this.apiKey!=='string'||!this.apiKey.trim()||!text(this.model,100)||!/^[a-zA-Z0-9.-]+$/.test(this.model)||typeof this.personalize!=='function'||typeof this.tryOn!=='function'||typeof this.template!=='function')throw new Error();
      if(!d||d.revision!==this.sessions.consentRevision||!['privacyContact','processingText','avatarText','tryonText'].every(key=>text(d[key],key==='privacyContact'?200:4000)))throw new Error();
      publicLink(d.privacyUrl);publicLink(d.providerTermsUrl);
      if(!v||v.id!==this.sessions.captcha.id||typeof v.script!=='string'||!v.script.trim()||Buffer.byteLength(v.script)>128*1024)throw new Error();
      for(const key of ['scriptOrigins','connectOrigins','frameOrigins']){
        if(v[key]!==undefined&&(!Array.isArray(v[key])||v[key].length>6))throw new Error();
        for(const origin of v[key]||[])if(new URL(publicLink(origin)).origin!==origin)throw new Error();
      }
    }catch{throw fail('Shopper photo generation is not enabled for this store. No photos have been sent.',503,'shopper_workflow_unavailable');}
  }
  metadata(){
    try{this.ready();}catch{return null;}
    const d=this.disclosure;
    return {providerLabel:'Google Gemini',disclosure:{revision:d.revision,privacyContact:d.privacyContact,processingText:d.processingText,avatarText:d.avatarText,tryonText:d.tryonText,privacyUrl:publicLink(d.privacyUrl),providerTermsUrl:publicLink(d.providerTermsUrl)},
      profiles:profiles.filter(p=>this.femaleEnabled||p.body==='male').map(({id,name,description,body})=>({id,name,description,body})),skinTones,defaultTemplateTone:DEFAULT_TEMPLATE_TONE,
      verificationProvider:this.verificationClient.id,generationRevision:GEMINI_REFERENCE_VERSION,tryOnContract:TRYON_CONTRACT};
  }
  avatarOptions(input){
    if(!only(input,['requestId','face','body','profileId','templateTone','measurements'])||!only(input.measurements,['heightCm','weightKg'])||Object.keys(input.measurements).length!==2)throw fail('Use two photos, an available body reference and approximate height/weight.');
    const profile=profiles.find(p=>p.id===input.profileId),tone=input.templateTone??DEFAULT_TEMPLATE_TONE;
    if(!profile||profile.body==='female'&&!this.femaleEnabled||!validTemplateTone(tone)||!recommendProfile(input.measurements.heightCm,input.measurements.weightKg,profile.body))throw fail('Choose an available body and complexion reference with height 140–210 cm (female: up to 200 cm) and weight 35–200 kg.');
    return {profileId:profile.id,templateTone:tone,measurements:{heightCm:input.measurements.heightCm,weightKg:input.measurements.weightKg}};
  }
  async avatar(auth,input,authorization,options){
    this.ready();const selected=this.avatarOptions(input);
    return this.sessions.run(auth,{...authorization,requestId:input.requestId,action:'avatar',images:{face:input.face,body:input.body}},async({images,signal})=>{
      const avatar=await this.template(selected.profileId,selected.templateTone);signal.throwIfAborted();
      return this.personalize({...images,avatar,...selected,apiKey:this.apiKey,model:this.model,quality:this.quality,signal});
    },{...options,metadata:{...selected,generationRevision:GEMINI_REFERENCE_VERSION}});
  }
  async tryon(auth,input,authorization,options){
    this.ready();if(!only(input,['requestId','avatar']))throw fail('Use the reviewed session avatar and current store product.');
    return this.sessions.run(auth,{...authorization,requestId:input.requestId,action:'tryon',images:{avatar:input.avatar}},({images,context,signal})=>this.tryOn({...images,garmentType:context.product.garmentType,title:context.product.name,apiKey:this.apiKey,model:this.model,signal}),{...options,metadata:{tryOnContract:TRYON_CONTRACT}});
  }
  choices(auth){
    this.ready();const current=this.sessions.auth(auth,{mutate:false}),shopify=this.sessions.shopify,row=shopify.row(current.session.context.store);
    const products=shopify.products(row),initial=shopify.products(row,{garmentId:current.session.context.garmentId})[0];
    const candidates=[...(initial?[initial]:[]),...products.filter(p=>p.id!==initial?.id)].slice(0,50),choices=[];
    for(const product of candidates){if(!product.enabled||!product.eligible)continue;try{
      const context=shopify.launchContext(row,product.externalId.split('/').pop());
      choices.push({context,selection:this.sessions.hmac('product-choice',current.key+'|'+digest(JSON.stringify(context)))});
    }catch{/* An invalid product is never advertised as selectable. */}}
    return {current,choices};
  }
  products(auth){const {current,choices}=this.choices(auth);return {products:choices.map(({selection,context})=>({selection,...context.product,selected:context.garmentId===current.session.context.garmentId}))};}
  select(auth,input){
    if(!only(input,['selection'])||typeof input.selection!=='string')throw fail('Choose a product offered by this store.');
    return this.sessions.state.transaction(()=>{
      const {current,choices}=this.choices(auth);this.sessions.auth(auth);
      if(current.session.activeAttempt)throw fail('Wait for the current image attempt before changing products.',409,'shopper_image_busy');
      const choice=choices.find(p=>p.selection===input.selection);if(!choice)throw fail('This product selection is no longer available.',403,'shopper_product_invalid');
      current.session.context=choice.context;this.sessions.save('session',current.key,current.session,current.session.expiresAt);
      this.sessions.state.db.prepare("DELETE FROM shopper_state WHERE kind IN ('consent','proof') AND json_extract(value,'$.session')=?").run(current.key);
      return this.sessions.describe(current.raw,current.session);
    });
  }
  async productImage(auth,selection){
    const choice=this.choices(auth).choices.find(p=>p.selection===selection);if(!choice)throw fail('This product image is unavailable.',404);
    const image=this.sessions.store.db.prepare('SELECT image FROM garments WHERE account=? AND id=?').get(choice.context.store,choice.context.garmentId)?.image;
    return sharp(Buffer.from(image),{limitInputPixels:12000000}).resize(240,300,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
  }
  async preview(auth,query){
    this.ready();this.sessions.auth(auth,{mutate:false});if(!only(query,['profile','tone']))throw fail('Choose a body reference.');
    const profile=profiles.find(p=>p.id===query.profile),tone=query.tone||DEFAULT_TEMPLATE_TONE;
    if(!profile||profile.body==='female'&&!this.femaleEnabled||!validTemplateTone(tone))throw fail('Choose an available body and complexion reference.');
    const key=profile.id+':'+tone;if(!this.previews.has(key))this.previews.set(key,await sharp(await this.template(profile.id,tone)).resize(240,360,{fit:'inside'}).jpeg({quality:80}).toBuffer());return this.previews.get(key);
  }
}
