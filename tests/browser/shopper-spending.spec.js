import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp} from '../../server/app.js';

async function setup(page,run,{plan='growth',role='owner'}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'forme-shopper-browser-')),store=new AccountStore(directory);
  const account=await store.register({name:'River Clothing',email:'shopper@example.test',password:'test-password-long'});
  store.db.prepare('UPDATE orgs SET plan=? WHERE id=?').run(plan,account.org);
  store.db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(role,account.user.id,account.id);
  let calls=0;const app=createApp({accountStore:store,accessMode:'public',tryOn:async()=>{calls++;throw new Error('Unexpected AI call');},personalize:async()=>{calls++;throw new Error('Unexpected AI call');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const api=`http://127.0.0.1:${server.address().port}`;
  const proxy=async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});await route.fulfill({response});};
  await page.route('**/api/**',proxy);
  try{
    await page.goto('/');await page.getByLabel('Account email').fill('shopper@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
    await run({store,account,ai:()=>calls});
  }finally{await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}

test('owner configures monthly shopper budgets on mobile, sees usage and pauses with unsaved edits',async({page})=>setup(page,async({store,account,ai})=>{
  await page.setViewportSize({width:390,height:844});await page.getByRole('link',{name:'Shopper spending',exact:true}).click();
  await expect(page.getByText('Widget not available yet.',{exact:false})).toBeVisible();await expect(page.getByText('Shopper spending is paused.',{exact:true})).toBeVisible();
  await page.getByLabel('Store monthly limit',{exact:true}).fill('50');await page.getByLabel('Organisation monthly limit',{exact:true}).fill('200');await page.getByLabel('Allow shopper spending when the widget is ready',{exact:true}).check();
  await page.getByRole('button',{name:'Save shopper limits',exact:true}).click();await expect(page.getByRole('status')).toContainText('Shopper limits saved.');
  const request={store:account.id,requestId:randomUUID(),action:'avatar',bodyHash:'ab'.repeat(32),sessionHash:'cd'.repeat(32)};store.shoppers.reserve(request);store.shoppers.dispatch(request.requestId);store.shoppers.refund(request.requestId);
  await page.getByRole('button',{name:'Refresh shopper spending',exact:true}).click();const storeUsage=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Active store',exact:true})});
  await expect(storeUsage.getByText('Provider attempts',{exact:true}).locator('+ dd')).toHaveText('1');await expect(storeUsage.getByText('Attempt allowance left',{exact:true}).locator('+ dd')).toHaveText('49');
  await page.getByLabel('Store monthly limit',{exact:true}).fill('999');await page.getByRole('button',{name:'Pause shopper spending now',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Shopper spending paused.');
  await expect(page.getByLabel('Store monthly limit',{exact:true})).toHaveValue('50');await expect(page.getByLabel('Allow shopper spending when the widget is ready',{exact:true})).not.toBeChecked();
  expect(store.shoppers.view(account).store.dispatched).toBe(1);expect(ai()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/shopper-spending-mobile.png',fullPage:true});
}));

test('stale owner tab cannot overwrite newer organisation limits; refresh preserves recorded attempts',async({page})=>setup(page,async({store,account,ai})=>{
  await page.goto('/shopper-spending');await expect(page.getByLabel('Store monthly limit',{exact:true})).toHaveValue('0');
  const before=store.shoppers.view(account);store.shoppers.update(account,{storeLimit:20,organisationLimit:80,paused:false,storeRevision:before.storeRevision,organisationRevision:before.organisationRevision});
  await page.getByLabel('Store monthly limit',{exact:true}).fill('50');await page.getByLabel('Organisation monthly limit',{exact:true}).fill('200');await page.getByRole('button',{name:'Save shopper limits',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('changed in another tab or store');expect(store.shoppers.view(account).organisation.monthlyLimit).toBe(80);
  await page.getByRole('button',{name:'Refresh shopper spending',exact:true}).click();await expect(page.getByLabel('Organisation monthly limit',{exact:true})).toHaveValue('80');await expect(page.getByRole('alert')).toHaveCount(0);expect(ai()).toBe(0);
}));

test('manager sees read-only counters, staff is denied, and ineligible owners can prepare limits without allowing spending',async({page})=>setup(page,async({store,account,ai})=>{
  await page.getByRole('link',{name:'Shopper spending',exact:true}).click();await expect(page.getByText('Only the owner can change limits or pause spending.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Save shopper limits',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Pause shopper spending now',exact:true})).toHaveCount(0);
  store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(account.user.id,account.id);await page.reload();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Store monthly limit',{exact:true})).toHaveCount(0);
  store.db.prepare("UPDATE memberships SET role='owner' WHERE user=? AND store=?").run(account.user.id,account.id);store.db.prepare("UPDATE orgs SET plan='starter' WHERE id=?").run(account.org);await page.reload();
  await expect(page.getByLabel('Allow shopper spending when the widget is ready',{exact:true})).toBeDisabled();await page.getByLabel('Store monthly limit',{exact:true}).fill('25');await page.getByLabel('Organisation monthly limit',{exact:true}).fill('100');await page.getByRole('button',{name:'Save shopper limits',exact:true}).click();await expect(page.getByRole('status')).toContainText('Shopper limits saved.');expect(store.shoppers.view(account).paused).toBe(true);expect(ai()).toBe(0);
},{role:'manager'}));
