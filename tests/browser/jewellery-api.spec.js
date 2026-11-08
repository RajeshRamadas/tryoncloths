import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {AccountStore} from '../helpers/pilot-accounts.js';
import {createApp,standardAvatar} from '../../server/app.js';

test('signed-in mobile browser approves hands, calls the guarded jewellery API, saves and reuses a result after reload',async({page})=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'forme-jewellery-api-browser-')),store=new AccountStore(directory);
  const account=await store.register({email:'jewellery-api@example.test',name:'Jewellery API store',password:'test-password-long'});
  const avatar=await store.save(account,{image:'data:image/png;base64,'+(await standardAvatar('regular')).toString('base64'),name:'Customer API',profileId:'regular',heightCm:175,weightKg:72,source:'imported'});
  const photo='data:image/png;base64,'+(await sharp({create:{width:220,height:220,channels:3,background:'#c79a3b'}}).png().toBuffer()).toString('base64');
  const item=(await store.garments.save(account,{category:'jewellery',garmentType:'ring',attributes:{metal:'yellow_gold'},name:'Gold ring',image:photo},{jewelleryEnabled:true})).garment;
  let calls=0;
  const server=createApp({accountStore:store,accessMode:'public',provider:'gemini',apiKey:'test-only',jewelleryEnabled:true,rateLimit:false,jewelleryOptions:{generate:async input=>{
    calls++;return 'data:image/png;base64,'+(await sharp(input.base).composite([{input:{create:{width:45,height:12,channels:3,background:'#d2ad32'}},left:806,top:325}]).png().toBuffer()).toString('base64');
  }}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const api='http://127.0.0.1:'+server.address().port;
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});await route.fulfill({response});});
  const post=(path,body)=>page.evaluate(async({path,body})=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};},{path,body});
  try{
    await page.setViewportSize({width:390,height:844});await page.goto('/');
    await page.getByLabel('Account email').fill('jewellery-api@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:'Saved avatars',exact:true}).click();await page.getByRole('link',{name:'Manage views for Customer API',exact:true}).click();
    await page.getByRole('button',{name:'Hands view',exact:true}).click();await page.getByRole('button',{name:'Preview sample hands — free',exact:true}).click();
    await page.getByLabel('The customer reviewed the sample hands, tone and proportions.',{exact:true}).check();
    await page.getByLabel('The customer agrees to save this approved view with this avatar in the store account.',{exact:true}).check();await page.getByRole('button',{name:'Approve and save view',exact:true}).click();
    await expect(page.getByRole('img',{name:'Approved hands view for Customer API',exact:true})).toBeVisible();
    const before=store.billing.balance(account.org),input={avatarId:avatar.id,itemId:item.id,view:'hands',hand:'right',finger:'ring',consent:true,consentScope:'view-and-item',consentProvider:'gemini'};
    const requestId=await page.evaluate(()=>crypto.randomUUID()),preview=await post('/api/jewellery/tryon',{...input,requestId});expect(preview.status).toBe(200);expect(preview.body.reused).toBe(false);expect(calls).toBe(1);expect(store.billing.balance(account.org)).toBe(before-1);
    const path='/api/jewellery/results/'+preview.body.resultId+'/approve',save={image:preview.body.image,receipt:preview.body.receipt,reviewed:true,storageConsent:true};
    expect((await post(path,{...save,reviewed:false})).status).toBe(400);expect((await post(path,save)).status).toBe(200);
    await page.reload();await expect(page.getByRole('heading',{name:'Avatar views',exact:true})).toBeVisible();
    const reused=await post('/api/jewellery/tryon',{...input,requestId:await page.evaluate(()=>crypto.randomUUID())});expect(reused.status).toBe(200);expect(reused.body.reused).toBe(true);expect(reused.body.image).toBe(preview.body.image);expect(reused.body.creditsUsed).toBe(0);expect(calls).toBe(1);expect(store.billing.balance(account.org)).toBe(before-1);
  }finally{await page.unrouteAll({behavior:'wait'});await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
});
