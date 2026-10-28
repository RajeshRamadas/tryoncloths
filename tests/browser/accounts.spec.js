import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountStore } from "../../server/accounts.js";
import { createApp, standardAvatar } from "../../server/app.js";
import { customerPhotos } from "../helpers/customer-photos.js";

// Exercise the actual account routes/database, forwarding the dev browser's API
// requests to an isolated backend. Provider output alone is stubbed.
test("web store accounts automatically save generated avatars and reopen them in another browser",async({browser,page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),"forme-account-browser-"));
 const store=new AccountStore(directory);let generations=0;
 const app=createApp({accountStore:store,apiKey:"test",accessMode:"public",rateLimit:false,personalize:async()=>{generations++;return `data:image/png;base64,${(await standardAvatar("regular")).toString("base64")}`;}});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const api=`http://127.0.0.1:${server.address().port}`;
 async function route(p){await p.route("**/api/**",async r=>{const u=new URL(r.request().url());const response=await r.fetch({url:api+u.pathname,headers:{...r.request().headers(),host:new URL(api).host,origin:api}});await r.fulfill({response});});}
 const other=await browser.newContext();const second=await other.newPage();
 try {
  await route(page);await route(second);await page.goto("/");
  await page.getByRole("button",{name:"Create an account",exact:true}).click();
  await page.getByLabel("Store name",{exact:true}).fill("Sample Clothing Store");
  await page.getByLabel("Account email").fill("owner@example.com");
  await page.getByLabel("Account password").fill("test-password-very-long");
  await page.getByRole("button",{name:"Create store account",exact:true}).click();
  await expect(page.getByRole("button",{name:"Sign out",exact:true})).toBeVisible();
  await page.getByLabel("The customer agrees to use their photos for this avatar session.").check();
  await page.getByLabel("Upload face photo").setInputFiles(customerPhotos[0].face);
  await page.getByLabel("Upload full-body photo").setInputFiles(customerPhotos[0].body);
  await expect(page.getByAltText("Customer full-body photo")).toBeVisible();
  await page.getByRole("button",{name:"Continue to match"}).click();
  await page.getByLabel("Customer / avatar name").fill("Customer Anil");
  await page.getByRole("checkbox",{name:/The customer agrees to send their face photo/}).check();
  await page.getByRole("button",{name:"Generate customer avatar",exact:true}).click();
  await expect(page.getByAltText("Customer’s personalized avatar, awaiting visual review")).toBeVisible();
  await page.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await expect(page.getByRole("button",{name:"Use Customer Anil",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Close saved avatars"}).click();
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.getByAltText("Customer’s personalized avatar, awaiting visual review")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Saved avatars",exact:true})).toBeDisabled();
  await second.goto(new URL(page.url()).origin);
  await second.getByLabel("Account email").fill("owner@example.com");
  await second.getByLabel("Account password").fill("test-password-very-long");
  await second.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(second.getByRole("button",{name:"Sign out",exact:true})).toBeVisible();
  await second.reload();
  await expect(second.getByRole("button",{name:"Sign out",exact:true})).toBeVisible();
  await second.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await expect(second.getByRole("button",{name:"Use Customer Anil",exact:true})).toBeVisible();
  await second.setViewportSize({width:390,height:844});
  await second.screenshot({path:"test-results/account-library-mobile.png"});
  expect(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await second.getByRole("button",{name:"Use Customer Anil",exact:true}).click();
  await expect(second.getByAltText("Customer’s personalized avatar, awaiting visual review")).toBeVisible();
  await second.getByLabel("The customer approves the face, body and skin tone of this avatar.").check();
  await second.getByRole("button",{name:"Try clothes"}).click();
  await second.getByRole("button",{name:"Navy T-shirt Sample"}).click();
  await expect(second.getByAltText("Avatar wearing the selected outfit")).toBeVisible();
  expect(generations).toBe(1);
 } finally {await other.close();await new Promise(r=>server.close(r));store.close();await rm(directory,{recursive:true,force:true});}
});
