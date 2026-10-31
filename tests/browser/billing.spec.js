import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../../server/app.js';
import {customerPhotos} from '../helpers/customer-photos.js';

test('zero-credit avatar shows billing help, a funded retry uses a fresh request ID and owner sees balance',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-billing-browser-')),store=new AccountStore(directory);
 const owner=await store.register({name:'Credit store',email:'credits@example.test',password:'test-password-long'});
 store.db.prepare("INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',-1000,'expire','test-zero',?)").run(randomUUID(),owner.org,Date.now());
 let calls=0;const ids=[];
 const server=createApp({accountStore:store,accessMode:'public',apiKey:'test',rateLimit:false,personalize:async()=>{calls++;return `data:image/png;base64,${(await standardAvatar('regular')).toString('base64')}`;}}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));const api=`http://127.0.0.1:${server.address().port}`;
 try{
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/api/personalize')ids.push(route.request().postDataJSON().requestId);const response=await route.fetch({url:api+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});await route.fulfill({response});});
  await page.goto('/');await page.getByLabel('Account email').fill('credits@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('link',{name:'Billing',exact:true})).toBeVisible();
  await page.getByLabel('The customer agrees to use their photos for this avatar session.').check();
  await page.getByLabel('Upload face photo').setInputFiles(customerPhotos[0].face);await page.getByLabel('Upload full-body photo').setInputFiles(customerPhotos[0].body);
  await page.getByRole('button',{name:'Continue to match'}).click();await page.getByRole('checkbox',{name:/The customer agrees to send their face photo/}).check();
  await page.getByRole('button',{name:'Generate customer avatar',exact:true}).click();
  await expect(page.getByRole('link',{name:'Buy credits or upgrade'}).first()).toHaveAttribute('href','/billing');expect(calls).toBe(0);
  store.billing.grant(owner.org,'ai',2,'grant_admin','test-fund');
  await page.getByRole('button',{name:'Generate customer avatar',exact:true}).click();await expect(page.getByAltText('Customer’s personalized avatar, awaiting visual review')).toBeVisible();
  expect(calls).toBe(1);expect(ids).toHaveLength(2);expect(ids[0]).not.toBe(ids[1]);for(const id of ids)expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await page.goto('/billing');await expect(page.getByRole('heading',{name:'1 AI credits available'})).toBeVisible();
  await expect(page.getByText('Online payments are not configured.',{exact:false})).toBeVisible();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/credit-balance-mobile.png'});
  store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(owner.user.id,owner.id);
  await page.reload();await expect(page.getByRole('alert')).toContainText('Only a store owner');
 }finally{await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
});
