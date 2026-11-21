import { test, expect } from "@playwright/test";
import path from "node:path";
import sharp from "sharp";
import { customerPhotos } from "../helpers/customer-photos.js";

test("face photo framing reacts to retakes without uploading the photos", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const studioOrigin = new URL(baseURL).origin;
  const outsideRequests = [];
  const modelRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (request.method() !== "GET" || url.origin !== studioOrigin)
      outsideRequests.push(url.pathname);
    if (url.pathname.endsWith("/models/blaze_face_short_range.tflite"))
      modelRequests.push(url.pathname);
  });

  await page.goto("/");
  await page.getByLabel("The customer agrees to use their photos for this avatar session.").check();
  expect(modelRequests).toHaveLength(0);
  const input = page.getByLabel("Upload face photo");
  const framing = page.getByRole("status", { name: "Face photo framing check" });
  const face = path.resolve(customerPhotos[0].face);
  const upload = async (name, image) =>
    input.setInputFiles({ name, mimeType: "image/jpeg", buffer: await image.jpeg().toBuffer() });

  await upload(
    "no-face.jpg",
    sharp({ create: { width: 440, height: 230, channels: 3, background: "#b7a38c" } }),
  );
  await expect(framing).toContainText("No face was detected", { timeout: 20_000 });

  const twoFaces = await Promise.all(
    customerPhotos.slice(0, 2).map(({ face }) => sharp(path.resolve(face)).jpeg().toBuffer()),
  );
  await upload(
    "two-faces.jpg",
    sharp({ create: { width: 440, height: 230, channels: 3, background: "#b7a38c" } }).composite([
      { input: twoFaces[0], top: 0, left: 0 },
      { input: twoFaces[1], top: 0, left: 220 },
    ]),
  );
  await expect(framing).toContainText("More than one face was detected");

  await upload(
    "distant-face.jpg",
    sharp(face).extend({ top: 200, bottom: 200, left: 200, right: 200, background: "#b7a38c" }),
  );
  await expect(framing).toContainText("The face looks small in the photo");

  await upload("edge-face.jpg", sharp(face).extract({ left: 56, top: 0, width: 164, height: 230 }));
  await expect(framing).toContainText("The face is close to an edge");

  await input.setInputFiles(face);
  await expect(framing).toContainText("One face detected with space around it");
  await page.getByRole("button", { name: "Remove face photo" }).click();
  await expect(framing).toHaveCount(0);
  expect(modelRequests).toHaveLength(1);
  expect(outsideRequests).toEqual([]);
});

test("face photo framing reports unavailable locally and can retry on a replacement", async ({
  page,
}) => {
  await page.route("**/models/blaze_face_short_range.tflite", (route) => route.abort(), {
    times: 1,
  });
  await page.goto("/");
  await page.getByLabel("The customer agrees to use their photos for this avatar session.").check();
  const input = page.getByLabel("Upload face photo");
  const framing = page.getByRole("status", { name: "Face photo framing check" });
  await input.setInputFiles(path.resolve(customerPhotos[0].face));
  await expect(framing).toContainText("Face framing couldn’t be checked", { timeout: 20_000 });
  await input.setInputFiles(path.resolve(customerPhotos[1].face));
  await expect(framing).toContainText("One face detected with space around it", {
    timeout: 20_000,
  });
});

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
  await page.getByLabel("Upload face photo").setInputFiles(path.resolve(customerPhotos[0].face));
  await expect(page.getByRole("status", { name: "Face photo clarity check" })).not.toContainText(
    "not usable for generation",
  );
});
