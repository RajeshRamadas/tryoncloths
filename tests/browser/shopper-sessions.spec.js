import {test,expect} from '@playwright/test';
import {randomBytes} from 'node:crypto';
import {shopifyFixture,publicStudio} from '../helpers/shopify-shopper.js';

async function setup(page,run){
  const f=await shopifyFixture({sessionOptions:{enabled:true}});await f.install();await f.enable(await f.product());
  const proxy=async route=>{try{const url=new URL(route.request().url()),response=await route.fetch({url:f.base+url.pathname+url.search,headers:{...route.request().headers(),host:new URL(f.base).host,origin:publicStudio}});await route.fulfill({response});}catch(e){if(page.url()!=='about:blank'&&!page.isClosed())throw e;}};
  await page.route('**/shopper',proxy);await page.route('**/shopper-api/**',proxy);
  const launch=async()=>{const url=new URL(f.service.launch(f.proxy({launch_nonce:randomBytes(16).toString('hex')})));await page.goto('/shopper'+url.hash);};
  try{await run({...f,launch});}finally{await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});await f.close();}
}

test('anonymous mobile session uses isolated HttpOnly cookies, strips the ticket, counts down and can end without photos or credits',async({page})=>setup(page,async f=>{
  await page.setViewportSize({width:390,height:844});await f.launch();await expect(page.getByRole('heading',{name:'River Clothing',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Blue shirt',exact:true})).toBeVisible();await expect(page.getByRole('status')).toContainText('temporary shopper session is ready');
  await expect(page.locator('#expiry')).toContainText('30 minutes');await expect(page).toHaveURL(/\/shopper$/);await expect(page.locator('input[type=file]')).toHaveCount(0);
  const cookies=await page.context().cookies();expect(cookies.find(c=>c.name==='forme_shopper')).toMatchObject({httpOnly:true,sameSite:'Strict'});expect(cookies.some(c=>c.name==='forme_session')).toBe(false);expect(await page.evaluate(()=>document.cookie.includes('forme_shopper'))).toBe(false);expect(await page.evaluate(()=>localStorage.length)).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/shopper-session-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'End shopper session',exact:true}).click();await expect(page.getByRole('status')).toContainText('Shopper session ended');await expect(page.getByRole('button',{name:'End shopper session',exact:true})).toBeHidden();
  await expect.poll(async()=>((await page.context().cookies()).some(c=>c.name==='forme_shopper'))).toBe(false);expect((await page.context().cookies()).some(c=>c.name==='forme_shopper_device')).toBe(true);expect(f.ai()).toBe(0);expect(f.store.billing.balance(f.a.org)).toBe(1000);
}));

test('server expiry is enforced on resume and does not slide when the page checks its session',async({page})=>setup(page,async f=>{
  const created=page.waitForResponse(response=>response.url().endsWith('/shopper-api/session')&&response.request().method()==='POST');await f.launch();const original=await (await created).json();await expect(page.getByRole('status')).toContainText('session is ready');
  f.advance(10*60000);const read=page.waitForResponse(response=>response.url().endsWith('/shopper-api/session')&&response.request().method()==='GET');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));expect((await (await read).json()).expiresAt).toBe(original.expiresAt);
  f.advance(21*60000);await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(page.getByRole('status')).toContainText('expired');await expect(page.getByRole('button',{name:'End shopper session',exact:true})).toBeHidden();expect(f.ai()).toBe(0);
}));

test('ending and reopening cannot reset device limits, and an owner pause revokes the active tab on resume',async({page})=>setup(page,async f=>{
  await f.launch();await expect(page.getByRole('status')).toContainText('session is ready');await page.getByRole('button',{name:'End shopper session',exact:true}).click();await expect(page.getByRole('status')).toContainText('session ended');
  await page.goto('about:blank');await f.launch();await expect(page.getByRole('status')).toContainText('session is ready');f.store.shoppers.update(f.a,{action:'pause'});await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(page.getByRole('status')).toContainText('no longer available');
  f.configure();await page.goto('about:blank');await f.launch();await expect(page.getByRole('status')).toContainText('Please wait');expect(f.ai()).toBe(0);expect(f.store.db.prepare('SELECT count(*) n FROM avatars').get().n).toBe(0);
}));
