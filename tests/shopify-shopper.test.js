import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {statfsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Any existing absolute directory that is normally not tmpfs (the repository checkout).
const nonTmpfsDirectory=fileURLToPath(new URL('..',import.meta.url));
import {shopifyFixture,signedQuery,shopifySecret,publicStudio} from './helpers/shopify-shopper.js';
import {verifyShopifyQuery,shopDomain} from '../server/shopify-security.js';
import {ShopifyShopper,digest} from '../server/shopify-shopper.js';
import {ShopperState} from '../server/shopper-state.js';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp} from '../server/app.js';
const fixture=run=>async()=>{const f=await shopifyFixture();try{await run(f);}finally{await f.close();}};

test('Shopify query verification follows admin/app-proxy canonicalization and rejects forged, stale, malformed and ambiguous parameters',()=>{
  const now=1700000000000;
  const canonical='extra=1,2launch_nonce='+ '12'.repeat(16)+'path_prefix=/apps/forme-tryonproduct_id=123shop=sample.myshopify.comtimestamp=1700000000';
  const signature=createHmac('sha256',shopifySecret).update(canonical).digest('hex');
  const raw='extra=1&extra=2&launch_nonce='+ '12'.repeat(16)+'&path_prefix=%2Fapps%2Fforme-tryon&product_id=123&shop=sample.myshopify.com&timestamp=1700000000&signature='+signature;
  assert.equal(verifyShopifyQuery(raw,shopifySecret,{proxy:true,now}).shop,'sample.myshopify.com');
  for(const invalid of [raw.replace('123','124'),raw+'&signature='+signature,raw+'&product_id=321',raw+'&hmac='+signature,raw.replace('sample.myshopify.com','127.0.0.1'),raw+'&bad=%ZZ'])assert.throws(()=>verifyShopifyQuery(invalid,shopifySecret,{proxy:true,now}));
  assert.throws(()=>verifyShopifyQuery(raw,shopifySecret,{proxy:true,now:now+91000}));
  const oauth=signedQuery({shop:'sample.myshopify.com',timestamp:'1700000000',code:'code with & ? + %',state:'random-state'});
  assert.equal(verifyShopifyQuery(oauth,shopifySecret,{now}).params.get('code'),'code with & ? + %');
  assert.throws(()=>verifyShopifyQuery(oauth+'&state=other',shopifySecret,{now}));
  for(const domain of ['https://bad.test','user:pass@sample.myshopify.com','sample.myshopify.com:443','sample.myshopify.com/path','sample.myshopify.com?x=y'])assert.throws(()=>shopDomain(domain));
});

test('OAuth binds shop, browser and live owner session, stores encrypted tokens only after identity/webhook verification and never spends credits',fixture(async f=>{
  const {service,a,staffToken,store,calls}=f,balance=store.billing.balance(a.org),start=service.start(a,{shopDomain:'sample.myshopify.com'},staffToken),url=new URL(start.authorizationUrl);
  assert.equal(url.origin,'https://sample.myshopify.com');assert.equal(url.searchParams.get('scope'),'read_products');assert.equal(url.searchParams.get('redirect_uri'),publicStudio+'/shopify/callback');
  const query=signedQuery({shop:'sample.myshopify.com',timestamp:f.timestamp(),state:url.searchParams.get('state'),code:'test-code'});
  await assert.rejects(service.callback(query,'wrong-browser'),{status:403});assert.equal(calls.length,0);
  assert.equal(await service.callback(query,start.browser),publicStudio+'/shopify-shopper');const row=service.row(a.id);
  assert.equal(row.enabled,0);assert.equal(row.primaryHost,'clothing.example.test');assert.ok(!row.credentials.includes('shpat_private'));assert.equal(calls.length,7);
  assert.ok(calls.every(c=>!c.url.includes('shpat_private')));assert.equal(calls.filter(c=>c.url.endsWith('graphql.json')&&JSON.parse(c.options.body).query.includes('webhookSubscriptionCreate')).length,4);
  const summary=JSON.stringify(service.summary(a));assert.ok(!summary.includes('credentials'));assert.ok(!summary.includes('client-secret'));assert.ok(!summary.includes('shpat_private'));assert.equal(store.billing.balance(a.org),balance);assert.equal(f.ai(),0);
  await assert.rejects(service.callback(query,start.browser),{status:403});assert.equal(calls.length,7);
  const reopened=new AccountStore(f.directory);try{assert.equal(reopened.db.prepare('SELECT status FROM shopper_shopify_installations').get().status,'installed');}finally{reopened.close();}
}));

test('OAuth state expiry, role/session changes, wrong shop, provider errors and webhook registration failure never install',fixture(async f=>{
  for(const mode of ['scope','shop-mismatch','webhook-error','token-error','network']){
    f.setMode(mode);const start=f.service.start(f.a,{shopDomain:'sample.myshopify.com'},f.staffToken),state=new URL(start.authorizationUrl).searchParams.get('state');
    await assert.rejects(f.service.callback(signedQuery({shop:'sample.myshopify.com',timestamp:f.timestamp(),state,code:'test'}),start.browser));assert.equal(f.service.row(f.a.id),undefined);
  }
  f.setMode('');let start=f.service.start(f.a,{shopDomain:'sample.myshopify.com'},f.staffToken),state=new URL(start.authorizationUrl).searchParams.get('state');
  f.advance(10*60000+1);await assert.rejects(f.service.callback(signedQuery({shop:'sample.myshopify.com',timestamp:f.timestamp(),state,code:'test'}),start.browser),{status:403});
  start=f.service.start(f.a,{shopDomain:'sample.myshopify.com'},f.staffToken);state=new URL(start.authorizationUrl).searchParams.get('state');
  await assert.rejects(f.service.callback(signedQuery({shop:'other.myshopify.com',timestamp:f.timestamp(),state,code:'test'}),start.browser),{status:403});
  f.store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(f.a.user.id,f.a.id);
  await assert.rejects(f.service.callback(signedQuery({shop:'sample.myshopify.com',timestamp:f.timestamp(),state,code:'test'}),start.browser),{status:403});assert.equal(f.service.row(f.a.id),undefined);
}));

test('HTTP OAuth callback works outside protected API auth, requires the separate Lax cookie and removes codes from the final URL',fixture(async f=>{
  const token='x'.repeat(32),app=createApp({production:true,accountStore:f.store,accessMode:'protected',mobileToken:token,shopifyShopperOptions:f.options}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const result=await fetch(base+'/api/shopify-shopper/connect',{method:'POST',headers:{Authorization:'Bearer '+token,Cookie:'forme_session='+f.staffToken,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({shopDomain:'sample.myshopify.com'})});
    assert.equal(result.status,200);const authorization=await result.json(),cookie=result.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/^__Host-forme_shopify_oauth=/);assert.match(cookie,/Secure/);assert.match(cookie,/Path=\//);assert.ok(!cookie.includes('Domain='));
    const query=signedQuery({shop:'sample.myshopify.com',timestamp:f.timestamp(),state:new URL(authorization.authorizationUrl).searchParams.get('state'),code:'private-one-time-code'});
    assert.equal((await fetch(base+'/shopify/callback?'+query,{redirect:'manual'})).status,403);
    const callback=await fetch(base+'/shopify/callback?'+query,{headers:{Cookie:cookie.split(';')[0]},redirect:'manual'});assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),publicStudio+'/shopify-shopper');assert.equal(callback.headers.get('referrer-policy'),'no-referrer');assert.match(callback.headers.get('set-cookie'),/Expires=/);
  }finally{await new Promise(r=>server.close(r));}
}));

test('owner logout or demotion during token exchange prevents installation and later provider writes',fixture(async f=>{
  let start=f.service.start(f.a,{shopDomain:'sample.myshopify.com'},f.staffToken),state=new URL(start.authorizationUrl).searchParams.get('state');
  f.store.logout(f.staffToken);await assert.rejects(f.service.callback(signedQuery({shop:'sample.myshopify.com',timestamp:f.timestamp(),state,code:'test'}),start.browser),{status:403});assert.equal(f.calls.length,0);
  const session=f.store.session(f.a);start=f.service.start(f.a,{shopDomain:'sample.myshopify.com'},session);state=new URL(start.authorizationUrl).searchParams.get('state');let release;
  f.block(new Promise(r=>{release=r;}));const running=f.service.callback(signedQuery({shop:'sample.myshopify.com',timestamp:f.timestamp(),state,code:'test'}),start.browser);
  try{assert.equal(f.calls.length,1);f.store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(f.a.user.id,f.a.id);}finally{f.block(null);release();}
  await assert.rejects(running,{status:403});assert.equal(f.calls.length,1);assert.equal(f.service.row(f.a.id),undefined);
}));

test('product paging and exact-id selection work beyond the first page and reject unmapped origins and unsafe return URLs',fixture(async f=>{
  await f.install();const original=await f.product(),row=f.store.db.prepare('SELECT * FROM garments WHERE account=? AND id=?').get(f.a.id,original.id),columns=Object.keys(row);
  const insert=f.store.db.prepare(`INSERT INTO garments(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
  for(let i=1;i<=60;i++){const extra={...row,id:'page-'+i,name:'Z product '+String(i).padStart(3,'0'),variant:'variant-'+i,externalId:'gid://shopify/Product/'+(1000+i),sourceUrl:'https://clothing.example.test/products/shirt-'+(1000+i)};insert.run(...columns.map(k=>extra[k]));}
  assert.equal(f.service.browse(f.a,{offset:'50'}).products.length,11);f.configure();const connection=f.service.row(f.a.id);await f.service.setProduct(f.a,'page-60',{enabled:true,revision:connection.revision});f.service.update(f.a,{enabled:true,revision:f.service.row(f.a.id).revision});assert.ok(f.service.launch(f.proxy({product_id:'1060'})));
  assert.equal(f.service.browse(f.a,{search:'Z product 060'}).products.length,1);assert.throws(()=>f.service.browse(f.a,{offset:'-1'}),{status:400});
  f.store.db.prepare('UPDATE garments SET sourceUrl=? WHERE account=? AND id=?').run('https://attacker.example.test/products/stolen',f.a.id,'page-60');f.advance(1000);assert.throws(()=>f.service.launch(f.proxy({product_id:'1060'})),{status:409});
  f.store.db.prepare("UPDATE catalogue_source_origins SET baseUrl='https://other.myshopify.com' WHERE store=? AND provider='shopify'").run(f.a.id);assert.equal(f.service.browse(f.a).products.length,0);
}));

test('owner role/store/origin matrix protects every connection and product route; another store cannot claim an installed shop',fixture(async f=>{
  const {request,managerToken,otherToken,store,a,b}=f;
  const paths=[['/api/shopify-shopper','GET'],['/api/shopify-shopper/products','GET'],['/api/shopify-shopper/connect','POST'],['/api/shopify-shopper','PUT'],['/api/shopify-shopper','DELETE'],['/api/shopify-shopper/products/fake','PUT']];
  for(const [url,method] of paths){const body=method==='GET'?undefined:{};assert.equal((await request(url,method,body,'')).status,401);if(!['GET'].includes(method))assert.equal((await request(url,method,body,managerToken)).status,403);}
  assert.equal((await request('/api/shopify-shopper','GET',undefined,managerToken)).status,200);
  assert.equal((await request('/api/shopify-shopper/connect','POST',{shopDomain:'sample.myshopify.com'},f.staffToken,'https://bad.test')).status,403);
  await f.install();await assert.rejects(Promise.resolve().then(()=>f.service.start(b,{shopDomain:'sample.myshopify.com'},otherToken)),{status:409});
  assert.equal((await (await request('/api/shopify-shopper','GET',undefined,otherToken)).json()).installation,null);
  const item=await f.product();assert.equal((await request('/api/shopify-shopper/products/'+item.id,'PUT',{enabled:true,revision:f.service.row(a.id).revision},otherToken)).status,409);
  store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(b.user.id,a.id);for(const [url,method] of paths)assert.equal((await request(url,method,method==='GET'?undefined:{},managerToken)).status,403);
}));

test('verified product launch is single-use and revision-bound, survives protected API mode, and exposes only safe branding/product metadata',fixture(async f=>{
  await f.install();const item=await f.product();await f.enable(item);await f.store.branding.update(f.a,{displayName:'<River> & Co',primaryColor:'#224466'});
  const url=f.service.launch(f.proxy()),ticket=new URL(url).hash.slice('#launch='.length);assert.equal(new URL(url).origin,publicStudio);assert.ok(!url.includes(f.a.id));
  assert.throws(()=>f.service.launch(f.proxy()),{status:409});
  const response=await f.request('/shopper-api/launch-preview','POST',{ticket},'',publicStudio),body=await response.json();assert.equal(response.status,200);assert.equal(body.brand.displayName,'<River> & Co');assert.equal(body.product.url,'https://clothing.example.test/products/shirt-123');
  assert.equal(body.shopperGenerationAvailable,false);assert.ok(!JSON.stringify(body).includes(f.a.id));assert.equal((await f.request('/shopper-api/launch-preview','POST',{ticket},'',publicStudio)).status,410);
  assert.equal(f.ai(),0);assert.equal(f.store.billing.balance(f.a.org),1000);
  const protectedApp=createApp({accountStore:f.store,accessMode:'protected',mobileToken:'x'.repeat(32),shopifyShopperOptions:f.options}),server=protectedApp.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{assert.equal((await fetch(base+'/api/shopify-shopper')).status,401);assert.equal((await fetch(base+'/shopper')).status,200);f.advance(1000);const launch=await fetch(base+'/shopper/launch?'+f.proxy(),{redirect:'manual'});assert.equal(launch.status,302);assert.ok(launch.headers.get('location').startsWith(publicStudio+'/shopper#launch='));}finally{await new Promise(r=>server.close(r));}
}));

test('paused budgets, ineligible/unselected/foreign products, stale tickets, changed product pixels and wrong origins cannot launch or redeem',fixture(async f=>{
  await f.install();const item=await f.product();f.configure();assert.throws(()=>f.service.launch(f.proxy()),{status:410});await f.enable(item);
  assert.throws(()=>f.service.launch(f.proxy({product_id:'999'})),{status:404});
  let ticket=new URL(f.service.launch(f.proxy())).hash.slice(8);f.store.shoppers.update(f.a,{action:'pause'});assert.throws(()=>f.service.redeem(ticket));
  f.configure();f.advance(1000);ticket=new URL(f.service.launch(f.proxy())).hash.slice(8);f.advance(61000);assert.throws(()=>f.service.redeem(ticket),{status:410});
  f.advance(1000);ticket=new URL(f.service.launch(f.proxy())).hash.slice(8);f.store.db.prepare('UPDATE garments SET imageHash=? WHERE account=? AND id=?').run('changed',f.a.id,item.id);assert.throws(()=>f.service.redeem(ticket),{status:410});
  f.advance(1000);ticket=new URL(f.service.launch(f.proxy())).hash.slice(8);assert.equal((await f.request('/shopper-api/launch-preview','POST',{ticket},'','https://bad.test')).status,403);assert.ok(f.service.redeem(ticket));
  f.store.db.prepare("UPDATE garments SET stock='out' WHERE account=? AND id=?").run(f.a.id,item.id);f.advance(1000);assert.throws(()=>f.service.launch(f.proxy()),{status:404});
}));

test('two anonymous shoppers can launch the same product in the same second with separate nonces, while replay is blocked',fixture(async f=>{
  await f.install();await f.enable(await f.product());const one=f.proxy({launch_nonce:'01'.repeat(16)}),two=f.proxy({launch_nonce:'02'.repeat(16)});
  const first=f.service.launch(one),second=f.service.launch(two);assert.notEqual(first,second);assert.throws(()=>f.service.launch(one),{status:409});assert.throws(()=>f.service.launch(two),{status:409});
  assert.equal(f.service.redeem(new URL(first).hash.slice(8)).product.name,'Blue shirt');assert.equal(f.service.redeem(new URL(second).hash.slice(8)).product.name,'Blue shirt');assert.equal(f.ai(),0);
}));

test('unpublished products cannot be selected, and signed product changes/deletions revoke selected products and old launches',fixture(async f=>{
  await f.install();const item=await f.product();f.configure();f.setMode('unpublished');
  await assert.rejects(f.service.setProduct(f.a,item.id,{enabled:true,revision:f.service.row(f.a.id).revision}),{status:409});
  f.setMode('');await f.enable(item);const ticket=new URL(f.service.launch(f.proxy())).hash.slice(8);
  assert.equal((await f.webhook('products/update',{id:123})).status,200);assert.equal(f.service.summary(f.a).products[0].enabled,false);assert.throws(()=>f.service.redeem(ticket),{status:404});
  await f.enable(item);f.advance(1000);const next=new URL(f.service.launch(f.proxy())).hash.slice(8);assert.equal((await f.webhook('products/delete',{id:123})).status,200);assert.throws(()=>f.service.redeem(next),{status:404});
}));

test('uninstall and disconnect remove credentials and revoke tickets; old installation webhooks cannot revoke a reinstallation',fixture(async f=>{
  await f.install();const item=await f.product();await f.enable(item);const old=f.service.row(f.a.id),ticket=new URL(f.service.launch(f.proxy())).hash.slice(8);
  assert.equal((await f.webhook('app/uninstalled')).status,200);assert.equal(f.service.row(f.a.id).credentials,null);assert.equal(f.service.row(f.a.id).status,'uninstalled');assert.throws(()=>f.service.redeem(ticket),{status:410});
  await f.install();assert.equal((await f.webhook('app/uninstalled',undefined,old)).status,200);assert.equal(f.service.row(f.a.id).status,'installed');
  await f.enable(item);f.service.disconnect(f.a);assert.equal(f.service.row(f.a.id).credentials,null);f.advance(1000);assert.throws(()=>f.service.launch(f.proxy()),{status:410});
}));

test('reconnect replaces old and partially registered subscriptions, leaves preview paused on failure and serializes shop installation',fixture(async f=>{
  await f.install();const item=await f.product();await f.enable(item);
  f.setMode('partial-webhook-error');await assert.rejects(f.install(),{status:502});assert.equal(f.service.row(f.a.id).credentials,null);assert.equal(f.service.row(f.a.id).enabled,0);assert.equal(f.subscriptions.size,1);assert.equal(f.service.summary(f.a).installation.status,'reconnect_required');
  f.setMode('');for(let i=0;i<3;i++){await f.install();assert.equal(f.subscriptions.size,4);assert.equal(f.service.summary(f.a).products[0].enabled,false);}
  const start=f.service.start(f.a,{shopDomain:'sample.myshopify.com'},f.staffToken),state=new URL(start.authorizationUrl).searchParams.get('state');
  f.state.put('install-lock',digest('sample.myshopify.com'),{owner:'another-worker'},Date.now()+180000);const before=f.calls.length;
  await assert.rejects(f.service.callback(signedQuery({shop:'sample.myshopify.com',timestamp:f.timestamp(),state,code:'test'}),start.browser),{status:409});assert.equal(f.calls.length,before);
}));

test('uninstall delivered during first-time webhook registration prevents publishing the installation',fixture(async f=>{
  f.onHook(async variables=>{if(variables.topic==='APP_UNINSTALLED'){f.onHook(null);const path=new URL(variables.input.uri).pathname.split('/');assert.equal((await f.webhook('app/uninstalled',undefined,{id:path[3],webhookEpoch:path[4]})).status,200);}});
  await assert.rejects(f.install(),{status:409});assert.equal(f.service.row(f.a.id),undefined);assert.equal(f.subscriptions.size,1);assert.equal(f.ai(),0);
}));

test('signed domain updates reverify HTTPS domains, pause previews and revoke launches even if the verification service fails',fixture(async f=>{
  await f.install();const item=await f.product();await f.enable(item);const ticket=new URL(f.service.launch(f.proxy())).hash.slice(8);f.setHost('new-clothing.example.test');
  assert.equal((await f.webhook('shop/update')).status,200);assert.equal(f.service.row(f.a.id).primaryHost,'new-clothing.example.test');assert.equal(f.service.row(f.a.id).enabled,0);assert.throws(()=>f.service.redeem(ticket),{status:410});
  f.setMode('network');assert.equal((await f.webhook('shop/update',{id:42,myshopify_domain:'sample.myshopify.com',domain:'another.example.test'})).status,502);assert.equal(f.service.row(f.a.id).enabled,0);
  const row=f.service.row(f.a.id),result=await fetch(f.base+`/shopify/webhooks/${row.id}/${row.webhookEpoch}`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Hmac-Sha256':'bad','X-Shopify-Topic':'app/uninstalled'},body:'{}'});assert.equal(result.status,401);assert.equal(f.service.row(f.a.id).status,'installed');
  assert.equal((await f.webhook('app/uninstalled',{id:999,myshopify_domain:'other.myshopify.com'})).status,403);
}));

test('transient state enforces logical expiry, bounded capacity, one-use across connections and tmpfs-only production configuration',fixture(async f=>{
  const filename=path.join(f.directory,'test-transient.sqlite'),one=new DatabaseSync(filename),two=new DatabaseSync(filename),first=new ShopperState({db:one,now:()=>1000}),second=new ShopperState({db:two,now:()=>1000});
  try{first.put('launch','one',{value:1},2000);assert.deepEqual(second.take('launch','one'),{value:1});assert.equal(first.take('launch','one'),null);first.put('launch','expired',true,500);assert.equal(first.get('launch','expired'),null);
    for(let i=0;i<10000;i++)first.put('proxy',String(i),true,5000);assert.throws(()=>second.put('proxy','too-many',true,5000),{status:503});
  }finally{one.close();two.close();}
  assert.throws(()=>new ShopperState({directory:'relative'}),/absolute/);
  if(Number(statfsSync(nonTmpfsDirectory).type)!==0x01021994){assert.throws(()=>new ShopperState({directory:nonTmpfsDirectory}),/tmpfs/);
    const unavailable=new ShopifyShopper(f.store,{...f.options,state:undefined,stateDirectory:nonTmpfsDirectory});assert.equal(unavailable.summary(f.a).available,false);}
  const oauth=f.service.start(f.a,{shopDomain:'sample.myshopify.com'},f.staffToken);assert.ok(!JSON.stringify(f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).includes('shopper_state'));assert.ok(!f.store.db.prepare('SELECT * FROM shopper_shopify_installations').all().length);
  const raw=await readFile(path.join(f.directory,'accounts.sqlite'));assert.ok(!raw.includes(Buffer.from(new URL(oauth.authorizationUrl).searchParams.get('state'))));
}));
