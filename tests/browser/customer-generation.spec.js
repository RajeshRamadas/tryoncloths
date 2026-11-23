import { approvePersonalizedAvatar } from "../helpers/avatar-quality-review.js";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { nativeBridge } from "../helpers/native-bridge.js";
import { ProviderError } from "../../server/provider-errors.js";
import { customerPhotos } from "../helpers/customer-photos.js";

test("Android sends both photos once with consent; failures block export; approved provider PNG is shared", async ({
  page,
}) => {
  await nativeBridge(page);
  // Deliberately stubbed image: this verifies integration, not generation quality.
  const output = await sharp(customerPhotos[0].body).png().toBuffer();
  const dataUrl = `data:image/png;base64,${output.toString("base64")}`;
  await page.route("https://studio.example.test/api/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        personalizationAvailable: true,
        personalizationContract: "customer-avatar-v4",
        provider: "gemini",
      },
    }),
  );
  const requests = [];
  await page.route("https://studio.example.test/api/personalize", async (route) => {
    const data = route.request().postDataJSON();
    requests.push(data);
    expect(route.request().headers().authorization).toBe(
      "Bearer test-only-store-access-code-32-characters",
    );
    expect(data.face).toMatch(/^data:image\/jpeg;base64,/);
    expect(data.body).toMatch(/^data:image\/jpeg;base64,/);
    expect(data.face).not.toEqual(data.body);
    expect(data.profileId).toBe("broad");
    expect(data.measurements).toEqual({ heightCm: 175, weightKg: 95 });
    expect(data.consent).toBe(true);
    expect(data.consentScope).toBe("face-and-body");
    expect(data.consentProvider).toBe("gemini");
    await route.fulfill(
      requests.length === 1
        ? {
            status: 502,
            json: { code: "missing_face", error: new ProviderError("missing_face").message },
          }
        : {
            json: {
              image: dataUrl,
              kind: "customer-avatar",
              provider: "gemini",
              profileId: "broad",
              needsReview: true,
            },
          },
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Studio connection", exact: true }).click();
  await page.getByLabel("Studio address").fill("https://studio.example.test");
  await page.getByLabel("Store access code").fill("test-only-store-access-code-32-characters");
  await page.getByRole("button", { name: "Connect studio", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    })
    .check();
  await page.getByRole("button", { name: "Add face photo" }).click();
  await page.getByRole("button", { name: "Add full-body photo" }).click();
  await page.getByRole("spinbutton", { name: "Weight in kilograms" }).fill("95");
  await page.getByRole("button", { name: "Continue to match" }).click();
  const generate = page.getByRole("button", { name: "Generate customer avatar", exact: true });
  await expect(generate).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review avatar" })).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Customer avatar not generated yet" }),
  ).toBeVisible();
  await expect(page.getByText("Sample avatar", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Match the customer’s photos", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /The customer agrees to send their face photo/ }),
  ).toHaveAccessibleName(/Google Gemini/);
  expect(requests).toHaveLength(0);
  await page
    .getByRole("checkbox", { name: /The customer agrees to send their face photo, full-body/ })
    .check();
  await generate.click();
  await expect(page.getByRole("alert")).toContainText(
    "did not contain one clearly detectable face",
  );
  await expect(page.getByRole("heading", { name: "Generation did not complete" })).toBeVisible();
  expect(requests).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Review avatar" })).toBeDisabled();
  expect(
    await page.evaluate(() => window.__nativeCalls.some((c) => c.method === "writeFile")),
  ).toBe(false);
  await generate.click();
  await expect(
    page.getByAltText("Customer’s personalized avatar, awaiting visual review"),
  ).toHaveAttribute("src", dataUrl);
  await expect(
    page.getByRole("heading", { name: "Customer avatar not generated yet" }),
  ).toHaveCount(0);
  expect(requests).toHaveLength(2);
  await expect(page.getByRole("heading", { name: "Ready for review" })).toBeVisible();
  await expect(page.getByAltText("Original customer face for skin-tone review")).toBeVisible();
  await expect(page.getByAltText("Original customer body for skin-tone review")).toBeVisible();
  const share = page.getByRole("button", { name: "Save or share avatar" });
  await expect(share).toBeDisabled();
  await approvePersonalizedAvatar(page);
  await share.click();
  const file = await page.evaluate(
    () => window.__nativeCalls.find((c) => c.method === "writeFile").options,
  );
  expect(file.path).toContain("broad-personalized-avatar.png");
  const exportedPixels = await sharp(Buffer.from(file.data, "base64"))
    .removeAlpha()
    .raw()
    .toBuffer();
  const providerPixels = await sharp(output).removeAlpha().raw().toBuffer();
  expect(exportedPixels.equals(providerPixels)).toBe(true);
  await page.getByRole("button", { name: "Change frame", exact: true }).click();
  await page.getByRole("button", { name: "Select Slim profile" }).click();
  await expect(share).toBeDisabled();
  expect(requests).toHaveLength(2);
});

test("a face-only legacy studio cannot advertise customer skin-tone generation", async ({
  page,
}) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok", personalizationAvailable: true } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to match" }).click();
  await expect(
    page.getByText("Customer avatar generation unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate customer avatar" })).toBeDisabled();
});

test("a preset and a separate hairstyle reference both preserve the head and full-body inputs", async ({
  page,
}) => {
  const output = await sharp(customerPhotos[2].body).png().toBuffer();
  const requests = [];
  await page.setViewportSize({ width: 430, height: 920 });
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: {
        personalizationAvailable: true,
        avatarHairstylesAvailable: true,
        personalizationContract: "customer-avatar-v4",
        provider: "gemini",
      },
    }),
  );
  await page.route("**/api/personalize", (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    return route.fulfill({
      json: {
        image: `data:image/png;base64,${output.toString("base64")}`,
        kind: "customer-avatar",
        provider: "gemini",
        profileId: input.profileId,
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("The customer agrees to use their photos for this avatar session.").check();
  await page.getByLabel("Upload face photo").setInputFiles(customerPhotos[2].face);
  await page.getByLabel("Upload full-body photo").setInputFiles(customerPhotos[2].body);
  await expect(page.getByText("Head photo", { exact: true })).toBeVisible();
  await expect(page.getByText("Full-body photo", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Customer face photo", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Customer full-body photo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue to match" }).click();

  const style = page.getByLabel("Hairstyle option");
  const consent = page.getByRole("checkbox", {
    name: /The customer agrees to send their face photo/,
  });
  const generate = page.getByRole("button", { name: "Generate customer avatar", exact: true });
  await expect(style).toHaveValue("original");
  await consent.check();
  await style.selectOption("shoulder-waves");
  await expect(consent).not.toBeChecked();
  await expect(generate).toBeDisabled();
  await consent.check();
  await generate.click();
  await expect(page.getByRole("heading", { name: "Ready for review" })).toBeVisible();
  await expect(page.getByText("Shoulder-length waves", { exact: true })).toBeVisible();
  expect(requests[0].hairstylePreset).toBe("shoulder-waves");
  expect(requests[0].hairstylePhoto).toBeUndefined();
  expect(requests[0].consentScope).toBe("face-and-body");

  await page.getByRole("button", { name: "Match & personalize" }).click();
  await style.selectOption("reference");
  await expect(generate).toBeDisabled();
  await expect(consent).toBeDisabled();
  await page.getByLabel("Upload hairstyle reference photo").setInputFiles(customerPhotos[1].face);
  await expect(page.getByAltText("Hairstyle reference photo", { exact: true })).toBeVisible();
  await expect(consent).toHaveAccessibleName(/hairstyle reference photo/);
  await consent.check();
  await page.getByRole("button", { name: "Remove hairstyle reference photo" }).click();
  await expect(consent).not.toBeChecked();
  await expect(generate).toBeDisabled();
  await page.getByLabel("Upload hairstyle reference photo").setInputFiles(customerPhotos[1].face);
  await consent.check();
  await generate.click();
  await expect(page.getByRole("heading", { name: "Ready for review" })).toBeVisible();
  await expect(page.getByAltText("Hairstyle reference for review")).toBeVisible();
  await expect(
    page.getByLabel("Face resembles the customer and hair matches the requested style"),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].hairstylePreset).toBeUndefined();
  expect(requests[1].hairstylePhoto).toMatch(/^data:image\/jpeg;base64,/);
  expect(requests[1].consentScope).toBe("face-body-and-hairstyle");
  expect(requests[1].face).toBe(requests[0].face);
  expect(requests[1].body).toBe(requests[0].body);
  expect(requests[1].hairstylePhoto).not.toBe(requests[1].face);
});
