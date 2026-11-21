import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import sharp from "sharp";
import { allowBrowserRequest } from "../server/browser-policy.js";
import {
  readProductLinkWithFallback,
  requestRenderedPage,
  requestWorkerMemory,
} from "../server/browser-reader.js";
import { workerServer } from "../server/browser-worker.js";
import { readWorkerMemory } from "../server/worker-memory.js";
import { safeFetch, LinkError } from "../server/product-link.js";

test("browser request filter refuses private destinations, downloads and unrelated scripts", () => {
  for (const url of [
    "http://127.0.0.1",
    "http://169.254.169.254",
    "http://[::1]",
    "file:///etc/passwd",
    "https://shop.example:8443",
  ])
    assert.equal(allowBrowserRequest(url, "document", "https://shop.example"), false);
  assert.equal(
    allowBrowserRequest("https://shop.example/p", "document", "https://shop.example"),
    true,
  );
  assert.equal(
    allowBrowserRequest("https://shop.example/a.js", "script", "https://shop.example"),
    true,
  );
  assert.equal(
    allowBrowserRequest("https://ads.example/a.js", "script", "https://shop.example"),
    false,
  );
  for (const kind of ["image", "media", "font", "websocket", "other"])
    assert.equal(
      allowBrowserRequest("https://shop.example/a", kind, "https://shop.example"),
      false,
    );
});
test("fallback is disabled by default, only handles eligible failures and reuses guarded image fetching", async () => {
  let calls = 0;
  const browserReader = async () => {
    calls++;
    return {
      url: "https://shop.example/p",
      html: '<meta property="og:image" content="https://cdn.example/shirt.jpg"><title>Shirt</title>',
    };
  };
  const staticReader = async () => {
    throw new LinkError("no_images");
  };
  await assert.rejects(
    readProductLinkWithFallback("https://shop.example", {
      enabled: false,
      staticReader,
      browserReader,
    }),
    { code: "no_images" },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    readProductLinkWithFallback("https://shop.example", {
      enabled: true,
      staticReader: async () => {
        throw new LinkError("blocked_address");
      },
      browserReader,
    }),
    { code: "blocked_address" },
  );
  assert.equal(calls, 0);
  const image = await sharp({
    create: { width: 200, height: 300, channels: 3, background: "#234" },
  })
    .jpeg()
    .toBuffer();
  const result = await readProductLinkWithFallback("https://shop.example", {
    enabled: true,
    staticReader,
    browserReader,
    imageFetch: async (url) => {
      assert.equal(url, "https://cdn.example/shirt.jpg");
      return { body: image };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.images.length, 1);
  assert.equal(result.title, "Shirt");
});
test("worker client bounds responses and validates final URLs", async () => {
  const options = {
    endpoint: "http://reader:3002",
    token: "test-reader-token-at-least-32-characters",
  };
  await assert.rejects(
    requestRenderedPage("https://shop.example", {
      ...options,
      fetchImpl: async () => Response.json({ html: "ok", url: "http://169.254.169.254" }),
    }),
    { code: "blocked_address" },
  );
  await assert.rejects(
    requestRenderedPage("https://shop.example", {
      ...options,
      fetchImpl: async () =>
        Response.json({ html: "x".repeat(5 * 1024 * 1024), url: "https://shop.example" }),
    }),
    { code: "too_large" },
  );
});
test("worker authenticates requests, serializes pages and sanitizes renderer errors", async () => {
  let release, entered;
  const started = new Promise((r) => (entered = r));
  const gate = new Promise((r) => (release = r));
  const token = "test-reader-token-at-least-32-characters";
  const server = workerServer({
    token,
    render: async () => {
      entered();
      await gate;
      throw new Error("private details");
    },
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (auth = true) =>
    fetch(base + "/render", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url: "https://shop.example" }),
    });
  try {
    assert.equal((await post(false)).status, 401);
    const first = post();
    await started;
    assert.equal((await post()).status, 429);
    release();
    const result = await first;
    assert.equal(result.status, 422);
    assert.ok(!(await result.text()).includes("private details"));
  } finally {
    release();
    await new Promise((r) => server.close(r));
  }
});
test("worker memory is scoped to a limited private cgroup v2", async () => {
  const files = {
    "/proc/self/cgroup": "0::/\n",
    "/sys/fs/cgroup/memory.current": "100\n",
    "/sys/fs/cgroup/memory.peak": "300\n",
    "/sys/fs/cgroup/memory.max": "512\n",
  };
  const read = async (file) => {
    if (!(file in files)) throw new Error("Counter unavailable");
    return files[file];
  };
  const sample = () => readWorkerMemory({ expectedLimit: 512, read });
  assert.deepEqual(await sample(), {
    currentBytes: 100,
    peakBytes: 300,
    limitBytes: 512,
  });
  for (const limit of ["max", "8192"]) {
    files["/sys/fs/cgroup/memory.max"] = limit;
    assert.equal(await sample(), null);
  }
  files["/sys/fs/cgroup/memory.max"] = "512\n";
  delete files["/sys/fs/cgroup/memory.peak"];
  assert.equal(await sample(), null);
  assert.equal(
    await readWorkerMemory({
      expectedLimit: 512,
      read: async (file) => {
        assert.equal(file, "/proc/self/cgroup");
        return "0::/system.slice/reader.service\n";
      },
    }),
    null,
  );
});

test("worker memory uses authenticated health and older workers remain compatible", async () => {
  const token = "test-reader-token-at-least-32-characters";
  const snapshot = { currentBytes: 100, peakBytes: 300, limitBytes: 512 };
  let samples = 0;
  const server = workerServer({
    token,
    memory: async () => {
      samples++;
      return snapshot;
    },
    render: async () => assert.fail("A memory read must not start Chromium."),
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${endpoint}/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.deepEqual(await health.json(), { ok: true });
    assert.equal((await fetch(`${endpoint}/health?memory=1`)).status, 401);
    assert.equal(samples, 0);
    assert.deepEqual(await requestWorkerMemory({ endpoint, token }), snapshot);
    assert.equal(samples, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  for (const fetchImpl of [
    async () => new Response(null, { status: 404 }),
    async () => Response.json({ ok: true, memory: { ...snapshot, peakBytes: 50 } }),
    async () => Response.json({ ok: true, memory: snapshot, padding: "x".repeat(1024) }),
  ]) {
    assert.equal(await requestWorkerMemory({ endpoint, token, fetchImpl }), null);
  }
});

test("static fetch enforces an absolute deadline on a continuously streaming response", async (t) => {
  let destroyed = false,
    interval;
  const response = new PassThrough();
  response.statusCode = 200;
  response.headers = { "content-type": "text/html" };
  t.mock.method(http, "request", (_url, _options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {
      destroyed = true;
      clearInterval(interval);
    };
    request.end = () => {
      callback(response);
      interval = setInterval(() => response.write("x"), 5);
    };
    return request;
  });
  try {
    await assert.rejects(safeFetch("http://shop.example", { timeoutMs: 40 }), { code: "timeout" });
    assert.equal(destroyed, true);
  } finally {
    clearInterval(interval);
    response.destroy();
  }
});
