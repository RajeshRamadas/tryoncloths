import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { AccountStore } from "./helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../server/app.js";
import { handsTemplate } from "../server/hands-templates.js";
import {
  overlayAsset,
  renderOverlay,
  saveOverlayAsset,
  prepareOverlay,
  applyOverlay,
} from "../server/jewellery-overlay.js";
import {
  defaultOverlayPlacements,
  validateOverlayPlacements,
  previewLabel,
  combinedMode,
} from "../src/jewellery-overlay.js";
const url = (b) => "data:image/png;base64," + b.toString("base64");
const png = await sharp(
  Buffer.from(
    '<svg width="240" height="240"><rect x="60" y="20" width="120" height="200" fill="#d1a33d"/><circle cx="85" cy="70" r="20" fill="#d42233"/></svg>',
  ),
)
  .png()
  .toBuffer();
const cutout = url(png),
  template = await handsTemplate("male", "medium");
const anchors = {
  anchors: {
    leftEarlobe: { x: 335, y: 650 },
    rightEarlobe: { x: 815, y: 645 },
    leftNostril: { x: 550, y: 600 },
    rightNostril: { x: 605, y: 600 },
    hairParting: { x: 575, y: 250 },
    neckBase: { x: 575, y: 850 },
  },
  pxPerMm: 3,
  width: 1152,
  height: 1536,
};
const defaults = () =>
  defaultOverlayPlacements({
    type: "drop_earrings",
    attributes: { dropMm: 38, pair: true },
    side: "both",
    view: "portrait",
    anchors,
    width: 1152,
    height: 1536,
    assetWidth: 120,
    assetHeight: 200,
  });
async function fixture(run, { enabled = true, key = "" } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-j9-")),
    store = new AccountStore(directory);
  const a = await store.register({
      email: "overlay-a@example.test",
      name: "Overlay store",
      password: "test-password-long",
    }),
    b = await store.register({
      email: "overlay-b@example.test",
      name: "Other store",
      password: "test-password-long",
    }),
    token = store.session(a),
    ca = "forme_session=" + token,
    cb = "forme_session=" + store.session(b);
  const avatar = await store.save(a, {
    image: url(await standardAvatar("regular")),
    name: "Customer",
    profileId: "regular",
    heightCm: 175,
    weightKg: 72,
    source: "imported",
  });
  for (const kind of ["hands", "portrait"]) {
    const c = store.views.context(a, avatar.id, kind),
      image = url(
        kind === "hands"
          ? template.png
          : await sharp({
              create: { width: 1152, height: 1536, channels: 3, background: "#dad8d0" },
            })
              .png()
              .toBuffer(),
      ),
      receipt = store.views.receipt(a, avatar.id, kind, c, image, {
        tone: "medium",
        sourceKind: kind === "hands" ? "template" : "generated",
      });
    await store.views.approve(a, avatar.id, kind, {
      image,
      receipt,
      reviewed: true,
      storageConsent: true,
    });
  }
  store.views.anchors = async () => anchors;
  const items = {};
  for (const type of ["drop_earrings", "ring", "bangles", "waist_belt", "anklets"])
    items[type] = (
      await store.garments.save(
        a,
        {
          category: "jewellery",
          garmentType: type,
          name: type,
          attributes: {
            metal: "yellow_gold",
            ...(type === "drop_earrings"
              ? { dropMm: 38, pair: true }
              : type === "anklets"
                ? { pair: true }
                : type === "bangles"
                  ? { count: 24 }
                  : {}),
          },
          image: cutout,
          overlayPng: cutout,
          overlayAnchor:
            type === "drop_earrings"
              ? "earlobe"
              : type === "ring"
                ? "finger"
                : type === "bangles"
                  ? "wrist"
                  : type === "waist_belt"
                    ? "waist"
                    : "ankle",
        },
        { jewelleryEnabled: true },
      )
    ).garment;
  let calls = 0;
  const app = createApp({
    accountStore: store,
    accessMode: "public",
    provider: "gemini",
    apiKey: key,
    model: "test-model",
    jewelleryEnabled: enabled,
    rateLimit: false,
    jewelleryOptions: {
      generate: async (input) => {
        calls++;
        return url(input.base);
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (p, body, cookie = ca, origin = base, method = "POST") =>
    fetch(base + p, {
      method,
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const input = {
    avatarId: avatar.id,
    itemId: items.drop_earrings.id,
    view: "portrait",
    side: "both",
  };
  const prepare = async (changes = {}) => {
    const r = await request("/api/jewellery/overlay/prepare", { ...input, ...changes });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const apply = (p, changes = {}) =>
    request("/api/jewellery/overlay", {
      ...input,
      assetHash: p.assetHash,
      placements: p.placements,
      ...changes,
    });
  try {
    await run({
      directory,
      store,
      a,
      b,
      ca,
      cb,
      token,
      avatar,
      items,
      app,
      base,
      request,
      input,
      prepare,
      apply,
      calls: () => calls,
    });
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("cut-outs require actual PNG alpha, visible pixels, bounded bytes and dimensions; trimming preserves design", async () => {
  const asset = await overlayAsset(cutout, "earlobe", "drop_earrings"),
    m = await sharp(asset).metadata();
  assert.equal(m.width, 120);
  assert.equal(m.height, 200);
  assert.equal(m.hasAlpha, true);
  for (const value of [
    "bad",
    url(
      await sharp({ create: { width: 240, height: 240, channels: 4, background: "#cc9900" } })
        .png()
        .toBuffer(),
    ),
    url(
      await sharp({ create: { width: 240, height: 240, channels: 4, background: "#00000000" } })
        .png()
        .toBuffer(),
    ),
    url(await sharp(png).resize(199, 240).png().toBuffer()),
    url(await sharp(png).resize(2050, 200).png().toBuffer()),
    url(await sharp(png).jpeg().toBuffer()),
    "data:image/png;base64," + Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
  ])
    await assert.rejects(overlayAsset(value, "earlobe", "drop_earrings"), /transparent PNG/);
  await assert.rejects(overlayAsset(cutout, "wrist", "drop_earrings"), /anchor/);
});
test("earrings begin exactly on image-side anchors, keep millimetre scale and mirror the second piece", () => {
  const p = defaults();
  assert.equal(p.length, 2);
  assert.equal(p[0].x, anchors.anchors.rightEarlobe.x);
  assert.equal(p[0].y, 645);
  assert.equal(p[1].x, 335);
  assert.equal(p[1].y, 650);
  assert.equal(p[0].height, 38 * 3);
  assert.equal(p[0].pivotY, 0);
  assert.equal(p[0].mirror, false);
  assert.equal(p[1].mirror, true);
  const doubled = defaultOverlayPlacements({
    type: "drop_earrings",
    attributes: { dropMm: 38 },
    side: "left",
    view: "portrait",
    anchors: { ...anchors, pxPerMm: 6 },
    width: 1152,
    height: 1536,
    assetWidth: 120,
    assetHeight: 200,
  });
  assert.equal(doubled[0].height, p[0].height * 2);
});
test("template ring, 48 bangles and full body starts are bounded and cannot distort the original proportions", () => {
  const common = { width: 1024, height: 1024, assetWidth: 120, assetHeight: 200 };
  const ring = defaultOverlayPlacements({
    ...common,
    type: "ring",
    attributes: {},
    view: "hands",
    hand: "right",
    finger: "ring",
    anchors: template.anchors,
  });
  assert.equal(ring[0].x, template.anchors.right.ring.x);
  assert.equal(ring[0].width, template.anchors.right.ring.widthPx * 1.05);
  const bangles = defaultOverlayPlacements({
    ...common,
    type: "bangles",
    attributes: { count: 24 },
    view: "hands",
    wrist: "both",
    anchors: template.anchors,
  });
  assert.equal(bangles.length, 48);
  validateOverlayPlacements(bangles, bangles, common);
  for (const type of ["waist_belt", "anklets"]) {
    const p = defaultOverlayPlacements({
      ...common,
      type,
      attributes: {},
      view: "full",
      side: "both",
    });
    assert.ok(p.every((v) => v.x > 0 && v.y < 1024));
  }
  const p = defaults();
  for (const change of [
    { x: -1 },
    { width: 10000 },
    { width: NaN },
    { height: 10 },
    { pivotX: 0 },
    { mirror: "yes" },
    { angle: 181 },
    { id: "foreign" },
    { extra: true },
  ])
    assert.throws(() =>
      validateOverlayPlacements([{ ...p[0], ...change }, p[1]], p, { width: 1152, height: 1536 }),
    );
});
test("Sharp compositing honours anchor pivots, mirror, clockwise rotation, off-edge crop and source resolution", async () => {
  const base = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer(),
    asset = await overlayAsset(cutout, "earlobe", "drop_earrings");
  const p = {
    id: "left:0",
    x: 150,
    y: 50,
    width: 120,
    height: 200,
    pivotX: 0.5,
    pivotY: 0,
    angle: 0,
    mirror: false,
  };
  const pixel = async (image, x, y) => [
    ...(await sharp(image)
      .extract({ left: x, top: y, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  const out = await renderOverlay(base, asset, [p], 300, 300);
  assert.deepEqual(await pixel(out, 115, 100), [212, 34, 51]);
  assert.deepEqual(await pixel(out, 185, 100), [209, 163, 61]);
  const mirror = await renderOverlay(base, asset, [{ ...p, mirror: true }], 300, 300);
  assert.deepEqual(await pixel(mirror, 185, 100), [212, 34, 51]);
  const rotated = await renderOverlay(base, asset, [{ ...p, angle: 90 }], 300, 300);
  assert.deepEqual(await pixel(rotated, 100, 15), [212, 34, 51]);
  const clipped = await renderOverlay(base, asset, [{ ...p, x: 0, y: 0, angle: -40 }], 300, 300);
  assert.equal((await sharp(clipped).metadata()).width, 300);
});
test("free overlay works without a Gemini key or credits, signs the full-resolution output and never enters AI reuse", async () =>
  fixture(async ({ store, a, avatar, items, input, request, prepare, apply, calls }) => {
    const health = await (
      await request("/api/health", undefined, undefined, undefined, "GET")
    ).json();
    assert.equal(health.jewelleryAvailable, false);
    assert.equal(health.jewelleryOverlayAvailable, true);
    const balance = store.billing.balance(a.org),
      p = await prepare();
    assert.deepEqual(p.placements, defaults());
    const r = await apply(p);
    assert.equal(r.status, 200, await r.clone().text());
    const out = await r.json();
    assert.equal(out.previewMode, "overlay");
    assert.equal(out.creditsUsed, 0);
    assert.equal(out.kind, "jewellery-overlay");
    assert.notEqual(out.image, p.base);
    assert.equal(
      (await sharp(Buffer.from(out.image.split(",")[1], "base64")).metadata()).width,
      1152,
    );
    assert.equal(
      (
        await request("/api/jewellery/results/" + out.resultId + "/approve", {
          image: out.image,
          receipt: out.receipt,
          reviewed: true,
          storageConsent: true,
        })
      ).status,
      400,
    );
    const itemsJson = [
      {
        itemId: items.drop_earrings.id,
        name: "Earrings",
        type: "drop_earrings",
        attributes: { metal: "yellow_gold", pair: true, dropMm: 38 },
        side: "both",
        mode: "overlay",
      },
    ];
    const saved = await request("/api/jewellery/looks", {
      avatarId: avatar.id,
      view: "portrait",
      image: out.image,
      receipt: out.receipt,
      name: "Evening overlay",
      itemsJson,
      reviewed: true,
      storageConsent: true,
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const look = await saved.json();
    const opened = await (
      await request("/api/jewellery/looks/" + look.id, undefined, undefined, undefined, "GET")
    ).json();
    assert.equal(opened.previewMode, "overlay");
    assert.equal(opened.itemsJson[0].mode, "overlay");
    assert.equal(opened.image, out.image);
    const share = await (
        await request("/api/looks/" + look.id + "/share", { days: 7, sharingConsent: true })
      ).json(),
      html = await (await fetch(share.url)).text();
    assert.match(html, /Overlay preview/);
    assert.doesNotMatch(html, /AI preview/);
    const sharedImage = await fetch(share.url + "/image");
    assert.equal(sharedImage.status, 200);
    assert.equal(
      (await sharp(Buffer.from(await sharedImage.arrayBuffer())).metadata()).height,
      1536 + 52,
    );
    const next = await prepare({ base: out.image, baseLookId: look.id, baseReviewed: true });
    assert.equal(
      (await apply(next, { base: out.image, baseLookId: look.id, baseReviewed: true })).status,
      200,
    );
    assert.equal(store.billing.balance(a.org), balance);
    assert.equal(calls(), 0);
    assert.equal(store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='hold'").get().n, 0);
    assert.equal(store.db.prepare("SELECT count(*) n FROM garment_results").get().n, 0);
  }));
test("overlay validates tenant, role, origin, placement, storage review, trusted base and current cut-out", async () =>
  fixture(async ({ store, a, b, cb, items, input, request, prepare, apply, calls }) => {
    assert.equal((await request("/api/jewellery/overlay/prepare", input, "")).status, 401);
    assert.equal((await request("/api/jewellery/overlay/prepare", input, cb)).status, 404);
    assert.equal(
      (await request("/api/jewellery/overlay/prepare", input, undefined, "https://evil.test"))
        .status,
      403,
    );
    for (const changes of [
      { replaceExisting: "ears" },
      { base: "bad" },
      { view: "hands" },
      { store: b.id },
      { itemId: {} },
      { baseReceipt: "invented" },
    ])
      assert.ok(
        [400, 404].includes(
          (await request("/api/jewellery/overlay/prepare", { ...input, ...changes })).status,
        ),
      );
    const p = await prepare();
    assert.equal((await apply(p, { assetHash: "wrong" })).status, 409);
    assert.equal(
      (await apply(p, { placements: p.placements.map((v) => ({ ...v, width: 99999 })) })).status,
      400,
    );
    store.db
      .prepare(
        "INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(user,store) DO UPDATE SET role=excluded.role",
      )
      .run(b.user.id, a.id, "staff");
    const staff = "forme_session=" + store.session(store.identity(b.user.id, a.id));
    assert.equal((await request("/api/jewellery/overlay/prepare", input, staff)).status, 200);
    assert.equal(
      (
        await request(
          "/api/garments/" + items.drop_earrings.id + "/overlay?category=jewellery",
          { overlayPng: cutout, overlayAnchor: "earlobe", storageConsent: true },
          staff,
        )
      ).status,
      403,
    );
    const out = await (await apply(p)).json(),
      payload = {
        avatarId: input.avatarId,
        view: "portrait",
        name: "Test",
        itemsJson: [
          {
            itemId: items.drop_earrings.id,
            type: "drop_earrings",
            name: "Earrings",
            attributes: { metal: "yellow_gold", pair: true },
            side: "both",
          },
        ],
        image: out.image,
        receipt: out.receipt,
        reviewed: true,
        storageConsent: true,
      };
    assert.equal(
      (await request("/api/jewellery/looks", { ...payload, reviewed: false })).status,
      400,
    );
    assert.equal(
      (await request("/api/jewellery/looks", { ...payload, image: p.base })).status,
      409,
    );
    const edit = "/api/garments/" + items.drop_earrings.id + "/overlay?category=jewellery";
    assert.equal((await request(edit, { overlayPng: null, storageConsent: false })).status, 400);
    assert.equal((await request(edit, { overlayPng: null, storageConsent: true })).status, 200);
    assert.equal((await apply(p)).status, 400);
    assert.equal((await request("/api/jewellery/looks", payload)).status, 409);
    assert.equal(calls(), 0);
  }));
test("cut-out mutations recheck actor/session after async decoding and stale assets are rejected", async () =>
  fixture(async ({ store, a, items, app, input, prepare, apply }) => {
    const p = await prepare(),
      changed = await sharp(png).modulate({ brightness: 1.1 }).png().toBuffer();
    await saveOverlayAsset(
      store,
      a,
      items.drop_earrings.id,
      { overlayPng: url(changed), overlayAnchor: "earlobe" },
      { guard: () => {} },
    );
    assert.equal((await apply(p)).status, 409);
    await assert.rejects(
      saveOverlayAsset(
        store,
        a,
        items.ring.id,
        { overlayPng: cutout, overlayAnchor: "finger" },
        {
          guard: () => {
            throw Object.assign(new Error("session gone"), { status: 401 });
          },
        },
      ),
      /session gone/,
    );
    const prepared = await prepareOverlay(store, app.locals.jewellery, a, input, () => {}),
      out = await applyOverlay(prepared, prepared.defaults);
    prepared.context.mode = "overlay";
    const receipt = app.locals.jewellery.receipt(a, prepared.context, out.image);
    store.db.prepare("DELETE FROM memberships WHERE user=? AND store=?").run(a.user.id, a.id);
    assert.throws(() => app.locals.jewellery.claims(a, receipt));
  }));
test("feature flag disables both cut-out editing and free overlay; provenance combines without discarding labels", async () =>
  fixture(
    async ({ request, input, items }) => {
      assert.equal((await request("/api/jewellery/overlay/prepare", input)).status, 404);
      assert.equal(
        (
          await request("/api/garments/" + items.ring.id + "/overlay?category=jewellery", {
            overlayPng: cutout,
            overlayAnchor: "finger",
            storageConsent: true,
          })
        ).status,
        404,
      );
      assert.equal(
        previewLabel(combinedMode("ai", "overlay")),
        "AI + Overlay preview — actual piece may differ in detail",
      );
      assert.equal(combinedMode("overlay", "overlay"), "overlay");
    },
    { enabled: false },
  ));

test("free overlays still work at zero credit balance; mixed AI/overlay provenance survives subsequent receipts", async () =>
  fixture(
    async ({ store, a, input, request, prepare, apply, calls }) => {
      const p = await prepare(),
        overlay = await (await apply(p)).json();
      const paid = await request("/api/jewellery/tryon", {
        ...input,
        base: overlay.image,
        baseReceipt: overlay.receipt,
        baseReviewed: true,
        requestId: (await import("node:crypto")).randomUUID(),
        consent: true,
        consentScope: "view-and-item",
        consentProvider: "gemini",
      });
      assert.equal(paid.status, 200, await paid.clone().text());
      const ai = await paid.json();
      assert.equal(ai.previewMode, "mixed");
      assert.equal(calls(), 1);
      const before = store.billing.balance(a.org);
      store.db
        .prepare(
          "INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','zero-overlay-test',?)",
        )
        .run((await import("node:crypto")).randomUUID(), a.org, -before, Date.now());
      assert.equal(store.billing.balance(a.org), 0);
      const next = await prepare({ base: ai.image, baseReceipt: ai.receipt, baseReviewed: true }),
        response = await apply(next, {
          base: ai.image,
          baseReceipt: ai.receipt,
          baseReviewed: true,
        });
      assert.equal(response.status, 200, await response.clone().text());
      const mixed = await response.json();
      assert.equal(mixed.previewMode, "mixed");
      assert.equal(store.billing.balance(a.org), 0);
      assert.equal(calls(), 1);
    },
    { key: "test-only" },
  ));
test("session revocation during anchor preparation delivers no customer output, and shared master cut-outs stay read-only", async () =>
  fixture(async ({ store, a, b, token, items, input, request, app }) => {
    let entered, release;
    const started = new Promise((r) => (entered = r)),
      gate = new Promise((r) => (release = r));
    store.views.anchors = async () => {
      entered();
      await gate;
      return anchors;
    };
    const pending = request("/api/jewellery/overlay/prepare", input);
    await started;
    store.logout(token);
    release();
    const cancelled = await pending;
    assert.equal(cancelled.status, 401);
    assert.doesNotMatch(await cancelled.text(), /data:image/);
    store.db.prepare("UPDATE orgs SET plan='chain' WHERE id=?").run(a.org);
    store.db.prepare("UPDATE stores SET org=? WHERE id=?").run(a.org, b.id);
    const branch = store.identity(b.user.id, b.id),
      { CatalogueSync } = await import("../server/catalogue-sync.js");
    new CatalogueSync(store).setMaster(a, a.id);
    const opts = { category: "jewellery", jewelleryEnabled: true },
      shared = store.garments
        .browse(branch, { category: "jewellery" }, opts)
        .garments.find((i) => i.name === "ring");
    assert.equal(shared.hasOverlay, true);
    assert.equal(shared.readOnly, true);
    store.garments.get(branch, shared.id, opts);
    await assert.rejects(
      saveOverlayAsset(store, branch, shared.id, { overlayPng: null }),
      /read-only/,
    );
    await saveOverlayAsset(store, a, items.ring.id, { overlayPng: null });
    assert.equal(store.garments.get(branch, shared.id, opts).hasOverlay, false);
    assert.equal(
      store.db
        .prepare("SELECT overlayPng FROM garments WHERE account=? AND id=?")
        .get(branch.id, shared.id).overlayPng,
      null,
    );
  }));

test("overlay application records one free jewellery fitting per request, while preparation and invalid tracking record nothing", async () =>
  fixture(async ({ store, a, request, prepare, apply, calls }) => {
    const { randomUUID } = await import("node:crypto"),
      sessionId = randomUUID(),
      requestId = randomUUID();
    await prepare({ sessionId });
    const p = await prepare({ sessionId });
    assert.equal(
      store.analytics.report(a, {}, Date.now(), { jewelleryEnabled: true }).jewellery.totals.tryons,
      0,
    );
    assert.equal((await apply(p, { sessionId: "invalid", requestId })).status, 400);
    assert.equal((await apply(p, { sessionId, requestId: "invalid" })).status, 400);
    for (let i = 0; i < 2; i++)
      assert.equal((await apply(p, { sessionId, requestId })).status, 200);
    const report = store.analytics.report(a, {}, Date.now(), { jewelleryEnabled: true });
    assert.equal(report.jewellery.totals.overlays, 1);
    assert.equal(report.jewellery.totals.tryonSessions, 1);
    assert.equal(report.totals.tryons, 0);
    assert.equal(report.totals.creditsUsed, 0);
    assert.equal(calls(), 0);
  }));
