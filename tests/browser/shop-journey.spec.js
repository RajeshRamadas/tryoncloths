import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountStore } from "../helpers/pilot-accounts.js";
import { openStoreTools } from "../helpers/studio-navigation.js";
import { createApp } from "../../server/app.js";

test("a brand can save, preview and publish on mobile before a customer requests a specific try-on", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-shop-journey-"));
  const store = new AccountStore(directory);
  const owner = await store.register({
    name: "Copper Finch",
    email: "shop-journey@example.test",
    password: "test-password-long",
  });
  await store.branding.update(owner, { primaryColor: "#793747" });
  const product = await readFile(new URL("../../public/garments/blue-shirt.webp", import.meta.url));
  await store.garments.save(owner, {
    image: "data:image/webp;base64," + product.toString("base64"),
    name: "Oxford shirt",
    garmentType: "shirt",
    variant: "Blue",
  });
  const app = createApp({ accountStore: store, accessMode: "public", jewelleryEnabled: true });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const api = new URL(`http://127.0.0.1:${server.address().port}`);
  const proxy = async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: new URL(url.pathname + url.search, api).href,
      headers: { ...route.request().headers(), host: api.host, origin: api.origin },
    });
    await route.fulfill({ response });
  };
  const visitor = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const context = page.context();
  await context.route("**/api/**", proxy);
  await context.route("**/shop/**", proxy);
  await visitor.route("**/shop/**", proxy);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByLabel("Account email").fill("shop-journey@example.test");
    await page.getByLabel("Account password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Products", exact: true })).toHaveAttribute(
      "href",
      "/catalogue",
    );
    await expect(page.getByRole("link", { name: "Shop setup", exact: true })).toHaveAttribute(
      "href",
      "/shop-page",
    );
    await openStoreTools(page);
    await page.getByRole("link", { name: "Shop page", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your shop is a draft" })).toBeVisible();
    await expect(page.getByText("1 product ready to show.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Jewellery catalogue" })).toHaveAttribute(
      "href",
      "/jewellery-catalogue",
    );

    await page.getByRole("link", { name: "Edit shop details" }).click();
    await expect(page).toHaveURL(/#shop-settings$/);
    await page.getByLabel("Tagline").fill("Everyday pieces, made to be worn");
    await page
      .getByLabel("Instagram profile link")
      .fill("https://instagram.com/copperfinch.example");
    await page.getByRole("link", { name: "Set WhatsApp number" }).click();
    await page.getByLabel("WhatsApp number for try-on requests").fill("+91 98765 43210");
    await page.getByLabel("Photo", { exact: true }).setInputFiles({
      name: "lookbook.webp",
      mimeType: "image/webp",
      buffer: product,
    });
    await page.getByRole("button", { name: "Add photo", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Photo added to the shop page.");
    await expect(page.getByLabel("Tagline")).toHaveValue("Everyday pieces, made to be worn");
    await expect(page.getByLabel("WhatsApp number for try-on requests")).toHaveValue(
      "+91 98765 43210",
    );

    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved. You can preview it now.");
    const link = page.getByRole("link", { name: "Preview saved draft" });
    const shop = await link.getAttribute("href");
    const pendingPreview = page.waitForEvent("popup");
    await link.click();
    const preview = await pendingPreview;
    await expect(preview.getByRole("status")).toContainText("Private preview");
    await expect(preview.getByText("Everyday pieces, made to be worn")).toBeVisible();
    await preview.close();

    const customer = await visitor.newPage();
    expect((await customer.goto(shop)).status()).toBe(404);
    await page.getByRole("button", { name: "Publish shop", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your shop is live" })).toBeVisible();
    await page.getByRole("button", { name: "Copy shop link", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Shop link copied.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shop);
    expect((await customer.goto(shop)).status()).toBe(200);
    const cover = customer.getByRole("img", { name: "Copper Finch shop photo" });
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(customer.getByRole("link", { name: "Instagram" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/copperfinch.example/",
    );
    await customer.getByRole("link", { name: "Browse collection" }).click();
    await expect(customer).toHaveURL(/#collection$/);
    const tryOn = customer.getByRole("link", { name: "Try on via WhatsApp — Oxford shirt — Blue" });
    await expect(tryOn).toBeVisible();
    const destination = new URL(await tryOn.getAttribute("href"));
    expect(destination.origin + destination.pathname).toBe("https://wa.me/919876543210");
    expect(destination.searchParams.get("text")).toContain(
      'virtual try-on for "Oxford shirt — Blue"',
    );
    expect(await customer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.getByRole("button", { name: "Unpublish shop", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your shop is a draft" })).toBeVisible();
    expect((await customer.goto(shop)).status()).toBe(404);
  } finally {
    await visitor.close();
    await context.unrouteAll({ behavior: "wait" });
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
