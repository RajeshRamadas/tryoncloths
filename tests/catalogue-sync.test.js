import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {randomBytes} from 'node:crypto';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../server/app.js';
import {CatalogueSync,nightlyDay} from '../server/catalogue-sync.js';
import {shopUrl} from '../server/shop-catalogue.js';
import {integrationFetch} from '../server/integration-http.js';
const key='ab'.repeat(32),secret='shpat_test-secret-do-not-expose';
const json=(data,status=200,headers={})=>({status,headers,body:Buffer.from(JSON.stringify(data))});
export const shopProduct=(n,extra={})=>({id:`gid://shopify/Product/${n}`,title:`Shirt ${n}`,handle:`shirt-${n}`,productType:'shirt',tags:[],vendor:'Example',status:'ACTIVE',featuredImage:{url:`https://cdn.example.test/${n}.jpg`},variants:{nodes:[{id:`v${n}`,title:'Medium',sku:`SKU-${n}`,price:'999.00',compareAtPrice:'1299.00',inventoryQuantity:8,inventoryPolicy:'DENY',inventoryItem:{tracked:true},selectedOptions:[{name:'Size',value:'M'},{name:'Colour',value:'Blue'}]}],pageInfo:{hasNextPage:false,endCursor:null}},...extra});
async function fixture(run){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-sync-')),store=new AccountStore(directory);
 const a=await store.register({email:'sync@example.test',name:'Sync store',password:'test-password-long'}),b=await store.register({email:'foreign@example.test',name:'Foreign store',password:'test-password-long'}),extra=await store.register({email:'branch@example.test',name:'Branch store',password:'test-password-long'});
 store.db.prepare('UPDATE stores SET org=? WHERE id=?').run(a.org,extra.id);const branch=store.identity(extra.user.id,extra.id);store.db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(b.user.id,a.id);const manager=store.identity(b.user.id,a.id);
 const cookies={a:`forme_session=${store.session(a)}`,b:`forme_session=${store.session(b)}`,manager:`forme_session=${store.session(manager)}`,branch:`forme_session=${store.session(branch)}`};
 const image=await sharp({create:{width:200,height:240,channels:3,background:'#426aa3'}}).jpeg().toBuffer();const photos=new Map();let products=[shopProduct(1)],mode='',images=0,calls=[],active=0,maxImages=0,block;
 const fetchImpl=async(url,options)=>{calls.push({url,options});assert.ok(!url.includes(secret));if(block)await block;
  if(mode==='bad-token')return json({error:secret},401);if(url.includes('/graphql.json')){assert.equal(options.headers['X-Shopify-Access-Token'],secret);const {query,variables}=JSON.parse(options.body);if(query.includes('shop {'))return json({data:{shop:{id:'gid://shopify/Shop/1',name:'Shop',currencyCode:mode==='usd'?'USD':'INR'}}});
   if(query.includes('product(id:'))return json({data:{product:{variants:{nodes:[{...shopProduct(1).variants.nodes[0],id:'v1-extra',selectedOptions:[{name:'Size',value:'L'}]}],pageInfo:{hasNextPage:false,endCursor:null}}}}});
   const page=variables.after?Number(variables.after):0;if(mode==='page-error'&&page>0)return json({errors:[{message:secret}]});const nodes=structuredClone(products.slice(page*50,(page+1)*50));return json({data:{products:{nodes,pageInfo:{hasNextPage:(page+1)*50<products.length,endCursor:mode==='loop'?'0':String(page+1)}}}});
  }
  assert.match(options.headers.Authorization,/^Basic /);if(url.includes('/variations?'))return json([{id:11,status:'publish',stock_status:'instock',manage_stock:true,stock_quantity:2}]);
  const rows=[{id:1,name:'Woo T-shirt',status:'publish',type:'variable',sku:'WOO-1',price:'499.50',regular_price:'599.50',permalink:'https://woo.example.test/shop/item',images:[{src:'https://cdn.example.test/woo.jpg'}],attributes:[{name:'Size',options:['M','L']}],categories:[{name:'T-shirts'}],tags:[]}];return json(rows,200,{'x-wp-totalpages':'1'});
 };
 const fetchImage=async url=>{images++;active++;maxImages=Math.max(maxImages,active);try{await new Promise(r=>setTimeout(r,1));if(mode==='image-error')throw new Error(secret);return {body:photos.get(url)||image};}finally{active--;}};
 const app=createApp({accountStore:store,accessMode:'public',rateLimit:false,syncOptions:{fetchImpl,fetchImage,secretKey:key}}),service=app.locals.catalogueSync,server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method='GET',body,cookie=cookies.a,origin=base)=>fetch(base+url,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const connect=()=>service.connect(a,'shopify',{shopDomain:'sample.myshopify.com',token:secret});
 try{await run({store,a,b,branch,manager,cookies,request,service,connect,directory,image,calls,images:()=>images,maxImages:()=>maxImages,setPhoto:(url,value)=>photos.set(url,value),setProducts:v=>{products=v;},setMode:v=>{mode=v;},block:v=>{block=v;},fetchImpl,fetchImage});}finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}

test('shop addresses reject unsafe protocols, hosts and credential-bearing endpoints; transport refuses non-HTTPS',async()=>{
 assert.equal(shopUrl('shopify',{shopDomain:'sample.myshopify.com'}),'https://sample.myshopify.com');assert.equal(shopUrl('woo',{siteUrl:'https://woo.example/shop/'}),'https://woo.example/shop');
 for(const raw of ['http://sample.myshopify.com','https://evil.test','https://x.myshopify.com/path','https://x.myshopify.com?token=secret','https://user:pass@x.myshopify.com'])assert.throws(()=>shopUrl('shopify',{shopDomain:raw}));
 for(const raw of ['http://woo.example','https://127.0.0.1','https://169.254.169.254','https://private.local','https://woo.example/wp-json/wc/v3','https://woo.example:8443','https://woo.example/?key=secret'])assert.throws(()=>shopUrl('woo',{siteUrl:raw}));
 assert.throws(()=>integrationFetch('http://woo.example'));assert.equal(nightlyDay(Date.parse('2026-11-01T20:29:59Z')),null);assert.equal(nightlyDay(Date.parse('2026-11-01T20:30:00Z')),'2026-11-02');
});

test('three Shopify pages sync all 101 products, map prices/sizes/inventory, encrypt keys and repeat without changes or credits',async()=>fixture(async({store,a,connect,service,setProducts,request,maxImages,calls})=>{
 setProducts(Array.from({length:101},(_,i)=>shopProduct(i+1)));await connect();const before=store.billing.balance(a.org,'ai'),report=await service.run(a,'shopify');assert.equal(report.created,101);assert.ok(maxImages()<=3);assert.equal(maxImages(),3);
 const products=store.garments.list(a),first=products.find(p=>p.sku==='SKU-1');assert.equal(first.priceInr,999);assert.equal(first.mrpInr,1299);assert.deepEqual(first.sizes,['M']);assert.equal(first.stock,'in');assert.equal(first.colourLabel,'Blue');assert.equal(first.garmentType,'shirt');assert.equal(first.needsTypeReview,false);
 const beforeRows=store.db.prepare('SELECT id,updatedAt,imageHash FROM garments ORDER BY id').all();const repeated=await service.run(a,'shopify');assert.equal(repeated.created,0);assert.equal(repeated.updated,0);assert.equal(repeated.unchanged,101);assert.deepEqual(store.db.prepare('SELECT id,updatedAt,imageHash FROM garments ORDER BY id').all(),beforeRows);assert.equal(store.billing.balance(a.org,'ai'),before);
 const connection=store.db.prepare('SELECT * FROM catalogue_integrations').get();assert.ok(!connection.credentials.includes(secret));const summary=await (await request('/api/integrations')).text();assert.ok(!summary.includes(secret));assert.ok(!summary.includes(connection.credentials));assert.equal(calls.filter(c=>JSON.parse(c.options.body||'{}').query?.includes('products(first:50')).length,6);
}));

test('partial pages, invalid images and bad tokens publish nothing, preserve adaptations, and record safe errors',async()=>fixture(async({store,a,connect,service,setProducts,setMode,request})=>{
 await connect();await service.run(a,'shopify');const original=store.db.prepare('SELECT * FROM garments WHERE account=?').all(a.id);
 setProducts(Array.from({length:51},(_,i)=>shopProduct(i+1,{title:'Changed shirt '+i})));setMode('page-error');await assert.rejects(service.run(a,'shopify'));assert.deepEqual(store.db.prepare('SELECT * FROM garments WHERE account=?').all(a.id),original);
 for(const mode of ['image-error','bad-token']){setMode(mode);await assert.rejects(service.run(a,'shopify'));assert.deepEqual(store.db.prepare('SELECT * FROM garments WHERE account=?').all(a.id),original);}
 const status=await (await request('/api/integrations')).json();assert.ok(status.connections[0].lastError);assert.ok(!JSON.stringify(status).includes(secret));assert.equal(store.db.prepare('SELECT count(*) n FROM catalogue_sync_staging').get().n,0);assert.equal(store.db.prepare('SELECT count(*) n FROM catalogue_sync_locks').get().n,0);
 setMode('');setProducts([]);await service.run(a,'shopify');assert.equal(store.garments.list(a)[0].stock,'out');assert.equal(store.db.prepare('SELECT count(*) n FROM garments').get().n,1);
}));

test('Woo uses HTTPS Basic headers, maps variable products and requires explicit INR confirmation',async()=>fixture(async({store,a,service,calls})=>{
 const input={siteUrl:'https://woo.example.test/shop',key:'ck_example',secret:'cs_example'};await assert.rejects(service.connect(a,'woo',input),{status:400});await service.connect(a,'woo',{...input,currency:'INR'});const report=await service.run(a,'woo');assert.equal(report.created,1);const item=store.garments.list(a)[0];assert.equal(item.garmentType,'tshirt');assert.deepEqual(item.sizes,['M','L']);assert.equal(item.stock,'low');assert.equal(item.priceInr,499.5);assert.ok(calls.some(c=>c.url.includes('/shop/wp-json/wc/v3/products/1/variations')));assert.ok(calls.every(c=>!c.url.includes('ck_example')&&!c.url.includes('cs_example')));
}));

test('unmapped types block try-on until confirmed, confirmed types survive sync, and variants page completely',async()=>fixture(async({store,a,service,connect,setProducts,request,calls})=>{
 const product=shopProduct(1,{title:'Summer piece',productType:'',tags:[]});product.variants.pageInfo={hasNextPage:true,endCursor:'more'};setProducts([product]);await connect();await service.run(a,'shopify');const item=store.garments.list(a)[0];assert.equal(item.needsTypeReview,true);assert.deepEqual(item.sizes,['M','L']);assert.ok(calls.some(c=>JSON.parse(c.options.body||'{}').query?.includes('product(id:')));
 const image=`data:image/png;base64,${(await standardAvatar('regular')).toString('base64')}`,avatar=await store.save(a,{image,name:'Avatar',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});await assert.rejects(store.garments.context(a,{avatar:image,avatarId:avatar.id,garmentId:item.id,garmentType:'outfit'},{provider:'gemini',model:'test'}),{status:409});
 assert.equal((await request(`/api/catalogue/${item.id}/type`,'PATCH',{garmentType:'jacket'})).status,200);await service.run(a,'shopify');assert.equal(store.garments.get(a,item.id).garmentType,'jacket');assert.equal(store.garments.get(a,item.id).needsTypeReview,false);
}));

test('all integration routes enforce active-store roles, origins, isolation and safe connection failures',async()=>fixture(async({store,a,b,branch,cookies,request,connect,setMode})=>{
 await connect();const input={shopDomain:'sample.myshopify.com',token:secret};assert.equal((await request('/api/integrations')).status,200);assert.equal((await request('/api/integrations','GET',undefined,cookies.manager)).status,200);
 for(const method of ['PUT','DELETE'])assert.equal((await request('/api/integrations/shopify',method,input,cookies.manager)).status,403);assert.equal((await request('/api/integrations/shopify/sync','POST',{},cookies.manager)).status,200);assert.equal((await request('/api/integrations/shopify/sync','POST',{},cookies.b)).status,409);
 const own=store.garments.list(a)[0];assert.equal((await request(`/api/catalogue/${own.id}/type`,'PATCH',{garmentType:'jeans'},cookies.b)).status,404);
 assert.equal((await request('/api/integrations/master','PUT',{storeId:branch.id},cookies.manager)).status,403);assert.equal((await request('/api/integrations/master','PUT',{storeId:b.id})).status,403);
 for(const [url,method] of [['/api/integrations','GET'],['/api/integrations/shopify','PUT'],['/api/integrations/woo','PUT'],['/api/integrations/shopify','DELETE'],['/api/integrations/woo','DELETE'],['/api/integrations/shopify/sync','POST'],['/api/integrations/woo/sync','POST'],['/api/integrations/master','PUT'],[`/api/catalogue/${own.id}/type`,'PATCH']])assert.equal((await request(url,method,method==='GET'?undefined:input,'')).status,401);
 assert.equal((await request('/api/integrations/shopify','PUT',input,cookies.a,'https://evil.test')).status,403);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(b.user.id,a.id);for(const [url,method] of [['/api/integrations','GET'],['/api/integrations/shopify','PUT'],['/api/integrations/woo','PUT'],['/api/integrations/shopify','DELETE'],['/api/integrations/woo','DELETE'],['/api/integrations/shopify/sync','POST'],['/api/integrations/woo/sync','POST'],['/api/integrations/master','PUT'],[`/api/catalogue/${own.id}/type`,'PATCH']])assert.equal((await request(url,method,method==='GET'?undefined:input,cookies.manager)).status,403);
 setMode('bad-token');const failed=await request('/api/integrations/shopify','PUT',input);assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes(secret));assert.ok((await (await request('/api/integrations')).json()).connections[0].lastError);
}));

test('persistent per-store locks prevent concurrent runs and connection changes; stale locks recover; schedules run once per day',async()=>fixture(async({store,a,service,connect,block,fetchImpl,fetchImage})=>{
 await connect();let release;block(new Promise(r=>{release=r;}));const running=service.run(a,'shopify');await assert.rejects(service.run(a,'shopify'),{status:409});await assert.rejects(service.connect(a,'shopify',{shopDomain:'sample.myshopify.com',token:secret}),{status:409});assert.throws(()=>service.disconnect(a,'shopify'),{status:409});
 const second=new CatalogueSync(store,{fetchImpl,fetchImage,secretKey:key});await assert.rejects(second.run(a,'shopify'),{status:409});block(null);release();await running;
 const token=randomBytes(16).toString('hex');store.db.prepare('INSERT INTO catalogue_sync_locks VALUES(?,?,?)').run(a.id,token,Date.now()-1);await service.run(a,'shopify');assert.equal(store.db.prepare('SELECT count(*) n FROM catalogue_sync_locks').get().n,0);
 const now=Date.parse('2026-11-06T20:30:00Z');await service.runDue(now);const last=store.db.prepare('SELECT lastAttemptAt,lastScheduledDay FROM catalogue_integrations').get();assert.equal(last.lastScheduledDay,'2026-11-07');await service.runDue(now+60000);assert.deepEqual(store.db.prepare('SELECT lastAttemptAt,lastScheduledDay FROM catalogue_integrations').get(),last);
}));

test('Chain master products are visible read-only, mirrored only on use, scoped per store, and hidden when disabled',async()=>fixture(async({store,a,b,branch,service,request,cookies,image,directory})=>{
 store.db.prepare("UPDATE orgs SET plan='chain' WHERE id=?").run(a.org);const source=`data:image/jpeg;base64,${image.toString('base64')}`,item=(await store.garments.save(a,{image:source,name:'Master shirt',garmentType:'shirt',variant:'M'})).garment;service.setMaster(a,a.id);
 const visible=store.garments.browse(branch).garments;assert.equal(visible.length,1);assert.equal(visible[0].readOnly,true);assert.equal(visible[0].sharedFrom,a.id);assert.equal(store.db.prepare('SELECT count(*) n FROM garments WHERE account=?').get(branch.id).n,0);assert.equal(store.garments.browse(b).garments.length,0);
 const shared=store.garments.get(branch,visible[0].id);assert.ok(shared.image);assert.equal(store.db.prepare('SELECT count(*) n FROM garments WHERE account=?').get(branch.id).n,1);assert.equal(store.garments.browse(branch).stored,0);assert.equal((await store.garments.matches(branch,{image:source})).exact[0].id,shared.id);
 const png=await standardAvatar('regular'),avatarImage=`data:image/png;base64,${png.toString('base64')}`,avatar=await store.save(branch,{image:avatarImage,name:'Branch customer',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
 const context=await store.garments.context(branch,{avatar:avatarImage,avatarId:avatar.id,garmentId:shared.id,garmentType:'shirt'},{provider:'gemini',model:'test'}),receipt=await store.garments.receipt(branch,context,avatarImage);await store.garments.saveResult(branch,shared.id,{image:avatarImage,receipt,reviewed:true,storageConsent:true});assert.ok(store.garments.cached(branch,context));assert.equal(store.db.prepare('SELECT count(*) n FROM garment_results WHERE account=?').get(a.id).n,0);
 store.db.prepare('UPDATE garments SET imageHash=? WHERE account=? AND id=?').run('updated-hash',a.id,item.id);store.garments.get(branch,shared.id);assert.equal(store.garments.cached(branch,context),null,'master image changes invalidate the store-local cache');
 for(const [url,method,body] of [[`/api/catalogue/${shared.id}`,'PATCH',{stock:'out'}],[`/api/catalogue/${shared.id}/type`,'PATCH',{garmentType:'shoes'}],[`/api/garments/${shared.id}`,'DELETE',{}]])assert.equal((await request(url,method,body,cookies.branch)).status,403);
 assert.equal((await request('/api/integrations/master','PUT',{storeId:b.id})).status,403);service.setMaster(a,null);assert.equal(store.garments.browse(branch).garments.length,0);assert.throws(()=>store.garments.get(branch,shared.id),{status:404});assert.equal(store.garments.get(a,item.id).name,'Master shirt');
 service.setMaster(a,a.id);const reopened=new AccountStore(directory);try{assert.equal(reopened.garments.browse(branch).garments[0].readOnly,true);}finally{reopened.close();}
 store.db.prepare("UPDATE orgs SET plan='growth' WHERE id=?").run(a.org);assert.equal(store.garments.browse(branch).garments.length,0);assert.throws(()=>service.setMaster(a,a.id),{status:403});
}));

test('disconnect preserves identities, removal preserves adaptations, and name/image changes invalidate only affected caches',async()=>fixture(async({store,a,service,connect,setProducts,setPhoto})=>{
 setProducts([shopProduct(1),shopProduct(2)]);await connect();await service.run(a,'shopify');const items=store.garments.list(a).sort((x,y)=>x.sku.localeCompare(y.sku)),item=items[0];
 const png=await standardAvatar('regular'),image=`data:image/png;base64,${png.toString('base64')}`,avatar=await store.save(a,{image,name:'Avatar',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
 for(const garment of items)store.db.prepare('INSERT INTO garment_results VALUES(?,?,?,?,?,?)').run(a.id,garment.id,avatar.id,garment.id,png,Date.now());
 service.disconnect(a,'shopify');assert.equal(store.garments.list(a).length,2);await assert.rejects(service.connect(a,'shopify',{shopDomain:'different.myshopify.com',token:secret}),{status:409});
 await connect();setProducts([shopProduct(1,{title:'Updated shirt'})]);const result=await service.run(a,'shopify');assert.equal(result.updated,1);assert.equal(result.markedOut,1);assert.equal(store.garments.get(a,item.id).id,item.id);assert.equal(store.db.prepare('SELECT count(*) n FROM garment_results').get().n,1,'removed products keep their saved adaptations');
 setPhoto('https://cdn.example.test/2.jpg',await sharp({create:{width:200,height:240,channels:3,background:'#aa3366'}}).jpeg().toBuffer());setProducts([shopProduct(1,{title:'Updated shirt'}),shopProduct(2)]);await service.run(a,'shopify');assert.equal(store.db.prepare('SELECT count(*) n FROM garment_results').get().n,0,'changed image invalidates the old adaptation');
}));

test('catalogue limits and duplicate upstream IDs abort before publishing any rows',async()=>fixture(async({store,a,service,connect,setProducts})=>{
 await connect();await service.run(a,'shopify');const original=store.db.prepare('SELECT * FROM garments WHERE account=?').get(a.id),columns=Object.keys(original),insert=store.db.prepare(`INSERT INTO garments(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
 store.db.exec('BEGIN');for(let i=0;i<499;i++){const row={...original,id:'manual-'+i,source:'manual',externalId:null,variant:'manual-'+i};insert.run(...columns.map(c=>row[c]));}store.db.exec('COMMIT');
 setProducts([shopProduct(1,{title:'Changed shirt'}),shopProduct(2)]);await assert.rejects(service.run(a,'shopify'),{status:409});assert.equal(store.db.prepare('SELECT name FROM garments WHERE account=? AND id=?').get(a.id,original.id).name,original.name);assert.equal(store.db.prepare('SELECT count(*) n FROM garments').get().n,500);
 setProducts([shopProduct(1),shopProduct(1)]);await assert.rejects(service.run(a,'shopify'),{status:502});assert.equal(store.db.prepare('SELECT count(*) n FROM catalogue_sync_staging').get().n,0);
}));
