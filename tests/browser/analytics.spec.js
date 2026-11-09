import {openStoreTools} from '../helpers/studio-navigation.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp} from '../../server/app.js';
import {recordEvent} from '../../server/events.js';

async function setup(page,run,{jewelleryEnabled=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-analytics-browser-')),store=new AccountStore(directory);
 const owner=await store.register({name:'Analytics store',email:'analytics@example.test',password:'test-password-long'});
 const extra=await store.register({name:'Other branch',email:'branch@example.test',password:'test-password-long'});
 store.db.prepare('UPDATE stores SET org=? WHERE id=?').run(owner.org,extra.id);const branch=store.identity(extra.user.id,extra.id);
 const event=(account,type,ref)=>recordEvent(store.db,{org:account.org,store:account.id,user:account.user.id},type,ref);
 const sessionId=randomUUID();event(owner,'tryon_generated',{sessionId});event(owner,'tryon_reused',{sessionId});event(owner,'purchase_marked',{sessionId,lookId:'fixture-look'});event(branch,'tryon_generated',{sessionId:randomUUID()});
 const mail=[],app=createApp({accountStore:store,jewelleryEnabled,accessMode:'public',rateLimit:false,publicUrl:'https://studio.example.test',sendMail:async message=>{mail.push(message);}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const api=`http://127.0.0.1:${server.address().port}`;
 const proxy=async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});await route.fulfill({response});};
 await page.route('**/api/**',proxy);await page.route('**/reports/**',proxy);
 try{await page.goto('/');await page.getByLabel('Account email').fill('analytics@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await run({store,owner,branch,app,mail});}finally{await page.unrouteAll({behavior:'wait'});await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}

test('owner filters analytics, downloads displayed data and opts out on mobile; manager and staff controls stay scoped',async({page})=>setup(page,async({store,owner,branch})=>{
 await page.setViewportSize({width:390,height:844});await openStoreTools(page);await page.getByRole('link',{name:'Analytics',exact:true}).click();await expect(page.getByRole('heading',{name:'Store analytics',exact:true})).toBeVisible();
 const card=label=>page.locator('.analytics-cards article').filter({has:page.getByText(label,{exact:true})}).locator('strong');
 await expect(card('Generated try-ons')).toHaveText('1');await expect(card('Reused try-ons')).toHaveText('1');await expect(card('Sessions with try-ons')).toHaveText('1');await expect(card('Purchase / session')).toHaveText('100%');
 await page.getByLabel('Report store').selectOption('all');await page.getByRole('button',{name:'Apply analytics filters'}).click();await expect(card('Generated try-ons')).toHaveText('2');await expect(card('Purchase / session')).toHaveText('50%');
 await page.getByText('Show daily data',{exact:true}).click();await expect(page.getByRole('columnheader',{name:'Date (IST)',exact:true})).toBeVisible();
 // CSV must use the displayed report even when the draft filters have changed.
 await page.getByLabel('Report store').selectOption(branch.id);const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download analytics CSV'}).click();const file=await download;expect(file.suggestedFilename()).toBe('analytics.csv');let csv='';for await(const chunk of await file.createReadStream())csv+=chunk.toString();expect(csv).toContain('"Total","All selected stores"');expect(csv).toContain('"2","1","2","1","0","50"');
 await page.getByLabel('Email my monthly analytics report').uncheck();await expect(page.getByRole('status')).toContainText('Monthly reports disabled.');expect(store.analytics.preferences(owner.user.id).monthlyEmail).toBe(false);
 await page.screenshot({path:'test-results/analytics-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 store.db.prepare("UPDATE memberships SET role='manager' WHERE user=? AND store=?").run(owner.user.id,owner.id);await page.reload();await expect(card('Generated try-ons')).toHaveText('1');await expect(page.getByLabel('Report store').locator('option')).toHaveCount(1);await expect(page.getByRole('heading',{name:'Monthly email report'})).toHaveCount(0);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(owner.user.id,owner.id);await page.reload();await expect(page.getByRole('alert')).toContainText('role');await expect(page.getByRole('button',{name:'Download analytics CSV'})).toHaveCount(0);
}));

test('email unsubscribe confirmation works without login and opening the link alone does not unsubscribe',async({page})=>setup(page,async({store,owner,app,mail})=>{
 const now=new Date(),due=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),2,12)).getTime();await app.locals.analyticsReports.runDue(due);const message=mail.find(m=>m.to==='analytics@example.test');expect(message).toBeTruthy();
 const link=new URL(message.text.match(/Stop monthly analytics emails: (https:\/\/\S+)/)[1]);await page.context().clearCookies();await page.goto(link.pathname);await expect(page.getByRole('heading',{name:'Stop monthly analytics reports?'})).toBeVisible();expect(store.analytics.preferences(owner.user.id).monthlyEmail).toBe(true);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Stop monthly reports',exact:true}).click();await expect(page.getByRole('heading',{name:'Monthly reports stopped.'})).toBeVisible();expect(store.analytics.preferences(owner.user.id).monthlyEmail).toBe(false);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));

test('jewellery analytics filter by the displayed stores, export separate counts and keep manager/staff boundaries on mobile',async({page})=>setup(page,async({store,owner,branch})=>{
 const sessionId=randomUUID(),add=(actor,type,ref)=>recordEvent(store.db,{org:actor.org,store:actor.id,user:actor.user.id},type,ref),j={category:'jewellery',view:'portrait',sessionId};
 add(owner,'tryon_generated',{...j,garmentId:'fixture-jewel'});add(owner,'tryon_reused',{...j,garmentId:'fixture-jewel'});add(owner,'jewellery_overlay_applied',{...j,garmentId:'fixture-jewel'});
 add(branch,'jewellery_overlay_applied',{...j,garmentId:'fixture-jewel'});
 add(owner,'look_saved',{...j,lookId:'fixture-set',itemCount:2});add(owner,'jewellery_compared',{...j,outcome:'complete'});add(owner,'jewellery_compared',{...j,outcome:'partial'});add(owner,'look_shared',{...j,lookId:'fixture-set'});add(owner,'purchase_marked',{...j,lookId:'fixture-set',jewelleryItemIds:['fixture-jewel']});
 await page.setViewportSize({width:390,height:844});await openStoreTools(page);await page.getByRole('link',{name:'Analytics',exact:true}).click();
 const section=page.getByRole('region',{name:'Jewellery activity'}),card=label=>section.locator('.analytics-cards article').filter({has:page.getByText(label,{exact:true})}).locator('strong');
 await expect(card('Jewellery AI generated')).toHaveText('1');await expect(card('Jewellery AI reused')).toHaveText('1');await expect(card('Free jewellery overlays')).toHaveText('1');await expect(card('Jewellery sets saved')).toHaveText('1');await expect(card('Completed jewellery comparisons')).toHaveText('1');await expect(card('Partial jewellery comparisons')).toHaveText('1');await expect(card('Jewellery purchased looks')).toHaveText('1');
 await page.getByLabel('Report store').selectOption('all');await page.getByRole('button',{name:'Apply analytics filters'}).click();await expect(card('Free jewellery overlays')).toHaveText('2');await expect(card('Jewellery fitting sessions')).toHaveText('2');
 await section.getByText('Jewellery daily activity (IST)',{exact:true}).click();await expect(section.getByRole('columnheader',{name:'Free overlays',exact:true})).toBeVisible();expect(await section.getByRole('region',{name:'Jewellery daily activity (IST)'}).evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);await section.getByText('Jewellery daily activity (IST)',{exact:true}).click();
 await page.getByLabel('Report store').selectOption(branch.id);const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download analytics CSV'}).click();let csv='';for await(const chunk of await(await download).createReadStream())csv+=chunk.toString();
 expect(csv).toContain('"Jewellery total","All selected stores"');expect(csv).toContain('"Free overlays"');expect(csv).toContain('"Jewellery product"');expect(csv).not.toContain('data:image');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await section.screenshot({path:'test-results/jewellery-analytics-mobile.png'});
 await page.setViewportSize({width:1440,height:1000});await section.screenshot({path:'test-results/jewellery-analytics-desktop.png'});
 store.db.prepare("UPDATE memberships SET role='manager' WHERE user=? AND store=?").run(owner.user.id,owner.id);await page.reload();await expect(card('Free jewellery overlays')).toHaveText('1');await expect(page.getByLabel('Report store').locator('option')).toHaveCount(1);
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?").run(owner.user.id,owner.id);await page.reload();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('region',{name:'Jewellery activity'})).toHaveCount(0);
},{jewelleryEnabled:true}));
