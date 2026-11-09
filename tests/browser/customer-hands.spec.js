import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../../server/app.js';
import {customerHandsFixture} from '../helpers/customer-hands-fixture.js';
const f=await customerHandsFixture();
async function setup(page,run,{generate,enabled=true,key='test'}={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'forme-hand-photo-browser-')),store=new AccountStore(dir),owner=await store.register({name:'Hands store',email:'hands@example.test',password:'test-password-long'}),avatar=await store.save(owner,{image:'data:image/png;base64,'+(await standardAvatar('regular')).toString('base64'),name:'Customer',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});let calls=0;const inputs=[];
 const server=createApp({accountStore:store,accessMode:'public',provider:'gemini',apiKey:key,jewelleryEnabled:enabled,rateLimit:false,avatarViewOptions:{hands:async input=>{calls++;inputs.push(input);return generate?generate(input):'data:image/png;base64,'+input.handPhoto.toString('base64');}}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:base+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(base).host,origin:base}});await route.fulfill({response});});
 try{await page.goto('/');await page.getByLabel('Account email').fill('hands@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await page.goto('/avatar-views?avatar='+avatar.id);await expect(page.getByRole('button',{name:'Hands view',exact:true})).toBeVisible();await page.getByRole('button',{name:'Hands view',exact:true}).click();await run({store,owner,avatar,calls:()=>calls,inputs});}
 finally{await page.unrouteAll({behavior:'wait'});await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
}
async function prepare(page){
 await page.getByLabel('Hands reference source',{exact:true}).selectOption('photo');await page.getByLabel('Choose customer hand photo',{exact:true}).setInputFiles({name:'independent-hands.png',mimeType:'image/png',buffer:f.image});await expect(page.getByRole('img',{name:'Customer hand photo with placement markers',exact:true})).toBeVisible();
 for(const [id,p]of Object.entries(f.points)){await page.getByLabel('Hand placement marker',{exact:true}).selectOption(id);for(const [field,label]of [['x','Marker X'],['y','Marker Y'],['widthPx','Band width (pixels)'],['angle','Band angle (degrees)']])await page.getByLabel(label,{exact:true}).fill(String(p[field]));}
}
async function consent(page){
 await page.getByLabel('The customer confirms these are their own two hands, all fingers and wrists are visible, and all twelve placement markers match.',{exact:true}).check();await page.getByLabel('The customer confirms the saved avatar and the hand photo’s complexion match.',{exact:true}).check();await page.getByLabel('The customer agrees to send this hand photo to Google Gemini for one cleanup using 1 AI credit. Original hand photos are not saved by the studio.',{exact:true}).check();
}

test('customer hand photo requires twelve markers and consent, costs once, saves and reopens on mobile without another generation',async({page})=>setup(page,async({store,owner,avatar,calls,inputs})=>{
 await page.setViewportSize({width:390,height:844});const before=store.billing.balance(owner.org);await prepare(page);expect(calls()).toBe(0);await expect(page.getByRole('button',{name:'Generate customer hands — 1 AI credit',exact:true})).toBeDisabled();await consent(page);await expect(page.getByRole('button',{name:'Generate customer hands — 1 AI credit',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/customer-hands-markers-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Generate customer hands — 1 AI credit',exact:true}).click();await expect(page.getByRole('img',{name:'Customer hands preview awaiting approval',exact:true})).toBeVisible();expect(calls()).toBe(1);expect(inputs[0].handPhoto.every(v=>v===0)).toBe(true);expect(store.views.list(owner,avatar.id)).toHaveLength(0);expect(store.billing.balance(owner.org)).toBe(before-1);
 await expect(page.getByRole('button',{name:'Approve and save view',exact:true})).toBeDisabled();await page.getByLabel('The customer reviewed their hands, every finger and wrist, complexion and all placement markers.',{exact:true}).check();await page.getByLabel('The customer agrees to save this approved view with this avatar in the store account.',{exact:true}).check();await page.getByRole('button',{name:'Approve and save view',exact:true}).click();await expect(page.getByRole('img',{name:'Approved hands view for Customer',exact:true})).toBeVisible();expect(store.views.get(owner,avatar.id,'hands').sourceKind).toBe('photo');
 await page.screenshot({path:'test-results/customer-hands-approved-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/customer-hands-approved-desktop.png',fullPage:true});
 await page.reload();await page.getByRole('button',{name:'Hands view',exact:true}).click();await expect(page.getByRole('img',{name:'Approved hands view for Customer',exact:true})).toBeVisible();expect(calls()).toBe(1);expect(store.billing.balance(owner.org)).toBe(before-1);
}));

test('switching hands source clears a fresh photo, markers and consent; invalid uploads never send a generation',async({page})=>setup(page,async({calls})=>{
 await prepare(page);await consent(page);await page.getByLabel('Hands reference source',{exact:true}).selectOption('template');await expect(page.getByRole('img',{name:'Customer hand photo with placement markers'})).toHaveCount(0);await page.getByLabel('Hands reference source',{exact:true}).selectOption('photo');await expect(page.getByLabel('The customer agrees to send this hand photo to Google Gemini for one cleanup using 1 AI credit. Original hand photos are not saved by the studio.',{exact:true})).not.toBeChecked();await expect(page.getByRole('button',{name:'Generate customer hands — 1 AI credit',exact:true})).toBeDisabled();
 await page.getByLabel('Choose customer hand photo',{exact:true}).setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('bad')});await expect(page.getByRole('alert')).toBeVisible();expect(calls()).toBe(0);
}));

test('expired store session clears a selected hand photo and markers before any generation',async({page})=>setup(page,async({store,calls})=>{
 await prepare(page);store.db.prepare('DELETE FROM sessions').run();await page.evaluate(()=>window.dispatchEvent(new Event('forme-account-expired')));await expect(page.getByRole('img',{name:'Customer hand photo with placement markers'})).toHaveCount(0);await expect(page.getByLabel('Hand placement marker',{exact:true})).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('session');expect(calls()).toBe(0);
}));

test('a studio without Gemini keeps customer-photo generation disabled and makes no paid request',async({page})=>setup(page,async({calls})=>{
 await prepare(page);await consent(page);await expect(page.getByText('Customer hand generation is unavailable for this body library. Standard hands remain free.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Generate customer hands — 1 AI credit',exact:true})).toBeDisabled();expect(calls()).toBe(0);
},{key:''}));

test('cancelling a hand cleanup clears the photo/markers and ignores a late result without another generation',async({page})=>{
 let enter,release;const started=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 await setup(page,async({store,calls})=>{try{
  await prepare(page);await consent(page);await page.getByRole('button',{name:'Generate customer hands — 1 AI credit',exact:true}).click();await started;await page.getByRole('button',{name:'Cancel request',exact:true}).click();release();
  await expect(page.getByRole('alert')).toContainText('Request stopped');await expect(page.getByRole('img',{name:'Customer hand photo with placement markers'})).toHaveCount(0);await expect.poll(()=>store.db.prepare("SELECT count(*) n FROM ledger WHERE kind IN ('commit','refund')").get().n).toBe(1);await expect(page.getByRole('img',{name:'Customer hands preview awaiting approval'})).toHaveCount(0);expect(calls()).toBe(1);expect(store.db.prepare('SELECT count(*) n FROM avatar_views').get().n).toBe(0);
 }finally{release();}},{generate:async input=>{enter();await gate;return 'data:image/png;base64,'+input.handPhoto.toString('base64');}});
});
