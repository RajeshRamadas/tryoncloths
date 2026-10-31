import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { standardAvatar } from "../../server/app.js";

const garment = `data:image/jpeg;base64,${(await sharp({ create: { width: 300, height: 400, channels: 3, background: "#1f3a93" } }).jpeg().toBuffer()).toString("base64")}`;
const dressedAvatar = async () => {
  const base = await standardAvatar("regular");
  const tinted = await sharp(base).composite([{ input: Buffer.from('<svg width="384" height="300"><rect y="180" width="384" height="120" fill="#1f3a93"/></svg>'), top: 0, left: 0 }]).png().toBuffer();
  return `data:image/png;base64,${tinted.toString("base64")}`;
};

async function openStudio(page, { tryOnAvailable = true } = {}) {
  await page.route("**/api/health", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), tryOnAvailable, tryOnContract: "garment-tryon-v1" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to match" }).click();
  await page.getByRole("button", { name: "Review avatar", exact: true }).click();
  await page.getByLabel("I have reviewed this standard sample avatar.").check();
  await page.getByRole("button", { name: "Try clothes" }).click();
  await expect(page.getByAltText("Avatar wearing the selected outfit")).toBeVisible();
}

test("a product link is read, the garment type is confirmed, and one try-on request dresses the avatar", async ({ page }) => {
  const image = await dressedAvatar();
  const requests = [];
  await page.route("**/api/product-link", async route => {
    requests.push(["link", route.request().postDataJSON()]);
    await route.fulfill({ json: { title: "Men Slim Fit Blue Oxford Shirt", url: "https://shop.example/p/1", images: [{ source: "a", image: garment }, { source: "b", image: garment.replace("AAAA", "AAAB") }] } });
  });
  await page.route("**/api/tryon", async route => {
    requests.push(["tryon", route.request().postDataJSON()]);
    await route.fulfill({ json: { image, provider: "gemini", kind: "garment-tryon", garmentType: "shirt", needsReview: true } });
  });
  await openStudio(page);
  await page.getByLabel("Product link", { exact: true }).fill("https://shop.example/p/1");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText("Men Slim Fit Blue Oxford Shirt")).toBeVisible();
  const types = page.getByRole("group", { name: "Garment type" });
  await expect(types.getByRole("button", { name: "Shirt", exact: true })).toHaveAttribute("aria-pressed", "true");
  const putOn = page.getByRole("button", { name: "Put on avatar" });
  await expect(putOn).toBeDisabled();
  await page.getByLabel(/send their avatar and this product photo/).check();
  await putOn.click();
  await expect(page.getByText("Shirt · Men Slim Fit Blue Oxford Shirt")).toBeVisible();
  const tryon = requests.find(([kind]) => kind === "tryon")[1];
  expect(tryon).toMatchObject({ garmentType: "shirt", consent: true, consentScope: "avatar-and-garment", consentProvider: "gemini", garment });
  expect(tryon.avatar).toMatch(/^data:image\/png;base64,/);
  expect(requests.filter(([kind]) => kind === "tryon")).toHaveLength(1);
  await expect(page.getByLabel(/send their avatar and this product photo/)).not.toBeChecked();
  await page.getByLabel("I have checked clothing placement and approve this outfit preview.").check();
  await expect(page.getByRole("button", { name: "Download outfit" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo last garment" }).click();
  await expect(page.getByText("Wearing from product links")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("link failures show the server message and an uploaded photo can be used instead", async ({ page }) => {
  await page.route("**/api/product-link", route => route.fulfill({ status: 502, json: { code: "site_refused", error: "This website didn't allow the studio to read the page. Save the product image and upload it instead." } }));
  await openStudio(page);
  await page.getByLabel("Product link", { exact: true }).fill("https://blocked.example/p");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("alert")).toContainText("didn't allow the studio");
  const photo = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#333" } }).jpeg().toBuffer();
  await page.getByLabel("Upload product photo").setInputFiles({ name: "black-jeans.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByRole("group", { name: "Garment type" }).getByRole("button", { name: "Jeans" })).toHaveAttribute("aria-pressed", "true");
});

test("without a Gemini studio the link try-on cannot generate", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/tryon", route => { calls++; return route.abort(); });
  await page.route("**/api/product-link", route => route.fulfill({ json: { title: "Shirt", url: "https://shop.example", images: [{ source: "a", image: garment }] } }));
  await openStudio(page, { tryOnAvailable: false });
  await expect(page.getByText("needs the Gemini provider")).toBeVisible();
  await page.getByLabel("Product link", { exact: true }).fill("https://shop.example/p");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("button", { name: "Put on avatar" })).toBeDisabled();
  expect(calls).toBe(0);
});


test("undo restores local layers worn before an AI edit", async ({page}) => {
  const image=await dressedAvatar();
  await page.route("**/api/product-link", r=>r.fulfill({json:{title:"Shirt",images:[{source:"test",image:garment}]}}));
  await page.route("**/api/tryon", r=>r.fulfill({json:{image,kind:"garment-tryon"}}));
  await openStudio(page);
  await page.getByRole("button",{name:"Navy T-shirt Sample",exact:true}).click();
  await page.getByLabel("Product link",{exact:true}).fill("https://shop.example/p");
  await page.getByRole("button",{name:"Find",exact:true}).click();
  await page.getByLabel(/send their avatar and this product photo/).check();
  const preview=page.getByAltText("Avatar wearing the selected outfit");
  const before=await preview.getAttribute("src");
  await page.getByRole("button",{name:"Put on avatar"}).click();
  await page.getByRole("button",{name:"Undo last garment"}).click();
  await expect(preview).toHaveAttribute("src",before);
  await expect(page.getByRole("button",{name:"Navy T-shirt Sample",exact:true})).toHaveAttribute("aria-pressed","true");
});

test("failed try-on requires fresh consent before a manual retry", async ({page}) => {
  let calls=0;
  await page.route("**/api/product-link", r=>r.fulfill({json:{title:"Shirt",images:[{source:"test",image:garment}]}}));
  await page.route("**/api/tryon", r=>{calls++;return r.fulfill({status:502,json:{error:"Test provider failure"}});});
  await openStudio(page);
  await page.getByLabel("Product link",{exact:true}).fill("https://shop.example/p");
  await page.getByRole("button",{name:"Find",exact:true}).click();
  await page.getByLabel(/send their avatar and this product photo/).check();
  await page.getByRole("button",{name:"Put on avatar"}).click();
  await expect(page.getByRole("alert")).toContainText("Test provider failure");
  await expect(page.getByLabel(/send their avatar and this product photo/)).not.toBeChecked();
  await expect(page.getByRole("button",{name:"Put on avatar"})).toBeDisabled();
  expect(calls).toBe(1);
});

test('a credit limit offers billing help and a deliberate retry uses a fresh UUID',async({page})=>{
 const ids=[];
 await page.route('**/api/product-link',route=>route.fulfill({json:{title:'Blue shirt',url:'https://shop.example/p/1',images:[{source:'a',image:garment}]}}));
 await page.route('**/api/tryon',route=>{ids.push(route.request().postDataJSON().requestId);return route.fulfill({status:402,json:{error:'Buy credits or upgrade.',code:'credits_required'}});});
 await openStudio(page);await page.getByLabel('Product link',{exact:true}).fill('https://shop.example/p/1');await page.getByRole('button',{name:'Find',exact:true}).click();
 await page.getByLabel(/send their avatar and this product photo/).check();await page.getByRole('button',{name:'Put on avatar',exact:true}).click();
 await expect(page.getByRole('link',{name:'Buy credits or upgrade'})).toHaveAttribute('href','/billing');expect(ids).toHaveLength(1);
 await page.getByLabel(/send their avatar and this product photo/).check();await page.getByRole('button',{name:'Put on avatar',exact:true}).click();await expect.poll(()=>ids.length).toBe(2);
 expect(ids[0]).not.toBe(ids[1]);for(const id of ids)expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
