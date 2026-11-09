import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { AccountStore } from "./helpers/pilot-accounts.js";
import { createApp } from "../server/app.js";
import { catalogueHeaders, CatalogueImporter, parseCatalogue } from "../server/catalogue-import.js";
import { catalogueLimit } from "../server/catalogue-fields.js";

const csv = (rows) =>
  Buffer.from(
    catalogueHeaders.join(",") +
      "\n" +
      rows
        .map((row) =>
          [
            row.name ?? "Blue shirt",
            row.type ?? "shirt",
            row.sku ?? "SKU1",
            row.brand ?? "Example",
            row.price ?? "999.50",
            row.mrp ?? "1299",
            row.sizes ?? "S|M|L",
            row.colour ?? "Blue",
            row.stock ?? "in",
            row.product_url ?? "",
            row.image_url ?? "https://shop.example/image.jpg",
          ]
            .map((s) => '"' + String(s).replaceAll('"', '""') + '"')
            .join(","),
        )
        .join("\n"),
  );
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-import-")),
    store = new AccountStore(directory),
    a = await store.register({
      name: "Store A",
      email: "a@example.test",
      password: "test-password-long",
    }),
    b = await store.register({
      name: "Store B",
      email: "b@example.test",
      password: "test-password-long",
    });
  const ca = `forme_session=${store.session(a)}`,
    cb = `forme_session=${store.session(b)}`;
  const blue = await sharp({
      create: { width: 200, height: 300, channels: 3, background: "#2560aa" },
    })
      .jpeg()
      .toBuffer(),
    red = await sharp({ create: { width: 200, height: 300, channels: 3, background: "#aa2525" } })
      .jpeg()
      .toBuffer();
  let active = 0,
    peak = 0,
    calls = 0,
    flip = false;
  const options = {
    fetchImage: async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return { body: flip ? red : blue };
    },
  };
  const app = createApp({ accountStore: store, accessMode: "public", catalogueOptions: options }),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = "GET", body, cookie = ca, origin = base) =>
    fetch(base + url, {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  const upload = (buffer, cookie = ca, filename = "products.csv", origin = base) => {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "text/csv" }), filename);
    return request("/api/catalogue/import", "POST", form, cookie, origin);
  };
  try {
    await run({
      store,
      a,
      b,
      ca,
      cb,
      request,
      upload,
      directory,
      options,
      blue,
      calls: () => calls,
      peak: () => peak,
      setRed: () => {
        flip = true;
      },
    });
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("1,000-row CSV imports 980 valid products, reports 20 errors and reruns without duplicate products or AI charges", async () =>
  fixture(async ({ store, a, upload, calls }) => {
    store.db.prepare("UPDATE orgs SET plan='growth' WHERE id=?").run(a.org);
    const rows = Array.from({ length: 1000 }, (_, i) => ({
        sku: "SKU" + i,
        ...(i % 50 === 0 ? { stock: "invalid" } : {}),
      })),
      before = store.billing.balance(a.org);
    const response = await upload(csv(rows));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.created, 980);
    assert.equal(result.skipped, 20);
    assert.equal(result.errors.length, 20);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM garments WHERE account=?").get(a.id).n,
      980,
    );
    assert.equal(calls(), 1, "shared image URLs have a bounded per-import cache");
    const first = store.db
      .prepare("SELECT id FROM garments WHERE account=? AND sku='SKU1'")
      .get(a.id).id;
    const repeat = await (await upload(csv(rows))).json();
    assert.equal(repeat.created, 0);
    assert.equal(repeat.updated, 0);
    assert.equal(repeat.skipped, 1000);
    assert.equal(repeat.errors.length, 20);
    assert.equal(
      store.db.prepare("SELECT id FROM garments WHERE account=? AND sku='SKU1'").get(a.id).id,
      first,
    );
    assert.equal(store.billing.balance(a.org), before);
  }));

test("CSV SKU upsert isolates stores, preserves product IDs and adaptations for metadata updates, and invalidates obsolete image results", async () =>
  fixture(async ({ store, a, b, upload, cb, setRed, request }) => {
    const first = await (await upload(csv([{ sku: "SAME" }]))).json();
    assert.equal(first.created, 1);
    await upload(csv([{ sku: "SAME" }]), cb);
    const item = store.garments.list(a)[0],
      other = store.garments.list(b)[0];
    assert.notEqual(item.id, other.id);
    // A representative existing result exercises image-change cleanup without AI calls.
    const raw = store.garments.row(a, item.id);
    const av = await store.save(a, {
      image: `data:image/png;base64,${Buffer.from(raw.image).toString("base64")}`,
      name: "Customer",
      profileId: "regular",
      heightCm: 175,
      weightKg: 72,
      source: "imported",
    });
    store.db
      .prepare(
        "INSERT INTO garment_results(account,id,avatarId,garmentId,image,savedAt) VALUES(?,?,?,?,?,?)",
      )
      .run(a.id, "result", av.id, item.id, raw.image, Date.now());
    const update = await (await upload(csv([{ sku: "SAME", price: "899", stock: "low" }]))).json();
    assert.equal(update.updated, 1);
    assert.equal(store.garments.get(a, item.id).priceInr, 899);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM garment_results").get().n, 1);
    assert.equal(store.garments.get(b, other.id).priceInr, 999.5);
    setRed();
    const changed = await (await upload(csv([{ sku: "SAME", price: "899", stock: "low" }]))).json();
    assert.equal(changed.updated, 1);
    assert.equal(store.garments.list(a)[0].id, item.id);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM garment_results").get().n, 0);
    assert.equal(
      (await request(`/api/catalogue/${item.id}`, "PATCH", { stock: "out", priceInr: 799 })).status,
      200,
    );
    assert.equal((await (await request("/api/catalogue")).json()).total, 0);
    assert.equal((await (await request("/api/catalogue?stock=out")).json()).total, 1);
    assert.equal((await request(`/api/catalogue/${item.id}`, "PATCH", { sku: "NEW" })).status, 400);
    assert.equal(
      (await request(`/api/catalogue/${item.id}`, "PATCH", { priceInr: 9999, mrpInr: 10 })).status,
      400,
    );
  }));

test("owner/manager import and edits require a valid session and same origin; staff browse but cannot modify inventory", async () =>
  fixture(async ({ store, a, ca, cb, request, upload }) => {
    for (const role of ["owner", "manager"]) {
      store.db
        .prepare("UPDATE memberships SET role=? WHERE user=? AND store=?")
        .run(role, a.user.id, a.id);
      assert.equal((await upload(csv([{ sku: role }]))).status, 200);
      assert.equal((await request("/api/catalogue/template.csv")).status, 200);
    }
    const item = store.garments.list(a)[0];
    assert.equal(
      (await request(`/api/catalogue/${item.id}`, "PATCH", { stock: "out" }, cb)).status,
      404,
    );
    assert.equal((await upload(csv([{}]), ca, "products.csv", "https://evil.test")).status, 403);
    assert.equal(
      (
        await request(
          `/api/catalogue/${item.id}`,
          "PATCH",
          { stock: "out" },
          ca,
          "https://evil.test",
        )
      ).status,
      403,
    );
    for (const [url, method, body] of [
      ["/api/catalogue", "GET", undefined],
      ["/api/catalogue/template.csv", "GET", undefined],
      [`/api/catalogue/${item.id}`, "PATCH", { stock: "out" }],
    ])
      assert.equal((await request(url, method, body, "")).status, 401);
    assert.equal((await upload(csv([{}]), "")).status, 401);
    store.db
      .prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?")
      .run(a.user.id, a.id);
    assert.equal((await request("/api/catalogue")).status, 200);
    assert.equal((await upload(csv([{}]))).status, 403);
    assert.equal((await request("/api/catalogue/template.csv")).status, 403);
    assert.equal(
      (await request(`/api/catalogue/${item.id}`, "PATCH", { stock: "out" })).status,
      403,
    );
    store.db.prepare("UPDATE users SET disabled=1 WHERE id=?").run(a.user.id);
    assert.equal((await request("/api/catalogue")).status, 401);
  }));

test("private and credentialed image URLs fail before fetching; invalid fields and duplicate SKUs are reported per row", async () =>
  fixture(async ({ upload, calls }) => {
    const result = await (
      await upload(
        csv([
          { sku: "bad1", image_url: "http://169.254.169.254/latest/meta-data" },
          { sku: "bad2", image_url: "http://127.0.0.1/image.jpg" },
          { sku: "bad3", image_url: "https://user:pass@shop.example/image.jpg" },
          { sku: "bad4", price: "-1" },
          { sku: "bad5", price: "100", mrp: "99" },
          { sku: "bad6", type: "unknown" },
          { sku: "good" },
          { sku: "good" },
        ]),
      )
    ).json();
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 7);
    assert.equal(result.errors.length, 7);
    assert.equal(calls(), 1);
  }));

test("parser rejects malformed headers/quotes/UTF-8; multipart limits reject oversized or non-CSV uploads", async () =>
  fixture(async ({ upload, request }) => {
    for (const text of [
      "name,type,sku,image_url,sku\nA,shirt,X,https://shop.example/a,X",
      "name,type\nA,shirt",
      'name,type,sku,image_url\n"unterminated',
    ])
      assert.throws(() => parseCatalogue(Buffer.from(text)), { status: 400 });
    assert.throws(() => parseCatalogue(Buffer.from([0xff, 0xff])), { status: 400 });
    assert.equal((await upload(Buffer.alloc(5 * 1024 * 1024 + 1, 65))).status, 413);
    assert.equal((await upload(csv([{}]), undefined, "products.xlsx")).status, 400);
    assert.equal((await request("/api/catalogue/import", "POST", {})).status, 400);
  }));

test("downloads are limited to three workers; failed image rows do not abort valid rows", async () =>
  fixture(async ({ store, a, options, upload, peak }) => {
    const data = csv(
      Array.from({ length: 12 }, (_, i) => ({
        sku: "P" + i,
        image_url: "https://shop.example/" + i + ".jpg",
      })),
    );
    const result = await (await upload(data)).json();
    assert.equal(result.created, 12);
    assert.equal(peak(), 3);
    const importer = new CatalogueImporter(store, {
      fetchImage: async () => {
        throw new Error("network detail must not be exposed");
      },
    });
    const failed = await importer.run(a, csv([{ sku: "bad-image" }]));
    assert.equal(failed.skipped, 1);
    assert.match(failed.errors[0].message, /Image could not/);
    assert.ok(!failed.errors[0].message.includes("network detail"));
  }));

test("plan limits apply to CSV and manual saves, existing products can update at capacity and search is paged with literal wildcards", async () =>
  fixture(async ({ store, a, upload, blue, request }) => {
    for (const [plan, limit] of [
      ["starter", 500],
      ["growth", 5000],
      ["chain", 50000],
    ]) {
      store.db.prepare("UPDATE orgs SET plan=? WHERE id=?").run(plan, a.org);
      assert.equal(catalogueLimit(store.db, a), limit);
    }
    store.db.prepare("UPDATE orgs SET plan='starter' WHERE id=?").run(a.org);
    const tooMany = await upload(csv(Array.from({ length: 501 }, (_, i) => ({ sku: "SKU" + i }))));
    assert.equal(tooMany.status, 409);
    assert.equal((await tooMany.json()).created, 0);
    await upload(
      csv(
        Array.from({ length: 500 }, (_, i) => ({
          sku: "SKU" + i,
          brand: i === 0 ? "100% Brand" : "Example",
        })),
      ),
    );
    assert.equal((await upload(csv([{ sku: "OVER" }]))).status, 409);
    assert.equal(
      (await upload(csv([{ sku: "SKU0", stock: "out", brand: "100% Brand" }]))).status,
      200,
    );
    await assert.rejects(
      store.garments.save(a, {
        image: `data:image/jpeg;base64,${blue.toString("base64")}`,
        name: "Manual",
        variant: "new",
        garmentType: "shirt",
      }),
      { status: 409 },
    );
    const page = await (await request("/api/catalogue?limit=20&offset=20")).json();
    assert.equal(page.garments.length, 20);
    assert.equal(page.total, 499);
    assert.equal(page.stored, 500);
    assert.equal(page.capacity, 500);
    const found = await (await request("/api/catalogue?search=100%25&stock=all")).json();
    assert.equal(found.total, 1);
    assert.equal((await request("/api/catalogue?limit=100000")).status, 400);
  }));

test("schema upgrades are idempotent and legacy avatar/adaptation data survives catalogue fields", async () =>
  fixture(async ({ store, a, directory, upload }) => {
    await upload(csv([{ sku: "PERSIST" }]));
    const before = store.garments.list(a)[0];
    const reopened = new AccountStore(directory);
    try {
      const after = reopened.garments.get(a, before.id);
      assert.equal(after.sku, "PERSIST");
      assert.deepEqual(after.sizes, ["S", "M", "L"]);
      assert.equal(after.priceInr, 999.5);
      assert.deepEqual(reopened.db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      reopened.close();
    }
  }));
