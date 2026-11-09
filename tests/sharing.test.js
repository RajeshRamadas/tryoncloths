import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { AccountStore } from "./helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../server/app.js";

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-sharing-")),
    store = new AccountStore(directory);
  const a = await store.register({
      name: "Clothes & Co",
      email: "a@example.test",
      password: "test-password-long",
    }),
    b = await store.register({
      name: "Other store",
      email: "b@example.test",
      password: "test-password-long",
    });
  const ca = `forme_session=${store.session(a)}`,
    cb = `forme_session=${store.session(b)}`;
  const customer = store.customers.save(a, {
    name: "Private Customer",
    phoneE164: "9876543210",
    notes: "Never public",
  });
  const image = `data:image/png;base64,${(await standardAvatar("regular")).toString("base64")}`;
  const av = await store.save(a, {
    image,
    customerId: customer.id,
    name: "Private avatar",
    profileId: "regular",
    heightCm: 175,
    weightKg: 72,
    source: "imported",
  });
  const look = await store.saveLook(a, {
    image,
    avatarId: av.id,
    name: "Private customer name in look",
    garments: ["Blue shirt", "Jeans"],
  });
  let calls = 0;
  const server = createApp({
    accountStore: store,
    accessMode: "public",
    publicUrl: "https://studio.example.test",
    personalize: async () => {
      calls++;
      throw new Error("Unexpected AI call");
    },
    tryOn: async () => {
      calls++;
      throw new Error("Unexpected AI call");
    },
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = "GET", body, cookie = ca, origin = base) =>
    fetch(base + url, {
      method,
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    await run({
      store,
      a,
      b,
      ca,
      cb,
      customer,
      look,
      av,
      image,
      directory,
      request,
      base,
      calls: () => calls,
    });
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const share = (request, id, body = {}) =>
  request(`/api/looks/${id}/share`, "POST", { sharingConsent: true, ...body });

test("share creation stores only a 256-bit token hash, defaults to 30 days, persists across restart and uses no AI credits", async () =>
  fixture(async ({ store, a, look, request, directory, calls }) => {
    const before = store.db.prepare("SELECT count(*) AS n FROM ledger").get().n;
    const response = await share(request, look.id);
    assert.equal(response.status, 201);
    const data = await response.json(),
      url = new URL(data.url),
      token = url.pathname.split("/").at(-1);
    assert.equal(url.origin, "https://studio.example.test");
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, "base64url").length, 32);
    assert.equal(data.id, createHash("sha256").update(token).digest("hex"));
    assert.equal(data.customerPhone, "+919876543210");
    assert.ok(Math.abs(data.expiresAt - Date.now() - 30 * 86400000) < 5000);
    assert.ok(!JSON.stringify(store.db.prepare("SELECT * FROM share_links").all()).includes(token));
    const listed = (await (await request(`/api/looks/${look.id}/shares`)).json()).shares;
    assert.equal(listed.length, 1);
    assert.ok(!JSON.stringify(listed).includes(token));
    const reopened = new AccountStore(directory);
    try {
      assert.ok(reopened.sharing.resolve(token));
      assert.equal(reopened.sharing.list(a, look.id).length, 1);
    } finally {
      reopened.close();
    }
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM ledger").get().n, before);
    assert.equal(calls(), 0);
    const event = store.db.prepare("SELECT * FROM events WHERE type='look_shared'").get();
    assert.equal(event.store, a.id);
    assert.ok(!event.refJson.includes(token));
  }));

test("every share management route enforces staff roles, authentication, store ownership and same-origin mutations", async () =>
  fixture(async ({ store, a, look, request, cb, ca }) => {
    for (const role of ["owner", "manager", "staff"]) {
      store.db
        .prepare("UPDATE memberships SET role=? WHERE user=? AND store=?")
        .run(role, a.user.id, a.id);
      const response = await share(request, look.id);
      assert.equal(response.status, 201);
      const { id } = await response.json();
      for (const [url, method, body] of [
        [`/api/looks/${look.id}/share`, "POST", { sharingConsent: true }],
        [`/api/looks/${look.id}/shares`, "GET", undefined],
        [`/api/share/${id}`, "DELETE", undefined],
      ]) {
        assert.equal((await request(url, method, body, "")).status, 401);
        assert.equal((await request(url, method, body, cb)).status, 404);
        if (method !== "GET")
          assert.equal((await request(url, method, body, ca, "https://evil.test")).status, 403);
      }
      assert.equal((await request(`/api/looks/${look.id}/shares`)).status, 200);
      assert.equal((await request(`/api/share/${id}`, "DELETE")).status, 200);
    }
    store.db.prepare("UPDATE users SET disabled=1 WHERE id=?").run(a.user.id);
    assert.equal((await share(request, look.id)).status, 401);
  }));

test("sharing needs customer agreement and a 1–90 day lifetime; addresses are unique and unknown IDs stay private", async () =>
  fixture(async ({ look, request }) => {
    assert.equal((await request(`/api/looks/${look.id}/share`, "POST", {})).status, 400);
    for (const days of [0, 91, -1, 1.5, "30", {}])
      assert.equal((await share(request, look.id, { days })).status, 400);
    const first = await (await share(request, look.id, { days: 1 })).json(),
      second = await (await share(request, look.id, { days: 90 })).json();
    assert.notEqual(first.url, second.url);
    assert.ok(Math.abs(second.expiresAt - Date.now() - 90 * 86400000) < 5000);
    assert.equal((await share(request, "missing")).status, 404);
  }));

test("public page and PNG work anonymously, omit contact PII, escape content, and record only page GET views", async () =>
  fixture(async ({ store, a, look, request, image }) => {
    store.db
      .prepare("UPDATE stores SET name=?,phone=?,brandingJson=? WHERE id=?")
      .run(
        "<script>alert(1)</script>",
        "+91 80000 00000",
        JSON.stringify({ mapUrl: "https://maps.example.test/?x=1&y=2" }),
        a.id,
      );
    store.db
      .prepare("UPDATE looks SET garments=? WHERE account=? AND id=?")
      .run(JSON.stringify(["<img src=x onerror=alert(1)>", "Blue shirt"]), a.id, look.id);
    const link = await (await share(request, look.id)).json(),
      route = new URL(link.url).pathname;
    const page = await request(route, "GET", undefined, "");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control"), /no-store/);
    assert.match(page.headers.get("x-robots-tag"), /noindex/);
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
    const html = await page.text();
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;img/);
    assert.ok(!html.includes("<script>"));
    assert.match(html, /Call store/);
    assert.match(html, /Get directions/);
    for (const privateText of [
      "Private Customer",
      "Private customer name in look",
      "9876543210",
      "Never public",
      "a@example.test",
    ])
      assert.ok(!html.includes(privateText));
    const png = await request(route + "/image", "GET", undefined, "");
    assert.equal(png.status, 200);
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.match(png.headers.get("cache-control"), /max-age=300/);
    assert.match(png.headers.get("cache-control"), /no-cache/);
    assert.equal(
      (await png.arrayBuffer()).byteLength,
      Buffer.from(image.split(",")[1], "base64").length,
    );
    await request(route, "HEAD", undefined, "");
    assert.equal(store.sharing.list(a, look.id)[0].views, 1);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM events WHERE type='share_viewed'").get().n,
      1,
    );
    store.db
      .prepare("UPDATE stores SET phone=?,brandingJson=? WHERE id=?")
      .run("javascript:alert(1)", JSON.stringify({ mapUrl: "javascript:alert(1)" }), a.id);
    const safe = await (await request(route, "GET", undefined, "")).text();
    assert.ok(!safe.includes("Call store"));
    assert.ok(!safe.includes("Get directions"));
  }));

test("revocation, expiry, look deletion and customer erasure make page and image return 410 immediately", async () =>
  fixture(async ({ store, a, look, customer, request, image, av }) => {
    const create = async () => {
      const link = await (await share(request, look.id)).json();
      return { ...link, route: new URL(link.url).pathname };
    };
    const gone = async (route) => {
      for (const url of [route, route + "/image"])
        assert.equal((await request(url, "GET", undefined, "")).status, 410);
    };
    const revoked = await create();
    await request(`/api/share/${revoked.id}`, "DELETE");
    await gone(revoked.route);
    assert.equal((await request(`/api/share/${revoked.id}`, "DELETE")).status, 200);
    const expired = await create();
    store.db
      .prepare("UPDATE share_links SET expiresAt=? WHERE tokenHash=?")
      .run(Date.now() - 1, expired.id);
    await gone(expired.route);
    const removed = await create();
    store.removeLook(a, look.id);
    await gone(removed.route);
    await store.saveLook(a, {
      image,
      avatarId: av.id,
      name: "Recreated look",
      garments: ["Blue shirt"],
    });
    const erased = await create();
    store.customers.remove(a, customer.id);
    await gone(erased.route);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM share_links").get().n, 0);
    await gone("/s/" + "x".repeat(43));
    await gone("/s/malformed");
    assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  }));
