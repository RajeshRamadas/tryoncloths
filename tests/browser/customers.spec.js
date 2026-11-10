import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountStore } from "../helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../../server/app.js";
import { customerPhotos } from "../helpers/customer-photos.js";

async function setup(page, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-customer-browser-")),
    store = new AccountStore(directory);
  let calls = 0;
  const owner = await store.register({
    name: "Customer store",
    email: "customer@example.test",
    password: "test-password-long",
  });
  const server = createApp({
    accountStore: store,
    accessMode: "public",
    apiKey: "test",
    rateLimit: false,
    personalize: async () => {
      calls++;
      return `data:image/png;base64,${(await standardAvatar("regular")).toString("base64")}`;
    },
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const api = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/api/**", async (r) => {
    const u = new URL(r.request().url());
    const response = await r.fetch({
      url: api + u.pathname + u.search,
      headers: { ...r.request().headers(), host: new URL(api).host, origin: api },
    });
    await r.fulfill({ response });
  });
  try {
    await page.goto("/");
    await page.getByLabel("Account email").fill("customer@example.test");
    await page.getByLabel("Account password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await run({ store, owner, calls: () => calls });
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
async function createCustomer(page) {
  await page.getByRole("button", { name: "New customer", exact: true }).click();
  await page.getByLabel("Customer name", { exact: true }).fill("Asha Rao");
  await page.getByLabel("Saved mobile number").fill("9876543210");
  await page.getByLabel("Customer notes").fill("Prefers blue");
  await page.getByLabel("Profile height (cm)").fill("164");
  await page.getByLabel("Profile weight (kg)").fill("62");
  await page.getByRole("checkbox", { name: /agrees to receive marketing/ }).check();
  await page.getByRole("button", { name: "Save customer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit customer", exact: true })).toBeVisible();
}

test("customer mobile lookup, generated avatar grouping, reopen and profile erasure work on mobile", async ({
  page,
}) =>
  setup(page, async ({ store, owner, calls }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createCustomer(page);
    const customer = store.customers.list(owner)[0];
    expect(customer.marketingOptIn).toBe(true);
    await page
      .getByLabel("The customer agrees to use their photos for this avatar session.")
      .check();
    await page.getByLabel("Upload face photo").setInputFiles(customerPhotos[0].face);
    await page.getByLabel("Upload full-body photo").setInputFiles(customerPhotos[0].body);
    await expect(page.getByAltText("Customer full-body photo")).toBeVisible();
    await page.getByRole("button", { name: "Continue to match" }).click();
    await expect(
      page.getByText("Saving for Asha Rao · +919876543210", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Customer / avatar name")).toHaveValue("Asha Rao");
    await page
      .getByRole("checkbox", { name: /The customer agrees to send their face photo/ })
      .check();
    await page.getByRole("button", { name: "Generate customer avatar", exact: true }).click();
    await expect(
      page.getByAltText("Customer’s personalized avatar, awaiting visual review"),
    ).toBeVisible();
    expect(store.list(owner)[0].customerId).toBe(customer.id);
    await page.reload();
    await page.getByLabel("Customer mobile number", { exact: true }).fill("987");
    await page.getByRole("button", { name: "Find customer", exact: true }).click();
    await page.getByRole("button", { name: "Asha Rao · +919876543210", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit customer", exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/customers-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Saved avatars", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Asha Rao · +919876543210", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Use Asha Rao", exact: true }).click();
    await expect(
      page.getByText("Saving for Asha Rao · +919876543210", { exact: true }),
    ).toBeVisible();
    expect(calls()).toBe(1);
    await page
      .getByLabel("The customer approves the face, body and skin tone of this avatar.")
      .check();
    await page.getByRole("button", { name: "Try clothes", exact: true }).click();
    await page.getByRole("button", { name: "Navy T-shirt Sample" }).click();
    await expect(page.getByAltText("Avatar wearing the selected outfit")).toBeVisible();
    await page
      .getByLabel("I have checked clothing placement and approve this outfit preview.")
      .check();
    await page.getByLabel("Look name", { exact: true }).fill("Asha navy");
    await page.getByLabel("The customer agrees to save this outfit to the store account.").check();
    await page.getByRole("button", { name: "Save look to account", exact: true }).click();
    await expect(
      page.getByText(
        "Look saved to your store account. Open it under this avatar in Saved avatars.",
      ),
    ).toBeVisible();
    await page.reload();
    await page.getByLabel("Customer mobile number", { exact: true }).fill("9876543210");
    await page.getByRole("button", { name: "Find customer", exact: true }).click();
    await page.getByRole("button", { name: "Asha Rao · +919876543210", exact: true }).click();
    await page.getByRole("button", { name: "Edit customer", exact: true }).click();
    await page.getByRole("checkbox", { name: /agrees to receive marketing/ }).uncheck();
    await page.getByLabel("Customer notes").fill("Returning customer");
    await page.getByRole("button", { name: "Save customer", exact: true }).click();
    await expect(page.getByLabel("Customer notes")).toHaveCount(0);
    expect(store.customers.get(owner, customer.id).marketingOptIn).toBe(false);
    await page.getByRole("button", { name: "Delete customer", exact: true }).click();
    await expect(page.getByText(/This cannot be undone/)).toBeVisible();
    await page.getByRole("button", { name: "Permanently delete customer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit customer", exact: true })).toHaveCount(0);
    expect(store.list(owner)).toHaveLength(0);
    expect(store.listLooks(owner)).toHaveLength(0);
    expect(store.customers.list(owner)).toHaveLength(0);
    await page.getByRole("button", { name: "Saved avatars", exact: true }).click();
    await expect(page.getByText(/No saved avatars yet/)).toBeVisible();
    expect(calls()).toBe(1);
  }));

test("switching customer clears photos and duplicate numbers show a useful error", async ({
  page,
}) =>
  setup(page, async ({ store, owner }) => {
    await createCustomer(page);
    const second = store.customers.save(owner, { name: "Ravi", phoneE164: "9876543211" });
    await page
      .getByLabel("The customer agrees to use their photos for this avatar session.")
      .check();
    await page.getByLabel("Upload face photo").setInputFiles(customerPhotos[0].face);
    await expect(page.getByAltText("Customer face photo", { exact: true })).toBeVisible();
    await page.getByLabel("Customer mobile number", { exact: true }).fill("9876543211");
    await page.getByRole("button", { name: "Find customer", exact: true }).click();
    await page.getByRole("button", { name: `Ravi · ${second.phoneE164}`, exact: true }).click();
    await expect(page.getByAltText("Customer face photo", { exact: true })).toHaveCount(0);
    await expect(
      page.getByLabel("The customer agrees to use their photos for this avatar session."),
    ).not.toBeChecked();
    await page.getByRole("button", { name: "New customer", exact: true }).click();
    await page.getByLabel("Customer name", { exact: true }).fill("Duplicate");
    await page.getByLabel("Saved mobile number").fill("9876543211");
    await page.getByRole("button", { name: "Save customer", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("already has a customer");
    expect(store.customers.list(owner)).toHaveLength(2);
  }));

test("finding a returning customer lists their saved avatars and opens one without generating again", async ({
  page,
}) =>
  setup(page, async ({ store, owner, calls }) => {
    await createCustomer(page);
    const customer = store.customers.list(owner)[0];
    await store.save(owner, {
      image: `data:image/png;base64,${(await standardAvatar("regular")).toString("base64")}`,
      customerId: customer.id,
      name: "Asha festive",
      profileId: "regular",
      heightCm: 164,
      weightKg: 62,
      source: "generated",
    });
    await page.getByRole("button", { name: "Clear customer selection", exact: true }).click();
    await page.getByLabel("Customer mobile number").fill("98765");
    await page.getByRole("button", { name: "Find customer", exact: true }).click();
    await page.getByRole("button", { name: "Asha Rao · +919876543210", exact: true }).click();
    const saved = page.getByRole("region", { name: "Saved avatars for Asha Rao" });
    await expect(saved.getByText("Asha festive", { exact: true })).toBeVisible();
    await saved.getByRole("button", { name: "Open Asha festive for try-on", exact: true }).click();
    await expect(page.getByText(/Avatar opened without an AI request/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try clothes" })).toBeVisible();
    expect(calls()).toBe(0);
  }));
