import { test, expect } from "@playwright/test";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { customerPhotos } from "../helpers/customer-photos.js";
import { AccountStore } from "../helpers/pilot-accounts.js";
import { createApp } from "../../server/app.js";

test("each standard template's build suggests its own profile", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { measureBodyBuild } = await import("/src/body-pose.ts");
    const { suggestBuild } = await import("/src/body-build.js");
    const { avatarCanvas } = await import("/src/images.ts");
    const { profiles } = await import("/src/profiles.js");
    const out = [];
    for (const p of profiles) {
      const build = await measureBodyBuild((await avatarCanvas(p.index)).toDataURL());
      out.push([p.id, suggestBuild(build, p.body)?.profileId]);
    }
    return out;
  });
  for (const [id, suggested] of results) expect(suggested, id).toBe(id);
});

test("staff see the build the full-body photo suggests and can use it", async ({ page }) => {
  test.setTimeout(90_000);
  const uploads = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") uploads.push(req.url());
  });
  await page.goto("/");
  await page
    .getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    })
    .check();
  // A heavy-set customer in a loose shirt.
  await page
    .getByLabel("Upload full-body photo")
    .setInputFiles(path.resolve(customerPhotos[0].body));
  const estimate = page.getByLabel("Build from the photo");
  await expect(estimate).toContainText("closest to Broad", { timeout: 30_000 });
  await page.getByRole("button", { name: "Use the photo’s build" }).click();
  await expect(page.getByRole("button", { name: "Select Broad profile" })).toHaveClass(/selected/);
  await expect(page.getByRole("button", { name: "Use the photo’s build" })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove full-body photo" }).click();
  await expect(estimate).toHaveCount(0);
  expect(uploads).toEqual([]);
});

test("standard templates measure close to the size-estimate table's chest and waist", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  // server/size.js: [chest, waist, reference height] for each profile.
  const table = {
    slim: [90, 74, 175],
    regular: [98, 84, 175],
    athletic: [106, 82, 180],
    broad: [114, 100, 175],
    "f-slim": [82, 66, 165],
    "f-regular": [90, 74, 165],
    "f-athletic": [96, 76, 170],
  };
  const measured = await page.evaluate(async (table) => {
    const { analyseBodyPhoto } = await import("/src/body-pose.ts");
    const { avatarCanvas } = await import("/src/images.ts");
    const { profiles } = await import("/src/profiles.js");
    const out = {};
    for (const p of profiles.filter((p) => table[p.id])) {
      const analysis = await analyseBodyPhoto((await avatarCanvas(p.index)).toDataURL());
      out[p.id] = analysis.girths(table[p.id][2], p.body);
    }
    return out;
  }, table);
  for (const [id, [chest, waist]] of Object.entries(table)) {
    expect(Math.abs(measured[id].chestCm - chest), id + " chest").toBeLessThanOrEqual(6);
    expect(Math.abs(measured[id].waistCm - waist), id + " waist").toBeLessThanOrEqual(6);
  }
});

test("photo girths can be saved to the customer as estimates for size suggestions", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-photo-girths-")),
    store = new AccountStore(directory),
    owner = await store.register({
      email: "girths@example.test",
      name: "Girth store",
      password: "test-password-long",
    });
  const app = createApp({ accountStore: store, accessMode: "public", rateLimit: false });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const uploads = [];
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() !== "GET") uploads.push(u.pathname);
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
  try {
    await page.goto("/");
    await page.getByLabel("Account email").fill("girths@example.test");
    await page.getByLabel("Account password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "New customer", exact: true }).click();
    await page.getByLabel("Customer name", { exact: true }).fill("Ravi K");
    await page.getByLabel("Saved mobile number").fill("9876501234");
    await page.getByRole("button", { name: "Save customer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit customer", exact: true })).toBeVisible();
    await page
      .getByLabel("The customer agrees to use their photos for this avatar session.")
      .check();
    await page
      .getByLabel("Upload full-body photo")
      .setInputFiles(path.resolve(customerPhotos[1].body));
    const girths = page.getByLabel("Measurements from the photo");
    await expect(girths).toContainText(/chest \d+ cm, waist \d+ cm and hip \d+ cm/, {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Save to Ravi K for size suggestions" }).click();
    await expect(page.getByText(/Photo measurements saved to the customer/)).toBeVisible();
    const [customer] = store.customers.list(owner);
    const m = store.customers.get(owner, customer.id).measurements;
    expect(m.fitSource).toBe("photo");
    for (const field of ["chestCm", "waistCm", "hipCm"]) expect(m[field]).toBeGreaterThan(60);
    await expect(girths).toContainText(`chest ${m.chestCm} cm`);
    // The photo itself never left the device; only the three numbers were saved.
    expect(uploads.filter((u) => u.includes("customers"))).toHaveLength(2);
    // Taping over the estimate marks the girths as taped.
    await page.getByRole("button", { name: "Edit customer", exact: true }).click();
    await expect(page.getByText(/were estimated from the full-body photo/)).toBeVisible();
    await page.getByLabel("Chest circumference (cm)").fill(String(m.chestCm + 2));
    await page.getByRole("button", { name: "Save customer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit customer", exact: true })).toBeVisible();
    expect(store.customers.get(owner, customer.id).measurements.fitSource).toBe("tape");
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
