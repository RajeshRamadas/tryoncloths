import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {AccountStore} from './pilot-accounts.js';
import {createApp} from '../../server/app.js';
import {ShopperState} from '../../server/shopper-state.js';

export const shopifySecret='test-shopify-client-secret-long';
export const publicStudio='https://studio.example.test';
export function signedQuery(values,{proxy=false,secret=shopifySecret}={}){
  const pairs=Object.entries(values).sort(([a],[b])=>a.localeCompare(b)),query=new URLSearchParams();
  for(const [key,value] of pairs)for(const v of Array.isArray(value)?value:[value])query.append(key,String(v));
  const canonical=proxy?pairs.map(([key,value])=>key+'='+(Array.isArray(value)?value.join(','):value)).join(''):query.toString();
  query.set(proxy?'signature':'hmac',createHmac('sha256',secret).update(canonical).digest('hex'));return query.toString();
}
const json=(data,status=200)=>({status,body:Buffer.from(JSON.stringify(data))});
export async function shopifyFixture({sessionOptions={},trustProxy=false}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'forme-shopify-')),store=new AccountStore(directory);
  const a=await store.register({name:'River Clothing',email:'river@example.test',password:'test-password-long'}),b=await store.register({name:'Other shop',email:'other@example.test',password:'test-password-long'});
  store.db.prepare("UPDATE orgs SET plan='growth' WHERE id=?").run(a.org);store.db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(b.user.id,a.id);
  const manager=store.identity(b.user.id,a.id),staffToken=store.session(a),managerToken=store.session(manager),otherToken=store.session(b);
  const transientDb=new DatabaseSync(':memory:');let clock=Date.now(),primaryHost='clothing.example.test',mode='',barrier=null,ai=0,onHook=null;
  const state=new ShopperState({db:transientDb,now:()=>clock}),calls=[],subscriptions=new Map();let subscriptionSequence=0;
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});if(barrier)await barrier;
    if(mode==='network')throw new Error('private-token-provider-body');
    if(url.endsWith('/access_token'))return json({access_token:'shpat_private-offline-test-token',scope:mode==='scope'?'read_orders':'read_products'},mode==='token-error'?401:200);
    const {query,variables}=JSON.parse(options.body);
    if(query.includes('webhookSubscriptions('))return json({data:{webhookSubscriptions:{nodes:[...subscriptions.values()],pageInfo:{hasNextPage:false,endCursor:null}}}});
    if(query.includes('webhookSubscriptionDelete(')){subscriptions.delete(variables.id);return json({data:{webhookSubscriptionDelete:{deletedWebhookSubscriptionId:variables.id,userErrors:[]}}});}
    if(query.includes('product(id:'))return json({data:{product:{id:variables.id,status:'ACTIVE',onlineStoreUrl:mode==='unpublished'?null:'https://'+primaryHost+'/products/shirt-'+variables.id.split('/').pop()}}});
    if(query.startsWith('query'))return json({data:{shop:{id:'gid://shopify/Shop/42',myshopifyDomain:mode==='shop-mismatch'?'elsewhere.myshopify.com':'sample.myshopify.com',primaryDomain:{host:primaryHost,url:'https://'+primaryHost+'/'}}}});
    const bad=mode==='webhook-error'||mode==='partial-webhook-error'&&variables.topic==='SHOP_UPDATE';
    const registered=bad?null:{id:'gid://shopify/WebhookSubscription/'+(++subscriptionSequence),topic:variables.topic};if(registered)subscriptions.set(registered.id,registered);
    if(onHook)await onHook(variables);
    return json({data:{webhookSubscriptionCreate:{webhookSubscription:registered,userErrors:bad?[{message:'private-token-provider-body'}]:[]}}});
  };
  const options={clientId:'test-client-id-1234',clientSecret:shopifySecret,secretKey:'ab'.repeat(32),publicUrl:publicStudio,state,fetchImpl,now:()=>clock};
  const app=createApp({accountStore:store,accessMode:'public',trustProxy,shopifyShopperOptions:options,shopperSessionOptions:{now:()=>clock,...sessionOptions},personalize:async()=>{ai++;throw new Error('Unexpected AI');},tryOn:async()=>{ai++;throw new Error('Unexpected AI');}}),service=app.locals.shopifyShopper;
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const request=(url,method='GET',body,session=staffToken,origin=base,extra={})=>fetch(base+url,{method,redirect:'manual',headers:{Origin:origin,Cookie:session?`forme_session=${session}`:'','Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const timestamp=()=>String(Math.floor(clock/1000));
  async function install(){const start=service.start(a,{shopDomain:'sample.myshopify.com'},staffToken),state=new URL(start.authorizationUrl).searchParams.get('state');await service.callback(signedQuery({shop:'sample.myshopify.com',timestamp:timestamp(),state,code:'test-code'}),start.browser);return service.row(a.id);}
  async function product(id='123',name='Blue shirt'){
    const image='data:image/png;base64,'+(await sharp({create:{width:192,height:256,channels:3,background:'#4466aa'}}).png().toBuffer()).toString('base64');
    const item=(await store.garments.save(a,{image,name,garmentType:'shirt',variant:'M-'+id,sourceUrl:'https://clothing.example.test/products/shirt-'+id})).garment;
    store.db.prepare("UPDATE garments SET source='shopify',externalId=? WHERE account=? AND id=?").run('gid://shopify/Product/'+id,a.id,item.id);
    store.db.prepare("INSERT INTO catalogue_source_origins VALUES(?,'shopify','https://sample.myshopify.com') ON CONFLICT(store,provider) DO UPDATE SET baseUrl=excluded.baseUrl").run(a.id);
    return item;
  }
  function configure(){const p=store.shoppers.view(a);store.shoppers.update(a,{storeLimit:50,organisationLimit:200,paused:false,storeRevision:p.storeRevision,organisationRevision:p.organisationRevision});}
  async function enable(item){configure();let row=service.row(a.id);await service.setProduct(a,item.id,{enabled:true,revision:row.revision});row=service.row(a.id);service.update(a,{enabled:true,revision:row.revision});}
  const proxy=(extra={})=>signedQuery({shop:'sample.myshopify.com',timestamp:timestamp(),product_id:'123',launch_nonce:'12'.repeat(16),path_prefix:'/apps/forme-tryon',logged_in_customer_id:'',...extra},{proxy:true});
  async function webhook(topic,body={id:42,myshopify_domain:'sample.myshopify.com'},row=service.row(a.id)){
    const bytes=Buffer.from(JSON.stringify(body)),signature=createHmac('sha256',shopifySecret).update(bytes).digest('base64');return fetch(base+`/shopify/webhooks/${row.id}/${row.webhookEpoch}`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Hmac-Sha256':signature,'X-Shopify-Topic':topic},body:bytes});
  }
  return {directory,store,a,b,manager,staffToken,managerToken,otherToken,state,transientDb,options,app,service,base,request,calls,subscriptions,install,product,enable,configure,proxy,timestamp,webhook,
    ai:()=>ai,setMode:value=>{mode=value;},setHost:value=>{primaryHost=value;},advance:value=>{clock+=value;},block:value=>{barrier=value;},
    onHook:value=>{onHook=value;},
    close:async()=>{await new Promise(r=>server.close(r));transientDb.close();store.close();await rm(directory,{recursive:true,force:true});}};
}
