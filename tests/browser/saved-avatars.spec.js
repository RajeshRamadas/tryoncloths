import { test, expect } from "@playwright/test";
import { standardAvatar } from "../../server/app.js";
import { customerPhotos } from "../helpers/customer-photos.js";
import { nativeBridge } from "../helpers/native-bridge.js";

async function generate(page) {
  const png = await standardAvatar("regular");
  let calls = 0;
  await page.route("**/api/health", route => route.fulfill({ json: { personalizationAvailable:true, personalizationContract:"customer-avatar-v4", provider:"gemini" } }));
  await page.route("**/api/personalize", route => { calls++; return route.fulfill({ json:{ image:`data:image/png;base64,${png.toString("base64")}`, kind:"customer-avatar", provider:"gemini", profileId:"regular" } }); });
  await page.goto("/");
  await page.getByLabel("The customer agrees to use their photos for this avatar session.").check();
  await page.getByLabel("Upload face photo").setInputFiles(customerPhotos[0].face);
  await page.getByLabel("Upload full-body photo").setInputFiles(customerPhotos[0].body);
  await expect(page.getByAltText("Customer full-body photo")).toBeVisible();
  await page.getByRole("button",{name:"Continue to match"}).click();
  await page.getByRole("checkbox",{name:/The customer agrees to send their face photo/}).check();
  await page.getByRole("button",{name:"Generate customer avatar",exact:true}).click();
  await expect(page.getByAltText("Customer’s personalized avatar, awaiting visual review")).toBeVisible();
  await page.getByRole("button",{name:"Review avatar",exact:true}).click();
  return { png, calls:()=>calls };
}
async function approve(page) {
  await page.getByLabel("The customer approves the face, body and skin tone of this avatar.").check();
}
async function save(page, name) {
  await approve(page);
  await page.getByLabel("Avatar name",{exact:true}).fill(name);
  await page.getByLabel("The customer agrees to save this avatar and measurements on this device for reuse.").check();
  await page.getByRole("button",{name:"Save avatar for reuse",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Avatar saved on this device");
}

test("an explicitly saved customer avatar survives reload, reopens for clothes, and never stores input photos", async ({page}) => {
  const provider = await generate(page);
  await expect(page.getByRole("button",{name:"Save avatar for reuse"})).toBeDisabled();
  await approve(page);
  await expect(page.getByRole("button",{name:"Save avatar for reuse"})).toBeDisabled();
  await save(page,"Customer A");
  // Saving the same PNG again updates the name rather than duplicating it.
  await save(page,"Customer A updated");
  const records = await page.evaluate(async () => {
    const db = await new Promise((resolve,reject)=>{const r=indexedDB.open("forme-saved-avatars",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const all = await new Promise((resolve,reject)=>{const r=db.transaction("avatars").objectStore("avatars").getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    db.close(); return all.map(item=>({keys:Object.keys(item).sort(),type:item.image.type,name:item.name}));
  });
  expect(records).toEqual([{keys:["heightCm","id","image","name","profileId","savedAt","source","thumbnail","weightKg"],type:"image/png",name:"Customer A updated"}]);
  await page.reload();
  await page.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await expect(page.getByRole("button",{name:"Use Customer A updated",exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"test-results/saved-avatar-library-mobile.png",fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button",{name:"Use Customer A updated",exact:true}).click();
  await expect(page.getByAltText("Customer’s personalized avatar, awaiting visual review")).toHaveAttribute("src",`data:image/png;base64,${provider.png.toString("base64")}`);
  await expect(page.getByAltText("Original customer face for skin-tone review")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Try clothes"})).toBeDisabled();
  await approve(page);
  await page.getByRole("button",{name:"Try clothes"}).click();
  await page.getByRole("button",{name:"Navy T-shirt Sample"}).click();
  await expect(page.getByAltText("Avatar wearing the selected outfit")).toBeVisible();
  expect(provider.calls()).toBe(1);
  await page.getByRole("button",{name:"Back to avatar"}).click();
  await page.getByRole("button",{name:"New session",exact:true}).click();
  await page.getByRole("button",{name:"Start new session",exact:true}).click();
  await page.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await expect(page.getByRole("button",{name:"Use Customer A updated"})).toBeVisible();
  await page.getByRole("button",{name:"Delete Customer A updated",exact:true}).click();
  await page.getByRole("button",{name:"Confirm deletion"}).click();
  await expect(page.getByText(/No saved avatars yet/)).toBeVisible();
  await page.reload();
  await page.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await expect(page.getByText(/No saved avatars yet/)).toBeVisible();
});

test("an existing downloaded PNG can be reused offline with selected body details", async ({page}) => {
  let calls=0;
  page.on("request",r=>{if(r.url().includes("/api/personalize"))calls++;});
  await page.goto("/");
  await page.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await page.getByText("Open a downloaded avatar PNG",{exact:true}).click();
  await page.getByLabel("Avatar body profile").selectOption("broad");
  await page.getByLabel("Saved height (cm)").fill("180");
  await page.getByLabel("Saved weight (kg)").fill("95");
  await page.getByLabel("Open avatar PNG",{exact:true}).setInputFiles({name:"Previous customer.png",mimeType:"image/png",buffer:await standardAvatar("broad")});
  await expect(page.getByText(/Imported avatar PNG. Check/)).toBeVisible();
  await save(page,"Imported customer");
  await page.reload();
  await page.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await page.getByRole("button",{name:"Use Imported customer",exact:true}).click();
  await expect(page.getByText("180 cm / 95 kg",{exact:true})).toBeVisible();
  await approve(page);
  await page.getByRole("button",{name:"Select Slim profile"}).click();
  await expect(page.getByRole("button",{name:"Try clothes"})).toBeDisabled();
  await expect(page.getByText("Generate again with the current photos and selected body.",{exact:true})).toBeVisible();
  expect(calls).toBe(0);
});

test("storage failure is visible and never reports an avatar as saved", async ({page}) => {
  await generate(page);
  await approve(page);
  await page.getByLabel("The customer agrees to save this avatar and measurements on this device for reuse.").check();
  await page.evaluate(()=>{ indexedDB.open = ()=>{ throw new DOMException("Storage unavailable","SecurityError"); }; });
  await page.getByRole("button",{name:"Save avatar for reuse"}).click();
  await expect(page.getByRole("alert")).toContainText("Could not access saved avatars");
  await expect(page.getByText(/Avatar saved on this device/)).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Download avatar",exact:true})).toBeEnabled();
});

test("Android's library reopens locally and the native back button closes its dialog", async ({page}) => {
  await nativeBridge(page);
  await page.goto("/");
  await page.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await page.getByText("Open a downloaded avatar PNG",{exact:true}).click();
  await page.getByLabel("Open avatar PNG",{exact:true}).setInputFiles({name:"Phone avatar.png",mimeType:"image/png",buffer:await standardAvatar("regular")});
  await save(page,"Phone customer");
  await page.reload();
  await page.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await expect(page.getByRole("button",{name:"Use Phone customer"})).toBeVisible();
  await page.evaluate(()=>Object.values(window.__nativeListeners)[0]({canGoBack:false}));
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button",{name:"Saved avatars",exact:true}).click();
  await page.getByRole("button",{name:"Use Phone customer"}).click();
  await approve(page);
  await page.getByRole("button",{name:"Try clothes"}).click();
  await expect(page.getByAltText("Avatar wearing the selected outfit")).toBeVisible();
});
