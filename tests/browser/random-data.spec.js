import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { nativeBridge } from "../helpers/native-bridge.js";
import { customerPhotos } from "../helpers/customer-photos.js";

// Repeatable inputs from three independent synthetic customers, not avatar crops.
const seed = 20261022;
let state = seed;
const random = (min, max) => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return min + (state % (max - min + 1));
};
const names = ["Slim", "Regular", "Athletic", "Broad"];
const scenarios = [
  { height: 175, weight: 55, expected: "Slim" },
  { height: 175, weight: 72, expected: "Regular" },
  { height: 175, weight: 95, expected: "Broad" },
  { height: 140, weight: 35 },
  { height: 210, weight: 200 },
  ...Array.from({ length: 11 }, () => ({
    height: random(150, 200),
    weight: random(45, 130),
  })),
].map((row, index) => ({ ...row, index, customer: index < 3 ? index : random(0, 2) }));

async function photosFor(row) {
  const format = ["jpeg", "png", "webp"][row.index % 3];
  const customer = customerPhotos[row.customer];
  const face = await sharp(customer.face)
    .resize(row.index % 2 ? 340 : 170)
    .toFormat(format)
    .toBuffer();
  let full = sharp(customer.body);
  // Exercise camera EXIF orientation and downscaling of large phone images.
  if (row.index % 4 === 0) full = full.resize({ height: 3000 });
  if (row.index % 4 === 1) full = full.rotate(90).withMetadata({ orientation: 8 });
  const body = await full.toFormat(format).toBuffer();
  return { format, face, body };
}

const consentLabel = "The customer agrees to use their photos for this avatar session.";
const dataUrl = (buffer, format) => `data:image/${format};base64,${buffer.toString("base64")}`;

for (const row of scenarios) {
  test(`random Android session ${row.index + 1}: ${row.height} cm, ${row.weight} kg`, async ({ page }, testInfo) => {
    const photos = await photosFor(row);
    await nativeBridge(page, [dataUrl(photos.face, photos.format), dataUrl(photos.body, photos.format)]);
    const requests = [], errors = [];
    page.on("request", request => {
      if (request.url().includes("/api/")) requests.push(request.url());
    });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("spinbutton", { name: "Height in centimeters" }).fill(String(row.height));
    await page.getByRole("spinbutton", { name: "Weight in kilograms" }).fill(String(row.weight));
    if (row.expected) {
      await expect(page.getByRole("button", { name: `Select ${row.expected} profile` })).toHaveAttribute("aria-pressed", "true");
    }
    await page.getByRole("checkbox", { name: consentLabel }).check();
    await page.getByRole("button", { name: "Add face photo" }).click();
    await expect(page.getByAltText("Customer face photo")).toBeVisible();
    await page.getByRole("button", { name: "Add full-body photo" }).click();
    const bodyImage = page.getByAltText("Customer full-body photo");
    await expect(bodyImage).toBeVisible();
    const normalized = await bodyImage.evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight }));
    expect(Math.max(normalized.width, normalized.height)).toBeLessThanOrEqual(1600);
    expect(normalized.height).toBeGreaterThan(normalized.width);
    if (row.index < 3) {
      await page.screenshot({ path: testInfo.outputPath("photos-entered.png"), fullPage: true });
      await testInfo.attach("input-face", { body: photos.face, contentType: `image/${photos.format}` });
      await testInfo.attach("input-body", { body: photos.body, contentType: `image/${photos.format}` });
    }
    // Manual corrections must select/export every profile, including Athletic.
    const selected = names[row.index % names.length];
    await page.getByRole("button", { name: `Select ${selected} profile` }).click();
    await page.getByRole("button", { name: "Continue to match" }).click();
    await expect(page.getByRole("button", { name: "Personalize face", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Review avatar" }).click();
    await expect(page.getByText("Sample face · no customer face applied")).toBeVisible();
    const share = page.getByRole("button", { name: "Save or share avatar" });
    await expect(share).toBeDisabled();
    await page.getByRole("checkbox", { name: "I have reviewed this standard sample avatar." }).check();
    await share.click();
    await expect(page.getByRole("status")).toContainText("Share sheet closed");
    const written = await page.evaluate(() => window.__nativeCalls.find(c => c.method === "writeFile").options);
    expect(written.path).toContain(`${selected.toLowerCase()}-sample-avatar.png`);
    const png = Buffer.from(written.data, "base64");
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 384, 942]);
    const actual = await sharp(png).removeAlpha().raw().toBuffer();
    const expected = await sharp("public/avatar-library.png")
      .extract({ left: (row.index % 4) * 384, top: 0, width: 384, height: 942 })
      .removeAlpha().raw().toBuffer();
    expect(actual.equals(expected)).toBe(true);
    if (row.index < 3) {
      await page.screenshot({ path: testInfo.outputPath("review-approved.png"), fullPage: true });
      await testInfo.attach("exported-avatar", { body: png, contentType: "image/png" });
    }
    await page.getByRole("button", { name: "New session", exact: true }).click();
    await page.getByRole("button", { name: "Start new session", exact: true }).click();
    await expect(page.getByAltText("Customer face photo")).toHaveCount(0);
    await expect(page.getByAltText("Customer full-body photo")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: consentLabel })).not.toBeChecked();
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    await testInfo.attach("scenario", { body: JSON.stringify({ seed, ...row, customerId: customerPhotos[row.customer].id, format: photos.format, normalized, selected, export: { width: meta.width, height: meta.height }, apiRequests: requests.length }), contentType: "application/json" });
  });
}

test("invalid measurements block continuation and recover after correction", async ({ page }) => {
  await nativeBridge(page);
  await page.goto("/");
  const height = page.getByRole("spinbutton", { name: "Height in centimeters" });
  const weight = page.getByRole("spinbutton", { name: "Weight in kilograms" });
  for (const [h, w] of [["", "72"], ["175", ""], ["0", "72"], ["-1", "72"], ["139", "72"], ["211", "72"], ["175", "0"], ["175", "34"], ["175", "201"], ["9999", "9999"]]) {
    await height.fill(h);
    await weight.fill(w);
    await expect(page.getByRole("button", { name: "Continue to match" })).toBeDisabled();
  }
  await height.fill("175");
  await weight.fill("72");
  await expect(page.getByRole("button", { name: "Continue to match" })).toBeEnabled();
});

test("invalid photo files preserve an existing photo and allow recovery", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("checkbox", { name: consentLabel }).check();
  const { face } = await photosFor({ index: 0, customer: 0 });
  const input = page.getByLabel("Upload face photo");
  await input.setInputFiles({ name: "valid.jpg", mimeType: "image/jpeg", buffer: face });
  const preview = page.getByAltText("Customer face photo");
  await expect(preview).toBeVisible();
  const original = await preview.getAttribute("src");
  const tiny = await sharp({ create: { width: 64, height: 64, channels: 3, background: "red" } }).png().toBuffer();
  const files = [
    { name: "not-photo.txt", mimeType: "text/plain", buffer: Buffer.from("test"), error: "Choose a JPEG, PNG, or WebP photo." },
    { name: "corrupt.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a JPEG"), error: "This image could not be opened." },
    { name: "tiny.png", mimeType: "image/png", buffer: tiny, error: "Use a photo at least 128 × 128 pixels." },
    { name: "too-large.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(10 * 1024 * 1024 + 1), error: "Choose a photo smaller than 10 MB." },
  ];
  for (const { error, ...file } of files) {
    await input.setInputFiles(file);
    await expect(page.getByRole("alert")).toContainText(error);
    await expect(preview).toHaveAttribute("src", original);
  }
  await input.setInputFiles({ name: "recovered.jpg", mimeType: "image/jpeg", buffer: face });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("checkbox", { name: consentLabel }).uncheck();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add face photo" })).toBeDisabled();
});

test("all eight WebP orientations match independently decoded photos", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("checkbox", { name: consentLabel }).check();
  for (let orientation = 1; orientation <= 8; orientation++) {
    const buffer = await sharp(customerPhotos[2].body)
      .resize({ height: 480 }).withMetadata({ orientation }).webp({ lossless: true }).toBuffer();
    await page.getByLabel("Upload face photo").setInputFiles({ name: `orientation-${orientation}.webp`, mimeType: "image/webp", buffer });
    const preview = page.getByAltText("Customer face photo");
    await expect(preview).toBeVisible();
    await expect(page.getByRole("button", { name: "Replace face photo" })).toBeEnabled();
    const src = await preview.getAttribute("src");
    const actual = await sharp(Buffer.from(src.split(",")[1], "base64")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const expected = await sharp(buffer).autoOrient().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([actual.info.width, actual.info.height]).toEqual([expected.info.width, expected.info.height]);
    let difference = 0;
    for (let pixel = 0; pixel < actual.data.length; pixel++) difference += Math.abs(actual.data[pixel] - expected.data[pixel]);
    // JPEG normalization is lossy; compare decoded content, allowing compression noise.
    expect(difference / actual.data.length).toBeLessThan(5);
  }
});
