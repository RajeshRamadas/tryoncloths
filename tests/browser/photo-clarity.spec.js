import { test, expect } from "@playwright/test";
import path from "node:path";
import sharp from "sharp";
import { customerPhotos } from "../helpers/customer-photos.js";

test("on-device photo preflight blocks unusably dark face before any provider request", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: {
        personalizationAvailable: true,
        personalizationContract: "customer-avatar-v4",
        provider: "gemini",
      },
    }),
  );
  await page.route("**/api/personalize", async (route) => {
    requests++;
    await route.fulfill({ status: 500, json: { error: "Must not reach provider" } });
  });
  await page.goto("/");
  await page
    .getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    })
    .check();
  const darkFace = await sharp({
    create: { width: 600, height: 720, channels: 3, background: "#000000" },
  })
    .jpeg()
    .toBuffer();
  await page.getByLabel("Upload face photo").setInputFiles({
    name: "unusable-dark-face.jpg",
    mimeType: "image/jpeg",
    buffer: darkFace,
  });
  await page
    .getByLabel("Upload full-body photo")
    .setInputFiles(path.resolve(customerPhotos[0].body));
  await expect(page.getByRole("status", { name: "Face photo clarity check" })).toContainText(
    "not usable for generation",
  );
  await expect(page.getByRole("status", { name: "Full-body photo clarity check" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to match" }).click();
  await page
    .getByRole("checkbox", { name: /The customer agrees to send their face photo/ })
    .check();
  await page.getByRole("button", { name: "Generate customer avatar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This photo is almost completely dark");
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page
    .getByLabel("Upload face photo")
    .setInputFiles(path.resolve(customerPhotos[0].face));
  await expect(page.getByRole("status", { name: "Face photo clarity check" })).not.toContainText(
    "not usable for generation",
  );
});
