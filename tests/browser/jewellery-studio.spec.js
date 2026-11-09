import { test, expect } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { handsTemplate } from "../../server/hands-templates.js";
import { AccountStore } from "../helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../../server/app.js";

const face = await readFile(new URL("../fixtures/customers/red-plaid-face.jpg", import.meta.url));
const portrait = await sharp({
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
  .toBuffer();
async function fixture(page, run, { enabled = true, generate, overlayOnly = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-j8-browser-")),
    store = new AccountStore(directory),
    account = await store.register({
      email: "j8@example.test",
      name: "Jewellery store",
      password: "test-password-long",
    });
  const avatar = await store.save(account, {
    image: "data:image/png;base64," + (await standardAvatar("regular")).toString("base64"),
    name: "Customer A",
    profileId: "regular",
    heightCm: 175,
    weightKg: 72,
    source: "imported",
  });
  const items = [];
  for (const [type, name, metal] of [
    ["drop_earrings", "Gold drop earrings", "yellow_gold"],
    ["nose_pin", "Silver nose pin", "silver"],
    ["ring", "Gold ring", "yellow_gold"],
    ["bangles", "Silver bangles", "silver"],
  ]) {
    const product = await sharp(
      Buffer.from(
        `<svg width="240" height="240"><rect width="100%" height="100%" fill="#f0ede5"/><circle cx="120" cy="105" r="${type === "ring" ? 55 : 30}" fill="none" stroke="${metal === "silver" ? "#9ba2a6" : "#c49c3b"}" stroke-width="16"/>${type === "drop_earrings" ? '<circle cx="120" cy="170" r="25" fill="#c49c3b"/>' : ""}</svg>`,
      ),
    )
      .png()
      .toBuffer();
    items.push(
      (
        await store.garments.save(
          account,
          {
            category: "jewellery",
            garmentType: type,
            name,
            attributes: {
              metal,
              ...(type === "drop_earrings"
                ? { dropMm: 38, purity: "22K" }
                : type === "bangles"
                  ? { count: 2 }
                  : {}),
            },
            image: "data:image/png;base64," + product.toString("base64"),
          },
          { jewelleryEnabled: true },
        )
      ).garment,
    );
  }
  if (overlayOnly) {
    for (const kind of ["portrait", "hands"]) {
      const context = store.views.context(account, avatar.id, kind),
        image =
          "data:image/png;base64," +
          (kind === "portrait" ? portrait : (await handsTemplate("male", "medium")).png).toString(
            "base64",
          ),
        receipt = store.views.receipt(account, avatar.id, kind, context, image, {
          tone: "medium",
          sourceKind: kind === "hands" ? "template" : "generated",
        });
      await store.views.approve(account, avatar.id, kind, {
        image,
        receipt,
        reviewed: true,
        storageConsent: true,
      });
    }
    store.views.anchors = async () => ({
      anchors: {
        leftEarlobe: { x: 235, y: 815 },
        rightEarlobe: { x: 900, y: 815 },
        neckBase: { x: 575, y: 1180 },
      },
      pxPerMm: 4,
    });
  }
  let calls = 0,
    portraits = 0,
    links = 0;
  const seen = [];
  const app = createApp({
    accountStore: store,
    accessMode: "public",
    provider: "gemini",
    apiKey: overlayOnly ? "" : "test-only",
    jewelleryEnabled: enabled,
    rateLimit: false,
    avatarViewOptions: {
      faceCheck: async () => {},
      portrait: async () => {
        portraits++;
        return "data:image/png;base64," + portrait.toString("base64");
      },
    },
    jewelleryOptions: {
      generate: async (input) => {
        calls++;
        seen.push({ ...input, base: Buffer.from(input.base) });
        if (generate) return generate(input);
        return (
          "data:image/png;base64," +
          (
            await sharp(input.base)
              .composite([
                {
                  input: {
                    create: {
                      width: 30,
                      height: 30,
                      channels: 3,
                      background: input.type === "nose_pin" ? "#909aaa" : "#c49c3b",
                    },
                  },
                  left: input.type === "nose_pin" ? 600 : 280,
                  top: input.view === "hands" ? 330 : 650,
                },
              ])
              .png()
              .toBuffer()
          ).toString("base64")
        );
      },
    },
    productLink: async (url) => {
      links++;
      return {
        url,
        title: "Silver nose pin",
        images: [
          {
            source: "product",
            image:
              "data:image/jpeg;base64," +
              (
                await sharp({
                  create: { width: 240, height: 240, channels: 3, background: "#c2c8cf" },
                })
                  .jpeg()
                  .toBuffer()
              ).toString("base64"),
          },
        ],
      };
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
    await page.getByLabel("Account email").fill("j8@example.test");
    await page.getByLabel("Account password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    if (enabled) {
      await page.getByRole("button", { name: "Saved avatars", exact: true }).click();
      await page.getByRole("button", { name: "Use Customer A", exact: true }).click();
      await page
        .getByLabel("The customer approves the face, body and skin tone of this avatar.", {
          exact: true,
        })
        .check();
      await page.getByRole("button", { name: "Jewellery", exact: true }).click();
    } else await page.goto("/jewellery?avatar=" + avatar.id);
    await expect(page.getByRole("heading", { name: "Try jewellery.", exact: true })).toBeVisible();
    await run({
      store,
      account,
      avatar,
      items,
      api,
      calls: () => calls,
      portraits: () => portraits,
      links: () => links,
      seen,
    });
  } finally {
    await page.unrouteAll({ behavior: "wait" }).catch(() => {});
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const review = (page) =>
  page.getByLabel(
    "I have checked the customer, complexion, proportions and jewellery placement in this preview.",
    { exact: true },
  );
const consent = (page) =>
  page.getByLabel(
    "The customer agrees to send this avatar view and jewellery product photo to Google Gemini. A new preview uses 1 AI credit; an approved exact match is reused free.",
    { exact: true },
  );
async function tryPiece(page) {
  await review(page).check();
  await consent(page).check();
  await page
    .getByRole("button", { name: "Try jewellery — up to 1 AI credit", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Customer jewellery preview", exact: true }),
  ).toBeVisible();
  await expect(review(page)).not.toBeChecked();
}
async function preparePortrait(page) {
  await page.getByRole("button", { name: "Create portrait — 1 AI request", exact: true }).click();
  await page
    .getByLabel("Fresh customer face photo", { exact: true })
    .setInputFiles({ name: "customer.jpg", mimeType: "image/jpeg", buffer: face });
  await page
    .getByLabel("The customer confirms this saved full-body avatar is correct and approved.", {
      exact: true,
    })
    .check();
  await page
    .getByLabel(
      "The customer agrees to send this fresh face photo and saved avatar to Google Gemini for one portrait, using 1 AI credit. Original face photos are not saved by the studio.",
      { exact: true },
    )
    .check();
  await page.getByRole("button", { name: "Generate portrait — 1 AI credit", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Generated portrait awaiting customer approval", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(
      "The customer reviewed the face, complexion, hair, proportions and complete head framing.",
      { exact: true },
    )
    .check();
  await page
    .getByLabel(
      "The customer agrees to save this approved view with this avatar in the store account.",
      { exact: true },
    )
    .check();
  await page.getByRole("button", { name: "Approve and save view", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Approved portrait reference", exact: true }),
  ).toBeVisible();
}
async function prepareHands(page) {
  await page.getByRole("button", { name: "Hands view", exact: true }).click();
  await page.getByRole("button", { name: "Prepare sample hands — free", exact: true }).click();
  await page.getByRole("button", { name: "Preview sample hands — free", exact: true }).click();
  await page
    .getByLabel("The customer reviewed the sample hands, tone and proportions.", { exact: true })
    .check();
  await page
    .getByLabel(
      "The customer agrees to save this approved view with this avatar in the store account.",
      { exact: true },
    )
    .check();
  await page.getByRole("button", { name: "Approve and save view", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Approved hands reference", exact: true }),
  ).toBeVisible();
}

test("mobile portrait → earrings → nose pin → undo → save/share/reopen a labelled jewellery look without more AI", async ({
  page,
}) =>
  fixture(page, async ({ store, account, avatar, calls, portraits, seen }) => {
    const before = store.billing.balance(account.org);
    await preparePortrait(page);
    expect(portraits()).toBe(1);
    await page.getByRole("button", { name: /^Gold drop earrings/ }).click();
    await expect(page.getByText(/38 mm drop/)).toBeVisible();
    await tryPiece(page);
    const earrings = await page
      .getByRole("img", { name: "Customer jewellery preview", exact: true })
      .getAttribute("src");
    await page.getByRole("button", { name: /^Silver nose pin/ }).click();
    await page.getByLabel("Side", { exact: true }).selectOption("left");
    await tryPiece(page);
    expect(seen[1].side).toBe("left");
    expect(calls()).toBe(2);
    await page.getByRole("button", { name: "Undo last jewellery item", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "Customer jewellery preview", exact: true }),
    ).toHaveAttribute("src", earrings);
    expect(calls()).toBe(2);
    await review(page).check();
    await page.getByLabel("Jewellery look name", { exact: true }).fill("Earrings for tonight");
    await page
      .getByLabel(
        "The customer agrees to save this jewellery look and its reviewed adaptations to the store account.",
        { exact: true },
      )
      .check();
    await page.getByRole("button", { name: "Save jewellery look", exact: true }).click();
    await expect(
      page.getByText(
        "Jewellery look saved to this avatar. It can be reopened without generating again.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(store.listLooks(account, avatar.id)[0].view).toBe("portrait");
    expect(store.listLooks(account, avatar.id)[0].itemsJson).toHaveLength(1);
    expect(store.billing.balance(account.org)).toBe(before - 3);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download jewellery PNG", exact: true }).click();
    const exported = await download,
      file = await exported.path();
    expect((await sharp(await readFile(file)).metadata()).height).toBeGreaterThan(1536);
    await page
      .getByLabel(
        "The customer agrees to make this jewellery look available through a share link.",
        { exact: true },
      )
      .check();
    await page.getByRole("button", { name: "Create jewellery look link", exact: true }).click();
    const link = await page.getByLabel("Jewellery share link", { exact: true }).inputValue();
    const shared = await page.request.get(link);
    expect(await shared.text()).toContain("AI preview — actual piece may differ in detail");
    const look = store.listLooks(account, avatar.id)[0];
    await page.goto("/jewellery?avatar=" + avatar.id + "&look=" + look.id);
    await expect(
      page.getByRole("img", { name: "Customer jewellery preview", exact: true }),
    ).toBeVisible();
    expect(calls()).toBe(2);
    expect(portraits()).toBe(1);
    await review(page).check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .locator(".jewellery-preview")
      .screenshot({ path: "test-results/jewellery-studio-mobile.png" });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: "test-results/jewellery-studio-desktop.png" });
  }));

test("hands use selected ring finger and bangle count; product links guess a type but require confirmation and consent", async ({
  page,
}) =>
  fixture(page, async ({ store, account, calls, links, seen }) => {
    await prepareHands(page);
    const before = store.billing.balance(account.org);
    await page.getByRole("button", { name: /^Gold ring/ }).click();
    await page.getByLabel("Hand", { exact: true }).selectOption("right");
    await page.getByLabel("Finger", { exact: true }).selectOption("ring");
    await tryPiece(page);
    expect(seen[0].hand).toBe("right");
    expect(seen[0].finger).toBe("ring");
    await page.getByRole("button", { name: /^Silver bangles/ }).click();
    await page.getByLabel("Bangle count per wrist", { exact: true }).fill("4");
    await page.getByLabel("Wrist", { exact: true }).selectOption("left");
    await tryPiece(page);
    expect(seen[1].attributes.count).toBe(4);
    expect(store.billing.balance(account.org)).toBe(before - 2);
    await page
      .getByRole("group", { name: "Jewellery source" })
      .getByRole("button", { name: "Product link", exact: true })
      .click();
    await page
      .getByLabel("Jewellery product link", { exact: true })
      .fill("https://shop.example/nose-pin");
    await page.getByRole("button", { name: "Find photos", exact: true }).click();
    await expect(page.getByLabel("Jewellery type", { exact: true })).toHaveValue("nose_pin");
    expect(links()).toBe(1);
    expect(calls()).toBe(2);
    await expect(
      page.getByRole("button", { name: "Try jewellery — up to 1 AI credit", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("I confirm the jewellery type and selected product photo.", { exact: true }),
    ).not.toBeChecked();
    const uploaded = await sharp({
      create: { width: 250, height: 250, channels: 3, background: "#baac98" },
    })
      .jpeg()
      .toBuffer();
    await page
      .getByRole("group", { name: "Jewellery source" })
      .getByRole("button", { name: "Upload photo", exact: true })
      .click();
    await page
      .getByLabel("Upload jewellery product photo", { exact: true })
      .setInputFiles({ name: "nose pin.jpg", mimeType: "image/jpeg", buffer: uploaded });
    await expect(
      page.getByRole("img", { name: "Selected jewellery product", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Metal", { exact: true })).toHaveValue("");
    expect(calls()).toBe(2);
  }));

test("a revoked session during generation clears private previews and ignores late output", async ({
  page,
}) => {
  let entered, release;
  const started = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (release = r));
  try {
    await fixture(
      page,
      async ({ store, account, calls }) => {
        await prepareHands(page);
        await page.getByRole("button", { name: /^Gold ring/ }).click();
        await review(page).check();
        await consent(page).check();
        await page
          .getByRole("button", { name: "Try jewellery — up to 1 AI credit", exact: true })
          .click();
        await started;
        const cookies = await page.context().cookies();
        store.logout(cookies.find((c) => c.name === "forme_session").value);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(page.getByRole("alert")).toContainText("session ended or changed");
        release();
        await expect(
          page.getByRole("img", { name: "Customer jewellery preview", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("img", { name: "Approved hands reference", exact: true }),
        ).toHaveCount(0);
        expect(calls()).toBe(1);
      },
      {
        generate: async (input) => {
          entered();
          await gate;
          return "data:image/png;base64," + input.base.toString("base64");
        },
      },
    );
  } finally {
    release?.();
  }
});

test("disabled jewellery studio cannot offer image inputs or paid actions", async ({ page }) =>
  fixture(
    page,
    async ({ calls }) => {
      await expect(
        page.getByText("Jewellery try-on is not enabled on this studio.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Upload jewellery product photo", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: "Try jewellery — up to 1 AI credit", exact: true }),
      ).toHaveCount(0);
      expect(calls()).toBe(0);
    },
    { enabled: false },
  ));

test("session expiry cancels a pending jewellery download before it can write a customer image", async ({
  page,
}) =>
  fixture(page, async ({ store }) => {
    await prepareHands(page);
    await page.getByRole("button", { name: /^Gold ring/ }).click();
    await tryPiece(page);
    await review(page).check();
    let entered,
      release,
      finished,
      downloads = 0;
    const started = new Promise((r) => (entered = r)),
      gate = new Promise((r) => (release = r)),
      complete = new Promise((r) => (finished = r));
    page.on("download", () => downloads++);
    await page.route("**/api/exports/image", async (route) => {
      entered();
      await gate;
      try {
        await route.fulfill({ status: 200, contentType: "image/png", body: portrait });
      } catch {
      } finally {
        finished();
      }
    });
    try {
      await page.getByRole("button", { name: "Download jewellery PNG", exact: true }).click();
      await started;
      const cookies = await page.context().cookies();
      store.logout(cookies.find((c) => c.name === "forme_session").value);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByRole("alert")).toContainText("session ended or changed");
      release();
      await complete;
      expect(downloads).toBe(0);
      await expect(
        page.getByRole("img", { name: "Customer jewellery preview", exact: true }),
      ).toHaveCount(0);
    } finally {
      release();
      await page.unroute("**/api/exports/image");
    }
  }));

test("free cut-out upload → anchored mobile editor → drag/scale/rotate/reset → labelled save/share/export/reopen without a paid route", async ({
  page,
}) =>
  fixture(
    page,
    async ({ store, account, avatar, items, calls, portraits }) => {
      const paid = [];
      page.on("request", (r) => {
        if (new URL(r.url()).pathname === "/api/jewellery/tryon") paid.push(r.url());
      });
      const before = store.billing.balance(account.org);
      const cutout = await sharp(
        Buffer.from(
          '<svg width="240" height="300"><path d="M120 22 Q95 30 120 55 Q145 30 120 22" fill="none" stroke="#c89d37" stroke-width="9"/><path d="M120 52 Q28 145 120 255 Q212 145 120 52" fill="#cfa640" stroke="#a57927" stroke-width="5"/><path d="M120 80 Q66 148 120 216 Q174 148 120 80" fill="#a92e3c"/><circle cx="120" cy="145" r="17" fill="#faf0c4"/></svg>',
        ),
      )
        .png()
        .toBuffer();
      await page.locator(".jewellery-navigation summary").click();
      await page.getByRole("link", { name: "Jewellery catalogue", exact: true }).click();
      const item = page
        .locator(".catalogue-item")
        .filter({ has: page.getByRole("heading", { name: "Gold drop earrings", exact: true }) });
      await item.getByText("Transparent cut-out", { exact: true }).click();
      await item
        .getByLabel("Cut-out PNG", { exact: true })
        .setInputFiles({ name: "gold-drop.png", mimeType: "image/png", buffer: cutout });
      await item
        .getByLabel("I agree to store or remove this cut-out in the store catalogue.", {
          exact: true,
        })
        .check();
      await item.getByRole("button", { name: "Save cut-out", exact: true }).click();
      await expect(item.getByText("Overlay ready · free placement", { exact: true })).toBeVisible();
      await page.goto("/jewellery?avatar=" + avatar.id);
      await page.getByRole("button", { name: /^Gold drop earrings/ }).click();
      await expect(
        page.getByRole("button", { name: "Overlay · free", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("button", { name: "Try jewellery — up to 1 AI credit", exact: true }),
      ).toHaveCount(0);
      await review(page).check();
      await page.getByRole("button", { name: "Load overlay placement", exact: true }).click();
      const canvas = page.getByLabel("Jewellery placement canvas", { exact: true });
      await expect(canvas).toBeVisible();
      await expect(page.getByLabel("Overlay horizontal position", { exact: true })).toHaveValue(
        "900",
      );
      await expect(page.getByLabel("Overlay vertical position", { exact: true })).toHaveValue(
        "815",
      );
      await expect(
        page.getByLabel("Selected overlay piece", { exact: true }).locator("option"),
      ).toHaveCount(2);
      const originalX = await page
        .getByLabel("Overlay horizontal position", { exact: true })
        .inputValue();
      await canvas.scrollIntoViewIfNeeded();
      const bounds = await canvas.boundingBox();
      await page.mouse.move(
        bounds.x + (bounds.width * 900) / 1152,
        bounds.y + (bounds.height * 815) / 1536,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + (bounds.width * 950) / 1152,
        bounds.y + (bounds.height * 870) / 1536,
        { steps: 8 },
      );
      await page.mouse.up();
      await expect(page.getByLabel("Overlay horizontal position", { exact: true })).not.toHaveValue(
        originalX,
      );
      await canvas.scrollIntoViewIfNeeded();
      const touchBounds = await canvas.boundingBox(),
        cx = touchBounds.x + touchBounds.width / 2,
        cy = touchBounds.y + touchBounds.height / 2,
        cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: cx - 25, y: cy, id: 1 },
          { x: cx + 25, y: cy, id: 2 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: cx - 40, y: cy - 10, id: 1 },
          { x: cx + 40, y: cy + 10, id: 2 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(page.getByLabel("Overlay scale", { exact: true })).not.toHaveValue("100");
      await expect(page.getByLabel("Overlay rotation", { exact: true })).not.toHaveValue("0");
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.detach();
      await page.getByLabel("Overlay scale", { exact: true }).fill("140");
      await page.getByLabel("Overlay rotation", { exact: true }).fill("20");
      await page.getByRole("button", { name: "Reset all placements", exact: true }).click();
      await expect(page.getByLabel("Overlay horizontal position", { exact: true })).toHaveValue(
        "900",
      );
      await expect(page.getByLabel("Overlay scale", { exact: true })).toHaveValue("100");
      await expect(page.getByLabel("Overlay rotation", { exact: true })).toHaveValue("0");
      await page.getByLabel("Selected overlay piece", { exact: true }).selectOption("1");
      await expect(page.getByLabel("Mirror selected piece", { exact: true })).toBeChecked();
      await page
        .locator(".jewellery-overlay")
        .screenshot({ path: "test-results/jewellery-overlay-editor-mobile.png" });
      await page.getByRole("button", { name: "Apply overlay — free", exact: true }).click();
      await expect(
        page.getByRole("img", { name: "Customer jewellery preview", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".jewellery-ai-label")).toHaveText("Overlay preview");
      await review(page).check();
      await page.getByLabel("Jewellery look name", { exact: true }).fill("Gold drops overlay");
      await page
        .getByLabel(
          "The customer agrees to save this jewellery look and its reviewed adaptations to the store account.",
          { exact: true },
        )
        .check();
      await page.getByRole("button", { name: "Save jewellery look", exact: true }).click();
      await expect(
        page.getByText(
          "Jewellery look saved to this avatar. It can be reopened without generating again.",
          { exact: true },
        ),
      ).toBeVisible();
      const look = store.listLooks(account, avatar.id)[0];
      expect(look.previewMode).toBe("overlay");
      expect(store.db.prepare("SELECT count(*) n FROM garment_results").get().n).toBe(0);
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download jewellery PNG", exact: true }).click();
      expect((await sharp(await readFile(await (await download).path())).metadata()).height).toBe(
        1588,
      );
      await page
        .getByLabel(
          "The customer agrees to make this jewellery look available through a share link.",
          { exact: true },
        )
        .check();
      await page.getByRole("button", { name: "Create jewellery look link", exact: true }).click();
      const link = await page.getByLabel("Jewellery share link", { exact: true }).inputValue();
      expect(await (await page.request.get(link)).text()).toContain("Overlay preview");
      await page.goto("/jewellery?avatar=" + avatar.id + "&look=" + look.id);
      await expect(
        page.getByRole("img", { name: "Customer jewellery preview", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".jewellery-ai-label")).toHaveText("Overlay preview");
      expect(store.billing.balance(account.org)).toBe(before);
      expect(calls()).toBe(0);
      expect(portraits()).toBe(0);
      expect(paid).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page
        .locator(".jewellery-preview")
        .screenshot({ path: "test-results/jewellery-overlay-mobile.png" });
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: "test-results/jewellery-overlay-desktop.png" });
    },
    { overlayOnly: true },
  ));

test("session expiry clears a free placement editor and ignores a late composite", async ({
  page,
}) =>
  fixture(
    page,
    async ({ store, account, items, calls }) => {
      const cutout = await sharp(
        Buffer.from(
          '<svg width="240" height="240"><circle cx="120" cy="120" r="70" fill="none" stroke="#c69a32" stroke-width="20"/></svg>',
        ),
      )
        .png()
        .toBuffer();
      store.db
        .prepare("UPDATE garments SET overlayPng=?,overlayAnchor=? WHERE account=? AND id=?")
        .run(cutout, "finger", account.id, items[2].id);
      await page.getByRole("button", { name: /^Gold ring/ }).click();
      await expect(
        page.getByRole("img", { name: "Approved hands reference", exact: true }),
      ).toBeVisible();
      await review(page).check();
      await page.getByRole("button", { name: "Load overlay placement", exact: true }).click();
      await expect(page.getByLabel("Jewellery placement canvas", { exact: true })).toBeVisible();
      let entered, release;
      const started = new Promise((r) => (entered = r)),
        gate = new Promise((r) => (release = r));
      await page.route("**/api/jewellery/overlay", async (route) => {
        entered();
        await gate;
        try {
          await route.fulfill({
            status: 200,
            json: {
              view: "hands",
              image: "data:image/png;base64," + portrait.toString("base64"),
              previewMode: "overlay",
            },
          });
        } catch {}
      });
      try {
        await page.getByRole("button", { name: "Apply overlay — free", exact: true }).click();
        await started;
        const cookies = await page.context().cookies();
        store.logout(cookies.find((c) => c.name === "forme_session").value);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(page.getByRole("alert")).toContainText("session ended or changed");
        release();
        await expect(page.getByLabel("Jewellery placement canvas", { exact: true })).toHaveCount(0);
        await expect(
          page.getByRole("img", { name: "Customer jewellery preview", exact: true }),
        ).toHaveCount(0);
        expect(calls()).toBe(0);
      } finally {
        release();
        await page.unroute("**/api/jewellery/overlay");
      }
    },
    { overlayOnly: true },
  ));
