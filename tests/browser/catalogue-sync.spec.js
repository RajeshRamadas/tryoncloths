import {openStoreTools} from '../helpers/studio-navigation.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp} from '../../server/app.js';
const response=data=>({status:200,headers:{},body:Buffer.from(JSON.stringify(data))});
async function setup(page,run){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-sync-browser-')),store=new AccountStore(directory),owner=await store.register({name:'Sync store',email:'sync@example.test',password:'test-password-long'}),initial=await store.register({name:'Branch store',email:'branch@example.test',password:'test-password-long'});
 store.db.prepare('UPDATE stores SET org=? WHERE id=?').run(owner.org,initial.id);store.db.prepare("UPDATE orgs SET plan='chain' WHERE id=?").run(owner.org);store.db.prepare("INSERT INTO memberships VALUES(?,?,'owner')").run(owner.user.id,initial.id);const branch=store.identity(owner.user.id,initial.id);
 const image=await sharp({create:{width:200,height:240,channels:3,background:'#4466aa'}}).png().toBuffer();let fail=false,ai=0;
 const product={id:'gid://shopify/Product/1',title:'Summer piece',handle:'summer-piece',productType:'',tags:[],vendor:'Example',status:'ACTIVE',featuredImage:{url:'https://cdn.example.test/product.png'},variants:{nodes:[{id:'v1',sku:'SUMMER',price:'999.00',compareAtPrice:null,inventoryQuantity:5,inventoryPolicy:'DENY',inventoryItem:{tracked:true},selectedOptions:[{name:'Size',value:'M'}]}],pageInfo:{hasNextPage:false}}};
 const fetchImpl=async(url,options)=>{if(fail)return {status:401,headers:{},body:Buffer.from('{"error":"do-not-echo-token"}')};const {query}=JSON.parse(options.body);return query.includes('shop {')?response({data:{shop:{id:'shop1',currencyCode:'INR'}}}):response({data:{products:{nodes:[product],pageInfo:{hasNextPage:false}}}});};
 const app=createApp({accountStore:store,accessMode:'public',apiKey:'test',tryOn:async()=>{ai++;throw new Error('No AI call expected');},syncOptions:{secretKey:'ab'.repeat(32),fetchImpl,fetchImage:async()=>({body:image})}}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const api=`http://127.0.0.1:${server.address().port}`;
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),result=await route.fetch({url:api+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});await route.fulfill({response:result});});
 try{await page.goto('/');await page.getByLabel('Account email').fill('sync@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await page.getByLabel('Active store').selectOption(owner.id);await expect(page.locator('.store-account strong').first()).toHaveText('Sync store');await openStoreTools(page);await page.getByRole('link',{name:'Catalogue',exact:true}).click();await expect(page.getByRole('heading',{name:'Store catalogue',exact:true})).toBeVisible();await run({store,owner,branch,service:app.locals.catalogueSync,ai:()=>ai,setFail:value=>{fail=value;}});}finally{
  // Assertions are finished. Stop late React requests before closing the proxy;
  // reload-cancelled requests may otherwise try to fulfill an already handled route.
  await page.unrouteAll({behavior:'ignoreErrors'}).catch(()=>{});
  await page.goto('about:blank').catch(()=>{});
  await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});
 }

}
async function connect(page){await page.getByText('Connect Shopify',{exact:true}).click();await page.getByLabel('Shopify shop address').fill('sample.myshopify.com');await page.getByLabel('Shopify read-only access token').fill('do-not-echo-token');await page.getByRole('button',{name:'Save Shopify connection',exact:true}).click();await expect(page.getByText('Shopify connected. Use Sync now to import products.',{exact:true})).toBeVisible();}

test('mobile owner connects, syncs without credits, confirms clothing type, sees errors and shares a read-only Chain master',async({page})=>setup(page,async({store,owner,branch,setFail,ai})=>{
 await page.setViewportSize({width:390,height:844});await connect(page);await expect(page.getByLabel('Shopify read-only access token')).toHaveValue('');await page.getByRole('button',{name:'Sync Shopify now',exact:true}).click();await expect(page.getByRole('heading',{name:'Summer piece',exact:true})).toBeVisible();await expect(page.getByText(/1 created · 0 updated · 0 unchanged/)).toBeVisible();
 await page.getByLabel('Clothing type for Summer piece',{exact:true}).selectOption('shirt');await page.getByRole('button',{name:'Confirm type for Summer piece',exact:true}).click();await expect(page.getByText('Clothing type confirmed.',{exact:true})).toBeVisible();expect(store.garments.list(owner)[0].garmentType).toBe('shirt');
 await page.getByLabel('Master catalogue store').selectOption(owner.id);await page.getByRole('button',{name:'Save master catalogue',exact:true}).click();await expect(page.getByText('Master catalogue updated.',{exact:true})).toBeVisible();expect(store.garments.browse(branch).garments[0].readOnly).toBe(true);
 setFail(true);await page.getByRole('button',{name:'Sync Shopify now',exact:true}).click();await expect(page.getByRole('alert').first()).toContainText('shop API rejected');expect(await page.locator('body').innerText()).not.toContain('do-not-echo-token');expect(store.garments.list(owner)).toHaveLength(1);expect(ai()).toBe(0);
 await page.screenshot({path:'test-results/catalogue-sync-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const cookies=store.session(branch);await page.context().addCookies([{name:'forme_session',value:cookies,url:new URL(page.url()).origin}]);await page.reload();await expect(page.getByText(/Shared master · Read-only/)).toBeVisible();await expect(page.getByRole('button',{name:'Edit Summer piece',exact:true})).toHaveCount(0);
}));

test('managers can sync but cannot reconnect or select a master; staff only browse products',async({page})=>setup(page,async({store,owner,service,ai})=>{
 await service.connect(owner,'shopify',{shopDomain:'sample.myshopify.com',token:'do-not-echo-token'});store.db.prepare("UPDATE memberships SET role='manager' WHERE user=? AND store=?").run(owner.user.id,owner.id);await page.reload();await expect(page.getByRole('button',{name:'Sync Shopify now',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Disconnect Shopify',exact:true})).toHaveCount(0);await expect(page.getByLabel('Master catalogue store')).toHaveCount(0);await page.getByRole('button',{name:'Sync Shopify now',exact:true}).click();await expect(page.getByRole('heading',{name:'Summer piece',exact:true})).toBeVisible();
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(owner.user.id,owner.id);await page.reload();await expect(page.getByRole('heading',{name:'Browse products',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Shop connections',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit Summer piece',exact:true})).toHaveCount(0);expect(ai()).toBe(0);
}));
