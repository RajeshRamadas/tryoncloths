import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp} from '../../server/app.js';

// Mail and provider networking are replaced; auth, invites and roles use real SQLite/API routes.
test('owner invites staff, staff accepts and logs in, manager rules and disabling take effect',async({page,browser})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-staff-browser-')),store=new AccountStore(directory),mail=[];
 const owner=await store.register({email:'owner@example.test',name:'Example store',password:'owner-password-long'});
 const server=createApp({accountStore:store,accessMode:'public',rateLimit:false,publicUrl:'https://studio.example.test',sendMail:async m=>{mail.push(m);}}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));const api=`http://127.0.0.1:${server.address().port}`;
 const context=await browser.newContext(),staff=await context.newPage();
 async function route(p){await p.route('**/api/**',async r=>{const u=new URL(r.request().url());const response=await r.fetch({url:api+u.pathname+u.search,headers:{...r.request().headers(),host:new URL(api).host,origin:api}});await r.fulfill({response});});}
 try {
  await route(page);await route(staff);await page.goto('/');
  await page.getByLabel('Account email').fill('owner@example.test');await page.getByLabel('Account password').fill('owner-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Staff',exact:true}).click();
  await page.getByLabel('Staff email').fill('assistant@example.test');await page.getByRole('button',{name:'Send invitation',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Invitation emailed'})).toBeVisible();expect(mail).toHaveLength(1);
  const token=mail[0].text.match(/\/invite#([A-Za-z0-9_-]{43})/)[1];
  await staff.goto(`/invite#${token}`);
  await expect(staff).toHaveURL(/\/invite$/);
  await staff.getByLabel('Your name').fill('Anita');await staff.getByLabel('Forme password').fill('anita-password-long');await staff.getByRole('button',{name:'Accept invitation'}).click();
  await expect(staff.getByRole('status')).toContainText('Invitation accepted');
  await staff.getByRole('link',{name:'Go to sign in'}).click();await staff.getByLabel('Account email').fill('assistant@example.test');await staff.getByLabel('Account password').fill('anita-password-long');await staff.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(staff.getByRole('region',{name:'Store account',exact:true})).toContainText('Anita · staff');await expect(staff.getByRole('button',{name:'Staff',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Close staff',exact:true}).click();await page.getByRole('button',{name:'Staff',exact:true}).click();
  await page.getByLabel('Role for Anita').selectOption('manager');
  await expect(page.getByRole('status').filter({hasText:'Staff access updated'})).toBeVisible();
  await staff.reload();await staff.getByRole('button',{name:'Staff',exact:true}).click();
  await expect(staff.getByLabel('Invitation role').locator('option')).toHaveCount(1);
  await expect(staff.getByRole('button',{name:'Disable Example store',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Disable Anita',exact:true}).click();
  await expect(page.getByRole('region',{name:'Staff management'})).toContainText('Disabled');
  await staff.reload();await expect(staff.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await staff.goto(`/invite#${token}`);await staff.getByLabel('Your name').fill('Anita');await staff.getByLabel('Forme password').fill('anita-password-long');await staff.getByRole('button',{name:'Accept invitation'}).click();
  await expect(staff.getByRole('alert')).toContainText('already used');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/staff-management-mobile.png',fullPage:true});
  expect(store.db.prepare('SELECT count(*) AS n FROM memberships WHERE store=?').get(owner.id).n).toBe(2);
 } finally {await context.close();await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
});

test('invitation page handles missing tokens at mobile width',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/invite');
 await expect(page.getByRole('alert')).toContainText('complete invitation link');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
