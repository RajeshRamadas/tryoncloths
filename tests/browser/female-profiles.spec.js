import {test,expect} from '@playwright/test';
import {standardAvatar} from '../../server/app.js';
import sharp from 'sharp';

test('female library renders, exports and sends the selected garment without showing male samples',async({page})=>{
 const avatar='data:image/png;base64,'+(await standardAvatar('f-regular')).toString('base64');let request;
 await page.route('**/api/health',async r=>{const response=await r.fetch();await r.fulfill({response,json:{...(await response.json()),supportedBodies:['male','female'],tryOnAvailable:true,tryOnContract:'garment-tryon-v1'}});});
 await page.route('**/api/tryon',r=>{request=r.request().postDataJSON();return r.fulfill({json:{image:avatar,kind:'garment-tryon',provider:'gemini'}});});
 await page.goto('/');await page.getByLabel('Body library',{exact:true}).selectOption('female');
 await page.getByLabel('Height in centimeters').fill('165');await page.getByLabel('Weight in kilograms').fill('62');
 await expect(page.getByRole('button',{name:'Select Regular profile'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('img',{name:'Regular standard female avatar'}).first()).toBeVisible();
 await page.getByRole('button',{name:'Continue to match'}).click();await page.getByRole('button',{name:'Review avatar',exact:true}).click();
 await page.getByLabel('I have reviewed this standard sample avatar.').check();await page.getByRole('button',{name:'Try clothes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Navy T-shirt Sample',exact:true})).toHaveCount(0);
 const photo=await sharp({create:{width:300,height:400,channels:3,background:'#3f6980'}}).jpeg().toBuffer();
 await page.getByLabel('Upload product photo',{exact:true}).setInputFiles({name:'blue-dress.jpg',mimeType:'image/jpeg',buffer:photo});
 await expect(page.getByRole('group',{name:'Garment type'}).getByRole('button',{name:'Dress',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByLabel(/send their avatar and this product photo/).check();await page.getByRole('button',{name:'Put on avatar',exact:true}).click();
 await expect(page.getByText('Dress · blue-dress',{exact:true})).toBeVisible();expect(request.bodyType).toBe('female');expect(request.garmentType).toBe('dress');
 await page.getByLabel('I have checked clothing placement and approve this outfit preview.').check();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download outfit',exact:true}).click();expect((await download).suggestedFilename()).toContain('f-regular');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/female-outfit-mobile.png',fullPage:true});
});
test('male-only studio hides female library selection by default',async({page})=>{
 await page.goto('/');await expect(page.getByLabel('Body library',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('img',{name:'Regular standard male avatar'}).first()).toBeVisible();
});
