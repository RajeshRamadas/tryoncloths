import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {AccountStore} from './helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../server/app.js';
import {jewelleryTypes,jewelleryMetals,chooseView,validateAttributes} from '../server/jewellery-types.js';
import {guessJewelleryType} from '../src/jewellery-types.ts';
import {installCatalogueSchema,legacyGarmentColumns} from '../server/catalogue-fields.js';
import {CatalogueSync} from '../server/catalogue-sync.js';
import {ShopifyShopper} from '../server/shopify-shopper.js';

const enabled={category:'jewellery',jewelleryEnabled:true};
const attrs={metal:'yellow_gold',purity:'22K',weightG:12.5};
const dataUrl=buffer=>'data:image/png;base64,'+buffer.toString('base64');
async function fixture(run,{flag=true}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-jewellery-')),store=new AccountStore(directory);
 const a=await store.register({name:'Jewellery store',email:'owner@example.test',password:'test-password-long'}),b=await store.register({name:'Other store',email:'other@example.test',password:'test-password-long'});
 const ca='forme_session='+store.session(a),cb='forme_session='+store.session(b);let calls=0;
 const server=createApp({accountStore:store,accessMode:'public',jewelleryEnabled:flag,apiKey:'test',rateLimit:false,tryOn:async()=>{calls++;throw new Error('No AI expected');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(url,method='GET',body,cookie=ca,origin=base)=>fetch(base+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const image=dataUrl(await sharp({create:{width:220,height:220,channels:3,background:'#b58b30'}}).png().toBuffer());
 const input={category:'jewellery',garmentType:'jhumka',name:'Gold jhumka',variant:'Gold / 22K',image,attributes:attrs,sourceUrl:'https://shop.example/product/42?utm_source=test',storageConsent:true};
 try{await run({store,a,b,ca,cb,request,input,directory,calls:()=>calls});}finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}

test('18 shared types choose portrait, hands and full-body views with the 50 cm necklace boundary',()=>{
 assert.equal(Object.keys(jewelleryTypes).length,18);assert.equal(jewelleryMetals.length,7);
 for(const [type,definition] of Object.entries(jewelleryTypes)){
  for(const field of ['label','view','pair','sides','needsFinger','needsWrist','placement','keep'])assert.ok(Object.hasOwn(definition,field),type+':'+field);
  assert.equal(chooseView(type),definition.view);
 }
 for(const type of ['necklace','pendant','mangalsutra']){for(const lengthCm of [20,45,50])assert.equal(chooseView(type,{lengthCm}),'portrait');for(const lengthCm of [50.1,60,120])assert.equal(chooseView(type,{lengthCm}),'full');}
 assert.equal(chooseView('ring'),'hands');assert.equal(chooseView('anklets'),'full');assert.throws(()=>chooseView('toString'),{status:400});assert.throws(()=>chooseView('necklace',{lengthCm:'60'}),{status:400});
});

test('jewellery attributes validate metals, dimensions, sizes, booleans and display-only hallmark text strictly',()=>{
 assert.deepEqual(validateAttributes('jhumka',{...attrs,purity:' 22K '}),{...attrs,pair:true});assert.equal(validateAttributes('ring',attrs).pair,false);
 for(const invalid of [null,[],{},{metal:'gold'},{...attrs,unknown:true},{...attrs,purity:'x'.repeat(11)},{...attrs,stones:'x\n'},{...attrs,huid:'x'.repeat(13)},{...attrs,pair:'true'},{...attrs,bangleSize:2.4},JSON.parse('{"metal":"silver","__proto__":{}}')])assert.throws(()=>validateAttributes('ring',invalid),{status:400});
 for(const [field,min,max,integer] of [['weightG',0,2000],['lengthCm',20,120],['dropMm',2,150],['pendantMm',5,150],['ringSizeIn',1,30,true],['count',1,24,true]]){
  for(const value of [min,max])assert.equal(validateAttributes('ring',{metal:'silver',[field]:value})[field],value);
  for(const value of [min-1,max+1,NaN,Infinity,'20',null,...(integer?[1.5]:[])])assert.throws(()=>validateAttributes('ring',{metal:'silver',[field]:value}),{status:400},field+':'+value);
 }
 for(const bangleSize of ['2.2','2.4','2.6','2.8','2.10','2.12'])assert.equal(validateAttributes('bangles',{metal:'silver',bangleSize}).bangleSize,bangleSize);
 assert.throws(()=>validateAttributes('ring',{metal:'silver',bangleSize:'2.3'}),{status:400});
});

test('Indian title hints respect specific types and word boundaries',()=>{
 for(const [title,type] of [['Gold jhumka earrings','jhumka'],['Chandbali earrings','drop_earrings'],['Diamond stud','stud_earrings'],['Nath nose ring','nose_ring'],['Nose pin','nose_pin'],['Maang tikka','maang_tikka'],['Matha patti','matha_patti'],['Choker set','choker'],['Rani haar','long_haar'],['Mangalsutra necklace','mangalsutra'],['Silver ring','ring'],['Gold bangle','bangles'],['Kada','bangles'],['Bracelet','bracelet'],['Watch','watch'],['Payal','anklets'],['Kamarbandh','waist_belt'],['Toe ring',null],['Spring collection',null],['Plain shirt',null]])assert.equal(guessJewelleryType(title),type,title);
});

test('legacy catalogue upgrade preserves rows and refreshes old shared views atomically and idempotently',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec(`CREATE TABLE orgs(id TEXT PRIMARY KEY,plan TEXT);CREATE TABLE stores(id TEXT PRIMARY KEY,org TEXT);CREATE TABLE garments(account TEXT,id TEXT,name TEXT,garmentType TEXT,variant TEXT,sourceUrl TEXT,imageHash TEXT,signature TEXT,colour TEXT,image BLOB,thumbnail BLOB,savedAt INTEGER);INSERT INTO garments VALUES('store','old','Shirt','shirt','','','hash','0','[]',x'1234',x'5678',100);CREATE VIEW catalogue_visible AS SELECT ${legacyGarmentColumns},NULL sharedFrom,NULL sharedId,0 readOnly FROM garments;`);
  installCatalogueSchema(db);installCatalogueSchema(db);
  const row=db.prepare('SELECT * FROM catalogue_visible').get();assert.equal(row.category,'garment');assert.equal(row.attributesJson,'{}');assert.equal(row.overlayPng,null);assert.equal(Buffer.from(row.image).toString('hex'),'1234');assert.equal(row.savedAt,100);assert.equal(row.updatedAt,100);
 }finally{db.close();}
});

test('jewellery persists and matches by photo or URL without crossing clothing categories or consuming credits',async()=>fixture(async({store,a,request,input,directory,calls})=>{
 const balance=store.billing.balance(a.org),saved=await request('/api/garments','POST',input);assert.equal(saved.status,200);const item=(await saved.json()).garment;assert.equal(item.category,'jewellery');assert.equal(item.attributes.pair,true);
 const clothing=await store.garments.save(a,{...input,category:'garment',attributes:undefined,garmentType:'shirt',name:'Clothing reference'});
 assert.equal((await (await request('/api/garments')).json()).garments[0].id,clothing.garment.id);assert.equal(store.garments.list(a).length,1);assert.equal(store.garments.list(a,enabled).length,1);
 for(const lookup of [{image:input.image},{url:'https://shop.example/product/42?utm_source=other'}]){
  const match=await (await request('/api/garments/match','POST',{...lookup,category:'jewellery'})).json();assert.deepEqual([...match.exact,...match.linked].map(g=>g.id),[item.id]);
  const clothes=await (await request('/api/garments/match','POST',lookup)).json();assert.deepEqual([...clothes.exact,...clothes.linked].map(g=>g.id),[clothing.garment.id]);
 }
 assert.equal((await request('/api/garments/'+item.id)).status,404);assert.equal((await request('/api/garments/'+item.id+'?category=jewellery')).status,200);
 assert.equal((await (await request('/api/catalogue?category=jewellery&metal=silver')).json()).total,0);assert.equal((await (await request('/api/catalogue?category=jewellery&metal=yellow_gold')).json()).total,1);
 assert.equal((await (await request('/api/catalogue?category=jewellery')).json()).stored,2);
 assert.equal((await request('/api/catalogue?category=jewellery&type=shirt')).status,400);
 assert.equal((await request('/api/garments','POST',{...input,attributes:{metal:'silver'}})).status,409);
 assert.equal((await request('/api/garments','POST',{...input,variant:'Silver',attributes:{metal:'silver'}})).status,200);
 assert.equal((await request('/api/catalogue/'+item.id+'?category=jewellery','PATCH',{attributes:{...attrs,lengthCm:60},priceInr:1299.5,stock:'low'})).status,200);
 assert.equal((await request('/api/catalogue/'+item.id+'?category=jewellery','PATCH',{category:'garment'})).status,400);
 const reopened=new AccountStore(directory);try{const after=reopened.garments.get(a,item.id,enabled);assert.equal(after.priceInr,1299.5);assert.equal(after.attributes.lengthCm,60);assert.ok(after.image.startsWith('data:image/png'));assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{reopened.close();}
 assert.equal(store.billing.balance(a.org),balance);assert.equal(calls(),0);
}));

test('jewellery routes enforce feature flag, owner/manager roles, same origin and tenant isolation',async()=>fixture(async({store,a,ca,cb,request,input,calls})=>{
 const health=await (await request('/api/health')).json();assert.equal(health.jewelleryCatalogueAvailable,true);assert.equal(health.jewelleryAvailable,false);
 const item=(await (await request('/api/garments','POST',input)).json()).garment;
 assert.equal((await request('/api/jewellery/types')).status,200);
 for(const cookie of ['',cb]){assert.equal((await request('/api/garments/'+item.id+'?category=jewellery','GET',undefined,cookie)).status,cookie?404:401);assert.equal((await request('/api/garments/'+item.id+'?category=jewellery','DELETE',undefined,cookie)).status,cookie?404:401);}
 assert.equal((await request('/api/garments','POST',{...input,variant:'Foreign origin'},ca,'https://evil.test')).status,403);
 assert.equal((await request('/api/garments','POST',{...input,storageConsent:false})).status,400);
 assert.equal((await request('/api/garments?category=garment','POST',input)).status,400);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(a.user.id,a.id);
 assert.equal((await request('/api/catalogue?category=jewellery')).status,200);assert.equal((await request('/api/garments/match','POST',{category:'jewellery',image:input.image})).status,200);
 assert.equal((await request('/api/garments','POST',input)).status,403);assert.equal((await request('/api/garments/'+item.id+'?category=jewellery','DELETE')).status,403);assert.equal((await request('/api/catalogue/'+item.id+'?category=jewellery','PATCH',{stock:'out'})).status,403);
 store.db.prepare("UPDATE memberships SET role='manager' WHERE user=? AND store=?").run(a.user.id,a.id);assert.equal((await request('/api/catalogue/'+item.id+'?category=jewellery','PATCH',{stock:'out'})).status,200);
 assert.equal(calls(),0);
}));

test('disabled jewellery cannot be listed, read, saved, matched or patched even when stored items exist',async()=>fixture(async({store,a,request,input})=>{
 const item=(await store.garments.save(a,input,enabled)).garment;
 const health=await (await request('/api/health')).json();assert.equal(health.jewelleryCatalogueAvailable,false);
 for(const [url,method,body] of [['/api/jewellery/types','GET'],['/api/catalogue?category=jewellery','GET'],['/api/garments?category=jewellery','GET'],['/api/garments/'+item.id+'?category=jewellery','GET'],['/api/garments/'+item.id+'?category=jewellery','DELETE'],['/api/garments','POST',input],['/api/garments/match','POST',{category:'jewellery',image:input.image}],['/api/catalogue/'+item.id+'?category=jewellery','PATCH',{stock:'out'}]])assert.equal((await request(url,method,body)).status,404,url);
 assert.equal((await (await request('/api/catalogue')).json()).total,0);
},{flag:false}));

test('a role revoked while decoding the product photo cannot save jewellery',async()=>fixture(async({store,a,input})=>{
 const pending=store.garments.save(a,input,enabled);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(a.user.id,a.id);
 await assert.rejects(pending,{status:403});assert.equal(store.garments.list(a,enabled).length,0);
}));

test('clothing generation rejects jewellery IDs before provider calls or credit reservations',async()=>fixture(async({store,a,request,input,calls})=>{
 const item=(await store.garments.save(a,input,enabled)).garment,image=dataUrl(await standardAvatar('regular'));
 const avatar=await store.save(a,{image,name:'Customer',profileId:'regular',heightCm:175,weightKg:72,source:'imported'}),balance=store.billing.balance(a.org);
 const body={requestId:crypto.randomUUID(),avatar:image,avatarId:avatar.id,garmentId:item.id,garmentType:'shirt',bodyType:'male',consent:true,consentScope:'avatar-and-garment',consentProvider:'gemini'};
 assert.equal((await request('/api/tryon','POST',body)).status,404);assert.equal((await request('/api/garments/'+item.id+'/reuse','POST',body)).status,404);assert.equal(store.billing.balance(a.org),balance);assert.equal(calls(),0);
}));

test('shared jewellery remains read-only, updates attributes on access, and never appears in branch clothing',async()=>fixture(async({store,a,b,input,request,cb,directory})=>{
 store.db.prepare("UPDATE orgs SET plan='chain' WHERE id=?").run(a.org);store.db.prepare('UPDATE stores SET org=? WHERE id=?').run(a.org,b.id);const branch=store.identity(b.user.id,b.id);
 const item=(await store.garments.save(a,input,enabled)).garment;new CatalogueSync(store).setMaster(a,a.id);
 const shared=store.garments.browse(branch,{category:'jewellery'},enabled).garments[0];assert.equal(shared.readOnly,true);assert.equal(shared.sharedFrom,a.id);assert.equal(store.garments.list(branch).length,0);
 assert.equal(store.db.prepare('SELECT count(*) n FROM garments WHERE account=?').get(branch.id).n,0);
 assert.equal(store.garments.get(branch,shared.id,enabled).attributes.metal,'yellow_gold');
 assert.equal((await request('/api/garments/'+encodeURIComponent(shared.id)+'?category=jewellery','DELETE',undefined,cb)).status,403);
 assert.equal((await request('/api/catalogue/'+encodeURIComponent(shared.id)+'?category=jewellery','PATCH',{attributes:{metal:'silver'}},cb)).status,403);
 assert.equal((await request('/api/catalogue/'+item.id+'?category=jewellery','PATCH',{attributes:{metal:'rose_gold',weightG:10}})).status,200);
 assert.equal(store.garments.get(branch,shared.id,enabled).attributes.metal,'rose_gold');const mirror=store.db.prepare('SELECT attributesJson,category,overlayPng FROM garments WHERE account=? AND id=?').get(branch.id,shared.id);assert.equal(JSON.parse(mirror.attributesJson).metal,'rose_gold');assert.equal(mirror.category,'jewellery');assert.equal(mirror.overlayPng,null);
 const reopened=new AccountStore(directory);try{assert.equal(reopened.garments.list(branch,enabled)[0].attributes.metal,'rose_gold');assert.equal(reopened.garments.list(branch).length,0);}finally{reopened.close();}
}));

test('clothing and jewellery share catalogue capacity and Shopify shopper products remain garment-only',async()=>fixture(async({store,a,input})=>{
 const jewel=(await store.garments.save(a,input,enabled)).garment,clothes=(await store.garments.save(a,{...input,category:'garment',attributes:undefined,garmentType:'shirt',name:'Shirt'})).garment;
 store.db.prepare("UPDATE garments SET source='shopify',externalId=? WHERE account=? AND id=?").run('gid://shopify/Product/1',a.id,clothes.id);store.db.prepare("UPDATE garments SET source='shopify',externalId=? WHERE account=? AND id=?").run('gid://shopify/Product/2',a.id,jewel.id);
 store.db.prepare("INSERT INTO catalogue_source_origins VALUES(?,'shopify','https://sample.myshopify.com')").run(a.id);
 const shopper=new ShopifyShopper(store),installation={id:'installation',store:a.id,status:'installed',shop:'sample.myshopify.com'};
 assert.equal(shopper.productCount(installation),1);assert.deepEqual(shopper.products(installation).map(p=>p.id),[clothes.id]);assert.deepEqual(shopper.products(installation,{garmentId:jewel.id}),[]);
 const copy=store.db.prepare('INSERT INTO garments(account,id,name,garmentType,variant,sourceUrl,imageHash,signature,colour,image,thumbnail,savedAt) SELECT account,?,name,garmentType,variant,sourceUrl,?,signature,colour,image,thumbnail,savedAt FROM garments WHERE account=? AND id=?');for(let i=0;i<498;i++)copy.run('copy-'+i,'hash-'+i,a.id,clothes.id);
 assert.equal(store.garments.browse(a,{category:'jewellery'},enabled).stored,500);await assert.rejects(store.garments.save(a,{...input,variant:'Another'},enabled),{status:409});
}));
