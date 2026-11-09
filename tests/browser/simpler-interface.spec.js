import {test, expect} from '@playwright/test';
import {mkdtemp, rm} from 'node:fs/promises';
import sharp from 'sharp';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp, standardAvatar} from '../../server/app.js';
import {openStoreTools} from '../helpers/studio-navigation.js';

async function storeSession(page, run) {
  const directory=await mkdtemp('/tmp/forme-simple-ui-'), store=new AccountStore(directory);
  const account=await store.register({email:'interface@example.test',name:'Sample Store',password:'sample-store-password'});
  // Match the generated-avatar reference frame used by the existing renderer.
  const framed=await sharp(await standardAvatar('regular')).extend({top:48,bottom:48,left:154,right:154,background:'#c6c6c6'}).png().toBuffer();
  const avatar=await store.save(account,{image:'data:image/png;base64,'+framed.toString('base64'),name:'Sample customer',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
  const server=createApp({accountStore:store,accessMode:'public',jewelleryEnabled:true,apiKey:'',rateLimit:false}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const api='http://127.0.0.1:'+server.address().port, paid=[];
  const requests=request=>{if(/\/api\/(?:personalize|tryon|jewellery\/tryon)(?:\?|$)/.test(request.url()))paid.push(request.url());};
  page.on('request',requests);
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    const response=await route.fetch({url:api+url.pathname+url.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});
    await route.fulfill({response});
  });
  try {
    await page.setViewportSize({width:390,height:844});await page.goto('/');
    await page.getByLabel('Account email').fill('interface@example.test');
    await page.getByLabel('Account password').fill('sample-store-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
    await run({account,avatar,store,paid});
  } finally {
    page.off('request',requests);
    await page.unrouteAll({behavior:'wait'});
    await new Promise(resolve=>server.close(resolve));store.close();await rm(directory,{recursive:true,force:true});
  }
}

test('compact store menu keeps customer work visible and traps focus above the complete mobile backdrop',async({page})=>storeSession(page,async()=>{
  const trigger=page.getByRole('button',{name:'Store tools',exact:true});
  await expect(page.getByRole('button',{name:'Saved avatars',exact:true})).toBeInViewport();
  await expect(page.getByRole('link',{name:'Billing',exact:true})).toBeHidden();
  await page.screenshot({path:'docs/testing/simpler-studio/04-after-home-mobile.png'});
  await trigger.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Store tools',exact:true});
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element=>element.matches(':modal'))).toBe(true);
  await expect(dialog.getByRole('link',{name:'Jewellery catalogue',exact:true})).toBeVisible();
  await expect(dialog.getByRole('link',{name:'Billing',exact:true})).toBeVisible();
  for(let n=0;n<16;n++){
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  }
  await dialog.getByRole('button',{name:'Staff',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Staff email')).toBeVisible();
  await dialog.getByRole('button',{name:'Close staff',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('heading',{name:'Store tools',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'docs/testing/simpler-studio/05-store-tools-mobile.png'});
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  await openStoreTools(page);await page.mouse.click(2,2);await expect(dialog).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));

test('fitting room reveals one source at a time while retaining product drafts, sample selections and review guards',async({page})=>storeSession(page,async({paid})=>{
  await page.getByRole('button',{name:'Saved avatars',exact:true}).click();
  await page.getByRole('button',{name:'Use Sample customer',exact:true}).click();
  await page.getByLabel('The customer approves the face, body and skin tone of this avatar.').check();
  await page.getByRole('button',{name:'Try clothes',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sample clothes',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('Product link',{exact:true})).toBeHidden();
  const summary=page.locator('.sample-outfits summary');
  await expect(page.getByRole('group',{name:'Complete sample outfits',exact:true})).toBeHidden();
  await summary.focus();await page.keyboard.press('Enter');
  await page.getByRole('group',{name:'Complete sample outfits'}).getByRole('button',{name:/^Earth tones/}).click();
  await summary.click();
  await page.getByLabel('I have checked clothing placement and approve this outfit preview.').check();
  await expect(page.getByRole('button',{name:'Download outfit',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Your products',exact:true}).click();
  await page.getByLabel('Product link',{exact:true}).fill('https://shop.example.test/remember-this');
  await expect(page.getByLabel('Search sample clothes')).toBeHidden();
  await page.getByRole('button',{name:'Sample clothes',exact:true}).click();
  await expect(page.getByRole('button',{name:'Forest green T-shirt Sample',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Your products',exact:true}).click();
  await expect(page.getByLabel('Product link',{exact:true})).toHaveValue('https://shop.example.test/remember-this');
  await page.getByRole('button',{name:'Sample clothes',exact:true}).click();
  await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'docs/testing/simpler-studio/06-after-outfit-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('link',{name:'Choose clothes',exact:true}).click();
  await expect(page.getByRole('button',{name:'Your products',exact:true})).toBeInViewport();
  await page.screenshot({path:'docs/testing/simpler-studio/07-after-outfit-mobile.png'});
  await expect(page.getByLabel('shirt Left / right')).toBeHidden();
  await page.locator('.placement-options summary').click();
  await page.getByLabel('shirt Left / right').fill('25');
  await expect(page.getByRole('button',{name:'Download outfit',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(paid).toEqual([]);
}));

test('jewellery sources hide unrelated fields and preserve links across source changes without a paid request',async({page})=>storeSession(page,async({avatar,paid})=>{
  await page.goto('/jewellery?avatar='+avatar.id);
  await expect(page.getByRole('list',{name:'Jewellery fitting steps',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Full body view',exact:true}).click();
  await expect(page.getByRole('img',{name:'Approved full reference',exact:true})).toBeVisible();
  const sources=page.getByRole('group',{name:'Jewellery source',exact:true});
  await expect(page.getByLabel('Search jewellery',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Jewellery product link',{exact:true})).toBeHidden();
  await sources.getByRole('button',{name:'Product link',exact:true}).click();
  await page.getByLabel('Jewellery product link',{exact:true}).fill('https://shop.example.test/necklace');
  await expect(page.getByLabel('Search jewellery',{exact:true})).toBeHidden();
  await sources.getByRole('button',{name:'Upload photo',exact:true}).click();
  await expect(page.getByLabel('Upload jewellery product photo',{exact:true})).toBeVisible();
  await sources.getByRole('button',{name:'Product link',exact:true}).click();
  await expect(page.getByLabel('Jewellery product link',{exact:true})).toHaveValue('https://shop.example.test/necklace');
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'docs/testing/simpler-studio/08-after-jewellery-desktop.png'});
  await sources.getByRole('button',{name:'Upload photo',exact:true}).click();
  const photo=await sharp({create:{width:200,height:200,channels:3,background:'#c5a764'}}).jpeg().toBuffer();
  await page.getByLabel('Upload jewellery product photo',{exact:true}).setInputFiles({name:'test-necklace.jpg',mimeType:'image/jpeg',buffer:photo});
  await expect(page.getByRole('img',{name:'Selected jewellery product',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('heading',{name:'Choose jewellery',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.screenshot({path:'docs/testing/simpler-studio/09-after-jewellery-mobile.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(paid).toEqual([]);
}));
