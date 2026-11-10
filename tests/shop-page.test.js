import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { AccountStore } from "./helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../server/app.js";
import {
  slugify,
  validSlug,
  normalizeShopPhoto,
  tryOnLink,
  MAX_SHOP_PHOTOS,
} from "../server/shop-page.js";

const jpeg = async (width = 800, height = 600, colour = "#c04040") =>
  "data:image/jpeg;base64," +
  (
    await sharp({ create: { width, height, channels: 3, background: colour } })
      .withExif({ IFD0: { Make: "SecretCam" }, IFD3: { GPSLatitudeRef: "N" } })
      .jpeg()
      .toBuffer()
  ).toString("base64");

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-shop-page-")),
    store = new AccountStore(directory),
    a = await store.register({
      name: "Lakshmi Silks & Sarees",
      email: "owner@example.test",
      password: "test-password-long",
    }),
    b = await store.register({
      name: "Other store",
      email: "other@example.test",
      password: "test-password-long",
    }),
    m = await store.register({
      name: "Manager home",
      email: "manager@example.test",
      password: "test-password-long",
    }),
    s = await store.register({
      name: "Staff home",
      email: "staff@example.test",
      password: "test-password-long",
    });
  store.db.prepare("INSERT INTO memberships VALUES(?,?,'manager')").run(m.user.id, a.id);
  store.db.prepare("INSERT INTO memberships VALUES(?,?,'staff')").run(s.user.id, a.id);
  const manager = store.identity(m.user.id, a.id),
    staff = store.identity(s.user.id, a.id),
    ca = store.session(a),
    cb = store.session(b),
    cm = store.session(manager),
    cs = store.session(staff);
  store.customers.save(a, { name: "Private Customer", phoneE164: "9123456780", notes: "Secret" });
  const png = await standardAvatar("regular"),
    image = `data:image/png;base64,${png.toString("base64")}`;
  const saved = async (name, variant) =>
    (await store.garments.save(a, { image, name, garmentType: "shirt", variant, sourceUrl: "" }))
      .garment;
  const inStock = await saved("Kanchipuram silk shirt", "maroon"),
    soldOut = await saved("Sold out kurta", "green");
  store.db
    .prepare("UPDATE garments SET priceInr=2499,mrpInr=2999,stock='low' WHERE account=? AND id=?")
    .run(a.id, inStock.id);
  store.db
    .prepare("UPDATE garments SET stock='out' WHERE account=? AND id=?")
    .run(a.id, soldOut.id);
  await store.branding.update(a, {
    displayName: "Lakshmi Silks",
    primaryColor: "#7a1f3d",
    phone: "+91 80000 00000",
    address: "12 MG Road, Bengaluru",
    mapUrl: "https://maps.example.test/?q=lakshmi",
  });
  const app = createApp({
      accountStore: store,
      accessMode: "public",
      rateLimit: false,
      apiKey: "test",
      publicUrl: "https://studio.example.test",
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
  try {
    await run({ store, a, b, ca, cb, cm, cs, request, inStock, soldOut });
  } finally {
    app.locals.photoJobs?.stop();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("slugs are derived from store names and validated", () => {
  assert.equal(slugify("Lakshmi Silks & Sarees"), "lakshmi-silks-sarees");
  assert.equal(slugify("Café Noël"), "cafe-noel");
  assert.match(slugify("!!"), /^shop-/);
  assert.ok(validSlug("lakshmi-silks"));
  for (const bad of ["ab", "-shop", "shop-", "Shop", "a--b", "admin", "x".repeat(41), "a/b"])
    assert.equal(validSlug(bad), false, bad);
});

test("shop photos are re-encoded as JPEG without camera or location metadata", async () => {
  const { image, thumbnail } = await normalizeShopPhoto(await jpeg(2400, 1600));
  const meta = await sharp(image).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1600);
  assert.equal(meta.exif, undefined);
  assert.ok(!image.includes(Buffer.from("SecretCam")));
  assert.ok((await sharp(thumbnail).metadata()).width <= 360);
  await assert.rejects(normalizeShopPhoto(await jpeg(100, 100)), /at least 320/);
  await assert.rejects(normalizeShopPhoto("data:image/gif;base64,R0lGODlh"), /JPEG, PNG or WebP/);
  await assert.rejects(
    normalizeShopPhoto("data:image/png;base64," + Buffer.from("<svg/>").toString("base64")),
  );
});

test("try-on entry uses WhatsApp click-to-chat, else the store phone", () => {
  const brand = { displayName: "Lakshmi Silks", phone: "+918000000000" };
  assert.equal(
    tryOnLink({ whatsapp: "+919876543210" }, brand, "Silk shirt"),
    "https://wa.me/919876543210?text=" +
      encodeURIComponent(`Hi Lakshmi Silks, I'd like to try on "Silk shirt". When can I visit?`),
  );
  assert.equal(tryOnLink({ whatsapp: "" }, brand), "tel:+918000000000");
  assert.equal(tryOnLink({ whatsapp: "" }, { ...brand, phone: "" }), "");
});

test("a new shop page is private until the owner publishes it; staff can preview", async () =>
  fixture(async ({ request, ca, cb, cs }) => {
    const page = await (await request("/api/shop-page")).json();
    assert.equal(page.slug, "lakshmi-silks-sarees");
    assert.equal(page.published, false);
    assert.equal(page.path, "/shop/lakshmi-silks-sarees");
    assert.equal((await request(page.path, "GET", undefined, "")).status, 404);
    assert.equal((await request(page.path, "GET", undefined, cb)).status, 404);
    for (const cookie of [ca, cs]) {
      const preview = await request(page.path, "GET", undefined, cookie);
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get("cache-control"), "private, no-store");
      assert.match(preview.headers.get("x-robots-tag"), /noindex/);
      assert.match(await preview.text(), /Preview: only your store team/);
    }
    const published = await request("/api/shop-page", "PUT", {
      published: true,
      revision: page.revision,
    });
    assert.equal(published.status, 200);
    const live = await request(page.path, "GET", undefined, "");
    assert.equal(live.status, 200);
    assert.match(live.headers.get("cache-control"), /public/);
    assert.doesNotMatch(await live.text(), /Preview:/);
  }));

test("the public page shows branding, escaped content, photos and only in-stock catalogue items", async () =>
  fixture(async ({ request, a, store, inStock, soldOut }) => {
    await request("/api/shop-page", "PUT", {
      published: true,
      slug: "lakshmi",
      tagline: "Silks <script>alert(1)</script>",
      about: "Family run since 1998.\nBridal specialists.",
      hours: "Mon–Sat 10–9",
      whatsapp: "+91 98765 43210",
    });
    await request("/api/shop-page/photos", "POST", {
      image: await jpeg(),
      caption: "Our <b>counter</b>",
    });
    await request("/api/shop-page/photos", "POST", { image: await jpeg(900, 700, "#204080") });
    const response = await request("/shop/lakshmi", "GET", undefined, "");
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.doesNotMatch(csp, /script-src/);
    const html = await response.text();
    assert.match(html, /<h1>Lakshmi Silks<\/h1>/);
    assert.match(html, /Silks &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /Our &lt;b&gt;counter&lt;\/b&gt;/);
    assert.match(html, /Family run since 1998/);
    assert.match(html, /Mon–Sat 10–9/);
    assert.match(html, /https:\/\/wa\.me\/919876543210\?text=/);
    assert.match(html, /Kanchipuram silk shirt/);
    assert.match(html, /₹2,499/);
    assert.match(html, /<s>₹2,999<\/s>/);
    assert.match(html, /Only a few left/);
    assert.match(html, /12 MG Road, Bengaluru/);
    assert.doesNotMatch(html, /Sold out kurta/);
    assert.doesNotMatch(html, /Private Customer|9123456780|Secret|owner@example/);
    const photos = store.shopPages.photos(a.id);
    const photo = await request(`/shop/lakshmi/photos/${photos[0].id}`, "GET", undefined, "");
    assert.equal(photo.headers.get("content-type"), "image/jpeg");
    assert.equal((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).format, "jpeg");
    const item = await request(`/shop/lakshmi/items/${inStock.id}/image`, "GET", undefined, "");
    assert.equal(item.status, 200);
    assert.equal(item.headers.get("content-type"), "image/jpeg");
    assert.equal(
      (await request(`/shop/lakshmi/items/${soldOut.id}/image`, "GET", undefined, "")).status,
      404,
    );
    assert.equal(
      await (
        await request(`/shop/lakshmi/logo`, "GET", undefined, "")
      ).status,
      404,
      "no logo saved",
    );
    await request("/api/shop-page", "PUT", { showCatalogue: false });
    const hidden = await (await request("/shop/lakshmi", "GET", undefined, "")).text();
    assert.doesNotMatch(hidden, /Kanchipuram silk shirt/);
    assert.equal(
      (await request(`/shop/lakshmi/items/${inStock.id}/image`, "GET", undefined, "")).status,
      404,
    );
    await request("/api/shop-page", "PUT", { showCatalogue: true, showPrices: false });
    const noPrices = await (await request("/shop/lakshmi", "GET", undefined, "")).text();
    assert.match(noPrices, /Kanchipuram silk shirt/);
    assert.doesNotMatch(noPrices, /₹/);
  }));

test("managers edit content and photos; only owners change the address or publish; staff are read-only", async () =>
  fixture(async ({ request, cm, cs, cb }) => {
    const page = await (await request("/api/shop-page", "GET", undefined, cs)).json();
    assert.equal(page.slug, "lakshmi-silks-sarees");
    assert.equal((await request("/api/shop-page", "PUT", { tagline: "x" }, cs)).status, 403);
    assert.equal(
      (await request("/api/shop-page/photos", "POST", { image: await jpeg() }, cs)).status,
      403,
    );
    const edited = await request("/api/shop-page", "PUT", { tagline: "Manager tagline" }, cm);
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).tagline, "Manager tagline");
    assert.equal((await request("/api/shop-page", "PUT", { published: true }, cm)).status, 403);
    assert.equal(
      (await request("/api/shop-page", "PUT", { slug: "manager-shop" }, cm)).status,
      403,
    );
    const added = await request("/api/shop-page/photos", "POST", { image: await jpeg() }, cm);
    assert.equal(added.status, 201);
    const photoId = (await added.json()).photos[0].id;
    // Another store's owner cannot touch this store's photo by id.
    assert.equal(
      (await request(`/api/shop-page/photos/${photoId}`, "DELETE", undefined, cb)).status,
      404,
    );
    assert.equal(
      (await request("/api/shop-page", "PUT", { tagline: "x" }, cm, "https://evil.example")).status,
      403,
    );
    const other = await (await request("/api/shop-page", "GET", undefined, cb)).json();
    assert.equal(other.photos.length, 0);
    assert.equal(other.slug, "other-store");
  }));

test("slugs are unique, revisions detect stale editors and suspended stores go offline", async () =>
  fixture(async ({ request, store, a, cb }) => {
    const page = await (await request("/api/shop-page")).json();
    await request("/api/shop-page", "PUT", { published: true });
    assert.equal(
      (await request("/api/shop-page", "PUT", { slug: "lakshmi-silks-sarees" }, cb)).status,
      409,
    );
    assert.equal((await request("/api/shop-page", "PUT", { slug: "Bad Slug" })).status, 400);
    assert.equal((await request("/api/shop-page", "PUT", { slug: "admin" })).status, 400);
    assert.equal(
      (await request("/api/shop-page", "PUT", { tagline: "stale", revision: page.revision }))
        .status,
      409,
    );
    assert.equal((await request("/api/shop-page", "PUT", { whatsapp: "98765 43210" })).status, 400);
    assert.equal((await request("/api/shop-page", "PUT", { unknown: 1 })).status, 400);
    assert.equal((await request("/api/shop-page", "PUT", { tagline: "a\nb" })).status, 400);
    const renamed = await request("/api/shop-page", "PUT", { slug: "lakshmi-silks" });
    assert.equal(renamed.status, 200);
    assert.equal((await request("/shop/lakshmi-silks-sarees", "GET", undefined, "")).status, 404);
    assert.equal((await request("/shop/lakshmi-silks", "GET", undefined, "")).status, 200);
    store.db
      .prepare("UPDATE orgs SET status='suspended' WHERE id=(SELECT org FROM stores WHERE id=?)")
      .run(a.id);
    assert.equal((await request("/shop/lakshmi-silks", "GET", undefined, "")).status, 404);
  }));

test("photos can be captioned, reordered, made the cover and removed, up to the limit", async () =>
  fixture(async ({ request, store, a }) => {
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        (await (await request("/api/shop-page/photos", "POST", { image: await jpeg() })).json())
          .photos[i].id,
      );
    const order = async () =>
      (await (await request("/api/shop-page")).json()).photos.map((p) => p.id);
    assert.deepEqual(await order(), ids);
    await request(`/api/shop-page/photos/${ids[2]}`, "PATCH", { move: "first" });
    assert.deepEqual(await order(), [ids[2], ids[0], ids[1]]);
    await request(`/api/shop-page/photos/${ids[0]}`, "PATCH", { move: "down" });
    assert.deepEqual(await order(), [ids[2], ids[1], ids[0]]);
    await request(`/api/shop-page/photos/${ids[1]}`, "PATCH", { move: "up", caption: "Window" });
    const page = await (await request("/api/shop-page")).json();
    assert.deepEqual(
      page.photos.map((p) => p.id),
      [ids[1], ids[2], ids[0]],
    );
    assert.equal(page.photos[0].caption, "Window");
    assert.equal(
      (await request(`/api/shop-page/photos/${ids[1]}`, "PATCH", { move: "sideways" })).status,
      400,
    );
    const removed = await (await request(`/api/shop-page/photos/${ids[1]}`, "DELETE")).json();
    assert.deepEqual(
      removed.photos.map((p) => p.id),
      [ids[2], ids[0]],
    );
    assert.equal((await request(`/api/shop-page/photos/${ids[1]}`, "DELETE")).status, 404);
    const image = await jpeg();
    while (store.shopPages.photos(a.id).length < MAX_SHOP_PHOTOS)
      assert.equal((await request("/api/shop-page/photos", "POST", { image })).status, 201);
    assert.equal((await request("/api/shop-page/photos", "POST", { image })).status, 409);
  }));
