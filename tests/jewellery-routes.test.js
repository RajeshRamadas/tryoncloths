import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { AccountStore } from "./helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../server/app.js";
import { JewelleryStore } from "../server/jewellery-store.js";
import { handsTemplate } from "../server/hands-templates.js";
import { normalizeJewelleryView } from "../server/jewellery-tryon.js";
import { ProviderError } from "../server/provider-errors.js";

const url = (bytes) => "data:image/png;base64," + Buffer.from(bytes).toString("base64");
const template = await handsTemplate("male", "medium");
const portrait = await sharp({
  create: { width: 1152, height: 1536, channels: 3, background: "#d4d1c8" },
})
  .png()
  .toBuffer();
const photo = url(
  await sharp({ create: { width: 220, height: 220, channels: 3, background: "#ca9f35" } })
    .png()
    .toBuffer(),
);
const approve = (preview) => ({
  image: preview.image,
  receipt: preview.receipt,
  reviewed: true,
  storageConsent: true,
});
async function saveView(store, account, avatar, kind) {
  const c = store.views.context(account, avatar.id, kind),
    image = url(kind === "hands" ? template.png : portrait);
  const receipt = store.views.receipt(account, avatar.id, kind, c, image, {
    tone: "medium",
    sourceKind: kind === "hands" ? "template" : "generated",
  });
  await store.views.approve(account, avatar.id, kind, {
    image,
    receipt,
    reviewed: true,
    storageConsent: true,
  });
  return image;
}
async function fixture(run, { generate, extra = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-jewellery-api-")),
    store = new AccountStore(directory);
  const a = await store.register({
      email: "jewel-a@example.test",
      name: "A store",
      password: "test-password-long",
    }),
    b = await store.register({
      email: "jewel-b@example.test",
      name: "B store",
      password: "test-password-long",
    });
  const token = store.session(a),
    ca = "forme_session=" + token,
    cb = "forme_session=" + store.session(b);
  const avatarImage = url(await standardAvatar("regular")),
    avatar = await store.save(a, {
      image: avatarImage,
      name: "Customer A",
      profileId: "regular",
      heightCm: 175,
      weightKg: 72,
      source: "imported",
    });
  await saveView(store, a, avatar, "hands");
  await saveView(store, a, avatar, "portrait");
  const item = (
    await store.garments.save(
      a,
      {
        category: "jewellery",
        garmentType: "ring",
        attributes: { metal: "yellow_gold", ringSizeIn: 14 },
        name: "Gold ring",
        image: photo,
      },
      { jewelleryEnabled: true },
    )
  ).garment;
  let calls = 0;
  const seen = [];
  const app = createApp({
    accountStore: store,
    accessMode: "public",
    provider: "gemini",
    apiKey: "test-key-only",
    model: "test-jewellery-model",
    jewelleryEnabled: true,
    rateLimit: false,
    ...extra,
    jewelleryOptions: {
      generate: async (input) => {
        calls++;
        seen.push(input);
        if (generate) return generate(input);
        return url(
          await sharp(input.base)
            .composite([
              {
                input: { create: { width: 50, height: 12, channels: 3, background: "#e3b332" } },
                left: 800,
                top: 324,
              },
            ])
            .png()
            .toBuffer(),
        );
      },
      ...extra.jewelleryOptions,
    },
  });
  const server = app.listen(0, "127.0.0.1");
  // Image work between requests can leave a pooled fetch socket idle for longer than the
  // default 5 s server keep-alive on slow CI runners. The server and client share one event
  // loop, so the server may close that socket just as fetch reuses it (ECONNRESET).
  server.keepAliveTimeout = 60_000;
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (endpoint, method = "POST", body, cookie = ca, origin = base) =>
    fetch(base + endpoint, {
      method,
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const input = {
    avatarId: avatar.id,
    view: "hands",
    itemId: item.id,
    hand: "right",
    finger: "ring",
    consent: true,
    consentScope: "view-and-item",
    consentProvider: "gemini",
  };
  const create = (changes = {}, cookie = ca) =>
    request(
      "/api/jewellery/tryon",
      "POST",
      { ...input, requestId: randomUUID(), ...changes },
      cookie,
    );
  const save = (p) =>
    request("/api/jewellery/results/" + p.resultId + "/approve", "POST", approve(p));
  try {
    await run({
      store,
      a,
      b,
      avatar,
      avatarImage,
      item,
      input,
      token,
      ca,
      cb,
      base,
      request,
      create,
      save,
      directory,
      app,
      calls: () => calls,
      seen,
    });
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("one paid request stores nothing until review; exact approved reuse costs no credit and survives restart", async () =>
  fixture(
    async ({ store, a, avatar, input, create, save, request, calls, seen, directory, app }) => {
      const before = store.billing.balance(a.org),
        first = await create();
      assert.equal(first.status, 200);
      const result = await first.json();
      assert.equal(result.view, "hands");
      assert.equal(result.kind, "jewellery-tryon");
      assert.equal(result.reused, false);
      assert.equal(result.creditsUsed, 1);
      assert.equal(result.needsReview, true);
      assert.ok(result.receipt);
      assert.equal(calls(), 1);
      assert.equal(store.db.prepare("SELECT count(*) n FROM garment_results").get().n, 0);
      assert.equal(store.billing.balance(a.org), before - 1);
      assert.equal(seen[0].type, "ring");
      assert.equal(seen[0].finger, "ring");
      assert.equal(seen[0].hand, "right");
      assert.deepEqual(seen[0].anchors, template.anchors);
      assert.ok(seen[0].base.every((x) => x === 0));
      assert.ok(seen[0].product.every((x) => x === 0));
      assert.equal((await save(result)).status, 200);
      assert.equal((await save(result)).status, 200, "approval is idempotent");
      const row = store.db.prepare("SELECT * FROM garment_results").get();
      assert.equal(row.view, "hands");
      assert.equal(row.avatarId, avatar.id);
      const reuse = await (await create()).json();
      assert.equal(reuse.reused, true);
      assert.equal(reuse.creditsUsed, 0);
      assert.equal(reuse.image, result.image);
      assert.equal(calls(), 1);
      assert.equal(store.billing.balance(a.org), before - 1);
      const reopened = new AccountStore(directory);
      try {
        const service = new JewelleryStore(reopened),
          context = await service.context(a, input, {
            provider: "gemini",
            model: "test-jewellery-model",
          });
        assert.equal(service.cached(a, context).image, result.image);
        assert.equal((await service.approve(a, result.resultId, approve(result))).ok, true);
        assert.deepEqual(reopened.db.prepare("PRAGMA foreign_key_check").all(), []);
      } finally {
        reopened.close();
      }
      const balance = store.billing.balance(a.org);
      store.db
        .prepare(
          "INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','zero-test',?)",
        )
        .run(randomUUID(), a.org, -balance, Date.now());
      assert.equal((await (await create()).json()).reused, true);
      assert.equal(store.billing.balance(a.org), 0);
      const noKey = createApp({
        accountStore: store,
        accessMode: "public",
        provider: "gemini",
        apiKey: "",
        model: "test-jewellery-model",
        jewelleryEnabled: true,
      });
      const server = noKey.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      try {
        const root = "http://127.0.0.1:" + server.address().port,
          response = await fetch(root + "/api/jewellery/tryon", {
            method: "POST",
            headers: {
              Cookie: "forme_session=" + store.session(a),
              Origin: root,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...input, requestId: randomUUID() }),
          });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).reused, true);
      } finally {
        await new Promise((r) => server.close(r));
      }
      const health = await (await request("/api/health", "GET")).json();
      assert.equal(health.jewelleryAvailable, true);
      assert.equal(health.jewelleryContract, "jewellery-tryon-v1");
      assert.equal(health.jewelleryTypes.length, 20);
      assert.equal(app.locals.jewellery instanceof JewelleryStore, true);
    },
  ));

test("owner, manager and staff can generate and approve; anonymous and other stores cannot access the flow", async () =>
  fixture(async ({ store, a, b, input, cb, request, create, save, calls }) => {
    const before = store.billing.balance(a.org);
    assert.equal((await create({}, "")).status, 401);
    assert.equal((await create({}, cb)).status, 404);
    assert.equal(
      (
        await request(
          "/api/jewellery/tryon",
          "POST",
          { ...input, requestId: randomUUID() },
          undefined,
          "https://evil.test",
        )
      ).status,
      403,
    );
    for (const role of ["manager", "staff"]) {
      store.db
        .prepare(
          "INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(user,store) DO UPDATE SET role=excluded.role",
        )
        .run(b.user.id, a.id, role);
      const cookie = "forme_session=" + store.session(store.identity(b.user.id, a.id)),
        response = await create({ finger: role === "manager" ? "index" : "middle" }, cookie);
      assert.equal(response.status, 200);
      const preview = await response.json();
      assert.equal((await save(preview)).status, 409, "receipt binds the initiating user");
      assert.equal(
        (
          await request(
            "/api/jewellery/results/" + preview.resultId + "/approve",
            "POST",
            approve(preview),
            cookie,
          )
        ).status,
        200,
      );
    }
    const preview = await (await create()).json(),
      path = "/api/jewellery/results/" + preview.resultId + "/approve";
    assert.equal((await request(path, "POST", approve(preview), "")).status, 401);
    assert.equal((await request(path, "POST", approve(preview), cb)).status, 409);
    assert.equal(
      (await request(path, "POST", approve(preview), undefined, "https://evil.test")).status,
      403,
    );
    assert.equal((await save(preview)).status, 200);
    assert.equal(calls(), 3);
    assert.equal(store.billing.balance(a.org), before - 3);
  }));

test("exact consent, request IDs, view, placement, catalogue ownership and bounded images fail before metering", async () =>
  fixture(async ({ store, a, b, input, item, avatar, create, request, calls }) => {
    const before = store.billing.balance(a.org),
      other = (
        await store.garments.save(
          b,
          {
            category: "jewellery",
            name: "Other ring",
            garmentType: "ring",
            attributes: { metal: "silver" },
            image: photo,
          },
          { jewelleryEnabled: true },
        )
      ).garment;
    for (const changes of [
      { consent: false },
      { consentScope: "avatar-and-garment" },
      { consentProvider: "openai" },
      { requestId: "not-uuid" },
      { view: "portrait" },
      { finger: "head" },
      { hand: "both" },
      { replaceExisting: "all" },
      { attributes: { metal: "silver" } },
      { type: "ring" },
      { itemId: undefined, image: "bad", type: "ring", attributes: { metal: "silver" } },
      { itemId: undefined, image: photo, type: "bad", attributes: { metal: "silver" } },
      { store: b.id },
      { avatarId: null },
      { itemId: {} },
      { baseResultId: "invalid" },
      { baseReviewed: "true" },
      { secondAngle: "bad" },
      { base: "bad" },
      { base: url(await sharp(template.png).resize(512, 512).png().toBuffer()) },
    ])
      assert.ok([400, 404].includes((await create(changes)).status), JSON.stringify(changes));
    assert.equal((await create({ itemId: other.id })).status, 404);
    const clothing = (
      await store.garments.save(a, { garmentType: "shirt", name: "Shirt", image: photo })
    ).garment;
    assert.equal((await create({ itemId: clothing.id })).status, 404);
    store.db.prepare("UPDATE garments SET stock='out' WHERE account=? AND id=?").run(a.id, item.id);
    assert.equal((await create()).status, 409);
    assert.equal(calls(), 0);
    assert.equal(store.billing.balance(a.org), before);
    assert.equal(store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='hold'").get().n, 0);
  }));

test("flag, account storage and provider configuration gate generation and expose honest capabilities", async () => {
  await fixture(
    async ({ create, request, calls }) => {
      assert.equal((await create()).status, 404);
      const h = await (await request("/api/health", "GET")).json();
      assert.equal(h.jewelleryAvailable, false);
      assert.equal(calls(), 0);
    },
    { extra: { jewelleryEnabled: false } },
  );
  for (const config of [{ provider: "openai" }, { apiKey: "" }])
    await fixture(
      async ({ create, request, calls }) => {
        assert.equal((await create()).status, 503);
        assert.equal(
          (await (await request("/api/health", "GET")).json()).jewelleryAvailable,
          false,
        );
        assert.equal(calls(), 0);
      },
      { extra: config },
    );
  const server = createApp({ accessMode: "public", jewelleryEnabled: true, apiKey: "test" }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  try {
    assert.equal(
      (
        await fetch("http://127.0.0.1:" + server.address().port + "/api/jewellery/tryon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      404,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("identity, face, framing, hands and provider failures refund exactly once with safe codes and no retries", async () => {
  for (const failure of [
    "identity_mismatch",
    "missing_face",
    "framing_changed",
    "hands_changed",
    "face_check",
    "quota",
    "timeout",
    "network",
    "blocked",
    "no_image",
    "invalid_image",
    "credentials",
    "model",
    "unavailable",
    "request",
    "response",
    "unknown",
  ])
    await fixture(
      async ({ store, a, create, calls }) => {
        const before = store.billing.balance(a.org),
          response = await create();
        assert.equal(response.status, 502);
        const error = await response.json();
        assert.equal(error.code, failure);
        assert.equal(error.image, undefined);
        assert.equal(error.receipt, undefined);
        assert.doesNotMatch(JSON.stringify(error), /test-key-only|PRIVATE/);
        assert.equal(calls(), 1);
        assert.equal(store.billing.balance(a.org), before);
        assert.equal(
          store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='refund'").get().n,
          1,
        );
        assert.equal(store.db.prepare("SELECT count(*) n FROM garment_results").get().n, 0);
      },
      {
        generate: async () => {
          throw new ProviderError(failure);
        },
      },
    );
  await fixture(
    async ({ store, a, create, calls }) => {
      const before = store.billing.balance(a.org),
        response = await create();
      assert.equal(response.status, 502);
      assert.equal((await response.json()).code, "invalid_image");
      assert.equal(store.billing.balance(a.org), before);
      assert.equal(calls(), 1);
    },
    { generate: async () => url(portrait) },
  );
});

test("approval requires original output, exact receipt, explicit review and storage consent", async () =>
  fixture(async ({ store, create, save, request }) => {
    const p = await (await create()).json(),
      endpoint = "/api/jewellery/results/" + p.resultId + "/approve";
    const altered = url(
      await sharp(Buffer.from(p.image.split(",")[1], "base64"))
        .modulate({ brightness: 0.5 })
        .png()
        .toBuffer(),
    );
    for (const changes of [
      { reviewed: false },
      { storageConsent: false },
      { receipt: p.receipt + "0" },
      { image: altered },
      { receipt: undefined },
    ])
      assert.ok(
        [400, 409].includes(
          (await request(endpoint, "POST", { ...approve(p), ...changes })).status,
        ),
      );
    assert.equal(
      (await request("/api/jewellery/results/" + "0".repeat(64) + "/approve", "POST", approve(p)))
        .status,
      409,
    );
    assert.equal(store.db.prepare("SELECT count(*) n FROM garment_results").get().n, 0);
    assert.equal((await save(p)).status, 200);
  }));

test("reuse includes placement, starting-state hash, second angle, product attributes and model", async () =>
  fixture(async ({ store, a, avatar, input, create, save, calls, app }) => {
    const p = await (await create()).json();
    await save(p);
    const changed = await (await create({ finger: "index" })).json();
    assert.equal(changed.reused, false);
    assert.notEqual(changed.resultId, p.resultId);
    await save(changed);
    const angle = await (await create({ secondAngle: photo })).json();
    assert.equal(angle.reused, false);
    assert.notEqual(angle.resultId, p.resultId);
    await save(angle);
    assert.equal((await (await create({ secondAngle: photo })).json()).reused, true);
    const s = app.locals.jewellery,
      first = await s.context(a, input, { provider: "gemini", model: "test-jewellery-model" }),
      other = await s.context(a, input, { provider: "gemini", model: "another-model" });
    assert.notEqual(first.id, other.id);
    assert.equal(s.cached(a, other), null);
    const next = await (
      await create({ base: p.image, baseReceipt: p.receipt, baseReviewed: true })
    ).json();
    assert.equal(next.reused, false);
    assert.notEqual(next.resultId, p.resultId);
    await save(next);
    assert.equal(
      (await (await create({ base: p.image, baseResultId: p.resultId })).json()).reused,
      true,
    );
    assert.equal(calls(), 4);
    store.db
      .prepare("UPDATE garments SET attributesJson=? WHERE account=? AND id=?")
      .run(JSON.stringify({ metal: "silver", ringSizeIn: 14, pair: false }), a.id, input.itemId);
    assert.equal(
      (await create({ base: p.image, baseReceipt: p.receipt, baseReviewed: true })).status,
      409,
    );
    assert.equal((await (await create()).json()).reused, false);
    assert.equal(calls(), 5);
  }));

test("arbitrary bases and cross-view or cross-user receipts cannot become customer input", async () =>
  fixture(async ({ store, a, b, avatar, create, request, cb, calls }) => {
    const p = await (await create()).json(),
      before = calls();
    assert.equal((await create({ base: p.image })).status, 400);
    assert.equal((await create({ base: p.image, baseReceipt: p.receipt })).status, 400);
    assert.equal(
      (
        await create({
          base: p.image,
          baseReceipt: p.receipt,
          baseReviewed: true,
          baseResultId: p.resultId,
        })
      ).status,
      400,
    );
    assert.equal(
      (await create({ base: p.image, baseReceipt: p.receipt + "0", baseReviewed: true })).status,
      409,
    );
    const modified = url(
      await sharp(Buffer.from(p.image.split(",")[1], "base64"))
        .modulate({ brightness: 0.8 })
        .png()
        .toBuffer(),
    );
    assert.equal(
      (await create({ base: modified, baseReceipt: p.receipt, baseReviewed: true })).status,
      409,
    );
    assert.equal((await create({ base: p.image, baseResultId: "0".repeat(64) })).status, 409);
    const other = await store.save(a, {
      image: url(await standardAvatar("broad")),
      name: "Different customer",
      profileId: "broad",
      heightCm: 175,
      weightKg: 95,
      source: "imported",
    });
    await saveView(store, a, other, "hands");
    assert.equal(
      (
        await create({
          avatarId: other.id,
          base: p.image,
          baseReceipt: p.receipt,
          baseReviewed: true,
        })
      ).status,
      409,
    );
    store.db.prepare("INSERT INTO memberships VALUES(?,?,'staff')").run(b.user.id, a.id);
    const staff = "forme_session=" + store.session(store.identity(b.user.id, a.id));
    assert.equal(
      (await create({ base: p.image, baseReceipt: p.receipt, baseReviewed: true }, staff)).status,
      409,
    );
    assert.equal(calls(), before);
  }));

test("portrait/full catalogue items and uploaded images use the correct view and a second product angle", async () =>
  fixture(async ({ store, a, create, save, calls, seen }) => {
    const necklace = (
      await store.garments.save(
        a,
        {
          category: "jewellery",
          name: "Chain",
          garmentType: "necklace",
          attributes: { metal: "silver", lengthCm: 45 },
          image: photo,
        },
        { jewelleryEnabled: true },
      )
    ).garment;
    const p = await create({
      itemId: necklace.id,
      view: "portrait",
      hand: undefined,
      finger: undefined,
    });
    assert.equal(p.status, 200);
    const pp = await p.json();
    assert.equal(pp.view, "portrait");
    assert.equal((await save(pp)).status, 200);
    const full = await create({
      itemId: necklace.id,
      view: "full",
      hand: undefined,
      finger: undefined,
      secondAngle: photo,
    });
    assert.equal(full.status, 200);
    assert.equal((await full.json()).view, "full");
    assert.ok(
      seen[1].secondAngle.every((x) => x === 0),
      "owned secondary image is cleared",
    );
    const upload = await create({
      itemId: undefined,
      image: photo,
      type: "ring",
      attributes: { metal: "silver" },
      title: "Uploaded ring",
    });
    assert.equal(upload.status, 200);
    const u = await upload.json();
    assert.equal(u.reuseAvailable, false);
    assert.ok(u.receipt, "upload can be explicitly reviewed for stacking");
    assert.equal((await save(u)).status, 400);
    assert.equal(
      (await create({ base: u.image, baseReceipt: u.receipt, baseReviewed: true })).status,
      200,
    );
    assert.equal(calls(), 4);
  }));

test("an identical in-flight adaptation is blocked across workers, and shared slot exhaustion refunds without calling the provider", async () => {
  let entered, release;
  const started = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (release = r));
  await fixture(
    async ({ store, a, input, create, app, directory, calls }) => {
      const pending = create();
      await started;
      try {
        assert.equal((await create()).status, 409);
        const reopened = new AccountStore(directory),
          other = new JewelleryStore(reopened);
        try {
          const context = await other.context(a, input, {
            provider: "gemini",
            model: "test-jewellery-model",
          });
          assert.throws(() => other.acquire(a, context), { status: 409 });
        } finally {
          reopened.close();
        }
        assert.equal(calls(), 1);
      } finally {
        release();
        assert.equal((await pending).status, 200);
      }
    },
    {
      generate: async (input) => {
        entered();
        await gate;
        return url(input.base);
      },
    },
  );
  await fixture(async ({ store, a, create, calls }) => {
    const first = store.imageSlots.acquire(),
      second = store.imageSlots.acquire(),
      before = store.billing.balance(a.org);
    try {
      assert.equal((await create()).status, 429);
      assert.equal(calls(), 0);
      assert.equal(store.billing.balance(a.org), before);
    } finally {
      store.imageSlots.release(first);
      store.imageSlots.release(second);
    }
  });
});

test("revoked sessions, removed avatars, replaced views, changed products and suspension cancel generation and refund", async () => {
  for (const change of ["session", "avatar", "view", "product", "suspension"]) {
    let entered, release, signal;
    const started = new Promise((r) => (entered = r)),
      gate = new Promise((r) => (release = r));
    await fixture(
      async ({ store, a, avatar, item, token, create, calls }) => {
        const before = store.billing.balance(a.org),
          pending = create();
        await started;
        try {
          if (change === "session") store.logout(token);
          if (change === "avatar") store.remove(a, avatar.id);
          if (change === "view") store.views.remove(a, avatar.id, "hands");
          if (change === "product")
            store.db
              .prepare("UPDATE garments SET name=? WHERE account=? AND id=?")
              .run("Changed product", a.id, item.id);
          if (change === "suspension")
            store.db.prepare("UPDATE orgs SET status='suspended' WHERE id=?").run(a.org);
          const response = await pending;
          assert.equal(
            response.status,
            change === "session"
              ? 401
              : change === "avatar"
                ? 404
                : change === "suspension"
                  ? 403
                  : 409,
          );
          assert.ok(signal.aborted);
          assert.equal(store.billing.balance(a.org), before);
          assert.equal(calls(), 1);
          assert.equal(store.db.prepare("SELECT count(*) n FROM jewellery_jobs").get().n, 0);
          assert.equal(store.db.prepare("SELECT count(*) n FROM garment_results").get().n, 0);
        } finally {
          release();
          await pending;
        }
      },
      {
        generate: async (input) => {
          signal = input.signal;
          entered();
          await gate;
          return url(input.base);
        },
      },
    );
  }
});

test("view/visual changes invalidate receipts and reuse; deleting the avatar cascades saved jewellery", async () =>
  fixture(async ({ store, a, avatar, avatarImage, create, save, calls }) => {
    const p = await (await create()).json();
    await save(p);
    assert.equal((await (await create()).json()).reused, true);
    store.views.remove(a, avatar.id, "hands");
    assert.equal(store.db.prepare("SELECT count(*) n FROM garment_results").get().n, 0);
    assert.equal((await save(p)).status, 409);
    await saveView(store, a, avatar, "hands");
    assert.equal((await (await create()).json()).reused, false);
    store.db
      .prepare("UPDATE avatars SET template_tone='light' WHERE account=? AND id=?")
      .run(a.id, avatar.id);
    assert.equal((await save(p)).status, 409);
    store.remove(a, avatar.id);
    await store.save(a, {
      image: avatarImage,
      name: "Recreated",
      profileId: "regular",
      heightCm: 175,
      weightKg: 72,
      source: "imported",
    });
    assert.equal((await save(p)).status, 409);
    assert.equal(calls(), 2);
  }));

test("expiry, receipt/storage failures and trial watermark keep the paid original without automatic regeneration", async () => {
  await fixture(async ({ app, store, a, create, calls }) => {
    app.locals.jewellery.receipt = () => {
      throw new Error("PRIVATE");
    };
    const before = store.billing.balance(a.org),
      p = await (await create()).json();
    assert.ok(p.image);
    assert.equal(p.receiptUnavailable, true);
    assert.doesNotMatch(JSON.stringify(p), /PRIVATE/);
    assert.equal(calls(), 1);
    assert.equal(store.billing.balance(a.org), before - 1);
  });
  await fixture(async ({ store, a, create, save }) => {
    store.db
      .prepare("UPDATE orgs SET plan='trial',status='trial',trialEndsAt=? WHERE id=?")
      .run(Date.now() + 86400000, a.org);
    const p = await (await create()).json();
    assert.equal((await save(p)).status, 200);
    assert.equal((await (await create()).json()).image, p.image);
    const now = Date.now;
    try {
      Date.now = () => now() + 25 * 3600000;
      assert.equal((await save(p)).status, 409);
    } finally {
      Date.now = now;
    }
  });
});

test("durable attempt limits count refunded holds and duplicate request IDs cannot cause another provider call", async () => {
  await fixture(async ({ store, a, create, calls }) => {
    const requestId = randomUUID();
    assert.equal((await create({ requestId })).status, 200);
    assert.equal((await create({ requestId: requestId.toUpperCase() })).status, 409);
    assert.equal(calls(), 1);
  });
  await fixture(
    async ({ store, a, create, calls }) => {
      const before = store.billing.balance(a.org);
      for (let i = 0; i < 20; i++) {
        const hold = randomUUID();
        store.db
          .prepare(
            "INSERT INTO ledger(id,org,store,user,pool,amount,kind,ref,requestId,action,createdAt) VALUES(?,?,?,?,'ai',-1,'hold','tryon',?,'tryon',?)",
          )
          .run(hold, a.org, a.id, a.user.id, randomUUID(), Date.now() - 60000 - i * 16000);
        store.billing.refund(hold, "fixture");
      }
      assert.equal((await create()).status, 429);
      assert.equal(calls(), 0);
      assert.equal(store.billing.balance(a.org), before);
    },
    { extra: { rateLimit: true } },
  );
});

test("approval rechecks the live HTTP session after asynchronous image decoding", async () =>
  fixture(async ({ store, app, token, create, save }) => {
    const p = await (await create()).json(),
      original = app.locals.jewellery.claims.bind(app.locals.jewellery);
    app.locals.jewellery.claims = (...args) => {
      const claims = original(...args);
      store.logout(token);
      return claims;
    };
    assert.equal((await save(p)).status, 401);
    assert.equal(store.db.prepare("SELECT count(*) n FROM garment_results").get().n, 0);
  }));

test("disconnecting the browser aborts the provider signal and refunds exactly once", async () => {
  let entered, release, signal;
  const started = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (release = r));
  await fixture(
    async ({ store, a, input, base, ca, calls }) => {
      const before = store.billing.balance(a.org),
        controller = new AbortController(),
        pending = fetch(base + "/api/jewellery/tryon", {
          method: "POST",
          headers: { Cookie: ca, Origin: base, "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, requestId: randomUUID() }),
          signal: controller.signal,
        });
      await started;
      try {
        controller.abort();
        await assert.rejects(pending, { name: "AbortError" });
        for (let i = 0; i < 100 && store.billing.balance(a.org) !== before; i++)
          await new Promise((r) => setTimeout(r, 10));
        assert.ok(signal.aborted);
        assert.equal(store.billing.balance(a.org), before);
        assert.equal(
          store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='refund'").get().n,
          1,
        );
        assert.equal(calls(), 1);
      } finally {
        release();
        await pending.catch(() => {});
      }
    },
    {
      generate: async (input) => {
        signal = input.signal;
        entered();
        await gate;
        return url(input.base);
      },
    },
  );
});

test("zero credits and the female pilot flag reject paid work, and result capacity never overwrites another reviewed output", async () => {
  await fixture(async ({ store, a, create, calls }) => {
    const balance = store.billing.balance(a.org);
    store.db
      .prepare(
        "INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','zero-test',?)",
      )
      .run(randomUUID(), a.org, -balance, Date.now());
    assert.equal((await create()).status, 402);
    assert.equal(calls(), 0);
  });
  await fixture(async ({ store, a, create, calls }) => {
    const female = await store.save(a, {
      image: url(await standardAvatar("f-regular")),
      name: "Female customer",
      profileId: "f-regular",
      heightCm: 165,
      weightKg: 62,
      source: "imported",
    });
    await saveView(store, a, female, "hands");
    assert.equal((await create({ avatarId: female.id })).status, 400);
    assert.equal(calls(), 0);
  });
  let count = 0;
  await fixture(
    async ({ store, a, create, save, calls }) => {
      const first = await (await create()).json(),
        second = await (await create()).json();
      assert.equal(first.resultId, second.resultId);
      assert.notEqual(first.image, second.image);
      await save(first);
      assert.equal((await save(second)).status, 409);
      assert.equal((await (await create()).json()).image, first.image);
      const copy = store.db.prepare(
        "INSERT INTO garment_results(account,id,avatarId,garmentId,image,savedAt,view) SELECT account,?,avatarId,garmentId,image,savedAt,view FROM garment_results WHERE account=? AND id=?",
      );
      for (let i = 0; i < 199; i++) copy.run("copy-" + i, a.id, first.resultId);
      const other = await (await create({ finger: "index" })).json();
      assert.equal((await save(other)).status, 409);
      assert.equal((await save(first)).status, 200);
      assert.equal(calls(), 3);
    },
    {
      generate: async (input) =>
        url(
          await sharp(input.base)
            .modulate({ brightness: ++count === 1 ? 0.95 : 0.85 })
            .png()
            .toBuffer(),
        ),
    },
  );
});

test("J8 hands looks retain view/item metadata, reopen free and share only labelled images without changing raw pixels", async () =>
  fixture(async ({ store, a, avatar, item, create, request, base, calls, directory }) => {
    const p = await (await create()).json(),
      before = store.billing.balance(a.org);
    const input = {
      avatarId: avatar.id,
      view: "hands",
      name: "Evening ring",
      image: p.image,
      receipt: p.receipt,
      itemsJson: [
        {
          itemId: item.id,
          name: item.name,
          type: "ring",
          attributes: item.attributes,
          hand: "right",
          finger: "ring",
        },
      ],
      reviewed: true,
      storageConsent: true,
    };
    const saved = await request("/api/jewellery/looks", "POST", input);
    assert.equal(saved.status, 200);
    const look = await saved.json();
    const listed = (await (await request("/api/looks?avatar=" + avatar.id, "GET")).json()).looks[0];
    assert.equal(listed.view, "hands");
    assert.equal(listed.itemsJson[0].type, "ring");
    assert.equal(listed.itemsJson[0].hand, "right");
    assert.equal((await sharp(store.lookImage(a, look.id)).metadata()).height, 1024);
    const opened = await (await request("/api/jewellery/looks/" + look.id, "GET")).json();
    assert.equal(opened.name, "Evening ring");
    assert.equal(opened.avatarId, avatar.id);
    assert.equal(opened.view, "hands");
    assert.equal(
      (
        await request("/api/jewellery/looks", "POST", {
          ...input,
          image: opened.image,
          receipt: undefined,
          baseLookId: look.id,
          itemsJson: opened.itemsJson,
        })
      ).status,
      200,
    );
    const share = await (
      await request("/api/looks/" + look.id + "/share", "POST", { days: 7, sharingConsent: true })
    ).json();
    const html = await (await fetch(share.url)).text();
    assert.match(html, /AI preview — actual piece may differ in detail/);
    assert.match(html, /Gold ring/);
    const image = Buffer.from(await (await fetch(share.url + "/image")).arrayBuffer());
    assert.equal((await sharp(image).metadata()).height, 1076);
    assert.equal((await sharp(store.lookImage(a, look.id)).metadata()).height, 1024);
    assert.equal(calls(), 1);
    assert.equal(store.billing.balance(a.org), before);
    const reopened = new AccountStore(directory);
    try {
      assert.equal(reopened.listLooks(a, avatar.id)[0].view, "hands");
      assert.equal(reopened.listLooks(a, avatar.id)[0].itemsJson[0].itemId, item.id);
    } finally {
      reopened.close();
    }
    const next = await create({ base: opened.image, baseLookId: look.id, baseReviewed: true });
    assert.equal(next.status, 200);
    assert.equal((await next.json()).reused, false);
    assert.equal(calls(), 2);
  }));

test("J8 look saves enforce review, original verified output, current session, tenant, view and item boundaries", async () =>
  fixture(async ({ store, a, b, avatar, item, create, request, cb, calls }) => {
    const p = await (await create()).json(),
      input = {
        avatarId: avatar.id,
        view: "hands",
        name: "Private ring",
        image: p.image,
        receipt: p.receipt,
        itemsJson: [
          {
            itemId: item.id,
            name: item.name,
            type: "ring",
            attributes: item.attributes,
            hand: "right",
            finger: "ring",
          },
        ],
        reviewed: true,
        storageConsent: true,
      };
    for (const change of [
      { reviewed: false },
      { storageConsent: false },
      { receipt: undefined },
      { view: "portrait" },
      { itemsJson: [] },
      { itemsJson: Array(11).fill(input.itemsJson[0]) },
      { image: url(await sharp(template.png).modulate({ brightness: 0.5 }).png().toBuffer()) },
      { store: b.id },
    ])
      assert.ok(
        [400, 409].includes(
          (await request("/api/jewellery/looks", "POST", { ...input, ...change })).status,
        ),
      );
    assert.equal((await request("/api/jewellery/looks", "POST", input, "")).status, 401);
    assert.equal((await request("/api/jewellery/looks", "POST", input, cb)).status, 404);
    const saved = await (await request("/api/jewellery/looks", "POST", input)).json();
    assert.equal(
      (await request("/api/jewellery/looks/" + saved.id, "GET", undefined, cb)).status,
      404,
    );
    assert.equal(
      (await request("/api/jewellery/looks/" + saved.id, "GET", undefined, "")).status,
      401,
    );
    assert.equal(
      (await request("/api/looks", "POST", { ...input, garments: ["Ring"] })).status,
      400,
      "legacy clothing path cannot accept square hands looks",
    );
    assert.equal(calls(), 1);
  }));

test("J8 bangle count is a validated preview override and changes reuse without editing the catalogue", async () =>
  fixture(async ({ store, a, create, calls }) => {
    const item = (
      await store.garments.save(
        a,
        {
          category: "jewellery",
          name: "Bangles",
          garmentType: "bangles",
          attributes: { metal: "silver", count: 2 },
          image: photo,
        },
        { jewelleryEnabled: true },
      )
    ).garment;
    const p = await create({
      itemId: item.id,
      hand: undefined,
      finger: undefined,
      wrist: "left",
      count: 4,
    });
    assert.equal(p.status, 200);
    assert.equal(
      store.garments.get(a, item.id, { category: "jewellery", jewelleryEnabled: true }).attributes
        .count,
      2,
    );
    assert.equal(
      (
        await create({
          itemId: item.id,
          hand: undefined,
          finger: undefined,
          wrist: "left",
          count: 25,
        })
      ).status,
      400,
    );
    assert.equal((await create({ count: 4 })).status, 400);
    assert.equal(calls(), 1);
  }));

test("saved sets, shares and purchase marks snapshot jewellery attribution and survive later look erasure without storing names or photos", async () =>
  fixture(async ({ store, a, avatar, item, create, request }) => {
    const sessionId = randomUUID(),
      first = await (await create({ sessionId })).json(),
      second = await (
        await create({
          sessionId,
          finger: "index",
          base: first.image,
          baseReceipt: first.receipt,
          baseReviewed: true,
        })
      ).json();
    const piece = {
      itemId: item.id,
      name: item.name,
      type: "ring",
      attributes: item.attributes,
      hand: "right",
      finger: "ring",
    };
    const body = {
      avatarId: avatar.id,
      view: "hands",
      image: second.image,
      name: "Reviewed set",
      itemsJson: [piece, { ...piece, finger: "index" }],
      receipt: second.receipt,
      reviewed: true,
      storageConsent: true,
      sessionId,
    };
    const saved = await request("/api/jewellery/looks", "POST", body);
    assert.equal(saved.status, 200, await saved.clone().text());
    const look = await saved.json();
    assert.equal(
      (await request("/api/jewellery/looks", "POST", { ...body, name: "Renamed set" })).status,
      200,
    );
    const share = await (
      await request("/api/looks/" + look.id + "/share", "POST", { sharingConsent: true, days: 1 })
    ).json();
    assert.equal((await fetch(share.url)).status, 200);
    assert.equal(
      (await request("/api/looks/" + look.id + "/purchase", "POST", { size: "Adjustable" })).status,
      200,
    );
    assert.equal(
      (await request("/api/looks/" + look.id + "/purchase", "POST", { size: "Adjustable" })).status,
      200,
    );
    store.removeLook(a, look.id);
    const report = store.analytics.report(a, {}, Date.now(), { jewelleryEnabled: true }),
      j = report.jewellery;
    assert.equal(j.totals.tryonsGenerated, 2);
    assert.equal(j.totals.tryonSessions, 1);
    assert.equal(j.totals.looksSaved, 1);
    assert.equal(j.totals.setsSaved, 1);
    assert.equal(j.totals.purchases, 1);
    assert.equal(j.totals.looksShared, 1);
    assert.equal(j.totals.shareViews, 1);
    assert.equal(j.totals.unattributedPurchases, 0);
    assert.equal(j.products[0].purchases, 1);
    const refs = store.db
      .prepare("SELECT refJson FROM events")
      .all()
      .map((r) => JSON.parse(r.refJson));
    assert.ok(refs.every((r) => !Object.hasOwn(r, "image") && !Object.hasOwn(r, "name")));
    assert.ok(
      refs
        .filter((r) => r.lookId === look.id)
        .every((r) => r.category === "jewellery" && r.itemCount === 2 && r.view === "hands"),
    );
  }));
