import { test, expect } from "@playwright/test";
import { workflowFixture } from "../helpers/shopper-workflow.js";
import { publicStudio } from "../helpers/shopify-shopper.js";
import { customerPhotos } from "../helpers/customer-photos.js";
import sharp from "sharp";
import { readFile } from "node:fs/promises";

test.setTimeout(60000);
async function setup(page, run, options = {}) {
  const f = await workflowFixture({ secondProduct: true, ...options });
  let closing = false;
  const proxy = async (route) => {
    try {
      const u = new URL(route.request().url()),
        response = await route.fetch({
          url: f.base + u.pathname + u.search,
          headers: {
            ...route.request().headers(),
            host: new URL(f.base).host,
            origin: publicStudio,
          },
          timeout: 150000,
        });
      await route.fulfill({ response });
    } catch (e) {
      if (!closing && page.url() !== "about:blank" && !page.isClosed()) throw e;
    }
  };
  await page.route("**/shopper", proxy);
  await page.route("**/shopper-api/**", proxy);
  try {
    await page.goto("/shopper" + f.launch().hash);
    await run(f);
  } finally {
    closing = true;
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
}
async function verify(page, tryon = false) {
  await page.getByRole("checkbox", { name: "I am 18 or older.", exact: true }).check();
  await page.getByRole("checkbox", { name: "These are my own photos", exact: false }).check();
  await page
    .getByRole("checkbox", {
      name: tryon ? "I request a separate AI clothing preview" : "I request an AI avatar",
      exact: false,
    })
    .check();
  await page
    .getByRole("button", {
      name: tryon ? "Verify this try-on" : "Verify and continue to photos",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Verified.");
}
async function photos(page) {
  await page.locator("#face-file").setInputFiles(customerPhotos[1].face);
  await page.locator("#body-file").setInputFiles(customerPhotos[1].body);
  await expect(page.getByRole("button", { name: "Generate my avatar", exact: true })).toBeEnabled();
}
async function avatar(page) {
  await verify(page);
  await photos(page);
  await page.getByRole("button", { name: "Generate my avatar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Does this look like you?", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "I checked my face, complexion and proportions.", exact: true })
    .check();
  await page.getByRole("button", { name: "Approve avatar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verify this try-on", exact: true })).toBeVisible();
}

test("mobile shopper verifies before upload, uses independent photos, approves once, tries two store products and downloads a reviewed labelled PNG", async ({
  page,
}) =>
  setup(page, async (f) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "River Clothing", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Verify and continue to photos", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    expect(f.calls.avatar.length).toBe(0);
    await verify(page);
    await expect(page.locator("#face-file")).not.toHaveAttribute("capture", /.*/);
    await expect(page.locator("#face-camera")).toHaveAttribute("capture", "user");
    await expect(page.locator("#body-camera")).toHaveAttribute("capture", "environment");
    await photos(page);
    expect(f.calls.avatar.length).toBe(0);
    await page.getByLabel("Height (cm)", { exact: true }).fill("178");
    await page.getByLabel("Weight (kg)", { exact: true }).fill("96");
    await expect(page.getByRole("combobox", { name: "Body profile", exact: true })).toHaveValue(
      "broad",
    );
    await page
      .getByRole("combobox", { name: "Template complexion", exact: true })
      .selectOption("deep");
    await page.getByRole("button", { name: "Generate my avatar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve avatar", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download reviewed avatar", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("#face-preview")).not.toHaveAttribute("src", /.*/);
    expect(f.calls.avatar.length).toBe(1);
    expect(f.calls.avatar[0].profileId).toBe("broad");
    expect(f.calls.avatar[0].templateTone).toBe("deep");
    expect(f.calls.avatar[0].face.equals(f.calls.avatar[0].body)).toBe(false);
    await page
      .getByRole("checkbox", {
        name: "I checked my face, complexion and proportions.",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "Approve avatar", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Verify this try-on", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "I am 18 or older.", exact: true }),
    ).not.toBeChecked();
    await verify(page, true);
    await page.getByRole("button", { name: "Try this product", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Review your look", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download reviewed outfit", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("checkbox", { name: "I reviewed this clothing preview.", exact: true })
      .check();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download reviewed outfit", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("forme-outfit-preview.png");
    const image = await sharp(await readFile(await file.path())).metadata(),
      original = await sharp(f.calls.tryon[0].avatar).metadata();
    expect(image.height).toBeGreaterThan(original.height);
    expect(image.width).toBe(original.width);
    await page.screenshot({ path: "test-results/shopper-workflow-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .getByRole("combobox", { name: "Store product", exact: true })
      .selectOption({ label: "White T-shirt (shirt)" });
    await expect(page.getByRole("heading", { name: "White T-shirt", exact: true })).toBeVisible();
    await expect(page.locator("#outfit-result")).not.toHaveAttribute("src", /.*/);
    await verify(page, true);
    await page.getByRole("button", { name: "Try this product", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Review your look", exact: true }),
    ).toBeVisible();
    expect(f.calls.avatar.length).toBe(1);
    expect(f.calls.tryon.length).toBe(2);
    expect(f.calls.tryon[1].title).toBe("White T-shirt");
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(f.store.db.prepare("SELECT count(*) n FROM avatars").get().n).toBe(0);
    expect(f.store.db.prepare("SELECT count(*) n FROM looks").get().n).toBe(0);
    await page.getByRole("button", { name: "End shopper session", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("session ended");
    await expect(page.locator("#avatar-result")).not.toHaveAttribute("src", /.*/);
    await expect(page.locator("#outfit-result")).not.toHaveAttribute("src", /.*/);
  }));

test("missing safety or reviewed disclosure hides photo inputs and never offers a token/code bypass", async ({
  page,
}) =>
  setup(
    page,
    async (f) => {
      await expect(page.getByRole("status")).toContainText("generation is unavailable");
      await expect(page.locator("input[type=file]")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Verify and continue to photos", exact: true }),
      ).toBeHidden();
      expect(f.calls.avatar.length).toBe(0);
      expect(f.calls.verification.length).toBe(0);
    },
    { workflowOptions: { disclosure: null } },
  ));

test("provider failure requires fresh unchecked consent and verification; a deliberate retry gets a new request and no automatic image call", async ({
  page,
}) =>
  setup(page, async (f) => {
    await verify(page);
    await photos(page);
    f.setGenerationMode("quota");
    await page.getByRole("button", { name: "Generate my avatar", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("quota or rate limit");
    expect(f.calls.avatar.length).toBe(1);
    expect(f.store.billing.balance(f.a.org)).toBe(1000);
    await expect(
      page.getByRole("checkbox", { name: "I am 18 or older.", exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Verify and continue to photos", exact: true }),
    ).toBeDisabled();
    f.setGenerationMode("");
    await verify(page);
    await page.getByRole("button", { name: "Generate my avatar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve avatar", exact: true })).toBeVisible();
    expect(f.calls.avatar.length).toBe(2);
    expect(f.calls.verification.length).toBe(2);
    expect(f.store.shoppers.view(f.a).store.dispatched).toBe(2);
  }));

test("photo validation preserves the last good preview, supports camera selection and never sends photo data until generation", async ({
  page,
}) =>
  setup(page, async (f) => {
    await verify(page);
    await page.locator("#face-camera").setInputFiles(customerPhotos[2].face);
    await expect(page.locator("#face-preview")).toHaveAttribute("src", /^blob:/);
    const before = await page.locator("#face-preview").getAttribute("src");
    await page
      .locator("#face-file")
      .setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(page.getByRole("status")).toContainText("JPEG, PNG or WebP");
    await expect(page.locator("#face-preview")).toHaveAttribute("src", before);
    expect(f.calls.avatar.length).toBe(0);
    await page.getByRole("button", { name: "Remove face photo", exact: true }).click();
    await expect(page.locator("#face-preview")).not.toHaveAttribute("src", /.*/);
    await expect(
      page.getByRole("button", { name: "Generate my avatar", exact: true }),
    ).toBeDisabled();
  }));

test("refresh clears customer images and never regenerates a lost avatar", async ({ page }) =>
  setup(page, async (f) => {
    await avatar(page);
    expect(f.calls.avatar.length).toBe(1);
    await page.reload();
    await expect(page.getByRole("status")).toContainText(/ended|expired|no longer in this tab/);
    await expect(page.locator("#avatar-result")).not.toHaveAttribute("src", /.*/);
    expect(f.calls.avatar.length).toBe(1);
  }));

test("expiry clears normalized photos on resume before any paid request", async ({ page }) =>
  setup(page, async (f) => {
    await verify(page);
    await photos(page);
    await expect(page.locator("#face-preview")).toHaveAttribute("src", /^blob:/);
    f.advance(31 * 60000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("status")).toContainText("expired");
    await expect(page.locator("#face-preview")).not.toHaveAttribute("src", /.*/);
    await expect(page.locator("#body-preview")).not.toHaveAttribute("src", /.*/);
    expect(f.calls.avatar.length).toBe(0);
  }));

test("an owner pause clears an approved avatar on resume and cannot trigger a try-on", async ({
  page,
}) =>
  setup(page, async (f) => {
    await avatar(page);
    await expect(page.locator("#avatar-result")).toHaveAttribute("src", /^blob:/);
    f.store.shoppers.update(f.a, { action: "pause" });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("status")).toContainText("no longer available");
    await expect(page.locator("#avatar-result")).not.toHaveAttribute("src", /.*/);
    expect(f.calls.tryon.length).toBe(0);
  }));

test("ending while generation is running aborts the provider and a late response cannot put the image back", async ({
  page,
}) =>
  setup(page, async (f) => {
    let release;
    f.holdGeneration(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    try {
      await verify(page);
      await photos(page);
      await page.getByRole("button", { name: "Generate my avatar", exact: true }).click();
      await expect.poll(() => f.calls.avatar.length).toBe(1);
      await page.getByRole("button", { name: "End shopper session", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("session ended");
      await expect.poll(() => f.calls.avatar[0].signal.aborted).toBe(true);
      release();
      await expect(page.locator("#avatar-result")).not.toHaveAttribute("src", /.*/);
      expect(f.store.billing.balance(f.a.org)).toBe(1000);
    } finally {
      release();
    }
  }));
