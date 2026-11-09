import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { AccountStore } from "./helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../server/app.js";
import { handsTemplate } from "../server/hands-templates.js";
import { ProviderError } from "../server/provider-errors.js";
import { patchCatalogue } from "../server/catalogue-fields.js";
import { completeLayout } from "../src/complete-look.js";
import { prepareComplete, renderComplete } from "../server/jewellery-complete.js";
import { CatalogueSync } from "../server/catalogue-sync.js";
const url = (b) => "data:image/png;base64," + b.toString("base64"),
  options = { category: "jewellery", jewelleryEnabled: true };
const hands = await handsTemplate("male", "medium"),
  portrait = await sharp({
    create: { width: 1152, height: 1536, channels: 3, background: "#a94455" },
  })
    .png()
    .toBuffer();
async function fixture(
  run,
  { generate, key = "test-key", enabled = true, rateLimit = false } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "forme-j10-")),
    store = new AccountStore(directory),
    a = await store.register({
      email: "j10-a@example.test",
      name: "A",
      password: "test-password-long",
    }),
    b = await store.register({
      email: "j10-b@example.test",
      name: "B",
      password: "test-password-long",
    }),
    token = store.session(a),
    ca = "forme_session=" + token,
    cb = "forme_session=" + store.session(b),
    avatar = await store.save(a, {
      image: url(await standardAvatar("regular")),
      name: "Customer A",
      profileId: "regular",
      heightCm: 175,
      weightKg: 72,
      source: "imported",
    });
  for (const kind of ["hands", "portrait"]) {
    const c = store.views.context(a, avatar.id, kind),
      image = url(kind === "hands" ? hands.png : portrait),
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
  const saveItem = async (name, metal, variantOf, type = "ring") =>
    (
      await store.garments.save(
        a,
        {
          category: "jewellery",
          name,
          garmentType: type,
          attributes: { metal, ...(variantOf ? { variantOf } : {}) },
          image: url(
            await sharp({
              create: {
                width: 240,
                height: 240,
                channels: 3,
                background: metal === "silver" ? "#aaaaaa" : "#cc9900",
              },
            })
              .png()
              .toBuffer(),
          ),
        },
        options,
      )
    ).garment;
  const gold = await saveItem("Gold ring", "yellow_gold"),
    silver = await saveItem("Silver ring", "silver", gold.id);
  const outfit = await store.saveLook(a, {
      avatarId: avatar.id,
      name: "White tee and shorts",
      image: url(await standardAvatar("regular")),
      garments: ["White T-shirt", "Dark shorts"],
    }),
    jewel = await store.saveLook(
      a,
      {
        avatarId: avatar.id,
        name: "Evening portrait",
        image: url(portrait),
        garments: ["Gold earrings · 22K"],
      },
      {
        view: "portrait",
        itemsJson: [
          {
            itemId: null,
            name: "Gold earrings",
            type: "drop_earrings",
            attributes: { metal: "yellow_gold", pair: true },
            view: "portrait",
            side: "both",
          },
        ],
        previewMode: "overlay",
      },
    );
  let calls = 0;
  const seen = [];
  const app = createApp({
    accountStore: store,
    accessMode: "public",
    apiKey: key,
    provider: "gemini",
    model: "j10-test-model",
    jewelleryEnabled: enabled,
    rateLimit,
    jewelleryOptions: {
      generate: async (input) => {
        calls++;
        seen.push({ base: Buffer.from(input.base), title: input.title });
        if (generate) return generate(input, calls);
        return url(
          await sharp(input.base)
            .composite([
              {
                input: {
                  create: {
                    width: 28,
                    height: 12,
                    channels: 3,
                    background: input.title.includes("Silver") ? "#aaaaaa" : "#cc9900",
                  },
                },
                left: 800,
                top: 320,
              },
            ])
            .png()
            .toBuffer(),
        );
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (path, body, cookie = ca, origin = base, method = "POST") =>
    fetch(base + path, {
      method,
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const input = {
      avatarId: avatar.id,
      view: "hands",
      hand: "right",
      finger: "ring",
      itemIds: [gold.id, silver.id],
    },
    quote = async (changes = {}) => {
      const r = await request("/api/jewellery/compare", { ...input, action: "quote", ...changes });
      assert.equal(r.status, 200, await r.clone().text());
      return r.json();
    };
  const runCompare = (q, changes = {}, cookie) =>
    request(
      "/api/jewellery/compare",
      {
        ...input,
        action: "run",
        quote: q.quote,
        requestIds: [randomUUID(), randomUUID()],
        consent: true,
        consentScope: "compare-two-variants",
        consentProvider: "gemini",
        ...changes,
      },
      cookie,
    );
  const complete = { avatarId: avatar.id, outfitLookId: outfit.id, portraitLookId: jewel.id };
  try {
    await run({
      store,
      a,
      b,
      avatar,
      gold,
      silver,
      outfit,
      jewel,
      saveItem,
      token,
      ca,
      cb,
      app,
      request,
      input,
      quote,
      runCompare,
      complete,
      calls: () => calls,
      seen,
      directory,
    });
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const approve = (e) => ({
  image: e.result.image,
  receipt: e.result.receipt,
  reviewed: true,
  storageConsent: true,
});

test("cost quote makes no paid request; two variants use the identical base and independent credits; reviewed reuse is free", async () =>
  fixture(async ({ store, a, request, quote, runCompare, calls, seen }) => {
    const before = store.billing.balance(a.org),
      q = await quote();
    assert.equal(q.credits, 2);
    assert.equal(calls(), 0);
    assert.equal(store.billing.balance(a.org), before);
    const response = await runCompare(q);
    assert.equal(response.status, 200, await response.clone().text());
    const p = await response.json();
    assert.equal(p.partial, false);
    assert.equal(p.results.length, 2);
    assert.equal(p.creditsUsed, 2);
    assert.equal(calls(), 2);
    assert.deepEqual(seen[0].base, seen[1].base);
    assert.notEqual(p.results[0].result.resultId, p.results[1].result.resultId);
    for (const e of p.results)
      assert.equal(
        (await request("/api/jewellery/results/" + e.result.resultId + "/approve", approve(e)))
          .status,
        200,
      );
    const free = await quote();
    assert.equal(free.credits, 0);
    const reused = await (await runCompare(free)).json();
    assert.ok(reused.results.every((e) => e.result.reused));
    assert.equal(reused.creditsUsed, 0);
    assert.equal(calls(), 2);
    assert.equal(store.billing.balance(a.org), before - 2);
  }));
test("an approved variant reduces the quote to one; administrative linking retains paid reuse while visual edits invalidate it", async () =>
  fixture(async ({ store, a, gold, silver, request, quote, runCompare }) => {
    const p = await (await runCompare(await quote())).json(),
      entry = p.results[1];
    await request("/api/jewellery/results/" + entry.result.resultId + "/approve", approve(entry));
    assert.equal((await quote()).credits, 1);
    patchCatalogue(store.db, a, silver.id, { attributes: { metal: "silver" } }, options);
    assert.equal(store.db.prepare("SELECT count(*) n FROM garment_results").get().n, 1);
    patchCatalogue(
      store.db,
      a,
      silver.id,
      { attributes: { metal: "silver", variantOf: gold.id } },
      options,
    );
    assert.equal((await quote()).credits, 1);
    patchCatalogue(
      store.db,
      a,
      silver.id,
      { attributes: { metal: "silver", purity: "925", variantOf: gold.id } },
      options,
    );
    assert.equal(store.db.prepare("SELECT count(*) n FROM garment_results").get().n, 0);
    assert.equal((await quote()).credits, 2);
  }));
test("second variant failure refunds only that variant, preserves the completed paid result and never retries", async () =>
  fixture(
    async ({ store, a, request, quote, runCompare, calls }) => {
      const before = store.billing.balance(a.org),
        response = await runCompare(await quote());
      assert.equal(response.status, 200);
      const p = await response.json();
      assert.equal(p.partial, true);
      assert.equal(p.results.length, 1);
      assert.match(p.error, /kept|retried/);
      assert.equal(p.creditsUsed, 1);
      assert.equal(calls(), 2);
      assert.equal(store.billing.balance(a.org), before - 1);
      assert.equal(
        store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='refund'").get().n,
        1,
      );
      assert.equal(
        (
          await request(
            "/api/jewellery/results/" + p.results[0].result.resultId + "/approve",
            approve(p.results[0]),
          )
        ).status,
        200,
      );
    },
    {
      generate: async (input, n) => {
        if (n === 2) throw new ProviderError("quota");
        return url(input.base);
      },
    },
  ));
test("family links reject self, chains, other types and stores; quotes bind context and cannot increase a consented cost", async () =>
  fixture(
    async ({
      store,
      a,
      b,
      gold,
      silver,
      saveItem,
      request,
      input,
      quote,
      runCompare,
      cb,
      calls,
    }) => {
      for (const attrs of [
        { metal: "yellow_gold", variantOf: gold.id },
        { metal: "yellow_gold", variantOf: silver.id },
      ])
        assert.throws(() => patchCatalogue(store.db, a, gold.id, { attributes: attrs }, options));
      const watch = await saveItem("Watch", "silver", null, "watch");
      assert.throws(() =>
        patchCatalogue(
          store.db,
          a,
          silver.id,
          { attributes: { metal: "silver", variantOf: watch.id } },
          options,
        ),
      );
      for (const changes of [
        { itemIds: [gold.id, gold.id] },
        { itemIds: [gold.id, watch.id] },
        { base: "bad" },
        { view: "portrait" },
      ])
        assert.ok(
          [400, 404].includes(
            (await request("/api/jewellery/compare", { ...input, action: "quote", ...changes }))
              .status,
          ),
        );
      assert.equal(
        (await request("/api/jewellery/compare", { ...input, action: "quote" }, "")).status,
        401,
      );
      assert.equal(
        (await request("/api/jewellery/compare", { ...input, action: "quote" }, cb)).status,
        404,
      );
      assert.equal(
        (
          await request(
            "/api/jewellery/compare",
            { ...input, action: "quote" },
            undefined,
            "https://evil.test",
          )
        ).status,
        403,
      );
      const q = await quote();
      assert.equal((await runCompare(q, { consent: false })).status, 400);
      assert.equal((await runCompare(q, { quote: q.quote + "x" })).status, 409);
      assert.equal((await runCompare(q, { finger: "middle" })).status, 409);
      assert.equal(calls(), 0);
      const p = await (await runCompare(q)).json();
      for (const e of p.results)
        await request("/api/jewellery/results/" + e.result.resultId + "/approve", approve(e));
      const free = await quote();
      store.db.prepare("DELETE FROM garment_results").run();
      assert.equal((await runCompare(free)).status, 409);
      assert.equal(calls(), 2);
    },
  ));
test("staff can compare, request IDs cannot duplicate charges, and one pilot operation can fit both variants without bypassing the next gap", async () =>
  fixture(
    async ({ store, a, b, quote, runCompare, ca, request, input, calls }) => {
      store.db
        .prepare(
          "INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(user,store) DO UPDATE SET role=excluded.role",
        )
        .run(b.user.id, a.id, "staff");
      const staff = "forme_session=" + store.session(store.identity(b.user.id, a.id));
      const q = await (
          await request("/api/jewellery/compare", { ...input, action: "quote" }, staff)
        ).json(),
        requestIds = [randomUUID(), randomUUID()];
      const p = await runCompare(q, { requestIds }, staff);
      assert.equal(p.status, 200, await p.clone().text());
      assert.equal((await p.json()).partial, false);
      assert.equal(calls(), 2);
      assert.equal((await runCompare(q, { requestIds }, staff)).status, 409);
      const fresh = await quote();
      assert.equal((await runCompare(fresh)).status, 200, "gap is per staff user");
      const next = await quote();
      assert.equal((await runCompare(next)).status, 429);
      assert.equal(calls(), 4);
    },
    { rateLimit: true },
  ));
test("insufficient credits and revoked sessions stop a comparison before another provider request", async () => {
  await fixture(async ({ store, a, quote, runCompare, calls }) => {
    const q = await quote(),
      balance = store.billing.balance(a.org);
    store.db
      .prepare(
        "INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'expire','low',?)",
      )
      .run(randomUUID(), a.org, 1 - balance, Date.now());
    assert.equal((await runCompare(q)).status, 402);
    assert.equal(calls(), 0);
  });
  let revoke;
  await fixture(
    async ({ store, token, quote, runCompare, calls }) => {
      revoke = () => store.logout(token);
      assert.equal((await runCompare(await quote())).status, 401);
      assert.equal(calls(), 1);
    },
    {
      generate: async (input) => {
        revoke();
        return url(input.base);
      },
    },
  );
});
test("complete boards use the same-avatar saved outfit and portrait, exact inset geometry, legible names, free storage/export/share and independent reopening", async () =>
  fixture(async ({ store, a, avatar, complete, request, calls, outfit, jewel }) => {
    const before = store.billing.balance(a.org),
      response = await request("/api/jewellery/complete/prepare", complete);
    assert.equal(response.status, 200);
    const p = await response.json();
    assert.equal(p.layout.inset.width, 410);
    assert.equal(p.layout.width, 1024);
    assert.ok(p.layout.text.some((t) => t.text.includes("Gold")));
    assert.ok(p.layout.text.some((t) => t.text.includes("White")));
    const context = await prepareComplete(store, a, complete),
      image = await renderComplete(context),
      pixel = async (x, y) => [
        ...(await sharp(image)
          .extract({ left: x, top: y, width: 1, height: 1 })
          .removeAlpha()
          .raw()
          .toBuffer()),
      ];
    assert.deepEqual(await pixel(p.layout.inset.x + 40, p.layout.inset.y + 40), [169, 68, 85]);
    assert.deepEqual(await pixel(0, p.layout.bodyHeight + 100), [255, 255, 255]);
    assert.equal((await sharp(image).metadata()).height, p.layout.height);
    const saved = await request("/api/jewellery/complete", {
      ...complete,
      sourceHash: p.sourceHash,
      name: "The whole look",
      reviewed: true,
      storageConsent: true,
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const board = await saved.json();
    assert.equal(board.view, "complete");
    assert.equal(board.creditsUsed, 0);
    const row = store.listLooks(a, avatar.id).find((l) => l.id === board.id);
    assert.equal(row.view, "complete");
    assert.ok(row.garments.some((n) => n.includes("White")));
    assert.ok(row.itemsJson.length);
    const share = await (
      await request("/api/looks/" + board.id + "/share", { days: 7, sharingConsent: true })
    ).json();
    assert.match(await (await fetch(share.url)).text(), /Your complete look/);
    const publicPng = await (await fetch(share.url + "/image")).arrayBuffer();
    assert.equal(
      (await sharp(Buffer.from(publicPng)).metadata()).height,
      p.layout.height,
      "already labelled board gets no duplicate footer",
    );
    const activity = store.analytics.report(a, {}, Date.now(), { jewelleryEnabled: true }).jewellery
      .totals;
    assert.equal(activity.completeLooksSaved, 1);
    assert.equal(activity.setsSaved, 0);
    assert.equal(activity.looksShared, 1);
    assert.equal(activity.shareViews, 1);
    store.removeLook(a, outfit.id);
    store.removeLook(a, jewel.id);
    assert.equal(
      (await request("/api/jewellery/looks/" + board.id, undefined, undefined, undefined, "GET"))
        .status,
      200,
    );
    assert.equal(store.billing.balance(a.org), before);
    assert.equal(calls(), 0);
    assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  }));
test("complete preview/save enforce consent, tenant, source hashes, source kinds and disabled pilot flag", async () =>
  fixture(async ({ store, a, b, avatar, complete, request, cb, jewel, outfit }) => {
    const p = await (await request("/api/jewellery/complete/prepare", complete)).json(),
      body = {
        ...complete,
        sourceHash: p.sourceHash,
        name: "Board",
        reviewed: true,
        storageConsent: true,
      };
    for (const changes of [
      { reviewed: false },
      { storageConsent: false },
      { image: "invented" },
      { sourceHash: "wrong" },
    ])
      assert.ok(
        [400, 409].includes(
          (await request("/api/jewellery/complete", { ...body, ...changes })).status,
        ),
      );
    assert.equal((await request("/api/jewellery/complete", body, "")).status, 401);
    assert.equal((await request("/api/jewellery/complete", body, cb)).status, 404);
    assert.equal(
      (await request("/api/jewellery/complete", body, undefined, "https://evil.test")).status,
      403,
    );
    assert.equal(
      (await request("/api/jewellery/complete/prepare", { ...complete, outfitLookId: jewel.id }))
        .status,
      404,
    );
    assert.equal(
      (await request("/api/jewellery/complete/prepare", { ...complete, portraitLookId: outfit.id }))
        .status,
      404,
    );
    store.db
      .prepare("UPDATE looks SET garments=? WHERE account=? AND id=?")
      .run('["Changed outfit"]', a.id, outfit.id);
    assert.equal((await request("/api/jewellery/complete", body)).status, 409);
  }));
test("complete composition supports 20 long Unicode names without cropped lines and variant families work through Chain master sharing", async () =>
  fixture(async ({ store, a, b, gold, silver, request }) => {
    const l = completeLayout(
      Array.from({ length: 20 }, (_, i) => `${i} Jewellery & <stones> — தமிழ் design `.repeat(3)),
    );
    assert.ok(l.text.length > 20);
    assert.ok(l.text.every((t) => t.y < l.height - 80));
    assert.equal(l.inset.width / 1024, 410 / 1024);
    store.db.prepare("UPDATE orgs SET plan='chain' WHERE id=?").run(a.org);
    store.db.prepare("UPDATE stores SET org=? WHERE id=?").run(a.org, b.id);
    new CatalogueSync(store).setMaster(a, a.id);
    const branch = store.identity(b.user.id, b.id),
      items = store.garments.list(branch, options),
      sharedGold = items.find((i) => i.name === "Gold ring"),
      sharedSilver = items.find((i) => i.name === "Silver ring");
    assert.equal(sharedSilver.attributes.variantOf, sharedGold.id);
    const cookie = "forme_session=" + store.session(branch),
      choices = await (
        await request(
          "/api/jewellery/variants/" + encodeURIComponent(sharedGold.id),
          undefined,
          cookie,
          undefined,
          "GET",
        )
      ).json();
    assert.equal(choices.variants.length, 2);
    assert.ok(choices.variants.every((i) => !i.image && !i.overlayPng));
  }));
test("disabled jewellery exposes neither comparisons nor complete boards", async () =>
  fixture(
    async ({ request, input, complete }) => {
      assert.equal(
        (await request("/api/jewellery/compare", { ...input, action: "quote" })).status,
        404,
      );
      assert.equal((await request("/api/jewellery/complete/prepare", complete)).status, 404);
    },
    { enabled: false },
  ));

test("comparison analytics count explicit runs once, include both fitting variants and keep one shared session across free reuse", async () =>
  fixture(async ({ store, a, request, input, quote, runCompare }) => {
    const sessionId = randomUUID(),
      q = await quote({ sessionId });
    assert.equal(
      store.analytics.report(a, {}, Date.now(), { jewelleryEnabled: true }).jewellery.totals
        .comparisonsCompleted,
      0,
    );
    assert.equal((await runCompare(q, { sessionId: "invalid" })).status, 400);
    const first = await (await runCompare(q, { sessionId })).json();
    for (const e of first.results)
      await request("/api/jewellery/results/" + e.result.resultId + "/approve", approve(e));
    const free = await quote({ sessionId }),
      requestIds = [randomUUID(), randomUUID()];
    assert.equal(free.credits, 0);
    for (let i = 0; i < 2; i++)
      assert.equal((await runCompare(free, { sessionId, requestIds })).status, 200);
    const j = store.analytics.report(a, {}, Date.now(), { jewelleryEnabled: true }).jewellery
      .totals;
    assert.equal(j.comparisonsCompleted, 2);
    assert.equal(j.comparisonsPartial, 0);
    assert.equal(j.tryonsGenerated, 2);
    assert.equal(j.tryonsReused, 2);
    assert.equal(j.tryonSessions, 1);
  }));

test("partial comparison analytics include the delivered variant only and keep the failed variant refund", async () =>
  fixture(
    async ({ store, a, quote, runCompare }) => {
      const p = await (await runCompare(await quote(), { sessionId: randomUUID() })).json();
      assert.equal(p.partial, true);
      const j = store.analytics.report(a, {}, Date.now(), { jewelleryEnabled: true }).jewellery
        .totals;
      assert.equal(j.comparisonsPartial, 1);
      assert.equal(j.comparisonsCompleted, 0);
      assert.equal(j.tryonsGenerated, 1);
      assert.equal(j.tryonSessions, 1);
      assert.equal(
        store.db.prepare("SELECT count(*) n FROM ledger WHERE kind='refund'").get().n,
        1,
      );
    },
    {
      generate: async (input, n) => {
        if (n === 2) throw new ProviderError("quota");
        return url(input.base);
      },
    },
  ));

test("comparison telemetry failure never discards paid previews or triggers a provider retry", async () =>
  fixture(async ({ store, a, quote, runCompare, calls }) => {
    store.db.exec(
      "CREATE TRIGGER reject_compare_event BEFORE INSERT ON events WHEN NEW.type='jewellery_compared' BEGIN SELECT RAISE(FAIL,'private telemetry failure');END;",
    );
    const before = store.billing.balance(a.org),
      result = await runCompare(await quote());
    assert.equal(result.status, 200);
    assert.equal((await result.json()).results.length, 2);
    assert.equal(calls(), 2);
    assert.equal(store.billing.balance(a.org), before - 2);
    assert.equal(
      store.analytics.report(a, {}, Date.now(), { jewelleryEnabled: true }).jewellery.totals
        .comparisonsCompleted,
      0,
    );
  }));
