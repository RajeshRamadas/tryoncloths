import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp} from '../../server/app.js';
async function setup(page,run){
 const dir=await mkdtemp(path.join(os.tmpdir(),'forme-import-browser-')),store=new AccountStore(dir),owner=await store.register({name:'Clothing store',email:'catalogue@example.test',password:'test-password-long'});
 const photo=await sharp({create:{width:200,height:300,channels:3,background:'#3466aa'}}).png().toBuffer();let ai=0;
 const server=createApp({accountStore:store,accessMode:'public',apiKey:'test',tryOn:async()=>{ai++;throw new Error('No AI request expected');},catalogueOptions:{fetchImage:async()=>({body:photo})}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const api=`http://127.0.0.1:${server.address().port}`;
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});await route.fulfill({response});});
 try{await page.goto('/');await page.getByLabel('Account email').fill('catalogue@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('link',{name:'Catalogue',exact:true}).click();await expect(page.getByRole('heading',{name:'Store catalogue',exact:true})).toBeVisible();await run({store,owner,ai:()=>ai});}finally{await page.unrouteAll({behavior:'wait'});await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
}
const csv='name,type,sku,brand,price,mrp,sizes,colour,stock,product_url,image_url\nBlue shirt,shirt,BLUE,Example,999,1299,M|L,Blue,in,,https://shop.example/blue.jpg\nRed shirt,shirt,RED,Example,899,1199,S|M,Red,out,,https://shop.example/red.jpg\nBad price,shirt,BAD,Example,-1,1200,M,Red,in,,https://shop.example/bad.jpg\n';
async function upload(page,buffer,name='products.csv'){await page.getByLabel('Product spreadsheet').setInputFiles({name,mimeType:name.endsWith('.csv')?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});await page.getByRole('button',{name:'Import selected spreadsheet',exact:true}).click();}

test('mobile CSV import reports errors, hides out-of-stock items, edits metadata and lets staff browse read-only',async({page})=>setup(page,async({store,owner,ai})=>{
 await page.setViewportSize({width:390,height:844});const template=page.waitForEvent('download');await page.getByRole('button',{name:'Download import template'}).click();expect((await template).suggestedFilename()).toBe('catalogue-template.csv');
 await upload(page,Buffer.from(csv));await expect(page.getByText('2 created · 0 updated · 1 skipped',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Blue shirt',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Red shirt',exact:true})).toHaveCount(0);await expect(page.getByText('Sizes: M, L ·',{exact:true})).toBeVisible();
 const errors=page.waitForEvent('download');await page.getByRole('button',{name:'Download import errors'}).click();expect((await errors).suggestedFilename()).toBe('catalogue-import-errors.csv');
 await page.getByRole('button',{name:'Edit Blue shirt',exact:true}).click();await page.getByLabel('Price (INR)',{exact:true}).fill('849');await page.getByLabel('Product stock').selectOption('low');await page.getByRole('button',{name:'Save product details'}).click();await expect(page.getByText('Product details saved.')).toBeVisible();const id=store.garments.list(owner).find(g=>g.sku==='BLUE').id;expect(store.garments.get(owner,id).priceInr).toBe(849);
 await page.getByLabel('Stock filter').selectOption('all');await page.getByRole('button',{name:'Apply catalogue filters'}).click();await expect(page.getByRole('heading',{name:'Red shirt',exact:true})).toBeVisible();await page.screenshot({path:'test-results/catalogue-import-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(owner.user.id,owner.id);await page.reload();await expect(page.getByRole('heading',{name:'Browse products'})).toBeVisible();await expect(page.getByRole('heading',{name:'Import products',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit Blue shirt',exact:true})).toHaveCount(0);expect(ai()).toBe(0);
}));

test('Excel converts in a worker, imports only the first worksheet and repeats SKUs without duplicates',async({page})=>setup(page,async({store,owner,ai})=>{
 const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['name','type','sku','brand','price','mrp','sizes','colour','stock','product_url','image_url'],['Excel jeans','jeans','JEANS','Denim',1499.5,1999,'30|32','Blue','in','','https://shop.example/jeans.jpg']]),'Products');XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['ignored']]),'Other');const buffer=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
 await upload(page,buffer,'products.xlsx');await expect(page.getByText('1 created · 0 updated · 0 skipped',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Excel jeans',exact:true})).toBeVisible();expect(store.garments.list(owner)[0].priceInr).toBe(1499.5);
 await upload(page,buffer,'products.xlsx');await expect(page.getByText('0 created · 0 updated · 1 skipped',{exact:true})).toBeVisible();expect(store.garments.list(owner)).toHaveLength(1);expect(ai()).toBe(0);
}));
