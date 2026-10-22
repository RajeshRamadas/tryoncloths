import { test, expect } from "@playwright/test";
import { nativeBridge } from "../helpers/native-bridge.js";


test("Android offline workflow uses consented native camera and shares the selected PNG", async ({
  page,
}) => {
  await nativeBridge(page);
  const apiRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Add face photo" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    })
    .check();
  await page.getByRole("button", { name: "Add face photo" }).click();
  await expect(page.getByAltText("Customer face photo")).toBeVisible();
  const camera = await page.evaluate(() =>
    window.__nativeCalls.find((c) => c.plugin === "Camera"),
  );
  expect(camera.options.saveToGallery).toBe(false);
  expect(camera.options.resultType).toBe("dataUrl");
  await page.getByRole("button", { name: "Select Broad profile" }).click();
  await page.getByRole("button", { name: "Continue to match" }).click();
  await expect(
    page.getByText("Face personalization unavailable", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review avatar" }).click();
  const exportButton = page.getByRole("button", {
    name: "Save or share avatar",
  });
  await expect(exportButton).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I have reviewed this standard sample avatar.",
    })
    .check();
  await exportButton.click();
  await expect(page.getByRole("status")).toContainText("Share sheet closed");
  const nativeCalls = await page.evaluate(() => window.__nativeCalls);
  const file = nativeCalls.find((call) => call.method === "writeFile");
  expect(file.options.path).toContain("broad-sample-avatar.png");
  expect(file.options.directory).toBe("CACHE");
  expect(
    Buffer.from(file.options.data, "base64").subarray(0, 8).toString("hex"),
  ).toBe("89504e470d0a1a0a");
  expect(
    nativeCalls.find((call) => call.plugin === "Share").options.files,
  ).toEqual(["file:///cache/forme-exports/approved-avatar.png"]);
  const before = nativeCalls.filter((call) => call.method === "rmdir").length;
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page
    .getByRole("button", { name: "Start new session", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => window.__nativeCalls.filter((c) => c.method === "rmdir").length,
    ),
  ).toBeGreaterThan(before);
  await expect(page.getByAltText("Customer face photo")).toHaveCount(0);
  expect(apiRequests).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Android handles cancelled and denied photo capture without losing the session", async ({
  page,
}) => {
  await nativeBridge(page);
  await page.goto("/");
  await page
    .getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    })
    .check();
  await page.evaluate(() => {
    window.__nativeErrors.Camera = "User cancelled photos app";
  });
  await page.getByRole("button", { name: "Add face photo" }).click();
  await expect(
    page.getByRole("button", { name: "Add face photo" }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    window.__nativeErrors.Camera =
      "Camera access was denied. Choose a photo or enable camera access in Settings.";
  });
  await page.getByRole("button", { name: "Add face photo" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Camera access was denied",
  );
  await page.evaluate(() => {
    window.__nativeErrors.Camera = "";
  });
  await page.getByRole("button", { name: "Add face photo" }).click();
  await expect(page.getByAltText("Customer face photo")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Android studio connection uses runtime authorization and clears it on restart", async ({
  page,
}) => {
  await nativeBridge(page);
  const token = "test-store-token-only-not-a-real-secret";
  const headers = [];
  await page.route("https://studio.example.test/api/health", async (route) => {
    headers.push(route.request().headers().authorization);
    await route.fulfill({
      json: { status: "ok", personalizationAvailable: true },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Studio connection", exact: true })
    .click();
  await page.getByLabel("Studio address").fill("https://studio.example.test");
  await page.getByLabel("Store access code").fill(token);
  await page
    .getByRole("button", { name: "Connect studio", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Studio connection", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Continue to match" }).click();
  await expect(
    page.getByText("Face personalization available", { exact: true }),
  ).toBeVisible();
  expect(headers.length).toBeGreaterThan(0);
  expect(headers.every((value) => value === `Bearer ${token}`)).toBe(true);
  expect(
    await page.evaluate(() => JSON.stringify([localStorage, sessionStorage])),
  ).not.toContain(token);
  const before = headers.length;
  await page.reload();
  await page.getByRole("button", { name: "Continue to match" }).click();
  await expect(
    page.getByText("Face personalization unavailable", { exact: true }),
  ).toBeVisible();
  expect(headers.length).toBe(before);
});

test("Android share cancellation preserves the approved avatar", async ({
  page,
}) => {
  await nativeBridge(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue to match" }).click();
  await page.getByRole("button", { name: "Review avatar" }).click();
  await page
    .getByRole("checkbox", {
      name: "I have reviewed this standard sample avatar.",
    })
    .check();
  await page.evaluate(() => {
    window.__nativeErrors.Share = "Share canceled";
  });
  await page.getByRole("button", { name: "Save or share avatar" }).click();
  await expect(page.getByRole("status")).toContainText("Export cancelled");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", {
      name: "I have reviewed this standard sample avatar.",
    }),
  ).toBeChecked();
});
