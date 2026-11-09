import { test, expect } from "@playwright/test";
import path from "node:path";
import sharp from "sharp";
import { customerPhotos } from "../helpers/customer-photos.js";

const consent = (page) =>
  page
    .getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    })
    .check();

test("full-body photos are checked for pose and framing on the device", async ({ page }) => {
  test.setTimeout(90_000);
  const uploads = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") uploads.push(req.url());
  });
  await page.goto("/");
  await consent(page);
  const check = page.getByRole("status", { name: "Full-body photo check" });
  for (const customer of customerPhotos) {
    await page.getByLabel("Upload full-body photo").setInputFiles(path.resolve(customer.body));
    await expect(check).toContainText("Pose looks good", { timeout: 30_000 });
  }
  // The same photo cropped at the knees: the feet are missing.
  const cropped = await sharp(customerPhotos[0].body)
    .extract({ left: 0, top: 0, width: 496, height: 760 })
    .jpeg()
    .toBuffer();
  await page
    .getByLabel("Upload full-body photo")
    .setInputFiles({ name: "cropped.jpg", mimeType: "image/jpeg", buffer: cropped });
  await expect(check).toContainText("The feet may be cut off", { timeout: 30_000 });
  // Lying on its side reads as a tilted body.
  const rotated = await sharp(customerPhotos[1].body).rotate(90).jpeg().toBuffer();
  await page
    .getByLabel("Upload full-body photo")
    .setInputFiles({ name: "rotated.jpg", mimeType: "image/jpeg", buffer: rotated });
  await expect(check).toContainText("tilted", { timeout: 30_000 });
  await page.getByRole("button", { name: "Remove full-body photo" }).click();
  await expect(check).toHaveCount(0);
  expect(uploads).toEqual([]);
});
