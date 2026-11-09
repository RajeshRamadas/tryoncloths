import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createTurnstile } from "../server/turnstile.js";
import { loadShopperConfiguration } from "../server/shopper-config.js";
import { checkShopperConfiguration } from "../server/check-shopper.js";
import { workflowFixture, testDisclosure } from "./helpers/shopper-workflow.js";
import { publicStudio } from "./helpers/shopify-shopper.js";

const siteKey = "site-key-public-long-enough-123",
  secretKey = "server-secret-do-not-print-123456";
const input = () => ({
  token: "challenge-token",
  action: "avatar",
  hostname: "studio.example.test",
});
const valid = () => ({
  success: true,
  action: "avatar",
  hostname: "studio.example.test",
  challenge_ts: new Date().toISOString(),
});
const response = (data) =>
  new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const withFiles = (run) => async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "forme-shopper-config-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
const withShop = (run) => async () => {
  const f = await workflowFixture();
  try {
    await run(f);
  } finally {
    await f.close();
  }
};

test("Turnstile makes one fixed-host server verification call with secret only on the server, not IP or private metadata", async () => {
  const calls = [],
    adapter = createTurnstile({
      siteKey,
      secretKey,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(valid());
      },
    });
  const verdict = await adapter.captcha.verify(input());
  assert.equal(verdict.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    secret: secretKey,
    response: "challenge-token",
  });
  assert.ok(!adapter.verificationClient.script.includes(secretKey));
  assert.ok(adapter.verificationClient.script.includes(siteKey));
  assert.ok(!JSON.stringify(adapter).includes(secretKey));
});

test("Turnstile rejects invalid, missing or mismatched results and never retries provider errors or malformed/oversized responses", async () => {
  for (const change of [
    { success: false },
    { action: "tryon" },
    { hostname: "evil.example.test" },
    { challenge_ts: "not-a-date" },
  ]) {
    const adapter = createTurnstile({
      siteKey,
      secretKey,
      fetchImpl: async () => response({ ...valid(), ...change }),
    });
    assert.equal((await adapter.captcha.verify(input())).success, false);
  }
  for (const reply of [
    () => new Response("private-secret", { status: 429 }),
    () => new Response("not-json"),
    () => new Response("x".repeat(17000)),
    () => new Response("{}", { headers: { "content-length": "20000" } }),
    () => {
      throw new Error(secretKey);
    },
  ]) {
    let calls = 0;
    const adapter = createTurnstile({
      siteKey,
      secretKey,
      fetchImpl: async () => {
        calls++;
        return reply();
      },
    });
    await assert.rejects(
      adapter.captcha.verify(input()),
      (error) => !error.message.includes(secretKey) && !error.message.includes("private-secret"),
    );
    assert.equal(calls, 1);
  }
});

test("Turnstile refuses invalid token sizes, cancelled requests and known public test keys in production", async () => {
  let calls = 0;
  const adapter = createTurnstile({
    siteKey,
    secretKey,
    fetchImpl: async () => {
      calls++;
      return response(valid());
    },
  });
  for (const token of ["", null, "x".repeat(2049)])
    assert.equal((await adapter.captcha.verify({ ...input(), token })).success, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(adapter.captcha.verify({ ...input(), signal: controller.signal }));
  assert.equal(calls, 0);
  assert.throws(() => createTurnstile({ siteKey: "1x00000000000000000000AA", secretKey }));
  assert.throws(() => createTurnstile({ siteKey, secretKey: "bad" }));
});

test("an in-flight Turnstile request honours cancellation without a retry", async () => {
  let started,
    calls = 0;
  const ready = new Promise((resolve) => {
      started = resolve;
    }),
    controller = new AbortController();
  const adapter = createTurnstile({
    siteKey,
    secretKey,
    fetchImpl: async (url, { signal }) => {
      calls++;
      started();
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  });
  const request = adapter.captcha.verify({ ...input(), signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(request);
  assert.equal(calls, 1);
});

test(
  "reviewed module loads only bounded allowed dependencies; invalid files, permissions and exports never reveal raw errors",
  withFiles(async (dir) => {
    const validFile = path.join(dir, "valid.mjs");
    await writeFile(
      validFile,
      `export default {disclosure:${JSON.stringify(testDisclosure)},moderation:{id:'reviewed-test',async check(){throw new Error('not a live adapter')}}};`,
    );
    const loaded = await loadShopperConfiguration({
      env: {
        TRYON_SHOPPER_CONFIG_MODULE: validFile,
        TRYON_SHOPPER_CAPTCHA: "turnstile",
        TRYON_TURNSTILE_SITE_KEY: siteKey,
        TRYON_TURNSTILE_SECRET_KEY: secretKey,
      },
    });
    assert.equal(loaded.source.status, "loaded");
    assert.equal(loaded.shopperSessionOptions.consentRevision, testDisclosure.revision);
    assert.equal(loaded.shopperSessionOptions.captcha.id, "cloudflare-turnstile");
    assert.equal(typeof loaded.shopperSessionOptions.moderation.check, "function");
    assert.ok(!JSON.stringify(loaded).includes(secretKey));
    const files = [
      ["exports.mjs", "export default {enabled:true};"],
      ["throw.mjs", `throw new Error(${JSON.stringify(secretKey)});`],
      ["huge.mjs", " ".repeat(131073)],
    ];
    for (const [name, contents] of files) {
      const file = path.join(dir, name);
      await writeFile(file, contents);
      const result = await loadShopperConfiguration({ env: { TRYON_SHOPPER_CONFIG_MODULE: file } });
      assert.equal(result.source.status, "invalid");
      assert.equal(result.shopperSessionOptions.moderation, undefined);
      assert.ok(!JSON.stringify(result).includes(secretKey));
      assert.ok(!JSON.stringify(result).includes(dir));
    }
    await chmod(validFile, 0o666);
    assert.equal(
      (await loadShopperConfiguration({ env: { TRYON_SHOPPER_CONFIG_MODULE: validFile } })).source
        .status,
      "invalid",
    );
    assert.equal(
      (await loadShopperConfiguration({ env: { TRYON_SHOPPER_CONFIG_MODULE: "relative.mjs" } }))
        .source.status,
      "invalid",
    );
  }),
);

test(
  "service selection conflicts and consent revision drift clear all dependencies, with no permissive fallback",
  withFiles(async (dir) => {
    const file = path.join(dir, "services.mjs");
    await writeFile(
      file,
      `export default {disclosure:${JSON.stringify(testDisclosure)},captcha:{id:'custom',verify(){}},verificationClient:{id:'custom',script:'test'}};`,
    );
    const both = await loadShopperConfiguration({
      env: {
        TRYON_SHOPPER_CONFIG_MODULE: file,
        TRYON_SHOPPER_CAPTCHA: "turnstile",
        TRYON_TURNSTILE_SITE_KEY: siteKey,
        TRYON_TURNSTILE_SECRET_KEY: secretKey,
      },
    });
    assert.equal(both.source.code, "verification_invalid");
    assert.equal(both.shopperSessionOptions.captcha, undefined);
    const mismatch = await loadShopperConfiguration({
      env: { TRYON_SHOPPER_CONFIG_MODULE: file, TRYON_SHOPPER_CONSENT_REVISION: "different" },
    });
    assert.equal(mismatch.source.code, "consent_revision_mismatch");
    assert.equal(mismatch.shopperWorkflowOptions.disclosure, undefined);
    const none = await loadShopperConfiguration({ env: {} });
    assert.equal(none.source.status, "not-configured");
    assert.equal(none.shopperSessionOptions.moderation, undefined);
  }),
);

test(
  "owner/manager readiness is local, scoped, non-mutating and excludes credentials, scripts, paths, customer payloads and fake live approvals",
  withShop(async (f) => {
    const before = {
      credits: f.store.billing.balance(f.a.org),
      state: f.state.db.prepare("SELECT * FROM shopper_state").all(),
      calls: f.calls.avatar.length + f.calls.tryon.length,
    };
    const owner = await fetch(f.base + "/api/shopify-shopper", {
      headers: { Cookie: "forme_session=" + f.staffToken },
    });
    assert.equal(owner.status, 200);
    const data = await owner.json();
    assert.equal(data.readiness.liveVerified, false);
    assert.equal(data.readiness.workflowConfigured, true);
    assert.equal(data.readiness.checks.find((c) => c.id === "storage").state, "blocked");
    assert.ok(data.readiness.manualChecks.every((c) => c.state === "unverified"));
    const serialized = JSON.stringify(data.readiness);
    for (const privateValue of [
      "test-key-only",
      "shpat_private",
      f.directory,
      "data:image",
      "heightCm",
      f.staffToken,
    ])
      assert.ok(!serialized.includes(privateValue));
    for (const [cookie, status] of [
      [f.managerToken, 200],
      [f.otherToken, 200],
      ["", 401],
    ])
      assert.equal(
        (
          await fetch(f.base + "/api/shopify-shopper", {
            headers: { Cookie: cookie ? "forme_session=" + cookie : "" },
          })
        ).status,
        status,
      );
    f.store.db
      .prepare("UPDATE memberships SET role='staff' WHERE user=? AND store=?")
      .run(f.b.user.id, f.a.id);
    assert.equal(
      (
        await fetch(f.base + "/api/shopify-shopper", {
          headers: { Cookie: "forme_session=" + f.managerToken },
        })
      ).status,
      403,
    );
    assert.deepEqual(f.state.db.prepare("SELECT * FROM shopper_state").all(), before.state);
    assert.equal(f.store.billing.balance(f.a.org), before.credits);
    assert.equal(f.calls.avatar.length + f.calls.tryon.length, before.calls);
  }),
);

test(
  "readiness updates after pause, cap consumption and invalid disclosure without treating those as successful live checks",
  withShop(async (f) => {
    let report = f.service.summary(f.a).readiness;
    assert.equal(report.checks.find((c) => c.id === "budget").state, "pass");
    assert.equal(report.checks.find((c) => c.id === "products").state, "pass");
    f.store.shoppers.update(f.a, { action: "pause" });
    report = f.service.summary(f.a).readiness;
    assert.equal(report.checks.find((c) => c.id === "budget").state, "blocked");
    assert.equal(report.checks.find((c) => c.id === "products").state, "blocked");
    f.configure();
    f.workflow.disclosure = null;
    assert.equal(
      f.service.summary(f.a).readiness.checks.find((c) => c.id === "disclosure").state,
      "blocked",
    );
    assert.equal(f.service.summary(f.a).readiness.liveVerified, false);
  }),
);

test(
  "offline preflight refuses shared/non-tmpfs directories and reads configuration without creating databases or leaking secrets",
  withFiles(async (dir) => {
    await chmod(dir, 0o755);
    const before = await readdir(dir),
      env = {
        TRYON_DATA_DIR: dir,
        TRYON_SHOPPER_STATE_DIR: dir,
        TRYON_GEMINI_API_KEY: secretKey,
        SHOPIFY_APP_CLIENT_SECRET: secretKey,
      };
    const result = await checkShopperConfiguration({ env });
    assert.equal(result.configurationReady, false);
    assert.equal(result.liveVerified, false);
    assert.equal(result.checks.find((c) => c.id === "storage-separation").state, "blocked");
    assert.equal(result.checks.find((c) => c.id === "state-directory").state, "blocked");
    assert.equal(result.checks.find((c) => c.id === "provider").state, "pass");
    assert.deepEqual(await readdir(dir), before);
    assert.ok(!JSON.stringify(result).includes(secretKey));
    const command = spawnSync(process.execPath, ["server/check-shopper.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
        TRYON_SHOPPER_CONFIG_MODULE: path.join(dir, "private-secret-name.mjs"),
      },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(command.status, 1);
    const cli = JSON.parse(command.stdout);
    assert.equal(cli.configurationReady, false);
    assert.ok(!command.stdout.includes(secretKey));
    assert.ok(!command.stdout.includes(dir));
    assert.deepEqual(await readdir(dir), before);
  }),
);

test(
  "the production bootstrap loads invalid shopper configuration fail-closed while keeping the staff service running",
  withFiles(async (dir) => {
    const module = path.join(dir, "invalid.mjs");
    await writeFile(module, `throw new Error(${JSON.stringify(secretKey)});`);
    const script = `import net from 'node:net';const original=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){this.once('listening',()=>console.log('TEST_PORT='+this.address().port));return original.apply(this,args);};await import('./server/index.js');`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, "--", "--production"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: "0",
          TRYON_DATA_DIR: "",
          TRYON_PROVIDER: "gemini",
          TRYON_GEMINI_API_KEY: "",
          TRYON_ACCESS_MODE: "public",
          TRYON_TRUST_PROXY_HOPS: "0",
          TRYON_SHOPPER_CONFIG_MODULE: module,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Server did not start.")), 10000);
        child.stdout.on("data", (chunk) => {
          log += chunk;
          const match = /TEST_PORT=(\d+)/.exec(log);
          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Server exited before readiness."));
        });
      });
      const health = await fetch("http://127.0.0.1:" + port + "/api/health");
      assert.equal(health.status, 200);
      assert.equal((await health.json()).personalizationAvailable, false);
      assert.ok(!log.includes(secretKey));
    } finally {
      child.kill("SIGTERM");
      if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    }
  }),
);
