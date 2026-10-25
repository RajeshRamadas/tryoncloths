import { test, expect } from "@playwright/test";
import path from "node:path";
import { customerPhotos } from "../helpers/customer-photos.js";

test("sample workflow matches, allows correction, reviews and exports the selected avatar", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Every great fit starts with you." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Select Regular profile/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("spinbutton", { name: "Weight in kilograms" })
    .fill("95");
  await expect(
    page.getByRole("button", { name: /Select Broad profile/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Select Athletic profile/ }).click();
  await page.getByRole("button", { name: "Continue to match" }).click();
  await expect(
    page.getByText("Customer avatar generation unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate customer avatar", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Review avatar" }).click();
  await expect(
    page.getByText("Sample face · no customer face applied"),
  ).toBeVisible();
  const downloadButton = page.getByRole("button", { name: "Download avatar" });
  await expect(downloadButton).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I have reviewed this standard sample avatar.",
    })
    .check();
  const downloaded = page.waitForEvent("download");
  await downloadButton.click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("forme-athletic-sample-avatar.png");
  const imagePath = await file.path();
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(imagePath).metadata();
  expect(metadata.width).toBe(384);
  expect(metadata.height).toBe(942);
  await page.getByRole("button", { name: /Select Slim profile/ }).click();
  await expect(downloadButton).toBeDisabled();
  expect(errors).toEqual([]);
});

test("photos require consent, can be removed, and are cleared in a new session", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Add face photo" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    })
    .check();
  for (const [label, file] of [
    ["face photo", customerPhotos[0].face],
    ["full-body photo", customerPhotos[0].body],
  ]) {
    const chooserOpened = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: `Add ${label}` }).click();
    const chooser = await chooserOpened;
    await chooser.setFiles(path.resolve(file));
    await expect(page.getByAltText(`Customer ${label}`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Remove face photo" }).click();
  await expect(page.getByAltText("Customer face photo")).toHaveCount(0);
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page
    .getByRole("button", { name: "Start new session", exact: true })
    .click();
  await expect(page.getByAltText("Customer full-body photo")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    }),
  ).not.toBeChecked();
});

test("invalid input blocks continuation and dialogs work on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("spinbutton", { name: "Height in centimeters" })
    .fill("0");
  await expect(
    page.getByRole("button", { name: "Continue to match" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Expand avatar preview" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
});

test("personalization is explicit, generates only on request, and approval resets after changes", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { personalizationAvailable: true, personalizationContract: "customer-avatar-v3" } }),
  );
  await page.route("**/api/personalize", async (route) => {
    calls++;
    expect(route.request().postDataJSON().consent).toBe(true);
    const input = route.request().postDataJSON();
    expect(input.body).toMatch(/^data:image\/jpeg;base64,/);
    expect(input.face).toMatch(/^data:image\/jpeg;base64,/);
    expect(input.consentScope).toBe("face-and-body");
    expect(input.consentProvider).toBe("openai");
    expect(input.measurements).toEqual({ heightCm: 175, weightKg: 72 });
    const fs = await import("node:fs/promises");
    const image = await fs.readFile("public/avatar-library.png");
    await route.fulfill({
      json: { image: `data:image/png;base64,${image.toString("base64")}`, kind: "customer-avatar", profileId: input.profileId },
    });
  });
  await page.goto("/");
  await page
    .getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    })
    .check();
  for (const label of ["Upload face photo", "Upload full-body photo"]) {
    await page
      .getByLabel(label)
      .setInputFiles(path.resolve(label === "Upload face photo" ? customerPhotos[1].face : customerPhotos[1].body));
  }
  await expect(page.getByAltText("Customer full-body photo")).toBeVisible();
  await page.getByRole("button", { name: "Continue to match" }).click();
  expect(calls).toBe(0);
  await page
    .getByRole("checkbox", {
      name: /The customer agrees to send their face photo/,
    })
    .check();
  await page
    .getByRole("button", { name: "Generate customer avatar", exact: true })
    .click();
  await expect(
    page.getByAltText("Customer’s personalized avatar, awaiting visual review"),
  ).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Review avatar" }).click();
  await page
    .getByRole("checkbox", { name: "The customer approves the face, body and skin tone of this avatar." })
    .check();
  await page.getByRole("button", { name: /Select Slim profile/ }).click();
  await expect(
    page.getByText("Sample face · no customer face applied"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download avatar" }),
  ).toBeDisabled();
  expect(calls).toBe(1);
});
