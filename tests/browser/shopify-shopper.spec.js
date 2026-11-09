import { openStoreTools } from "../helpers/studio-navigation.js";
import { test, expect } from "@playwright/test";
import { shopifyFixture, publicStudio } from "../helpers/shopify-shopper.js";
import { fileURLToPath } from "node:url";

async function setup(page, run) {
  const f = await shopifyFixture();
  const proxy = async (route) => {
    const u = new URL(route.request().url()),
      publicRoute = u.pathname.startsWith("/shopper-api/");
    const response = await route.fetch({
      url: f.base + u.pathname + u.search,
      headers: {
        ...route.request().headers(),
        host: new URL(f.base).host,
        origin: publicRoute ? publicStudio : f.base,
      },
    });
    await route.fulfill({ response });
  };
  await page.route("**/api/**", proxy);
  await page.route("**/shopper", proxy);
  await page.route("**/shopper-api/**", proxy);
  const login = async () => {
    await page.goto("/");
    await page.getByLabel("Account email").fill("river@example.test");
    await page.getByLabel("Account password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  };
  try {
    await run({ ...f, login });
  } finally {
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
}

test("owner selects a synced Shopify product, enables setup preview and opens a branded single-use launch on mobile without photos or credits", async ({
  page,
}) =>
  setup(page, async (f) => {
    await f.install();
    await f.product();
    f.configure();
    await f.store.branding.update(f.a, { displayName: "River & Co", primaryColor: "#224466" });
    await f.login();
    await page.setViewportSize({ width: 390, height: 844 });
    await openStoreTools(page);
    await page.getByRole("link", { name: "Shopper spending", exact: true }).click();
    await page.getByRole("link", { name: "Shopify widget", exact: true }).click();
    await expect(page.getByText("sample.myshopify.com", { exact: true })).toBeVisible();
    await page.getByLabel("Allow Blue shirt", { exact: true }).check();
    await expect(page.getByRole("status")).toContainText("Product selection saved.");
    await page.getByRole("button", { name: "Enable setup preview", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Setup preview enabled.");
    await page.screenshot({ path: "test-results/shopify-owner-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const launch = new URL(f.service.launch(f.proxy()));
    await page.goto("/shopper" + launch.hash);
    await expect(page.getByRole("heading", { name: "River & Co", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Blue shirt", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "No photos were collected and no AI credits were used.",
    );
    await expect(
      page.getByRole("link", { name: "Return to product", exact: true }),
    ).toHaveAttribute("href", "https://clothing.example.test/products/shirt-123");
    await expect(page).toHaveURL(/\/shopper$/);
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    expect(f.ai()).toBe(0);
    expect(f.store.billing.balance(f.a.org)).toBe(1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: "test-results/shopify-launch-mobile.png", fullPage: true });
    await page.goto("about:blank");
    await page.goto("/shopper" + launch.hash);
    await expect(page.getByRole("status")).toContainText("already opened");
  }));

test("Shopify OAuth starts from the owner page with a browser-bound cookie and a fixed Shopify permission URL", async ({
  page,
}) =>
  setup(page, async (f) => {
    await page.route("https://sample.myshopify.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Mock Shopify permissions</title><h1>Shopify permissions</h1>",
      }),
    );
    await f.login();
    await page.goto("/shopify-shopper");
    await page.getByLabel("Shopify shop address", { exact: true }).fill("sample.myshopify.com");
    await page.getByRole("button", { name: "Connect Shopify app", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Shopify permissions", exact: true }),
    ).toBeVisible();
    const url = new URL(page.url());
    expect(url.origin).toBe("https://sample.myshopify.com");
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("read_products");
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(url.searchParams.get("redirect_uri")).toBe(publicStudio + "/shopify/callback");
    expect(f.calls.length).toBe(0);
  }));

test("manager connection views are read-only, staff is denied, and missing server configuration leaves public previews unavailable", async ({
  page,
}) =>
  setup(page, async (f) => {
    await f.install();
    await f.product();
    f.store.db
      .prepare("UPDATE memberships SET role='manager' WHERE user=? AND store=?")
      .run(f.a.user.id, f.a.id);
    await f.login();
    await page.goto("/shopify-shopper");
    await expect(
      page.getByText("Managers can view this connection.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconnect Shopify", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByLabel("Allow Blue shirt", { exact: true })).toHaveCount(0);
    f.store.db
      .prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?")
      .run(f.a.user.id, f.a.id);
    await page.reload();
    await expect(page.getByRole("alert")).toBeVisible();
    f.store.db
      .prepare("UPDATE memberships SET role='owner' WHERE user=? AND store=?")
      .run(f.a.user.id, f.a.id);
    f.service.clientId = "";
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Configure SHOPIFY_APP_CLIENT_ID");
    await expect(
      page.getByRole("button", { name: "Reconnect Shopify", exact: true }),
    ).toBeDisabled();
    expect(f.ai()).toBe(0);
  }));

test("theme script adds a fresh signed-request nonce per click and sends only product id and nonce", async ({
  page,
}) => {
  await page.goto("/");
  await page.setContent(
    '<a data-forme-tryon href="/apps/forme-tryon?product_id=123">Try it on me</a>',
  );
  await page.addScriptTag({
    path: fileURLToPath(
      new URL("../../shopify/extensions/forme-tryon/assets/forme-tryon.js", import.meta.url),
    ),
  });
  const link = page.getByRole("link", { name: "Try it on me", exact: true }),
    first = await link.getAttribute("href");
  expect(new URL(first, "http://store.example").searchParams.get("launch_nonce")).toMatch(
    /^[a-f0-9]{32}$/,
  );
  await link.evaluate((element) =>
    element.addEventListener("click", (event) => event.preventDefault()),
  );
  await link.click();
  const next = await link.getAttribute("href");
  expect(next).not.toBe(first);
  expect([...new URL(next, "http://store.example").searchParams.keys()].sort()).toEqual([
    "launch_nonce",
    "product_id",
  ]);
});
