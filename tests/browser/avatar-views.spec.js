import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../../server/app.js';

const face=await readFile(new URL('../fixtures/customers/red-plaid-face.jpg',import.meta.url));
const portrait=await sharp({create:{width:1152,height:1536,channels:3,background:'#d3d1cc'}}).composite([{input:await sharp(face).extract({left:20,top:0,width:160,height:210}).resize(1020,1339).png().toBuffer(),left:66,top:80}]).png().toBuffer();
async function setup(page,run,{enabled=true,generate}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-views-browser-')),store=new AccountStore(directory),owner=await store.register({email:'views@example.test',name:'View store',password:'test-password-long'});
 const avatar=await store.save(owner,{image:'data:image/png;base64,'+(await standardAvatar('regular')).toString('base64'),name:'Customer A',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});let calls=0;
 const app=createApp({accountStore:store,accessMode:'public',apiKey:'test',provider:'gemini',jewelleryEnabled:enabled,rateLimit:false,avatarViewOptions:{faceCheck:async()=>{},portrait:async input=>{calls++;if(generate)return generate(input);return 'data:image/png;base64,'+portrait.toString('base64');}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url());try{const response=await route.fetch({url:base+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(base).host,origin:base}});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}});
 try{await page.goto('/');await page.getByLabel('Account email').fill('views@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Saved avatars',exact:true}).click();await expect(page.getByRole('heading',{name:'Saved avatars',exact:true})).toBeVisible();await run({store,owner,avatar,calls:()=>calls});}
 finally{await page.unrouteAll({behavior:'wait'});await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}
async function open(page){await page.getByRole('link',{name:'Manage views for Customer A',exact:true}).click();await expect(page.getByRole('heading',{name:'Avatar views',exact:true})).toBeVisible();}
async function ready(page){await page.getByLabel('Fresh customer face photo',{exact:true}).setInputFiles({name:'independent-customer.jpg',mimeType:'image/jpeg',buffer:face});await page.getByLabel('The customer confirms this saved full-body avatar is correct and approved.',{exact:true}).check();await page.getByLabel('The customer agrees to send this fresh face photo and saved avatar to Google Gemini for one portrait, using 1 AI credit. Original face photos are not saved by the studio.',{exact:true}).check();}
async function approve(page,kind){await page.getByLabel(kind==='hands'?'The customer reviewed the sample hands, tone and proportions.':'The customer reviewed the face, complexion, hair, proportions and complete head framing.',{exact:true}).check();await page.getByLabel('The customer agrees to save this approved view with this avatar in the store account.',{exact:true}).check();await page.getByRole('button',{name:'Approve and save view',exact:true}).click();}

test('mobile view workflow saves free hands and a reviewed portrait, reopens without AI and deletes only the selected view',async({page})=>setup(page,async({store,owner,avatar,calls})=>{
 await page.setViewportSize({width:390,height:844});const initial=store.billing.balance(owner.org);await open(page);await page.getByRole('button',{name:'Hands view',exact:true}).click();await page.getByRole('combobox',{name:'Hands template skin tone',exact:true}).selectOption('deep');await page.getByRole('button',{name:'Preview sample hands — free',exact:true}).click();
 await expect(page.getByRole('img',{name:'Sample hands preview awaiting approval',exact:true})).toBeVisible();expect(store.views.list(owner,avatar.id)).toHaveLength(0);await expect(page.getByRole('button',{name:'Approve and save view',exact:true})).toBeDisabled();await approve(page,'hands');await expect(page.getByRole('img',{name:'Approved hands view for Customer A',exact:true})).toBeVisible();expect(calls()).toBe(0);expect(store.billing.balance(owner.org)).toBe(initial);
 await page.reload();await page.getByRole('button',{name:'Hands view',exact:true}).click();await expect(page.getByRole('img',{name:'Approved hands view for Customer A',exact:true})).toBeVisible();expect(calls()).toBe(0);
 await page.getByRole('button',{name:'Portrait view',exact:true}).click();await expect(page.getByRole('button',{name:'Generate portrait — 1 AI credit',exact:true})).toBeDisabled();await ready(page);await page.getByRole('button',{name:'Generate portrait — 1 AI credit',exact:true}).click();await expect(page.getByRole('img',{name:'Generated portrait awaiting customer approval',exact:true})).toBeVisible();expect(calls()).toBe(1);expect(store.views.list(owner,avatar.id)).toHaveLength(1);await approve(page,'portrait');await expect(page.getByRole('img',{name:'Approved portrait view for Customer A',exact:true})).toBeVisible();expect(store.billing.balance(owner.org)).toBe(initial-1);
 await page.screenshot({path:'test-results/avatar-views-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.reload();await expect(page.getByRole('img',{name:'Approved portrait view for Customer A',exact:true})).toBeVisible();expect(calls()).toBe(1);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete saved view',exact:true}).click();await expect(page.getByText('No approved portrait view is saved for this avatar.',{exact:true})).toBeVisible();expect(store.views.list(owner,avatar.id).map(v=>v.kind)).toEqual(['hands']);expect(store.image(owner,avatar.id)).toBeTruthy();
}));

test('an expired approval keeps the paid preview downloadable and never regenerates automatically',async({page})=>setup(page,async({store,calls})=>{
 await open(page);await ready(page);await page.getByRole('button',{name:'Generate portrait — 1 AI credit',exact:true}).click();await expect(page.getByRole('img',{name:'Generated portrait awaiting customer approval',exact:true})).toBeVisible();store.views.claims=()=>{throw Object.assign(new Error('This preview expired. Do not regenerate just to save it.'),{status:409});};await approve(page,'portrait');await expect(page.getByRole('alert')).toContainText('Do not regenerate');await expect(page.getByRole('img',{name:'Generated portrait awaiting customer approval',exact:true})).toBeVisible();const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download preview',exact:true}).click();expect((await download).suggestedFilename()).toBe('portrait-preview.png');expect(calls()).toBe(1);
}));

test('ending the store session clears private view data on resume',async({page})=>setup(page,async({store})=>{
 await open(page);await page.getByRole('button',{name:'Hands view',exact:true}).click();await page.getByRole('button',{name:'Preview sample hands — free',exact:true}).click();await expect(page.getByRole('img',{name:'Sample hands preview awaiting approval',exact:true})).toBeVisible();const cookies=await page.context().cookies();store.logout(cookies.find(c=>c.name==='forme_session').value);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('alert')).toContainText('session ended or changed');await expect(page.getByRole('img',{name:'Sample hands preview awaiting approval',exact:true})).toHaveCount(0);await expect(page.getByRole('img',{name:'Saved full-body avatar: Customer A',exact:true})).toHaveCount(0);
}));

test('disabled view feature stays hidden in the library and unavailable on direct navigation',async({page})=>setup(page,async()=>{
 await expect(page.getByRole('link',{name:'Manage views for Customer A',exact:true})).toHaveCount(0);await page.goto('/avatar-views');await expect(page.getByText('Avatar views are not enabled on this studio.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Generate portrait — 1 AI credit',exact:true})).toHaveCount(0);
},{enabled:false}));

test('cancelling generation clears the reference and ignores any late preview without an automatic retry',async({page})=>{
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 try{await setup(page,async({calls})=>{await open(page);await ready(page);await page.getByRole('button',{name:'Generate portrait — 1 AI credit',exact:true}).click();await started;await page.getByRole('button',{name:'Cancel request',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Request stopped');await expect(page.getByRole('img',{name:'Fresh customer face reference',exact:true})).toHaveCount(0);release();await expect(page.getByRole('img',{name:'Generated portrait awaiting customer approval',exact:true})).toHaveCount(0);expect(calls()).toBe(1);},{generate:async()=>{entered();await gate;return 'data:image/png;base64,'+portrait.toString('base64');}});}finally{release?.();}
});
