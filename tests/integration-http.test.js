import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { integrationFetch } from "../server/integration-http.js";
import { guardedLookup } from "../server/public-url.js";
import { ShopCatalogue } from "../server/shop-catalogue.js";
function stub({ status = 200, body = "{}", headers = {}, hang = false } = {}) {
  const calls = [];
  let destroyed = false;
  const requestImpl = (url, options, callback) => {
    const req = new EventEmitter();
    calls.push({ url, options });
    req.end = (sent) => {
      calls.at(-1).body = sent;
      if (!hang)
        queueMicrotask(() => {
          const res = Readable.from([Buffer.from(body)]);
          res.headers = headers;
          res.statusCode = status;
          callback(res);
        });
    };
    req.destroy = () => {
      destroyed = true;
    };
    return req;
  };
  return { requestImpl, calls, destroyed: () => destroyed };
}
test("authenticated transport pins guarded DNS, sends credentials only in headers and never follows redirects", async () => {
  const mock = stub({
      status: 302,
      headers: { location: "https://attacker.example.test/capture" },
    }),
    fetchImpl = (url, options) =>
      integrationFetch(url, { ...options, requestImpl: mock.requestImpl }),
    client = new ShopCatalogue({ fetchImpl });
  await assert.rejects(
    client.check(
      "shopify",
      "https://sample.myshopify.com",
      { token: "test-secret" },
      Date.now() + 10000,
    ),
  );
  assert.equal(mock.calls.length, 1);
  const call = mock.calls[0];
  assert.equal(call.options.lookup, guardedLookup);
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers["X-Shopify-Access-Token"], "test-secret");
  assert.ok(!call.url.href.includes("test-secret"));
  assert.ok(!call.body.includes("test-secret"));
});
test("authenticated transport bounds bodies and absolute request time and blocks literal private targets", async () => {
  const large = stub({ body: "x".repeat(500) });
  await assert.rejects(
    integrationFetch("https://shop.example.test", {
      requestImpl: large.requestImpl,
      maxBytes: 100,
    }),
  );
  assert.equal(large.destroyed(), true);
  const slow = stub({ hang: true });
  await assert.rejects(
    integrationFetch("https://shop.example.test", { requestImpl: slow.requestImpl, timeoutMs: 5 }),
  );
  assert.equal(slow.destroyed(), true);
  assert.throws(() => integrationFetch("https://127.0.0.1", { requestImpl: slow.requestImpl }));
  assert.equal(slow.calls.length, 1);
});
