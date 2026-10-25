import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { nativeBridge } from "../helpers/native-bridge.js";
import { customerPhotos } from "../helpers/customer-photos.js";

test("Android sends both photos once with consent; failures block export; approved provider PNG is shared", async ({ page }) => {
  await nativeBridge(page);
  // Deliberately stubbed image: this verifies integration, not generation quality.
  const output = await sharp(customerPhotos[0].body).png().toBuffer();
  const dataUrl = `data:image/png;base64,${output.toString("base64")}`;
  await page.route("https://studio.example.test/api/health", route => route.fulfill({
    json: { status: "ok", personalizationAvailable: true, personalizationContract: "customer-avatar-v3" },
  }));
  const requests = [];
  await page.route("https://studio.example.test/api/personalize", async route => {
    const data = route.request().postDataJSON();
    requests.push(data);
    expect(route.request().headers().authorization).toBe("Bearer test-only-store-access-code-32-characters");
    expect(data.face).toMatch(/^data:image\/jpeg;base64,/);
    expect(data.body).toMatch(/^data:image\/jpeg;base64,/);
    expect(data.face).not.toEqual(data.body);
    expect(data.profileId).toBe("broad");
    expect(data.measurements).toEqual({ heightCm: 175, weightKg: 95 });
    expect(data.consent).toBe(true);
    expect(data.consentScope).toBe("face-and-body");
    expect(data.consentProvider).toBe("openai");
    await route.fulfill(requests.length === 1
      ? { status: 502, json: { error: "Generation failed. Please try again." } }
      : { json: { image: dataUrl, kind: "customer-avatar", profileId: "broad", needsReview: true } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Studio connection", exact: true }).click();
  await page.getByLabel("Studio address").fill("https://studio.example.test");
  await page.getByLabel("Store access code").fill("test-only-store-access-code-32-characters");
  await page.getByRole("button", { name: "Connect studio", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("checkbox", { name: "The customer agrees to use their photos for this avatar session." }).check();
  await page.getByRole("button", { name: "Add face photo" }).click();
  await page.getByRole("button", { name: "Add full-body photo" }).click();
  await page.getByRole("spinbutton", { name: "Weight in kilograms" }).fill("95");
  await page.getByRole("button", { name: "Continue to match" }).click();
  const generate = page.getByRole("button", { name: "Generate customer avatar", exact: true });
  await expect(generate).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review avatar" })).toBeDisabled();
  expect(requests).toHaveLength(0);
  await page.getByRole("checkbox", { name: /The customer agrees to send their face photo, full-body/ }).check();
  await generate.click();
  await expect(page.getByRole("alert")).toContainText("Generation failed");
  expect(requests).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Review avatar" })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeCalls.some(c => c.method === "writeFile"))).toBe(false);
  await generate.click();
  await expect(page.getByAltText("Customer’s personalized avatar, awaiting visual review")).toHaveAttribute("src", dataUrl);
  expect(requests).toHaveLength(2);
  await page.getByRole("button", { name: "Review avatar" }).click();
  await expect(page.getByAltText("Original customer face for skin-tone review")).toBeVisible();
  await expect(page.getByAltText("Original customer body for skin-tone review")).toBeVisible();
  const share = page.getByRole("button", { name: "Save or share avatar" });
  await expect(share).toBeDisabled();
  await page.getByRole("checkbox", { name: "The customer approves the face, body and skin tone of this avatar." }).check();
  await share.click();
  const file = await page.evaluate(() => window.__nativeCalls.find(c => c.method === "writeFile").options);
  expect(file.path).toContain("broad-personalized-avatar.png");
  const exportedPixels = await sharp(Buffer.from(file.data, "base64")).removeAlpha().raw().toBuffer();
  const providerPixels = await sharp(output).removeAlpha().raw().toBuffer();
  expect(exportedPixels.equals(providerPixels)).toBe(true);
  await page.getByRole("button", { name: "Select Slim profile" }).click();
  await expect(share).toBeDisabled();
  expect(requests).toHaveLength(2);
});

test("a face-only legacy studio cannot advertise customer skin-tone generation", async ({ page }) => {
  await page.route("**/api/health", route => route.fulfill({ json: { status: "ok", personalizationAvailable: true } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to match" }).click();
  await expect(page.getByText("Customer avatar generation unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate customer avatar" })).toBeDisabled();
});
