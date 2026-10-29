import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import {standardAvatar} from '../../server/app.js';
import {readFile} from 'node:fs/promises';

test('tone selection updates preview, full-body export and clothing base without provider calls',async({page})=>{
 let calls=0;page.on('request',r=>{if(/\/api\/(personalize|tryon)$/.test(r.url()))calls++;});
 await page.goto('/');await page.getByRole('button',{name:'Template tone: Very deep',exact:true}).click();
 await expect(page.getByRole('img',{name:'Regular standard male avatar'}).first().locator('img')).toHaveAttribute('src','/avatar-tones/male-very-deep.png');
 await page.getByLabel('Height in centimeters').fill('180');await page.getByLabel('Weight in kilograms').fill('95');
 await expect(page.getByRole('button',{name:'Select Broad profile'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByLabel('Approximate measurement bands')).toContainText('180–190 cm');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/avatar-library-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Continue to match'}).click();await page.getByRole('button',{name:'Review avatar',exact:true}).click();
 await page.getByLabel('I have reviewed this standard sample avatar.').check();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download avatar',exact:true}).click();
 const downloaded=await readFile(await (await download).path());
 const expected=await standardAvatar('broad','very-deep');
 const pixels=bytes=>sharp(bytes).removeAlpha().raw().toBuffer();
 expect(await pixels(downloaded)).toEqual(await pixels(expected));
 await page.getByRole('button',{name:'Try clothes',exact:true}).click();
 const preview=page.getByAltText('Avatar wearing the selected outfit');await expect(preview).toBeVisible();
 const source=await preview.getAttribute('src');expect(await pixels(Buffer.from(source.split(',')[1],'base64'))).toEqual(await pixels(expected));
 expect(calls).toBe(0);
});
