import {test,expect} from '@playwright/test';
import {workflowFixture} from '../helpers/shopper-workflow.js';
import {publicStudio} from '../helpers/shopify-shopper.js';
import {createTurnstile} from '../../server/turnstile.js';

const secretKey='private-turnstile-server-secret-123456',siteKey='public-turnstile-site-key-123456';
async function setup(page,run,{turnstile=false,mode='success'}={}){
  const verification=[];let f;
  const adapter=createTurnstile({siteKey,secretKey,fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);verification.push(body);const action=body.response.split(':')[0];return new Response(JSON.stringify({success:mode!=='invalid',action,hostname:'studio.example.test',challenge_ts:new Date(f.sessions.now()).toISOString()}));
  }});
  f=await workflowFixture(turnstile?{sessionOptions:{captcha:adapter.captcha},workflowOptions:{verificationClient:adapter.verificationClient}}:{});let closing=false,widgetLoads=0;
  const proxy=async route=>{try{const url=new URL(route.request().url()),response=await route.fetch({url:f.base+url.pathname+url.search,headers:{...route.request().headers(),host:new URL(f.base).host,origin:url.pathname.startsWith('/api/')?f.base:publicStudio}});await route.fulfill({response});}catch(e){if(!closing&&page.url()!=='about:blank')throw e;}};
  await page.route('**/api/**',proxy);await page.route('**/shopper',proxy);await page.route('**/shopper-api/**',proxy);
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',route=>{widgetLoads++;return route.fulfill({contentType:'application/javascript',body:`window.turnstile={render(container,options){window.__widgetOptions=options;return 'widget-1';},execute(){${mode==='pending'?'':"queueMicrotask(()=>window.__widgetOptions.callback(window.__widgetOptions.action+':'+crypto.randomUUID()));"}},remove(){window.__widgetRemoved=true;}};`});});
  try{await run({...f,verification,widgetLoads:()=>widgetLoads,launch:async()=>page.goto('/shopper'+f.launch().hash)});}finally{closing=true;await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});await f.close();}
}
async function consent(page){await page.getByRole('checkbox',{name:'I am 18 or older.',exact:true}).check();await page.getByRole('checkbox',{name:'These are my own photos',exact:false}).check();await page.getByRole('checkbox',{name:'I request an AI avatar',exact:false}).check();await page.getByRole('button',{name:'Verify and continue to photos',exact:true}).click();}

test('owner sees scoped local blockers and unverified launch checks on mobile; refresh makes no paid calls',async({page})=>setup(page,async f=>{
  await page.goto('/');await page.getByLabel('Account email').fill('river@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await page.goto('/shopify-shopper');await page.setViewportSize({width:390,height:844});
  const readiness=page.getByRole('region',{name:'Shopper launch readiness',exact:true});await expect(readiness).toContainText('Some local configuration checks are blocked.');await readiness.getByText('View local configuration checks',{exact:true}).click();await expect(readiness).toContainText('Blocked: Shared transient tmpfs store');await expect(readiness).toContainText('Configured: Image safety adapter');await readiness.getByText('View local configuration checks',{exact:true}).click();await readiness.getByText('View live verification checklist',{exact:true}).click();await expect(readiness).toContainText('Unverified: Verify Gemini billing');await readiness.getByText('View live verification checklist',{exact:true}).click();
  await readiness.getByRole('button',{name:'Refresh launch readiness',exact:true}).click();await expect(page.getByRole('status')).toContainText('No external checks were sent');expect(f.calls.avatar.length+f.calls.tryon.length).toBe(0);expect(f.store.billing.balance(f.a.org)).toBe(1000);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await readiness.screenshot({path:'test-results/shopper-launch-readiness-mobile.png'});
}));

test('optional Turnstile widget loads after consent, uses no retries and needs server verification before photo selection',async({page})=>setup(page,async f=>{
  const requests=[];page.on('request',r=>requests.push(r));await f.launch();await expect(page.getByRole('button',{name:'Verify and continue to photos',exact:true})).toBeDisabled();expect(f.widgetLoads()).toBe(0);await expect(page.locator('input[type=file]')).toHaveCount(0);await consent(page);await expect(page.getByRole('status')).toContainText('Verified.');expect(f.widgetLoads()).toBe(1);expect(f.verification.length).toBe(1);expect(f.verification[0].secret).toBe(secretKey);await expect(page.locator('#face-file')).toHaveCount(1);
  const options=await page.evaluate(()=>({retry:window.__widgetOptions.retry,expired:window.__widgetOptions['refresh-expired'],field:window.__widgetOptions['response-field']}));expect(options).toEqual({retry:'never',expired:'never',field:false});expect(requests.some(r=>r.url().includes(secretKey)||(r.postData()||'').includes(secretKey))).toBe(false);expect(f.calls.avatar.length).toBe(0);
},{turnstile:true}));

test('failed Turnstile server verification cannot expose photo inputs or make an image call',async({page})=>setup(page,async f=>{
  await f.launch();await consent(page);await expect(page.getByRole('status')).toContainText('Verification did not pass');await expect(page.locator('input[type=file]')).toHaveCount(0);expect(f.verification.length).toBe(1);expect(f.calls.avatar.length).toBe(0);
},{turnstile:true,mode:'invalid'}));

test('ending during a Turnstile challenge disposes of its widget and a late callback cannot reopen photo selection',async({page})=>setup(page,async f=>{
  await f.launch();await consent(page);await expect.poll(()=>page.evaluate(()=>Boolean(window.__widgetOptions))).toBe(true);await page.getByRole('button',{name:'End shopper session',exact:true}).click();await expect(page.getByRole('status')).toContainText('session ended');expect(await page.evaluate(()=>window.__widgetRemoved)).toBe(true);await page.evaluate(()=>window.__widgetOptions.callback('avatar:late'));await expect(page.locator('input[type=file]')).toHaveCount(0);expect(f.verification.length).toBe(0);expect(f.calls.avatar.length).toBe(0);
},{turnstile:true,mode:'pending'}));
