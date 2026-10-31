import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { AccountStore } from '../helpers/pilot-accounts.js';
import { createApp, standardAvatar } from '../../server/app.js';

async function fixture(page, work) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'forme-catalogue-browser-'));
  const store=new AccountStore(directory);
  const owner=await store.register({email:'catalogue@example.com',name:'Clothing store',password:'long-test-password-123'});
  const avatar=`data:image/png;base64,${(await standardAvatar('regular')).toString('base64')}`;
  await store.save(owner,{image:avatar,name:'Customer One',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
  const photo=await sharp('public/garments/blue-shirt.webp').flatten({background:'#fff'}).resize(320,400,{fit:'contain',background:'#fff'}).jpeg({quality:90}).toBuffer();
  const productPhoto=`data:image/jpeg;base64,${photo.toString('base64')}`;
  let links=0,generations=0;
  const server=createApp({accountStore:store,accessMode:'public',apiKey:'test',rateLimit:false,
    productLink:async url=>{links++;return {url,title:'Blue Oxford Shirt',images:[{source:'product',image:productPhoto}]};},
    tryOn:async()=>{generations++;return avatar;},
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const api=`http://127.0.0.1:${server.address().port}`;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/tryon'){
      const body=route.request().postDataJSON();
      if(body.garmentId)expect(body.garment).toBeUndefined();
    }
    const response=await route.fetch({url:api+url.pathname+url.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});
    await route.fulfill({response});
  });
  async function openAvatar() {
    await page.getByRole('button',{name:'Saved avatars',exact:true}).click();
    await page.getByRole('button',{name:'Use Customer One',exact:true}).click();
    await page.getByLabel('The customer approves the face, body and skin tone of this avatar.').check();
    await page.getByRole('button',{name:'Try clothes',exact:true}).click();
    await expect(page.getByAltText('Avatar wearing the selected outfit')).toBeVisible();
  }
  try {
    await page.goto('/');
    await page.getByLabel('Account email').fill('catalogue@example.com');
    await page.getByLabel('Account password').fill('long-test-password-123');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
    await openAvatar();
    await work({store,owner,photo,openAvatar,calls:()=>({links,generations})});
  } finally {await new Promise(resolve=>server.close(resolve));store.close();await rm(directory,{recursive:true,force:true});}
}

test('saved store clothes and reviewed adaptations reopen without another product read or AI call',async({page})=>fixture(page,async({openAvatar,calls,store,owner})=>{
  await page.getByLabel('Product link',{exact:true}).fill('https://shop.example/p/42?colour=blue&utm_source=first');
  await page.getByRole('button',{name:'Find',exact:true}).click();
  await page.getByLabel('Colour / size / SKU variant').fill('Blue / M');
  await page.getByRole('button',{name:'Save garment to store',exact:true}).click();
  await expect(page.getByText('Garment saved to your store. It can be selected for any customer.')).toBeVisible();
  expect(calls()).toEqual({links:1,generations:0});
  await page.getByLabel(/send their avatar and this product photo/).check();
  await page.getByRole('button',{name:'Put on avatar',exact:true}).click();
  await expect(page.getByText('Try-on created. Check the face, body and garment before keeping this look.')).toBeVisible();
  await page.getByLabel('I have checked clothing placement and approve this outfit preview.').check();
  await page.getByLabel('The customer agrees to save this outfit to the store account.').check();
  await page.getByRole('button',{name:'Save adaptation for reuse',exact:true}).click();
  await expect(page.getByText('Adaptation saved for reuse.',{exact:true})).toBeVisible();
  expect(store.garments.list(owner)[0].adaptations).toBe(1);
  await page.getByRole('button',{name:'Reset outfit',exact:true}).click();
  const useSaved=page.getByRole('button',{name:'Use saved result — no AI charge',exact:true});
  await expect(useSaved).toBeVisible();await useSaved.click();
  await expect(page.getByText('Saved adaptation reused without an AI request. Review it before keeping this look.')).toBeVisible();
  expect(calls()).toEqual({links:1,generations:1});
  await expect(page.getByRole('button',{name:'Download outfit',exact:true})).toBeDisabled();
  // A local clothing layer changes the input pixels: the old cached result must disappear.
  await page.getByRole('button',{name:'Reset outfit',exact:true}).click();
  await page.getByRole('button',{name:'Navy T-shirt Sample',exact:true}).click();
  await expect(useSaved).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Put on avatar',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Reset outfit',exact:true}).click();await expect(useSaved).toBeVisible();
  await page.reload();await openAvatar();
  await page.getByRole('button',{name:'My store clothes',exact:true}).click();
  await page.getByLabel('Search clothes').fill('Oxford');
  await page.getByLabel('Filter clothes').selectOption('shirt');
  await expect(page.getByRole('button',{name:/Use Blue Oxford Shirt · Blue \/ M/})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/store-garment-catalogue-mobile.png',fullPage:true});
  await page.getByRole('button',{name:/Use Blue Oxford Shirt · Blue \/ M/}).click();
  await expect(useSaved).toBeVisible();
  // Canonicalized link lookup selects the stored item without a retailer fetch.
  await page.getByLabel('Product link',{exact:true}).fill('https://shop.example/p/42?utm_source=second&colour=blue');
  await page.getByRole('button',{name:'Find',exact:true}).click();
  await expect(page.getByText('Saved garment selected. No website read or AI request was made.')).toBeVisible();
  await expect(useSaved).toBeVisible();expect(calls()).toEqual({links:1,generations:1});
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Forget saved adaptation',exact:true}).click();
  await expect(useSaved).toHaveCount(0);expect(store.garments.list(owner)[0].adaptations).toBe(0);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Delete garment Blue Oxford Shirt · Blue / M',exact:true}).click();
  await expect(page.getByText(/No saved clothes match/)).toBeVisible();
  expect(store.garments.list(owner)).toHaveLength(0);
  expect(calls()).toEqual({links:1,generations:1});
}));

test('uploading the same garment again offers the saved photo instead of creating a second catalogue item',async({page})=>fixture(page,async({photo,store,owner,calls})=>{
  const input={name:'oxford-shirt.jpg',mimeType:'image/jpeg',buffer:photo};
  await page.getByLabel('Upload product photo',{exact:true}).setInputFiles(input);
  await page.getByLabel('Garment name',{exact:true}).fill('Photo shirt');
  await page.getByRole('button',{name:'Save garment to store',exact:true}).click();
  await expect(page.getByText('Garment saved to your store. It can be selected for any customer.')).toBeVisible();
  await page.getByLabel('Upload product photo',{exact:true}).setInputFiles(input);
  await expect(page.getByRole('region',{name:'Already saved from this photo'})).toBeVisible();
  await page.getByRole('button',{name:/Use saved garment Photo shirt/}).click();
  await expect(page.getByText('Saved garment selected. No website read or AI request was made.')).toBeVisible();
  expect(store.garments.list(owner)).toHaveLength(1);expect(calls()).toEqual({links:0,generations:0});
}));
