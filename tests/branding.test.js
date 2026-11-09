import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { AccountStore } from "./helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../server/app.js";
import { normalizeLogo, sanitizeLogoSvg, stampTrial, brandInk } from "../server/branding.js";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#880000"/></linearGradient></defs><rect width="120" height="60" fill="url(#g)"/><text x="8" y="40" fill="white" font-size="24">Store</text></svg>';
const dataSvg = (value) => "data:image/svg+xml;base64," + Buffer.from(value).toString("base64");
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-branding-")),
    store = new AccountStore(directory),
    a = await store.register({
      name: "Original store",
      email: "brand@example.test",
      password: "test-password-long",
    }),
    b = await store.register({
      name: "Other store",
      email: "other@example.test",
      password: "test-password-long",
    });
  store.db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(b.user.id, a.id);
  const manager = store.identity(b.user.id, a.id),
    ca = store.session(a),
    cb = store.session(b),
    cm = store.session(manager);
  const customer = store.customers.save(a, {
    name: "Private Customer",
    phoneE164: "9876543210",
    notes: "Never public",
  });
  store.db
    .prepare(
      "UPDATE customers SET whatsappConsentAt=?,whatsappConsentSource='in_store' WHERE id=? AND store=?",
    )
    .run(Date.now(), customer.id, a.id);
  const png = await standardAvatar("regular"),
    image = `data:image/png;base64,${png.toString("base64")}`,
    avatar = await store.save(a, {
      image,
      name: "Private avatar",
      profileId: "regular",
      heightCm: 175,
      weightKg: 72,
      source: "imported",
      customerId: customer.id,
    }),
    look = await store.saveLook(a, {
      image,
      avatarId: avatar.id,
      name: "Private look",
      garments: ["Blue shirt"],
    });
  let ai = 0;
  const messages = [];
  const app = createApp({
      accountStore: store,
      accessMode: "public",
      apiKey: "test",
      publicUrl: "https://studio.example.test",
      photoOptions: {
        generate: async () => {
          ai++;
          return image;
        },
      },
      whatsappOptions: {
        secretKey: "ab".repeat(32),
        appSecret: "test-app",
        verifyToken: "test-verify",
        fetchImpl: async (url, options) => {
          if (url.includes("/messages")) {
            messages.push(JSON.parse(options.body));
            return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }));
          }
          return new Response(
            JSON.stringify(
              url.includes("phone_numbers") ? { data: [{ id: "123456789" }] } : { id: "123456789" },
            ),
          );
        },
      },
      sendMail: async () => {},
    }),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = "GET", body, cookie = ca, origin = base) =>
    fetch(base + url, {
      method,
      headers: {
        Cookie: cookie ? `forme_session=${cookie}` : "",
        Origin: origin,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const set = (extra) =>
    store.branding.update(a, {
      displayName: "Brand & Co",
      primaryColor: "#224466",
      phone: "+91 80000 00000",
      address: "Shop 4, Bengaluru",
      mapUrl: "https://maps.example.test/?q=Store&x=1",
      exportFooter: true,
      logo: dataSvg(svg),
      ...extra,
    });
  try {
    await run({
      directory,
      store,
      a,
      b,
      manager,
      ca,
      cb,
      cm,
      request,
      set,
      png,
      image,
      avatar,
      look,
      customer,
      app,
      messages,
      ai: () => ai,
    });
  } finally {
    app.locals.photoJobs.stop();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
test("static SVG/raster logos normalize to PNG; active content, external resources, XML entities and excessive geometry are rejected", async () => {
  const safe = await normalizeLogo(dataSvg(svg)),
    meta = await sharp(safe).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 256);
  assert.ok(!safe.includes(Buffer.from("<svg")));
  const raster = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#dd2233" },
  })
    .jpeg()
    .toBuffer();
  assert.equal(
    (
      await sharp(
        await normalizeLogo("data:image/jpeg;base64," + raster.toString("base64")),
      ).metadata()
    ).format,
    "png",
  );
  const attacks = [
    '<svg onload="alert(1)"/>',
    "<svg><script>alert(1)</script></svg>",
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg><text>&x;</text></svg>',
    '<?xml-stylesheet href="https://evil.test/a.css"?><svg/>',
    '<svg><image href="http://127.0.0.1/logo"/></svg>',
    '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hello</div></foreignObject></svg>',
    '<svg><style>@import "https://evil.test";</style></svg>',
    '<svg><rect style="fill:url(file:///etc/passwd)"/></svg>',
    '<svg><rect fill="url(https://evil.test/x)"/></svg>',
    '<svg><rect fill="u\\72l(https://evil.test/x)"/></svg>',
    '<svg xmlns:x="https://evil.test"><x:path/></svg>',
    '<svg><use href="#x" id="x"/></svg>',
    '<svg width="1e300" height="1"><rect width="1e300"/></svg>',
    '<svg><text font-size="999999">x</text></svg>',
    "<svg>" + "<g>".repeat(33) + "</g>".repeat(33) + "</svg>",
    "<svg>" + "<path/>".repeat(5001) + "</svg>",
    "<svg><text>" + "x".repeat(32769) + "</text></svg>",
  ];
  for (const attack of attacks)
    await assert.rejects(normalizeLogo(dataSvg(attack)), { status: 400 });
  await assert.rejects(
    normalizeLogo("data:image/svg+xml;base64," + Buffer.alloc(500 * 1024 + 1).toString("base64")),
    { status: 400 },
  );
  assert.throws(() => sanitizeLogoSvg(Buffer.from("<svg><g></svg>")), { status: 400 });
  assert.equal(brandInk("#ffffff"), "#000000");
  assert.equal(brandInk("#000000"), "#ffffff");
});
test("owner branding persists, leaves account identity unchanged, removes logos, validates contacts and protects concurrent/async changes", async () =>
  fixture(async ({ store, a, set, directory }) => {
    const brand = await set();
    assert.equal(brand.displayName, "Brand & Co");
    assert.equal(brand.phone, "+918000000000");
    assert.equal(brand.hasLogo, true);
    assert.equal(store.identity(a.user.id, a.id).name, "Original store");
    const reopened = new AccountStore(directory);
    try {
      assert.equal(reopened.branding.read(a.id).revision, brand.revision);
    } finally {
      reopened.close();
    }
    assert.equal(
      (await store.branding.update(a, { mapUrl: "https://maps.example.test/#point=12,77" })).mapUrl,
      "https://maps.example.test/#point=12,77",
    );
    await assert.rejects(store.branding.update(a, { revision: "stale", displayName: "Wrong" }), {
      status: 409,
    });
    for (const patch of [
      { mapUrl: "javascript:alert(1)" },
      { mapUrl: "https://127.0.0.1" },
      { mapUrl: "http://maps.example.test" },
      { primaryColor: "red;position:fixed" },
      { primaryColor: { toString: "invalid" } },
      { phone: "javascript:1234567890" },
      { exportFooter: "false" },
      { displayName: "" },
      { watermark: false },
    ])
      await assert.rejects(store.branding.update(a, patch), { status: 400 });
    const updating = store.branding.update(a, { logo: dataSvg(svg), displayName: "Late name" });
    store.db
      .prepare("UPDATE memberships SET role='manager' WHERE user=? AND store=?")
      .run(a.user.id, a.id);
    await assert.rejects(updating, { status: 403 });
    assert.equal(store.branding.read(a.id).displayName, "Brand & Co");
    store.db
      .prepare("UPDATE memberships SET role='owner' WHERE user=? AND store=?")
      .run(a.user.id, a.id);
    await store.branding.update(a, { logo: null });
    assert.equal(store.branding.read(a.id).hasLogo, false);
  }));
test("branding/export routes enforce active-store roles, ownership, origins and server-controlled watermark flags", async () =>
  fixture(async ({ store, a, b, request, set, image, ca, cb, cm }) => {
    await set();
    for (const cookie of [ca, cm]) {
      assert.equal((await request("/api/branding", "GET", undefined, cookie)).status, 200);
      assert.equal((await request("/api/branding/logo", "GET", undefined, cookie)).status, 200);
      assert.equal(
        (await request("/api/exports/image", "POST", { image, storeFooter: false }, cookie)).status,
        200,
      );
    }
    assert.equal(
      (await request("/api/branding", "PUT", { displayName: "Not allowed" }, cm)).status,
      403,
    );
    store.db
      .prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?")
      .run(b.user.id, a.id);
    assert.equal((await request("/api/branding", "GET", undefined, cm)).status, 200);
    assert.equal((await request("/api/branding/logo", "GET", undefined, cm)).status, 200);
    assert.equal((await request("/api/exports/image", "POST", { image }, cm)).status, 200);
    assert.equal(
      (await request("/api/branding", "PUT", { displayName: "Not allowed" }, cm)).status,
      403,
    );
    assert.equal((await request("/api/branding/logo", "GET", undefined, cb)).status, 404);
    const own = await request(`/api/branding/logo?store=${b.id}`);
    assert.equal(own.status, 200);
    assert.equal((await request("/api/branding", "PUT", { storeId: b.id })).status, 400);
    for (const [url, method, body] of [
      ["/api/branding", "GET", undefined],
      ["/api/branding/logo", "GET", undefined],
      ["/api/branding", "PUT", {}],
      ["/api/exports/image", "POST", { image }],
    ])
      assert.equal((await request(url, method, body, "")).status, 401);
    assert.equal(
      (await request("/api/branding", "PUT", { displayName: "Wrong" }, ca, "https://evil.test"))
        .status,
      403,
    );
    assert.equal(
      (await request("/api/exports/image", "POST", { image }, ca, "https://evil.test")).status,
      403,
    );
    store.db.prepare("UPDATE orgs SET status='trial' WHERE id=?").run(a.org);
    for (const extra of [{ watermark: false }, { trial: false }, { removeForme: true }])
      assert.equal((await request("/api/exports/image", "POST", { image, ...extra })).status, 400);
    const off = await request("/api/exports/image", "POST", { image, storeFooter: false }),
      on = await request("/api/exports/image", "POST", { image, storeFooter: true });
    const left = Buffer.from(await off.arrayBuffer()),
      right = Buffer.from(await on.arrayBuffer());
    assert.ok(left.equals(right));
    assert.deepEqual(
      await sharp(left)
        .metadata()
        .then((m) => [m.width, m.height]),
      await sharp(Buffer.from(image.split(",")[1], "base64"))
        .metadata()
        .then((m) => [m.width, m.height]),
    );
    assert.ok(left.equals(await stampTrial(Buffer.from(image.split(",")[1], "base64"))));
  }));
test("footers preserve every fitting pixel, branding does not change stored images, cache identities or credits, and staff can opt out", async () =>
  fixture(async ({ store, a, set, png, image, avatar, look, request, ai }) => {
    const product = (
        await store.garments.save(a, {
          image,
          name: "Shirt",
          variant: "Blue",
          garmentType: "shirt",
        })
      ).garment,
      contextInput = {
        avatar: image,
        avatarId: avatar.id,
        garmentId: product.id,
        garmentType: "shirt",
      },
      context = await store.garments.context(a, contextInput, {
        provider: "gemini",
        model: "test",
      });
    const receipt = await store.garments.receipt(a, context, image);
    await store.garments.saveResult(a, product.id, {
      image,
      receipt,
      reviewed: true,
      storageConsent: true,
    });
    const ledger = store.db.prepare("SELECT count(*) n FROM ledger").get().n;
    await set();
    const response = await request("/api/exports/image", "POST", { image }),
      bytes = Buffer.from(await response.arrayBuffer()),
      before = await sharp(png).ensureAlpha().raw().toBuffer(),
      meta = await sharp(png).metadata(),
      after = await sharp(bytes)
        .extract({ left: 0, top: 0, width: meta.width, height: meta.height })
        .ensureAlpha()
        .raw()
        .toBuffer();
    assert.equal(response.status, 200);
    assert.ok(before.equals(after));
    assert.ok((await sharp(bytes).metadata()).height > meta.height);
    assert.ok(store.image(a, avatar.id).equals(png));
    assert.ok(store.lookImage(a, look.id).equals(png));
    assert.equal(
      (await store.garments.context(a, contextInput, { provider: "gemini", model: "test" })).id,
      context.id,
    );
    assert.ok(store.garments.cached(a, context));
    assert.equal(store.db.prepare("SELECT count(*) n FROM ledger").get().n, ledger);
    assert.equal(ai(), 0);
    const unbranded = await request("/api/exports/image", "POST", { image, storeFooter: false });
    assert.ok(Buffer.from(await unbranded.arrayBuffer()).equals(png));
  }));
test("public shares use escaped branding and revocable PNG logos without exposing customer data or counting logo/image views", async () =>
  fixture(async ({ store, a, set, request, look }) => {
    await set({ displayName: "<Store> & Co", address: "Shop <4>" });
    const link = await (
        await request(`/api/looks/${look.id}/share`, "POST", { sharingConsent: true })
      ).json(),
      url = new URL(link.url).pathname;
    const page = await request(url, "GET", undefined, "");
    const html = await page.text();
    assert.match(html, /&lt;Store&gt; &amp; Co/);
    assert.match(html, /#224466/);
    assert.match(html, /Shop &lt;4&gt;/);
    assert.match(html, /Call store/);
    assert.match(html, /Get directions/);
    for (const value of [
      "Private Customer",
      "Private avatar",
      "Private look",
      "9876543210",
      "brand@example.test",
    ])
      assert.ok(!html.includes(value));
    const logo = await request(url + "/logo", "GET", undefined, "");
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.equal((await sharp(Buffer.from(await logo.arrayBuffer())).metadata()).format, "png");
    await request(url + "/image", "GET", undefined, "");
    await request(url + "/logo", "HEAD", undefined, "");
    assert.equal(store.sharing.list(a, look.id)[0].views, 1);
    store.sharing.revoke(a, link.id);
    for (const suffix of ["", "/logo", "/image"])
      assert.equal((await request(url + suffix, "GET", undefined, "")).status, 410);
  }));
test("WhatsApp payload/lookbook share the public brand and contact details while keeping the capability expiry and privacy boundary", async () =>
  fixture(async ({ store, a, set, app, customer, look, messages, request }) => {
    await set();
    const service = app.locals.whatsapp;
    await service.connect(a, {
      phoneId: "123456789",
      wabaId: "999999999",
      token: "test-token",
      language: "en_US",
    });
    await service.send(a, {
      requestId: crypto.randomUUID(),
      customerId: customer.id,
      lookIds: [look.id],
      template: "look_share",
      sendConsent: true,
    });
    assert.equal(messages[0].template.components[1].parameters[1].text, "Brand & Co");
    const header = new URL(messages[0].template.components[0].parameters[0].image.link),
      token = header.pathname.split("/")[2],
      route = "/w/" + token;
    const html = await (await request(route, "GET", undefined, "")).text();
    assert.match(html, /Brand &amp; Co/);
    assert.match(html, /Shop 4, Bengaluru/);
    assert.match(html, /Get directions/);
    assert.ok(!html.includes("Private Customer"));
    assert.equal((await request(route + "/logo", "GET", undefined, "")).status, 200);
    assert.equal((await request(header.pathname, "GET", undefined, "")).status, 200);
    store.db.prepare("UPDATE whatsapp_books SET expiresAt=?").run(Date.now() - 1);
    assert.equal((await request(route + "/logo", "GET", undefined, "")).status, 410);
  }));
test("branded catalogue-photo downloads keep exact format dimensions and AI provenance without regenerating pixels", async () =>
  fixture(async ({ store, a, set, image, app, ai, request }) => {
    const garment = (
      await store.garments.save(a, { image, name: "Product", garmentType: "shirt", variant: "M" })
    ).garment;
    store.billing.grant(a.org, "photo", 2, "grant_admin", "brand-photos");
    const service = app.locals.photoJobs,
      job = service.create(a, {
        requestId: crypto.randomUUID(),
        garmentIds: [garment.id],
        model: { profileId: "regular", tone: "medium" },
        poses: ["front"],
        formats: ["4:5"],
        generationConsent: true,
        maxCredits: 1,
      });
    await service.drain();
    const item = job.items[0].id;
    service.review(a, job.id, item, { approved: true });
    const original = store.db.prepare("SELECT image FROM photo_outputs").get().image;
    await set();
    const file = await request(`/api/photo-jobs/${job.id}/items/${item}/files/4%3A5`),
      meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    assert.equal(file.status, 200);
    assert.equal(meta.width, 1024);
    assert.equal(meta.height, 1280);
    assert.match(meta.xmp.toString(), /trainedAlgorithmicMedia/);
    assert.equal(ai(), 1);
    assert.ok(
      Buffer.from(store.db.prepare("SELECT image FROM photo_outputs").get().image).equals(
        Buffer.from(original),
      ),
    );
    assert.equal(store.billing.balance(a.org, "photo"), 1);
  }));
