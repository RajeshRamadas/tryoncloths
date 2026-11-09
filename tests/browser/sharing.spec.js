import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountStore } from "../helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../../server/app.js";

async function setup(page, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-sharing-browser-")),
    store = new AccountStore(directory);
  const owner = await store.register({
    name: "Sample Clothing",
    email: "sharing@example.test",
    password: "test-password-long",
  });
  const customer = store.customers.save(owner, {
    name: "Private Customer",
    phoneE164: "9876543210",
  });
  const image = `data:image/png;base64,${(await standardAvatar("regular")).toString("base64")}`;
  const av = await store.save(owner, {
    image,
    customerId: customer.id,
    name: "Saved customer",
    profileId: "regular",
    heightCm: 175,
    weightKg: 72,
    source: "imported",
  });
  const look = await store.saveLook(owner, {
    image,
    avatarId: av.id,
    name: "Blue outfit",
    garments: ["Blue shirt", "Jeans"],
  });
  let calls = 0;
  const server = createApp({
    accountStore: store,
    accessMode: "public",
    publicUrl: `http://127.0.0.1:${process.env.TEST_WEB_PORT || 5174}`,
    personalize: async () => {
      calls++;
      throw new Error("Unexpected generation");
    },
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const api = `http://127.0.0.1:${server.address().port}`;
  const routeHandler = async (r) => {
    const u = new URL(r.request().url());
    const response = await r.fetch({
      url: api + u.pathname + u.search,
      headers: { ...r.request().headers(), host: new URL(api).host, origin: api },
    });
    await r.fulfill({ response });
  };
  await page.context().route("**/api/**", routeHandler);
  await page.context().route("**/s/**", routeHandler);
  try {
    await page.goto("/");
    await page.getByLabel("Account email").fill("sharing@example.test");
    await page.getByLabel("Account password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await run({ store, owner, look, av, calls: () => calls });
  } finally {
    await page.context().unroute("**/api/**", routeHandler);
    await page.context().unroute("**/s/**", routeHandler);
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
async function library(page) {
  await page.getByRole("button", { name: "Saved avatars", exact: true }).click();
  await page
    .getByRole("button", { name: "View looks (1) for Saved customer", exact: true })
    .click();
}
const consent = "The customer agrees to make this outfit available through a share link.";

test("mobile saved outfit creates WhatsApp link, renders public preview, and revokes it after reopening the library", async ({
  page,
}) =>
  setup(page, async ({ store, owner, calls }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await library(page);
    await page.getByRole("button", { name: "Share Blue outfit", exact: true }).click();
    const panel = page.getByRole("region", { name: "Share saved outfit" });
    await expect(
      panel.getByRole("button", { name: "Create outfit link", exact: true }),
    ).toBeDisabled();
    await panel.getByLabel(consent).check();
    await panel.getByRole("button", { name: "Create outfit link", exact: true }).click();
    const input = panel.getByLabel("Outfit share link");
    await expect(input).toBeVisible();
    const url = await input.inputValue();
    const whatsapp = new URL(
      await panel
        .getByRole("link", { name: "Share on WhatsApp", exact: true })
        .getAttribute("href"),
    );
    expect(whatsapp.hostname).toBe("wa.me");
    expect(whatsapp.pathname).toBe("/919876543210");
    expect(whatsapp.searchParams.get("text")).toContain(url);
    await page.screenshot({ path: "test-results/share-controls-mobile.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const publicPage = await page.context().newPage();
    await publicPage.setViewportSize({ width: 390, height: 844 });
    try {
      await publicPage.goto(url);
      await expect(
        publicPage.getByRole("heading", { name: "Sample Clothing", exact: true }),
      ).toBeVisible();
      await expect(publicPage.getByAltText("Shared outfit preview")).toBeVisible();
      expect(
        await publicPage.getByAltText("Shared outfit preview").evaluate((img) => img.naturalWidth),
      ).toBeGreaterThan(0);
      await expect(publicPage.getByText("Blue shirt", { exact: true })).toBeVisible();
      await expect(publicPage.getByText("Private Customer", { exact: true })).toHaveCount(0);
      expect(
        await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await publicPage.screenshot({
        path: "test-results/public-outfit-mobile.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Close saved avatars", exact: true }).click();
      await library(page);
      await page.getByRole("button", { name: "Share Blue outfit", exact: true }).click();
      await panel.getByText("Manage outfit links (1)", { exact: true }).click();
      await expect(panel.getByText(/1 views/)).toBeVisible();
      await panel.getByRole("button", { name: /Revoke link/ }).click();
      await expect(
        panel.getByText("Link revoked. It can no longer open the outfit."),
      ).toBeVisible();
      const response = await publicPage.reload();
      expect(response.status()).toBe(410);
      await expect(
        publicPage.getByRole("heading", { name: "This outfit link is no longer available." }),
      ).toBeVisible();
      expect(store.sharing.list(owner, store.listLooks(owner)[0].id)[0].revokedAt).toBeTruthy();
      expect(calls()).toBe(0);
    } finally {
      await publicPage.close();
    }
  }));

test("saving a reviewed outfit enables sharing and changing clothes clears the share controls for the old look", async ({
  page,
}) =>
  setup(page, async () => {
    await page.getByRole("button", { name: "Saved avatars", exact: true }).click();
    await page.getByRole("button", { name: "Use Saved customer", exact: true }).click();
    await page
      .getByLabel("The customer approves the face, body and skin tone of this avatar.")
      .check();
    await page.getByRole("button", { name: "Try clothes", exact: true }).click();
    await page.getByRole("button", { name: "Navy T-shirt Sample" }).click();
    await expect(page.getByAltText("Avatar wearing the selected outfit")).toBeVisible();
    await page
      .getByLabel("I have checked clothing placement and approve this outfit preview.")
      .check();
    await page.getByLabel("The customer agrees to save this outfit to the store account.").check();
    await page.getByRole("button", { name: "Save look to account", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Share this outfit", exact: true }),
    ).toBeVisible();
    await page.getByLabel(consent).check();
    await page.getByRole("button", { name: "Create outfit link", exact: true }).click();
    await expect(page.getByLabel("Outfit share link")).toBeVisible();
    await page.getByRole("button", { name: "Original top", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Share this outfit", exact: true })).toHaveCount(
      0,
    );
  }));

test("unassigned outfit offers native sharing without a customer mobile number", async ({ page }) =>
  setup(page, async ({ store, owner, av }) => {
    store.db
      .prepare("UPDATE avatars SET customer=NULL WHERE account=? AND id=?")
      .run(owner.id, av.id);
    await page.evaluate(() => {
      navigator.share = async (value) => {
        window.sharedOutfit = value;
      };
    });
    await library(page);
    await page.getByRole("button", { name: "Share Blue outfit", exact: true }).click();
    const panel = page.getByRole("region", { name: "Share saved outfit" });
    await panel.getByLabel(consent).check();
    await panel.getByRole("button", { name: "Create outfit link", exact: true }).click();
    await expect(panel.getByLabel("Outfit share link")).toBeVisible();
    await expect(panel.getByRole("link", { name: "Share on WhatsApp", exact: true })).toHaveCount(
      0,
    );
    await panel.getByRole("button", { name: "Share using another app", exact: true }).click();
    expect((await page.evaluate(() => window.sharedOutfit)).url).toBe(
      await panel.getByLabel("Outfit share link").inputValue(),
    );
  }));
