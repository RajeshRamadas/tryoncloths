import { approvePersonalizedAvatar } from "../helpers/avatar-quality-review.js";
import { test, expect } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { AccountStore } from "../helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../../server/app.js";
import { saveOverlayAsset } from "../../server/jewellery-overlay.js";
import { customerPhotos } from "../helpers/customer-photos.js";

const face = await readFile(customerPhotos[0].face);
const portrait = await sharp({
  create: { width: 1152, height: 1536, channels: 3, background: "#d3d1cc" },
})
  .composite([
    {
      input: await sharp(face)
        .extract({ left: 20, top: 0, width: 160, height: 210 })
        .resize(1020, 1339)
        .png()
        .toBuffer(),
      left: 66,
      top: 80,
    },
  ])
  .png()
  .toBuffer();

/** Sign in, generate and save a customer avatar to the store account. */
async function saveAvatar(page, { portraitWithAvatar }, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-portrait-default-")),
    store = new AccountStore(directory),
    owner = await store.register({
      email: "portrait@example.test",
      name: "Portrait store",
      password: "test-password-long",
    });
  if (portraitWithAvatar)
    await store.branding.update(owner, { displayName: "Portrait store", portraitWithAvatar });
  const faces = [];
  const app = createApp({
    accountStore: store,
    accessMode: "public",
    apiKey: "test",
    provider: "gemini",
    jewelleryEnabled: true,
    rateLimit: false,
    avatarViewOptions: {
      faceCheck: async () => {},
      portrait: async (input) => {
        faces.push(input);
        return "data:image/png;base64," + portrait.toString("base64");
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    try {
      const response = await route.fetch({
        url: base + u.pathname + u.search,
        headers: { ...route.request().headers(), host: new URL(base).host, origin: base },
      });
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  const png = await standardAvatar("regular");
  await page.route("**/api/personalize", (route) =>
    route.fulfill({
      json: {
        image: `data:image/png;base64,${png.toString("base64")}`,
        kind: "customer-avatar",
        provider: "gemini",
        profileId: "regular",
      },
    }),
  );
  try {
    await page.goto("/");
    await page.getByLabel("Account email").fill("portrait@example.test");
    await page.getByLabel("Account password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "New customer", exact: true }).click();
    await page.getByLabel("Customer name", { exact: true }).fill("Priya N");
    await page.getByLabel("Saved mobile number").fill("9876543210");
    await page.getByRole("button", { name: "Save customer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit customer", exact: true })).toBeVisible();
    await page
      .getByLabel("The customer agrees to use their photos for this avatar session.")
      .check();
    await page.getByLabel("Upload face photo").setInputFiles(customerPhotos[0].face);
    await page.getByLabel("Upload full-body photo").setInputFiles(customerPhotos[0].body);
    await page.getByRole("button", { name: "Continue to match" }).click();
    await page
      .getByRole("checkbox", { name: /The customer agrees to send their face photo/ })
      .check();
    await page.getByRole("button", { name: "Generate customer avatar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ready for review" })).toBeVisible();
    await approvePersonalizedAvatar(page);
    await page.getByLabel("Avatar name", { exact: true }).fill("Customer P");
    await page
      .getByLabel(
        "The customer agrees to save this avatar and measurements to the store account for reuse.",
      )
      .check();
    await page.getByRole("button", { name: "Save avatar for reuse", exact: true }).click();
    await expect(page.getByText(/Avatar saved to your store account/)).toBeVisible({
      timeout: 15_000,
    });
    await run({ store, owner, faces });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("with the store setting on, the portrait step opens after saving and reuses the session face photo", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await saveAvatar(page, { portraitWithAvatar: true }, async ({ store, owner, faces }) => {
    const panel = page.getByRole("region", { name: "Jewellery portrait for this avatar" });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("Using the face photo from this avatar session");
    const generate = panel.getByRole("button", { name: "Generate portrait — 1 AI credit" });
    // Nothing is sent until staff confirm the avatar and the customer's consent.
    await expect(generate).toBeDisabled();
    const before = store.billing.balance(owner.org);
    await panel
      .getByLabel("The customer confirms this saved full-body avatar is correct and approved.")
      .check();
    await panel.getByLabel(/send this fresh face photo and saved avatar to Google Gemini/).check();
    await generate.click();
    await panel
      .getByLabel(
        "The customer reviewed the face, complexion, hair, proportions and complete head framing.",
      )
      .check();
    await panel
      .getByLabel(
        "The customer agrees to save this approved view with this avatar in the store account.",
      )
      .check();
    await panel.getByRole("button", { name: "Approve and save view", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByText(/Portrait saved with this avatar/)).toBeVisible();
    expect(faces).toHaveLength(1);
    expect(before - store.billing.balance(owner.org)).toBe(1);
  });
});

test("with the store setting off, staff can still start the portrait from the saved avatar", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await saveAvatar(page, { portraitWithAvatar: false }, async ({ faces }) => {
    const panel = page.getByRole("region", { name: "Jewellery portrait for this avatar" });
    await expect(panel).toHaveCount(0);
    await page
      .getByRole("button", { name: "Create a jewellery portrait from this face photo" })
      .click();
    await expect(panel).toContainText("Using the face photo from this avatar session");
    await panel.getByRole("button", { name: "Not now" }).click();
    await expect(panel).toHaveCount(0);
    expect(faces).toHaveLength(0);
  });
});

test("a new avatar opens for review and can try shoes and two accessories from the same fitting", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await saveAvatar(page, { portraitWithAvatar: false }, async ({ store, owner, faces }) => {
    for (const [garmentType, name, anchor, radius] of [
      ["ring", "Gold ring", "finger", 55],
      ["bangles", "Gold bangles", "wrist", 85],
    ]) {
      const png = await sharp(
        Buffer.from(
          `<svg width="240" height="240"><circle cx="120" cy="120" r="${radius}" fill="none" stroke="#b58b41" stroke-width="17"/></svg>`,
        ),
      )
        .png()
        .toBuffer();
      const image = "data:image/png;base64," + png.toString("base64");
      const { garment } = await store.garments.save(
        owner,
        {
          category: "jewellery",
          garmentType,
          name,
          image,
          attributes: { metal: "yellow_gold" },
        },
        { jewelleryEnabled: true },
      );
      await saveOverlayAsset(store, owner, garment.id, {
        overlayPng: image,
        overlayAnchor: anchor,
      });
    }
    const balance = store.billing.balance(owner.org);
    const paid = [];
    page.on("request", (r) => {
      if (
        ["/api/personalize", "/api/tryon", "/api/jewellery/tryon"].includes(
          new URL(r.url()).pathname,
        )
      )
        paid.push(r.url());
    });
    await page.getByRole("button", { name: "Try shoes", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Try shoes.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Shoes", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const outfit = page.getByRole("img", { name: "Avatar wearing the selected outfit" });
    const startingImage = await outfit.getAttribute("src");
    await page.getByRole("button", { name: "White sneakers Sample" }).click();
    await expect(outfit).not.toHaveAttribute("src", startingImage);
    await expect(outfit).toBeVisible();
    await page.getByRole("button", { name: "Back to avatar", exact: true }).click();
    await page.getByRole("button", { name: "Jewellery", exact: true }).click();
    await expect(page.getByLabel("Saved customer avatar", { exact: true })).toHaveValue(
      store.list(owner)[0].id,
    );
    await page.getByRole("button", { name: "Browse pieces", exact: true }).click();
    const picker = page.getByRole("region", { name: "Choose jewellery", exact: true });
    await expect(picker).toBeFocused();
    await picker.getByLabel("Filter jewellery type", { exact: true }).selectOption("ring");
    await expect(picker.getByRole("button", { name: /^Gold bangles/ })).toHaveCount(0);
    await picker.getByRole("button", { name: /^Gold ring/ }).click();
    await expect(page.getByRole("button", { name: "Hands view", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Prepare sample hands — free", exact: true }).click();
    await page.getByRole("button", { name: "Preview sample hands — free", exact: true }).click();
    await page.getByLabel("The customer reviewed the sample hands, tone and proportions.").check();
    await page
      .getByLabel(
        "The customer agrees to save this approved view with this avatar in the store account.",
      )
      .check();
    await page.getByRole("button", { name: "Approve and save view", exact: true }).click();
    const review = page.getByLabel(
      "I have checked the customer, complexion, proportions and jewellery placement in this preview.",
    );
    await expect(page.getByRole("button", { name: "Overlay · free", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await review.check();
    await page.getByRole("button", { name: "Preview on avatar — free", exact: true }).click();
    await expect(page.getByText(/^Gold ring · ring/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Try another piece", exact: true }).click();
    await expect(picker).toBeFocused();
    await picker.getByLabel("Filter jewellery type", { exact: true }).selectOption("bangles");
    await picker.getByRole("button", { name: /^Gold bangles/ }).click();
    await review.check();
    await page.getByRole("button", { name: "Preview on avatar — free", exact: true }).click();
    await expect(page.getByText(/^Gold bangles · bangles/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^Gold ring · ring/)).toBeVisible();
    expect(paid).toHaveLength(0);
    expect(faces).toHaveLength(0);
    expect(store.billing.balance(owner.org)).toBe(balance);
  });
});
