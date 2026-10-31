import {test,expect} from '@playwright/test';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHmac} from 'node:crypto';
import {AccountStore} from '../../server/accounts.js';import {createApp} from '../../server/app.js';
const config={keyId:'rzp_test_mock',keySecret:'test-secret',webhookSecret:'test-hook',supplier:{name:'Forme Test',address:'Bengaluru',billingEmail:'invoice@example.test',stateCode:'29',gstin:'29ABCDE1234F1Z5'},planIds:{'starter:monthly':'plan_starter'}};
async function setup(page,run){
 const dir=await mkdtemp(path.join(os.tmpdir(),'forme-checkout-')),store=new AccountStore(dir);let orders=0,providerCalls=0;
 const app=createApp({accountStore:store,accessMode:'public',paymentOptions:{config,fetchImpl:async(url,options)=>{providerCalls++;if(url.endsWith('/orders')){orders++;return new Response(JSON.stringify({id:'order_one',...JSON.parse(options.body)}));}if(url.endsWith('/payments/pay_one'))return new Response(JSON.stringify({id:'pay_one',order_id:'order_one',amount:106200,currency:'INR',status:'captured',captured:true}));throw new Error('Unexpected provider URL');}},sendMail:async()=>{}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const api=`http://127.0.0.1:${server.address().port}`;
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search,headers:{...route.request().headers(),host:new URL(api).host,origin:api}});await route.fulfill({response});});
 try{await run({store,orders:()=>orders,providerCalls:()=>providerCalls});}finally{await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
}
async function signup(page){await page.goto('/');await page.getByRole('button',{name:'Create an account',exact:true}).click();await page.getByLabel('Store name',{exact:true}).fill('Trial store');await page.getByLabel('Account email').fill('trial@example.test');await page.getByLabel('Account password').fill('test-password-long');await page.getByRole('button',{name:'Create store account',exact:true}).click();await expect(page.getByText('30 AI credits',{exact:true})).toBeVisible();}
async function details(page){await page.getByLabel('Legal / business name').fill('Example Clothing');await page.getByLabel('Billing address').fill('Bengaluru');await page.getByLabel('Billing email').fill('billing@example.test');await page.getByLabel('Indian state code').fill('29');await page.getByRole('button',{name:'Save billing details'}).click();await expect(page.getByText('Billing details saved.')).toBeVisible();}

test('real trial signup, mocked Checkout, verified pack credit, PDF download, usage and role gates work on mobile',async({page})=>setup(page,async({store,orders})=>{
 const checkoutUrls=[];await page.route('https://checkout.razorpay.com/v1/checkout.js',async route=>{checkoutUrls.push(route.request().url());const signature=createHmac('sha256',config.keySecret).update('order_one|pay_one').digest('hex');await route.fulfill({contentType:'text/javascript',body:`window.Razorpay=class{constructor(options){this.options=options;}open(){this.options.handler({razorpay_order_id:'order_one',razorpay_payment_id:'pay_one',razorpay_signature:'${signature}'});}on(){}};`});});
 await signup(page);expect(checkoutUrls).toHaveLength(0);
 await page.getByRole('link',{name:'Billing',exact:true}).click();await expect(page.getByRole('heading',{name:'30 AI credits available'})).toBeVisible();expect(checkoutUrls).toHaveLength(0);
 await expect(page.getByRole('button',{name:'Buy 100 credits',exact:true})).toBeDisabled();await details(page);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/billing-checkout-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Buy 100 credits',exact:true}).click();await expect(page.getByText('Payment verified. Credits added and invoice available.')).toBeVisible();await expect(page.getByRole('heading',{name:'130 AI credits available'})).toBeVisible();expect(orders()).toBe(1);expect(checkoutUrls).toHaveLength(1);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:/Download FY/}).click();expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
 await page.reload();await expect(page.getByRole('heading',{name:'130 AI credits available'})).toBeVisible();expect(orders()).toBe(1);
 await page.getByRole('link',{name:'Usage',exact:true}).click();await expect(page.getByText('0 credits used',{exact:true})).toBeVisible();const csv=page.waitForEvent('download');await page.getByRole('button',{name:'Download usage CSV'}).click();expect((await csv).suggestedFilename()).toBe('forme-usage.csv');
 const user=store.db.prepare('SELECT id FROM users').get();store.db.prepare("UPDATE memberships SET role='manager' WHERE user=?").run(user.id);await page.reload();await expect(page.getByText('0 credits used',{exact:true})).toBeVisible();
 store.db.prepare("UPDATE memberships SET role='staff' WHERE user=?").run(user.id);await page.reload();await expect(page.getByRole('alert')).toContainText('owner or manager');
 await page.goto('/billing');await expect(page.getByRole('alert')).toContainText('Only a store owner');await expect(page.getByRole('button',{name:'Buy 100 credits',exact:true})).toHaveCount(0);
 await page.goto('/');await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Billing',exact:true})).toHaveCount(0);
}));

test('closing checkout does not verify a payment or retry an order',async({page})=>setup(page,async({orders,store})=>{
 await page.route('https://checkout.razorpay.com/v1/checkout.js',route=>route.fulfill({contentType:'text/javascript',body:'window.Razorpay=class{constructor(o){this.o=o;}open(){this.o.modal.ondismiss();}on(){}};'}));
 await signup(page);await page.goto('/billing');await details(page);await page.getByRole('button',{name:'Buy 100 credits',exact:true}).click();await expect(page.getByText(/Checkout closed/)).toBeVisible();expect(orders()).toBe(1);expect(store.db.prepare('SELECT count(*) AS n FROM payments').get().n).toBe(0);
 await page.getByRole('button',{name:'Refresh billing'}).click();await expect(page.getByRole('heading',{name:'30 AI credits available'})).toBeVisible();expect(orders()).toBe(1);
}));
