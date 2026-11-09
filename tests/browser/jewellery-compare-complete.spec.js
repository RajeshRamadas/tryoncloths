import { test, expect } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { AccountStore } from "../helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../../server/app.js";
import { ProviderError } from "../../server/provider-errors.js";
const face = await readFile(new URL("../fixtures/customers/red-plaid-face.jpg", import.meta.url)),
  portrait = await sharp({
    create: { width: 1152, height: 1536, channels: 3, background: "#dedbd5" },
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
    .toBuffer(),
  url = (b) => "data:image/png;base64," + b.toString("base64");
async function fixture(page, run, { partial = false, enabled = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "forme-j10-browser-")),
    store = new AccountStore(directory),
    account = await store.register({
      email: "j10@example.test",
      name: "Jewellery store",
      password: "test-password-long",
    }),
    avatar = await store.save(account, {
      image: url(await standardAvatar("regular")),
      name: "Customer A",
      profileId: "regular",
      heightCm: 175,
      weightKg: 72,
      source: "imported",
    });
  const c = store.views.context(account, avatar.id, "portrait"),
    receipt = store.views.receipt(account, avatar.id, "portrait", c, url(portrait), {
      tone: "medium",
      sourceKind: "generated",
    });
  await store.views.approve(account, avatar.id, "portrait", {
    image: url(portrait),
    receipt,
    reviewed: true,
    storageConsent: true,
  });
  const items = [];
  for (const [name, metal, color] of [
    ["Gold drops", "yellow_gold", "#c49c3b"],
    ["Silver drops", "silver", "#a8afb5"],
  ])
    items.push(
      (
        await store.garments.save(
          account,
          {
            category: "jewellery",
            garmentType: "drop_earrings",
            name,
            attributes: { metal, dropMm: 38, pair: true },
            image: url(
              await sharp(
                Buffer.from(
                  `<svg width="240" height="240"><rect width="100%" height="100%" fill="#eeeae0"/><circle cx="120" cy="65" r="15" fill="${color}"/><path d="M120 80 Q25 150 120 215 Q215 150 120 80" fill="${color}"/></svg>`,
                ),
              )
                .png()
                .toBuffer(),
            ),
          },
          { jewelleryEnabled: true },
        )
      ).garment,
    );
  const outfit = await store.saveLook(account, {
      avatarId: avatar.id,
      name: "White tee and dark shorts",
      image: url(await standardAvatar("regular")),
      garments: ["White T-shirt", "Dark shorts"],
    }),
    jewel = await store.saveLook(
      account,
      {
        avatarId: avatar.id,
        name: "Everyday gold portrait",
        image: url(portrait),
        garments: ["Gold drops · yellow gold · 22K"],
      },
      {
        view: "portrait",
        itemsJson: [
          {
            name: "Gold drops",
            type: "drop_earrings",
            itemId: items[0].id,
            attributes: { metal: "yellow_gold", dropMm: 38, pair: true },
            side: "both",
            view: "portrait",
          },
        ],
        previewMode: "ai",
      },
    );
  let calls = 0;
  const app = createApp({
    accountStore: store,
    accessMode: "public",
    provider: "gemini",
    apiKey: "test-only",
    model: "j10-browser",
    jewelleryEnabled: enabled,
    rateLimit: false,
    jewelleryOptions: {
      generate: async (input) => {
        calls++;
        if (partial && calls === 2) throw new ProviderError("quota");
        const color = input.title.includes("Silver") ? "#a8afb5" : "#c49c3b",
          asset = await sharp(
            Buffer.from(
              `<svg width="60" height="140"><circle cx="30" cy="15" r="9" fill="${color}"/><path d="M30 28 Q-15 90 30 130 Q75 90 30 28" fill="${color}"/></svg>`,
            ),
          )
            .png()
            .toBuffer();
        return url(
          await sharp(input.base)
            .composite([
              { input: asset, left: 204, top: 810 },
              { input: asset, left: 870, top: 810 },
            ])
            .png()
            .toBuffer(),
        );
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const api = "http://127.0.0.1:" + server.address().port;
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    try {
      const response = await route.fetch({
        url: api + u.pathname + u.search,
        headers: { ...route.request().headers(), host: new URL(api).host, origin: api },
      });
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("Account email").fill("j10@example.test");
    await page.getByLabel("Account password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await run({ store, account, avatar, items, outfit, jewel, calls: () => calls });
  } finally {
    await page.unrouteAll({ behavior: "wait" }).catch(() => {});
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const baseReview = (page) =>
  page.getByLabel(
    "I have checked the customer, complexion, proportions and jewellery placement in this preview.",
    { exact: true },
  );
const compareConsent = (page) =>
  page.getByLabel(
    "The customer agrees to compare both selected variants with Google Gemini at the displayed cost.",
    { exact: true },
  );
async function linkVariants(page) {
  await page.goto("/jewellery-catalogue");
  const card = page
    .locator(".catalogue-item")
    .filter({ has: page.getByRole("heading", { name: "Silver drops", exact: true }) });
  await card.getByText("Link metal / colour variants", { exact: true }).click();
  await card.getByRole("button", { name: "Find original jewellery", exact: true }).click();
  await card
    .getByLabel("Original jewellery design", { exact: true })
    .selectOption({ label: "Gold drops · yellow gold" });
  await card.getByRole("button", { name: "Save variant link", exact: true }).click();
  await expect(
    page.getByText("Variant link updated. Approved visual adaptations are retained.", {
      exact: true,
    }),
  ).toBeVisible();
}
async function openCompare(page, avatar) {
  await page.goto("/jewellery?avatar=" + avatar.id);
  await page.getByRole("button", { name: /^Gold drops/ }).click();
  await baseReview(page).check();
  await expect(
    page.getByRole("button", { name: "Check comparison cost — free", exact: true }),
  ).toBeEnabled();
}
async function compare(page) {
  await page.getByRole("button", { name: "Check comparison cost — free", exact: true }).click();
  await expect(page.getByText("Comparison cost: 2 AI credits", { exact: true })).toBeVisible();
  await compareConsent(page).check();
  await page
    .getByRole("button", { name: "Compare both variants — 2 AI credits", exact: true })
    .click();
}

test("mobile variant linking → cost-first comparison → reviewed approval → free reuse → choose a variant", async ({
  page,
}) =>
  fixture(page, async ({ store, account, avatar, calls }) => {
    await linkVariants(page);
    await openCompare(page, avatar);
    const before = store.billing.balance(account.org);
    await page.getByRole("button", { name: "Check comparison cost — free", exact: true }).click();
    await expect(page.getByText("Comparison cost: 2 AI credits", { exact: true })).toBeVisible();
    expect(calls()).toBe(0);
    await expect(
      page.getByRole("button", { name: "Compare both variants — 2 AI credits", exact: true }),
    ).toBeDisabled();
    await compareConsent(page).check();
    await page
      .getByRole("button", { name: "Compare both variants — 2 AI credits", exact: true })
      .click();
    await expect(
      page.getByRole("img", { name: "Gold drops comparison preview", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Silver drops comparison preview", exact: true }),
    ).toBeVisible();
    expect(calls()).toBe(2);
    expect(store.billing.balance(account.org)).toBe(before - 2);
    await page.getByLabel("I reviewed Gold drops.", { exact: true }).check();
    await page.getByLabel("I reviewed Silver drops.", { exact: true }).check();
    await page
      .getByLabel("The customer agrees to save the reviewed comparison variants for reuse.", {
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Save reviewed variants for reuse", exact: true })
      .click();
    await expect(
      page.getByText(
        "Reviewed variants saved. An exact approved comparison can now be reused free.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(store.db.prepare("SELECT count(*) n FROM garment_results").get().n).toBe(2);
    await page.getByRole("button", { name: "Check comparison cost — free", exact: true }).click();
    await expect(page.getByText("Comparison cost: 0 AI credits", { exact: true })).toBeVisible();
    await compareConsent(page).check();
    await page
      .getByRole("button", { name: "Compare both variants — 0 AI credits", exact: true })
      .click();
    await expect(
      page.getByText(
        "Comparison ready · 0 AI credits used. Review each variant before keeping it.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(calls()).toBe(2);
    expect(store.billing.balance(account.org)).toBe(before - 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .locator(".jewellery-compare")
      .screenshot({ path: "test-results/jewellery-compare-mobile.png" });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page
      .locator(".jewellery-compare")
      .screenshot({ path: "test-results/jewellery-compare-desktop.png" });
    await page.getByLabel("I reviewed Silver drops.", { exact: true }).check();
    await page.getByRole("button", { name: "Use Silver drops", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "Customer jewellery preview", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Silver drops added from the comparison. Review this look before saving or adding another piece.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(calls()).toBe(2);
  }));

test("a failed second comparison keeps the first paid image and presents it for review without a retry", async ({
  page,
}) =>
  fixture(
    page,
    async ({ store, account, avatar, calls }) => {
      await linkVariants(page);
      await openCompare(page, avatar);
      const before = store.billing.balance(account.org);
      await compare(page);
      await expect(
        page.getByRole("img", { name: "Gold drops comparison preview", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("img", { name: "Silver drops comparison preview", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/The completed result is kept; nothing was retried/),
      ).toBeVisible();
      expect(calls()).toBe(2);
      expect(store.billing.balance(account.org)).toBe(before - 1);
      await page.getByLabel("I reviewed Gold drops.", { exact: true }).check();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download Gold drops", exact: true }).click();
      expect((await sharp(await readFile(await (await download).path())).metadata()).height).toBe(
        1588,
      );
      expect(calls()).toBe(2);
    },
    { partial: true },
  ));

test("complete board uses saved same-customer looks, saves, exports, shares and opens through the avatar library without AI", async ({
  page,
}) =>
  fixture(page, async ({ store, account, avatar, calls }) => {
    const before = store.billing.balance(account.org);
    await page.goto("/complete-look?avatar=" + avatar.id);
    await page.getByRole("button", { name: "Build complete look — free", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "Complete outfit and jewellery preview", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save complete look", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("Complete look name", { exact: true }).fill("Our complete look");
    await page
      .getByLabel(
        "I reviewed the outfit, customer portrait, jewellery and item names in this complete look.",
        { exact: true },
      )
      .check();
    await page
      .getByLabel("The customer agrees to save this complete look to the store account.", {
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "Save complete look", exact: true }).click();
    await expect(
      page.getByText("Complete look saved to this avatar. Reopen, export or share it without AI.", {
        exact: true,
      }),
    ).toBeVisible();
    const board = store.listLooks(account, avatar.id).find((l) => l.view === "complete");
    expect(board).toBeTruthy();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download complete look PNG", exact: true }).click();
    const png = await readFile(await (await download).path()),
      meta = await sharp(png).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBeGreaterThan(1536);
    expect(meta.height).toBeLessThan(2500);
    await page
      .getByLabel(
        "The customer agrees to make this complete look available through a share link.",
        { exact: true },
      )
      .check();
    await page.getByRole("button", { name: "Create complete look link", exact: true }).click();
    const link = await page.getByLabel("Complete look share link", { exact: true }).inputValue();
    expect(await (await page.request.get(link)).text()).toContain("Your complete look");
    await page.goto("/");
    await page.getByRole("button", { name: "Saved avatars", exact: true }).click();
    await page.getByRole("button", { name: /^View looks \(\d+\) for Customer A$/ }).click();
    await page
      .getByRole("link", { name: "Open complete look Our complete look", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Outfit and jewellery, together.", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Complete outfit and jewellery preview", exact: true }),
    ).toBeVisible();
    expect(calls()).toBe(0);
    expect(store.billing.balance(account.org)).toBe(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .getByRole("img", { name: "Complete outfit and jewellery preview", exact: true })
      .screenshot({ path: "test-results/complete-look-mobile-board.png" });
    await page.screenshot({ path: "test-results/complete-look-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: "test-results/complete-look-desktop.png", fullPage: true });
  }));

test("complete builder clears private content on session expiry and disabled pilots show no controls", async ({
  page,
}) => {
  await fixture(page, async ({ store, calls }) => {
    await page.goto("/complete-look");
    await page.getByRole("button", { name: "Build complete look — free", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "Complete outfit and jewellery preview", exact: true }),
    ).toBeVisible();
    const cookies = await page.context().cookies();
    store.logout(cookies.find((c) => c.name === "forme_session").value);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert")).toContainText("session ended or changed");
    await expect(
      page.getByRole("img", { name: "Complete outfit and jewellery preview", exact: true }),
    ).toHaveCount(0);
    expect(calls()).toBe(0);
  });
  await fixture(
    page,
    async () => {
      await page.goto("/complete-look");
      await expect(
        page.getByText("Complete looks are not enabled on this studio.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Build complete look — free", exact: true }),
      ).toHaveCount(0);
    },
    { enabled: false },
  );
});
