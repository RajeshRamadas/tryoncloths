import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp} from '../../server/app.js';

async function setup(page,run,enabled=true){
 const dir=await mkdtemp(path.join(os.tmpdir(),'forme-jewellery-browser-')),store=new AccountStore(dir),owner=await store.register({name:'Jewellery store',email:'jewels@example.test',password:'test-password-long'});
 const photo=await sharp({create:{width:220,height:220,channels:4,background:'#c9a44c'}}).composite([{input:Buffer.from('<svg width="220" height="220"><circle cx="110" cy="105" r="55" stroke="#fff" stroke-width="16" fill="none"/></svg>')}]).png().toBuffer();let ai=0;
 const server=createApp({accountStore:store,accessMode:'public',jewelleryEnabled:enabled,apiKey:'test',tryOn:async()=>{ai++;throw new Error('No AI expected');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const api='http://127.0.0.1:'+server.address().port;
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});await route.fulfill({response});});
 try{
  await page.goto('/');await page.getByLabel('Account email').fill('jewels@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('link',{name:'Catalogue',exact:true}).click();await expect(page.getByRole('heading',{name:'Store catalogue',exact:true})).toBeVisible();
  await run({store,owner,photo,ai:()=>ai});
 }finally{await page.unrouteAll({behavior:'wait'});await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
}

test('mobile jewellery inventory guesses Indian types, saves photos and dimensions, edits and filters without AI',async({page})=>setup(page,async({store,owner,photo,ai})=>{
 await page.setViewportSize({width:390,height:844});await page.getByRole('link',{name:'Jewellery catalogue',exact:true}).click();await expect(page.getByRole('heading',{name:'Jewellery catalogue',exact:true})).toBeVisible();
 await page.getByLabel('Item name',{exact:true}).fill('Gold jhumka');await expect(page.getByRole('combobox',{name:'Jewellery type',exact:true})).toHaveValue('jhumka');await page.getByRole('combobox',{name:'Metal',exact:true}).selectOption('yellow_gold');
 await page.getByText('Dimensions and hallmark',{exact:true}).click();await expect(page.getByLabel('Sold as a pair',{exact:true})).toBeChecked();await page.getByLabel('Earring drop (mm)',{exact:true}).fill('35');await page.getByLabel('Purity',{exact:true}).fill('22K');await page.getByLabel('Price (INR)',{exact:true}).fill('4999');await page.getByLabel('SKU',{exact:true}).fill('J-1');
 await page.getByLabel('Product photo',{exact:true}).setInputFiles({name:'jhumka.png',mimeType:'image/png',buffer:photo});await page.getByLabel('I confirm saving this product photo and its details to this store account.',{exact:true}).check();await page.getByRole('button',{name:'Save jewellery item',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Gold jhumka',exact:true})).toBeVisible();expect(store.garments.list(owner)).toHaveLength(0);const items=store.garments.list(owner,{category:'jewellery',jewelleryEnabled:true});expect(items).toHaveLength(1);expect(items[0].attributes.dropMm).toBe(35);expect(items[0].attributes.pair).toBe(true);
 await page.getByRole('button',{name:'Edit Gold jhumka',exact:true}).click();await page.getByRole('combobox',{name:'Metal',exact:true}).selectOption('silver');await page.getByLabel('Price (INR)',{exact:true}).fill('1999');await page.getByRole('button',{name:'Save jewellery details',exact:true}).click();await expect(page.getByText('Jewellery details saved.',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Filter metal',exact:true}).selectOption('yellow_gold');await page.getByRole('button',{name:'Search saved jewellery',exact:true}).click();await expect(page.getByText('No jewellery matches these filters.',{exact:true})).toBeVisible();await page.getByRole('combobox',{name:'Filter metal',exact:true}).selectOption('silver');await page.getByRole('button',{name:'Search saved jewellery',exact:true}).click();await expect(page.getByRole('heading',{name:'Gold jhumka',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Jewellery type',exact:true}).selectOption('necklace');await page.getByLabel('Chain / necklace length (cm)',{exact:true}).fill('45');await expect(page.getByText(/Suggested future view: Portrait/)).toBeVisible();await page.getByLabel('Chain / necklace length (cm)',{exact:true}).fill('60');await expect(page.getByText(/Suggested future view: Full body/)).toBeVisible();
 await page.screenshot({path:'test-results/jewellery-catalogue-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(owner.user.id,owner.id);await page.reload();await expect(page.getByRole('heading',{name:'Gold jhumka',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Add a jewellery item',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit Gold jhumka',exact:true})).toHaveCount(0);
 store.db.prepare("UPDATE memberships SET role='owner' WHERE user=? AND store=?").run(owner.user.id,owner.id);await page.reload();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete Gold jhumka',exact:true}).click();await expect(page.getByText('Jewellery item deleted.',{exact:true})).toBeVisible();expect(ai()).toBe(0);
}));

test('jewellery feature stays hidden and cannot open when disabled',async({page})=>setup(page,async()=>{
 await expect(page.getByRole('link',{name:'Jewellery catalogue',exact:true})).toHaveCount(0);await page.goto('/jewellery-catalogue');await expect(page.getByText('Jewellery catalogue is not enabled on this studio.',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Add a jewellery item',exact:true})).toHaveCount(0);
},false));
