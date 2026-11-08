import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../../server/app.js';

const face=await readFile(new URL('../fixtures/customers/red-plaid-face.jpg',import.meta.url));
const portrait=await sharp({create:{width:1152,height:1536,channels:3,background:'#dedbd5'}}).composite([{input:await sharp(face).extract({left:20,top:0,width:160,height:210}).resize(1020,1339).png().toBuffer(),left:66,top:80}]).png().toBuffer();
async function fixture(page,run,{enabled=true,generate}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'forme-j8-browser-')),store=new AccountStore(directory),account=await store.register({email:'j8@example.test',name:'Jewellery store',password:'test-password-long'});
  const avatar=await store.save(account,{image:'data:image/png;base64,'+(await standardAvatar('regular')).toString('base64'),name:'Customer A',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
  const items=[];
  for(const [type,name,metal] of [['drop_earrings','Gold drop earrings','yellow_gold'],['nose_pin','Silver nose pin','silver'],['ring','Gold ring','yellow_gold'],['bangles','Silver bangles','silver']]){
    const product=await sharp(Buffer.from(`<svg width="240" height="240"><rect width="100%" height="100%" fill="#f0ede5"/><circle cx="120" cy="105" r="${type==='ring'?55:30}" fill="none" stroke="${metal==='silver'?'#9ba2a6':'#c49c3b'}" stroke-width="16"/>${type==='drop_earrings'?'<circle cx="120" cy="170" r="25" fill="#c49c3b"/>':''}</svg>`)).png().toBuffer();
    items.push((await store.garments.save(account,{category:'jewellery',garmentType:type,name,attributes:{metal,...(type==='drop_earrings'?{dropMm:38,purity:'22K'}:type==='bangles'?{count:2}: {})},image:'data:image/png;base64,'+product.toString('base64')},{jewelleryEnabled:true})).garment);
  }
  let calls=0,portraits=0,links=0;const seen=[];
  const app=createApp({accountStore:store,accessMode:'public',provider:'gemini',apiKey:'test-only',jewelleryEnabled:enabled,rateLimit:false,
    avatarViewOptions:{faceCheck:async()=>{},portrait:async()=>{portraits++;return 'data:image/png;base64,'+portrait.toString('base64');}},
    jewelleryOptions:{generate:async input=>{calls++;seen.push({...input,base:Buffer.from(input.base)});if(generate)return generate(input);return 'data:image/png;base64,'+(await sharp(input.base).composite([{input:{create:{width:30,height:30,channels:3,background:input.type==='nose_pin'?'#909aaa':'#c49c3b'}},left:input.type==='nose_pin'?600:280,top:input.view==='hands'?330:650}]).png().toBuffer()).toString('base64');}},
    productLink:async url=>{links++;return {url,title:'Silver nose pin',images:[{source:'product',image:'data:image/jpeg;base64,'+(await sharp({create:{width:240,height:240,channels:3,background:'#c2c8cf'}}).jpeg().toBuffer()).toString('base64')}]};}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const api='http://127.0.0.1:'+server.address().port;
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url());try{const response=await route.fetch({url:api+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}});
  try{
    await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByLabel('Account email').fill('j8@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
    if(enabled){await page.getByRole('button',{name:'Saved avatars',exact:true}).click();await page.getByRole('button',{name:'Use Customer A',exact:true}).click();await page.getByLabel('The customer approves the face, body and skin tone of this avatar.',{exact:true}).check();await page.getByRole('button',{name:'Jewellery',exact:true}).click();}else await page.goto('/jewellery?avatar='+avatar.id);await expect(page.getByRole('heading',{name:'A little detail. A complete feeling.',exact:true})).toBeVisible();
    await run({store,account,avatar,items,api,calls:()=>calls,portraits:()=>portraits,links:()=>links,seen});
  }finally{await page.unrouteAll({behavior:'wait'}).catch(()=>{});await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
}
const review=page=>page.getByLabel('I have checked the customer, complexion, proportions and jewellery placement in this preview.',{exact:true});
const consent=page=>page.getByLabel('The customer agrees to send this avatar view and jewellery product photo to Google Gemini. A new preview uses 1 AI credit; an approved exact match is reused free.',{exact:true});
async function tryPiece(page){await review(page).check();await consent(page).check();await page.getByRole('button',{name:'Try jewellery — up to 1 AI credit',exact:true}).click();await expect(page.getByRole('img',{name:'Customer jewellery preview',exact:true})).toBeVisible();await expect(review(page)).not.toBeChecked();}
async function preparePortrait(page){
  await page.getByRole('button',{name:'Create portrait — 1 AI request',exact:true}).click();await page.getByLabel('Fresh customer face photo',{exact:true}).setInputFiles({name:'customer.jpg',mimeType:'image/jpeg',buffer:face});
  await page.getByLabel('The customer confirms this saved full-body avatar is correct and approved.',{exact:true}).check();
  await page.getByLabel('The customer agrees to send this fresh face photo and saved avatar to Google Gemini for one portrait, using 1 AI credit. Original face photos are not saved by the studio.',{exact:true}).check();
  await page.getByRole('button',{name:'Generate portrait — 1 AI credit',exact:true}).click();await expect(page.getByRole('img',{name:'Generated portrait awaiting customer approval',exact:true})).toBeVisible();
  await page.getByLabel('The customer reviewed the face, complexion, hair, proportions and complete head framing.',{exact:true}).check();await page.getByLabel('The customer agrees to save this approved view with this avatar in the store account.',{exact:true}).check();await page.getByRole('button',{name:'Approve and save view',exact:true}).click();await expect(page.getByRole('img',{name:'Approved portrait reference',exact:true})).toBeVisible();
}
async function prepareHands(page){
  await page.getByRole('button',{name:'Hands view',exact:true}).click();await page.getByRole('button',{name:'Prepare sample hands — free',exact:true}).click();await page.getByRole('button',{name:'Preview sample hands — free',exact:true}).click();
  await page.getByLabel('The customer reviewed the sample hands, tone and proportions.',{exact:true}).check();await page.getByLabel('The customer agrees to save this approved view with this avatar in the store account.',{exact:true}).check();await page.getByRole('button',{name:'Approve and save view',exact:true}).click();await expect(page.getByRole('img',{name:'Approved hands reference',exact:true})).toBeVisible();
}

test('mobile portrait → earrings → nose pin → undo → save/share/reopen a labelled jewellery look without more AI',async({page})=>fixture(page,async({store,account,avatar,calls,portraits,seen})=>{
  const before=store.billing.balance(account.org);await preparePortrait(page);expect(portraits()).toBe(1);
  await page.getByRole('button',{name:/^Gold drop earrings/}).click();await expect(page.getByText(/38 mm drop/)).toBeVisible();await tryPiece(page);const earrings=await page.getByRole('img',{name:'Customer jewellery preview',exact:true}).getAttribute('src');
  await page.getByRole('button',{name:/^Silver nose pin/}).click();await page.getByLabel('Side',{exact:true}).selectOption('left');await tryPiece(page);expect(seen[1].side).toBe('left');expect(calls()).toBe(2);
  await page.getByRole('button',{name:'Undo last jewellery item',exact:true}).click();await expect(page.getByRole('img',{name:'Customer jewellery preview',exact:true})).toHaveAttribute('src',earrings);expect(calls()).toBe(2);
  await review(page).check();await page.getByLabel('Jewellery look name',{exact:true}).fill('Earrings for tonight');await page.getByLabel('The customer agrees to save this jewellery look and its reviewed adaptations to the store account.',{exact:true}).check();await page.getByRole('button',{name:'Save jewellery look',exact:true}).click();await expect(page.getByText('Jewellery look saved to this avatar. It can be reopened without generating again.',{exact:true})).toBeVisible();
  expect(store.listLooks(account,avatar.id)[0].view).toBe('portrait');expect(store.listLooks(account,avatar.id)[0].itemsJson).toHaveLength(1);expect(store.billing.balance(account.org)).toBe(before-3);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download jewellery PNG',exact:true}).click();const exported=await download,file=await exported.path();expect((await sharp(await readFile(file)).metadata()).height).toBeGreaterThan(1536);
  await page.getByLabel('The customer agrees to make this jewellery look available through a share link.',{exact:true}).check();await page.getByRole('button',{name:'Create jewellery look link',exact:true}).click();const link=await page.getByLabel('Jewellery share link',{exact:true}).inputValue();
  const shared=await page.request.get(link);expect(await shared.text()).toContain('AI preview — actual piece may differ in detail');
  const look=store.listLooks(account,avatar.id)[0];await page.goto('/jewellery?avatar='+avatar.id+'&look='+look.id);await expect(page.getByRole('img',{name:'Customer jewellery preview',exact:true})).toBeVisible();expect(calls()).toBe(2);expect(portraits()).toBe(1);await review(page).check();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.jewellery-preview').screenshot({path:'test-results/jewellery-studio-mobile.png'});await page.setViewportSize({width:1440,height:1050});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'test-results/jewellery-studio-desktop.png'});
}));

test('hands use selected ring finger and bangle count; product links guess a type but require confirmation and consent',async({page})=>fixture(page,async({store,account,calls,links,seen})=>{
  await prepareHands(page);const before=store.billing.balance(account.org);await page.getByRole('button',{name:/^Gold ring/}).click();await page.getByLabel('Hand',{exact:true}).selectOption('right');await page.getByLabel('Finger',{exact:true}).selectOption('ring');await tryPiece(page);expect(seen[0].hand).toBe('right');expect(seen[0].finger).toBe('ring');
  await page.getByRole('button',{name:/^Silver bangles/}).click();await page.getByLabel('Bangle count per wrist',{exact:true}).fill('4');await page.getByLabel('Wrist',{exact:true}).selectOption('left');await tryPiece(page);expect(seen[1].attributes.count).toBe(4);expect(store.billing.balance(account.org)).toBe(before-2);
  await page.getByLabel('Jewellery product link',{exact:true}).fill('https://shop.example/nose-pin');await page.getByRole('button',{name:'Find photos',exact:true}).click();await expect(page.getByLabel('Jewellery type',{exact:true})).toHaveValue('nose_pin');expect(links()).toBe(1);expect(calls()).toBe(2);await expect(page.getByRole('button',{name:'Try jewellery — up to 1 AI credit',exact:true})).toBeDisabled();await expect(page.getByLabel('I confirm the jewellery type and selected product photo.',{exact:true})).not.toBeChecked();
  const uploaded=await sharp({create:{width:250,height:250,channels:3,background:'#baac98'}}).jpeg().toBuffer();await page.getByLabel('Upload jewellery product photo',{exact:true}).setInputFiles({name:'nose pin.jpg',mimeType:'image/jpeg',buffer:uploaded});await expect(page.getByRole('img',{name:'Selected jewellery product',exact:true})).toBeVisible();await expect(page.getByLabel('Metal',{exact:true})).toHaveValue('');expect(calls()).toBe(2);
}));

test('a revoked session during generation clears private previews and ignores late output',async({page})=>{
  let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  try{await fixture(page,async({store,account,calls})=>{await prepareHands(page);await page.getByRole('button',{name:/^Gold ring/}).click();await review(page).check();await consent(page).check();await page.getByRole('button',{name:'Try jewellery — up to 1 AI credit',exact:true}).click();await started;
    const cookies=await page.context().cookies();store.logout(cookies.find(c=>c.name==='forme_session').value);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('alert')).toContainText('session ended or changed');release();await expect(page.getByRole('img',{name:'Customer jewellery preview',exact:true})).toHaveCount(0);await expect(page.getByRole('img',{name:'Approved hands reference',exact:true})).toHaveCount(0);expect(calls()).toBe(1);
  },{generate:async input=>{entered();await gate;return 'data:image/png;base64,'+input.base.toString('base64');}});}finally{release?.();}
});

test('disabled jewellery studio cannot offer image inputs or paid actions',async({page})=>fixture(page,async({calls})=>{await expect(page.getByText('Jewellery try-on is not enabled on this studio.',{exact:true})).toBeVisible();await expect(page.getByLabel('Upload jewellery product photo',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Try jewellery — up to 1 AI credit',exact:true})).toHaveCount(0);expect(calls()).toBe(0);},{enabled:false}));

test('session expiry cancels a pending jewellery download before it can write a customer image',async({page})=>fixture(page,async({store})=>{
  await prepareHands(page);await page.getByRole('button',{name:/^Gold ring/}).click();await tryPiece(page);await review(page).check();
  let entered,release,finished,downloads=0;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r),complete=new Promise(r=>finished=r);
  page.on('download',()=>downloads++);
  await page.route('**/api/exports/image',async route=>{entered();await gate;try{await route.fulfill({status:200,contentType:'image/png',body:portrait});}catch{}finally{finished();}});
  try{
    await page.getByRole('button',{name:'Download jewellery PNG',exact:true}).click();await started;
    const cookies=await page.context().cookies();store.logout(cookies.find(c=>c.name==='forme_session').value);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('alert')).toContainText('session ended or changed');release();await complete;
    expect(downloads).toBe(0);await expect(page.getByRole('img',{name:'Customer jewellery preview',exact:true})).toHaveCount(0);
  }finally{release();await page.unroute('**/api/exports/image');}
}));
