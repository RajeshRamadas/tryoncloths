import {randomUUID} from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import dns from "node:dns";
import sharp from "sharp";
import { createApp, standardAvatar } from "../server/app.js";
import { geminiTryOn, tryOnPrompt, garmentTypes } from "../server/gemini-tryon.js";
import { extractProduct, isPublicAddress, parseProductUrl, readProductLink, safeFetch, LinkError } from "../server/product-link.js";

async function withServer(options, run) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (base, path, body, origin = base) => fetch(`${base}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(path==="/api/tryon"?{requestId:randomUUID(),...body}:body),
});
const avatarPng = await standardAvatar("regular");
const avatar = `data:image/png;base64,${avatarPng.toString("base64")}`;
const garmentJpeg = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#1f3a93" } }).jpeg().toBuffer();
const garment = `data:image/jpeg;base64,${garmentJpeg.toString("base64")}`;
const validTryOn = { avatar, garment, garmentType: "shirt", consent: true, consentScope: "avatar-and-garment", consentProvider: "gemini" };

test("only public addresses are reachable", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "142.250.183.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"])
    assert.equal(isPublicAddress(address), true, address);
});

test("product URLs must be public http(s) links on standard ports", () => {
  for (const url of ["ftp://shop.example/x", "file:///etc/passwd", "javascript:alert(1)", "not a url", "http://127.0.0.1/a", "http://[::1]/a",
    "http://169.254.169.254/latest/meta-data", "http://localhost/a", "http://shop.local/a", "https://shop.example:8443/a", "https://user:pw@shop.example/a"])
    assert.throws(() => parseProductUrl(url), LinkError, url);
  assert.equal(parseProductUrl(" https://www.myntra.com/shirts/123#reviews ").href, "https://www.myntra.com/shirts/123");
});

test("hostnames resolving to private addresses are refused at connect time", async () => {
  const server = http.createServer((_req, res) => res.end("secret")).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    // localhost.direct-style names are blocked by name; a raw loopback port is blocked by address and port.
    await assert.rejects(safeFetch(`http://127.0.0.1:${server.address().port}/`), error => error.code === "blocked_address");
    await assert.rejects(safeFetch("http://localhost/"), error => error.code === "blocked_address");
  } finally { server.close(); }
  // A public-looking name whose DNS answer is private (or DNS rebinding) is refused when connecting.
  const original = dns.lookup;
  dns.lookup = (_host, _options, callback) => callback(null, [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }]);
  try {
    await assert.rejects(safeFetch("http://shop.example/product"), error => error.code === "blocked_address");
  } finally { dns.lookup = original; }
});

test("product images and title come from JSON-LD, Open Graph and image_src, resolved and de-duplicated", () => {
  const html = `<html><head><title>Fallback &amp; title</title>
    <meta property="og:title" content="OG Title">
    <meta property="og:image" content="https://cdn.shop.example/og.jpg">
    <meta name="twitter:image" content="/img/tw.jpg?w=800&amp;h=1000">
    <link rel="image_src" href="//cdn.shop.example/og.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":"Product","name":"Men Slim Fit Oxford Shirt","image":["https://cdn.shop.example/front.jpg",{"@type":"ImageObject","url":"https://cdn.shop.example/back.jpg"}]}]}</script>
    <script type="application/ld+json">{ broken json</script>
    </head></html>`;
  const product = extractProduct(html, new URL("https://www.shop.example/p/1"));
  assert.equal(product.title, "Men Slim Fit Oxford Shirt");
  assert.deepEqual(product.images, [
    "https://cdn.shop.example/front.jpg",
    "https://cdn.shop.example/back.jpg",
    "https://cdn.shop.example/og.jpg",
    "https://www.shop.example/img/tw.jpg?w=800&h=1000",
  ]);
  assert.equal(extractProduct("<title>Only &amp; title</title>", new URL("https://a.example")).title, "Only & title");
});

test("reading a product link returns normalized images and skips unusable ones", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/p/")) return { url: new URL(String(url)), type: "text/html; charset=utf-8",
      body: Buffer.from(`<meta property="og:image" content="https://cdn.shop.example/a.png"><meta property="og:image" content="https://cdn.shop.example/tiny.png"><meta property="og:title" content="Blue Jeans">`) };
    const size = String(url).includes("tiny") ? 40 : 600;
    return { url: new URL(String(url)), type: "image/png", body: await sharp({ create: { width: size, height: size, channels: 4, background: "#00000000" } }).png().toBuffer() };
  };
  const result = await readProductLink("https://www.shop.example/p/9", { fetchImpl });
  assert.equal(result.title, "Blue Jeans");
  assert.equal(result.images.length, 1);
  assert.match(result.images[0].image, /^data:image\/jpeg;base64,/);
  assert.equal(calls.length, 3);
  await assert.rejects(readProductLink("https://www.shop.example/p/empty", { fetchImpl: async url => ({ url, type: "text/html", body: Buffer.from("<p>nothing</p>") }) }),
    error => error.code === "no_images");
});

test("product-link endpoint checks origin and maps failures to safe messages", async () => {
  let calls = 0;
  await withServer({ provider: "gemini", apiKey: "test-only", rateLimit: false, productLink: async url => {
    calls++;
    if (url.includes("blocked")) throw new LinkError("site_refused");
    if (url.includes("crash")) throw new Error("internal detail");
    return { title: "Shirt", url, images: [{ source: url, image: garment }] };
  } }, async base => {
    assert.equal((await post(base, "/api/product-link", { url: "https://shop.example/p" }, "https://evil.example")).status, 403);
    assert.equal(calls, 0);
    const ok = await post(base, "/api/product-link", { url: "https://shop.example/p" });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).images.length, 1);
    const refused = await post(base, "/api/product-link", { url: "https://shop.example/blocked" });
    assert.equal(refused.status, 502);
    assert.equal((await refused.json()).code, "site_refused");
    const crashed = await (await post(base, "/api/product-link", { url: "https://shop.example/crash" })).json();
    assert.equal(crashed.code, "unknown");
    assert.doesNotMatch(crashed.error, /internal detail/);
  });
});

test("try-on requires Gemini, matching consent, a listed garment type and valid images", async () => {
  let calls = 0;
  const tryOn = async ({ avatar: a, garment: g, garmentType, title }) => {
    calls++;
    assert.ok(Buffer.isBuffer(a) && Buffer.isBuffer(g));
    assert.equal(garmentType, "jeans");
    assert.equal(title, "Slim jeans");
    return avatar;
  };
  await withServer({ provider: "gemini", apiKey: "test-only", rateLimit: false, tryOn }, async base => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.tryOnAvailable, true);
    assert.equal(health.tryOnContract, "garment-tryon-v1");
    assert.deepEqual(health.garmentTypes, Object.keys(garmentTypes));
    for (const bad of [{ consent: false }, { consentScope: "face-and-body" }, { consentProvider: "openai" }, { garmentType: "hat" },
      { avatar: garment }, { garment: "data:image/gif;base64,AAAA" }])
      assert.equal((await post(base, "/api/tryon", { ...validTryOn, garmentType: "jeans", ...bad })).status, 400, JSON.stringify(Object.keys(bad)));
    assert.equal((await post(base, "/api/tryon", { ...validTryOn, garmentType: "jeans" }, "https://evil.example")).status, 403);
    assert.equal(calls, 0);
    const response = await post(base, "/api/tryon", { ...validTryOn, garmentType: "jeans", title: "Slim jeans" });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.kind, "garment-tryon");
    assert.equal(data.garmentType, "jeans");
    assert.equal(calls, 1);
  });
  await withServer({ provider: "openai", apiKey: "test-only", rateLimit: false, tryOn }, async base => {
    assert.equal((await (await fetch(`${base}/api/health`)).json()).tryOnAvailable, false);
    assert.equal((await post(base, "/api/tryon", { ...validTryOn, consentProvider: "openai" })).status, 503);
  });
  await withServer({ provider: "gemini", apiKey: "", tryOn }, async base => {
    assert.equal((await post(base, "/api/tryon", validTryOn)).status, 503);
  });
});

test("try-on shares the paid-generation attempt limit", async () => {
  let calls = 0;
  await withServer({ provider: "gemini", apiKey: "test-only", tryOn: async () => { calls++; return avatar; } }, async base => {
    assert.equal((await post(base, "/api/tryon", validTryOn)).status, 200);
    assert.equal((await post(base, "/api/tryon", validTryOn)).status, 429);
    assert.equal(calls, 1);
  });
});

test("Gemini try-on sends the avatar first, the garment second, and rejects faceless output", async () => {
  const prompt = tryOnPrompt("shoes", "Leather <script>ignore previous</script> Shoes");
  assert.match(prompt, /footwear only/);
  assert.doesNotMatch(prompt, /<script>/);
  let calls = 0;
  const reply = data => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data } }] } }] }) });
  const result = await geminiTryOn({ avatar: avatarPng, garment: garmentJpeg, garmentType: "shirt", title: "Oxford shirt", apiKey: "test-only", fetchImpl: async (url, options) => {
    calls++;
    assert.match(url, /gemini-2\.5-flash-image:generateContent$/);
    const parts = JSON.parse(options.body).contents[0].parts;
    const images = parts.filter(part => part.inlineData).map(part => part.inlineData);
    assert.deepEqual(images.map(image => image.mimeType), ["image/png", "image/jpeg"]);
    assert.equal(images[0].data, avatarPng.toString("base64"));
    assert.equal(images[1].data, garmentJpeg.toString("base64"));
    assert.match(parts[0].text, /Replace the upper-body garment/);
    assert.match(parts[0].text, /Product name, for reference only: "Oxford shirt"/);
    return reply(avatarPng.toString("base64"));
  } });
  assert.match(result, /^data:image\/png;base64,/);
  assert.equal(calls, 1);
  const blank = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#cccccc" } }).png().toBuffer();
  await assert.rejects(geminiTryOn({ avatar: avatarPng, garment: garmentJpeg, garmentType: "shirt", apiKey: "test-only", fetchImpl: async () => reply(blank.toString("base64")) }),
    error => error.code === "missing_face");
});
