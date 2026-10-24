import { test, expect } from "@playwright/test";
import { once } from "node:events";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../../server/app.js";
import { customerPhotos } from "../helpers/customer-photos.js";

test("browser connects to a protected studio before generating from both dummy photos", async ({ page, baseURL }) => {
  const token = "test-browser-store-code-not-a-secret";
  const studio = "https://studio.example.test";
  const calls = [];
  const statuses = [];
  // Exercise the real API/auth/image validation. Only the paid AI provider is stubbed.
  const result = await sharp(customerPhotos[1].body).png().toBuffer();
  const server = createApp({
    apiKey: "test-only",
    mobileToken: token,
    personalize: async (input) => {
      calls.push(input);
      return `data:image/png;base64,${result.toString("base64")}`;
    },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const backend = `http://127.0.0.1:${server.address().port}`;
  try {
    // Model an HTTPS reverse proxy locally without contacting a public server.
    await page.route(`${studio}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const api = url.pathname.startsWith("/api/");
      const response = await route.fetch({
        url: `${api ? backend : baseURL}${url.pathname}${url.search}`,
        headers: { ...request.headers(), host: api ? url.host : new URL(baseURL).host },
      });
      if (api && url.pathname === "/api/health") statuses.push(response.status());
      await route.fulfill({ response });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(studio);
    await page.getByRole("checkbox", { name: "The customer agrees to use their photos for this avatar session." }).check();
    await page.getByRole("spinbutton", { name: "Height in centimeters" }).fill("165");
    for (const [label, file] of [["face photo", customerPhotos[1].face], ["full-body photo", customerPhotos[1].body]]) {
      const picker = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: `Add ${label}` }).click();
      await (await picker).setFiles(path.resolve(file));
      await expect(page.getByAltText(`Customer ${label}`)).toBeVisible();
    }
    await page.getByRole("button", { name: "Continue to match" }).click();
    await expect(page.getByText("Studio connection required", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate customer avatar", exact: true })).toBeDisabled();
    expect(statuses).toContain(401);
    expect(calls).toHaveLength(0);

    await page.getByRole("button", { name: "Studio connection", exact: true }).click();
    await expect(page.getByLabel("Studio address")).toHaveValue(studio);
    await page.getByLabel("Store access code").fill("incorrect-store-code-at-least-24-chars");
    await page.getByRole("button", { name: "Connect studio", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("The store access code was not accepted.");
    await page.getByLabel("Store access code").fill(token);
    await page.getByRole("button", { name: "Connect studio", exact: true }).click();
    await expect(page.getByText("Customer avatar generation available", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: /The customer agrees to send their face photo/ }).check();
    await page.getByRole("button", { name: "Generate customer avatar", exact: true }).click();
    await expect(page.getByAltText("Customer’s personalized avatar, awaiting visual review")).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0].measurements).toEqual({ heightCm: 165, weightKg: 72 });
    expect(calls[0].face.length).toBeGreaterThan(1000);
    expect(calls[0].body.length).toBeGreaterThan(1000);
    expect(calls[0].avatar.length).toBeGreaterThan(1000);
    expect(statuses).toContain(200);
    await page.reload();
    await page.getByRole("button", { name: "Continue to match" }).click();
    await expect(page.getByText("Studio connection required", { exact: true })).toBeVisible();
    expect(calls).toHaveLength(1);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
