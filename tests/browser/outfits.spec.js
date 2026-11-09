import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { nativeBridge } from "../helpers/native-bridge.js";
import { customerPhotos } from "../helpers/customer-photos.js";
import { standardAvatar } from "../../server/app.js";

async function sampleStudio(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to match" }).click();
  await page.getByRole("button", { name: "Review avatar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try clothes" })).toBeDisabled();
  await page.getByLabel("I have reviewed this standard sample avatar.").check();
  await page.getByRole("button", { name: "Try clothes" }).click();
  await expect(page.getByAltText("Avatar wearing the selected outfit")).toBeVisible();
}
const outputBytes = async (page) =>
  Buffer.from(
    (await page.getByAltText("Avatar wearing the selected outfit").getAttribute("src")).split(
      ",",
    )[1],
    "base64",
  );
const approve = (page) =>
  page.getByLabel("I have checked clothing placement and approve this outfit preview.").check();

test("a JPEG product photo on a plain backdrop is cut out on the device and aligned as a top", async ({
  page,
}) => {
  const apiCalls = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/")) apiCalls.push(req.url());
  });
  await sampleStudio(page);
  const original = await outputBytes(page);
  const before = apiCalls.length;
  const photo = await sharp(
    Buffer.from(
      '<svg width="500" height="520" xmlns="http://www.w3.org/2000/svg"><rect width="500" height="520" fill="#f4f3ef"/><path d="M160 60 L210 40 Q250 70 290 40 L340 60 L440 150 L390 200 L350 160 L350 480 L150 480 L150 160 L110 200 L60 150 Z" fill="#2e5c8a"/></svg>',
    ),
  )
    .jpeg({ quality: 85 })
    .toBuffer();
  await page
    .getByLabel("Import clothing layer")
    .setInputFiles({ name: "Store tee.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByRole("button", { name: "Store tee Your layer" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Background removed on this device")).toBeVisible();
  await expect.poll(async () => (await outputBytes(page)).equals(original)).toBe(false);
  const composed = await outputBytes(page);
  // The backdrop is gone: the avatar's head above the neckline is untouched.
  const head = { left: 110, top: 0, width: 160, height: 170 };
  expect(
    (await sharp(original).extract(head).removeAlpha().raw().toBuffer()).equals(
      await sharp(composed).extract(head).removeAlpha().raw().toBuffer(),
    ),
  ).toBe(true);
  await page.locator(".placement-options summary").click();
  const width = Number(await page.getByLabel("shirt Width").inputValue());
  expect(width).toBeGreaterThan(70);
  expect(width).toBeLessThan(110);
  await page.getByLabel("Clothing background tolerance").fill("60");
  await expect(page.getByLabel("Clothing background tolerance")).toHaveValue("60");
  await page.getByLabel("Clear enclosed gaps, such as between straps").uncheck();
  await approve(page);
  await expect(page.getByRole("button", { name: "Download outfit" })).toBeEnabled();
  expect(apiCalls.slice(before)).toEqual([]);
});

test("outfits select independently, export displayed pixels without AI calls, and reset cleanly", async ({
  page,
}) => {
  let aiCalls = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/personalize")) aiCalls++;
  });
  await sampleStudio(page);
  const original = await outputBytes(page);
  await page.getByRole("button", { name: "Navy T-shirt Sample" }).click();
  await page.getByRole("button", { name: "Trousers", exact: true }).click();
  await page.getByRole("button", { name: "Sand chinos Sample" }).click();
  await page.getByRole("button", { name: "Shoes", exact: true }).click();
  await page.getByRole("button", { name: "White sneakers Sample" }).click();
  await expect(page.getByRole("button", { name: "Download outfit" })).toBeDisabled();
  await approve(page);
  const composed = await outputBytes(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "test-results/outfit-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/outfit-mobile.png", fullPage: true });
  const head = { left: 110, top: 0, width: 160, height: 170 };
  expect(
    (await sharp(original).extract(head).removeAlpha().raw().toBuffer()).equals(
      await sharp(composed).extract(head).removeAlpha().raw().toBuffer(),
    ),
  ).toBe(true);
  expect(composed.equals(original)).toBe(false);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download outfit" }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("forme-regular-outfit-avatar.png");
  expect(
    (
      await sharp(await file.path())
        .raw()
        .toBuffer()
    ).equals(await sharp(composed).raw().toBuffer()),
  ).toBe(true);
  await page.getByRole("button", { name: "Trousers", exact: true }).click();
  await page.locator(".placement-options summary").click();
  await page.getByLabel("trousers Left / right").fill("25");
  await expect(page.getByRole("button", { name: "Download outfit" })).toBeDisabled();
  await page.getByRole("button", { name: "Back to avatar" }).click();
  await page.getByRole("button", { name: "Try clothes" }).click();
  await expect(page.getByRole("button", { name: "Sand chinos Sample" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Reset outfit", exact: true }).click();
  await expect.poll(async () => (await outputBytes(page)).equals(original)).toBe(true);
  expect(aiCalls).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("transparent layers import locally; photos with no garment fail and profile changes discard the outfit", async ({
  page,
}) => {
  await sampleStudio(page);
  const opaque = await sharp({
    create: { width: 100, height: 120, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Import clothing layer")
    .setInputFiles({ name: "opaque.png", mimeType: "image/png", buffer: opaque });
  await expect(page.getByRole("alert")).toContainText("No clothing was found");
  const transparent = await sharp(opaque)
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#00000000" })
    .png()
    .toBuffer();
  await page
    .getByLabel("Import clothing layer")
    .setInputFiles({ name: "Store top.png", mimeType: "image/png", buffer: transparent });
  await expect(page.getByRole("button", { name: "Store top Your layer" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await approve(page);
  await page.locator(".placement-options summary").click();
  await page.getByRole("button", { name: "Remove imported layer" }).click();
  await expect(page.getByRole("button", { name: "Store top Your layer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download outfit" })).toBeDisabled();
  await page.getByRole("button", { name: "Back to avatar" }).click();
  await page.getByRole("button", { name: "Select Broad profile" }).click();
  await expect(page.getByRole("button", { name: "Try clothes" })).toBeDisabled();
  await page.getByLabel("I have reviewed this standard sample avatar.").check();
  await page.getByRole("button", { name: "Try clothes" }).click();
  await expect(page.getByRole("button", { name: "Original top" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("customer outfit reuses the approved generated image without another provider request", async ({
  page,
}) => {
  let calls = 0;
  const avatar = await standardAvatar("regular");
  const generated = await sharp(avatar)
    .extend({ top: 48, bottom: 48, left: 154, right: 154, background: "#c6c6c6" })
    .png()
    .toBuffer();
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: {
        personalizationAvailable: true,
        personalizationContract: "customer-avatar-v4",
        provider: "gemini",
      },
    }),
  );
  await page.route("**/api/personalize", (route) => {
    calls++;
    return route.fulfill({
      json: {
        image: `data:image/png;base64,${generated.toString("base64")}`,
        kind: "customer-avatar",
        provider: "gemini",
        profileId: "regular",
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("The customer agrees to use their photos for this avatar session.").check();
  await page.getByLabel("Upload face photo").setInputFiles(customerPhotos[0].face);
  await page.getByLabel("Upload full-body photo").setInputFiles(customerPhotos[0].body);
  await expect(page.getByAltText("Customer full-body photo")).toBeVisible();
  await page.getByRole("button", { name: "Continue to match" }).click();
  await page
    .getByRole("checkbox", { name: /The customer agrees to send their face photo/ })
    .check();
  await page.getByRole("button", { name: "Generate customer avatar", exact: true }).click();
  await expect(
    page.getByAltText("Customer’s personalized avatar, awaiting visual review"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review avatar", exact: true }).click();
  await page
    .getByLabel("The customer approves the face, body and skin tone of this avatar.")
    .check();
  await page.getByRole("button", { name: "Try clothes" }).click();
  await page.getByRole("button", { name: "Cream T-shirt Sample" }).click();
  await approve(page);
  const composed = await outputBytes(page);
  const head = { left: 250, top: 48, width: 180, height: 170 };
  expect(
    (await sharp(composed).extract(head).removeAlpha().raw().toBuffer()).equals(
      await sharp(generated).extract(head).removeAlpha().raw().toBuffer(),
    ),
  ).toBe(true);
  expect(calls).toBe(1);
});

test("Android shares the composed outfit through the existing native export path", async ({
  page,
}) => {
  await nativeBridge(page);
  await sampleStudio(page);
  await page.getByRole("button", { name: "Blue button-down shirt Sample" }).click();
  await page.getByRole("button", { name: "Shoes", exact: true }).click();
  await page.getByRole("button", { name: "Brown leather shoes Sample" }).click();
  await approve(page);
  const composed = await outputBytes(page);
  await page.getByRole("button", { name: "Save or share outfit" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__nativeCalls.filter((c) => c.method === "writeFile").length),
    )
    .toBe(1);
  const file = await page.evaluate(
    () => window.__nativeCalls.find((c) => c.method === "writeFile").options,
  );
  expect(file.path).toContain("regular-outfit-avatar.png");
  expect(
    (await sharp(Buffer.from(file.data, "base64")).raw().toBuffer()).equals(
      await sharp(composed).raw().toBuffer(),
    ),
  ).toBe(true);
});

test("footwear can switch or clear independently without changing the upper body", async ({
  page,
}) => {
  const missing = [];
  page.on("response", (response) => {
    if (response.url().includes("/garments/") && !response.ok()) missing.push(response.url());
  });
  await sampleStudio(page);
  await page.getByRole("button", { name: "Navy T-shirt Sample" }).click();
  await approve(page);
  const withoutShoes = await outputBytes(page);
  await page.getByRole("button", { name: "Shoes", exact: true }).click();
  for (const name of [
    "White sneakers Sample",
    "Black sneakers Sample",
    "Brown leather shoes Sample",
  ]) {
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("button", { name: "Download outfit" })).toBeDisabled();
    await approve(page);
    const withShoes = await outputBytes(page);
    expect(withShoes.equals(withoutShoes)).toBe(false);
    const upper = { left: 0, top: 0, width: 384, height: 820 };
    expect(
      (await sharp(withShoes).extract(upper).raw().toBuffer()).equals(
        await sharp(withoutShoes).extract(upper).raw().toBuffer(),
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Bare feet", exact: true }).click();
  await expect.poll(async () => (await outputBytes(page)).equals(withoutShoes)).toBe(true);
  await page.getByRole("button", { name: "Shirts & tops", exact: true }).click();
  await expect(page.getByRole("button", { name: "Navy T-shirt Sample" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(missing).toEqual([]);
});

test("expanded wardrobe searches all categories, renders real colour variants and exports the displayed pixels", async ({
  page,
}) => {
  const aiRequests = [],
    missing = [];
  page.on("request", (request) => {
    if (/\/api\/(personalize|tryon)(\?|$)/.test(request.url())) aiRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.url().includes("/garments/") && !response.ok()) missing.push(response.url());
  });
  await sampleStudio(page);
  const original = await outputBytes(page);
  await page.locator(".sample-outfits summary").click();
  await expect(page.getByText(/44 sample items · 2,860 possible combinations/)).toBeVisible();
  await expect(page.locator(".garment-grid button")).toHaveCount(21);
  await page.getByLabel("Search sample clothes").fill("red");
  await expect(page.locator(".garment-grid button")).toHaveCount(2);
  const red = page.getByRole("button", { name: "Red T-shirt Sample", exact: true });
  await expect(red.locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  const thumbnail = Buffer.from(
    (await red.locator("img").getAttribute("src")).split(",")[1],
    "base64",
  );
  const { data, info } = await sharp(thumbnail).raw().toBuffer({ resolveWithObject: true });
  const chest =
    (Math.floor(info.height * 0.5) * info.width + Math.floor(info.width * 0.5)) * info.channels;
  expect(data[chest]).toBeGreaterThan(data[chest + 1] * 1.5);
  await red.click();
  await approve(page);
  const redOutfit = await outputBytes(page);
  expect(redOutfit.equals(original)).toBe(false);
  const head = { left: 0, top: 0, width: 384, height: 170 };
  expect(
    (await sharp(redOutfit).extract(head).raw().toBuffer()).equals(
      await sharp(original).extract(head).raw().toBuffer(),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Trousers", exact: true }).click();
  await page.getByLabel("Search sample clothes").fill("");
  await expect(page.locator(".garment-grid button")).toHaveCount(14);
  await page.getByRole("button", { name: "Olive chinos Sample", exact: true }).click();
  await page.getByRole("button", { name: "Shoes", exact: true }).click();
  await expect(page.locator(".garment-grid button")).toHaveCount(12);
  await page.getByRole("button", { name: "Tan leather shoes Sample", exact: true }).click();
  await approve(page);
  const composed = await outputBytes(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download outfit", exact: true }).click();
  expect(
    (
      await sharp(await (await download).path())
        .raw()
        .toBuffer()
    ).equals(await sharp(composed).raw().toBuffer()),
  ).toBe(true);
  expect(aiRequests).toEqual([]);
  expect(missing).toEqual([]);
});

test("complete sample outfits replace all three layers, reset review, and keep individual choices editable", async ({
  page,
}) => {
  const aiRequests = [];
  page.on("request", (request) => {
    if (/\/api\/(personalize|tryon)(\?|$)/.test(request.url())) aiRequests.push(request.url());
  });
  await sampleStudio(page);
  await page.locator(".sample-outfits summary").click();
  const outfits = page.getByRole("group", { name: "Complete sample outfits" });
  for (const name of [
    "Weekend casual",
    "Office classic",
    "Earth tones",
    "Monochrome",
    "Summer light",
    "Evening smart",
    "Colour pop",
    "Soft pastels",
  ]) {
    const choice = outfits.getByRole("button", { name: new RegExp("^" + name) });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Download outfit", exact: true })).toBeDisabled();
    await approve(page);
    await expect(page.getByAltText("Avatar wearing the selected outfit")).toBeVisible();
  }
  await page.getByRole("button", { name: "Trousers", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Light blue jeans Sample", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Black jeans Sample", exact: true }).click();
  await expect(outfits.locator('[aria-pressed="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Shoes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Grey sneakers Sample", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Shirts & tops", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Blush pink T-shirt Sample", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset outfit", exact: true }).click();
  await expect(outfits.locator('[aria-pressed="true"]')).toHaveCount(0);
  expect(aiRequests).toEqual([]);
});

test("sample search keeps imported clothing usable and the enlarged catalogue fits mobile", async ({
  page,
}) => {
  await sampleStudio(page);
  const transparent = await sharp({
    create: { width: 150, height: 150, channels: 4, background: "#805050" },
  })
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#00000000" })
    .png()
    .toBuffer();
  await page
    .getByLabel("Import clothing layer")
    .setInputFiles({ name: "Store top.png", mimeType: "image/png", buffer: transparent });
  await page.getByLabel("Search sample clothes").fill("not-a-colour");
  await expect(page.getByText(/No sample clothes match this search/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Store top Your layer", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear sample search", exact: true }).click();
  await expect(page.locator(".garment-grid button")).toHaveCount(22);
  await page.locator(".sample-outfits summary").click();
  await page
    .getByRole("group", { name: "Complete sample outfits" })
    .getByRole("button", { name: /^Earth tones/ })
    .click();
  await approve(page);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page
    .getByRole("heading", { name: "Complete outfit combinations" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/colour-wardrobe-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("heading", { name: "Choose your clothes" })
    .evaluate((heading) => heading.scrollIntoView({ block: "start" }));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: "test-results/colour-wardrobe-mobile.png" });
});
