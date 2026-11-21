import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { ProviderError } from "../server/provider-errors.js";

const face = await sharp({
  create: { width: 256, height: 256, channels: 3, background: "#c49d83" },
})
  .jpeg()
  .toBuffer();
const body = await sharp({
  create: { width: 300, height: 600, channels: 3, background: "#aaaaaa" },
})
  .jpeg()
  .toBuffer();
const output = await sharp({
  create: { width: 384, height: 768, channels: 3, background: "#b5b5b5" },
})
  .png()
  .toBuffer();
const avatarUrl = "data:image/png;base64," + output.toString("base64");

async function withApi(options, work) {
  const server = createApp({
    provider: "gemini",
    apiKey: "test-local-credential",
    rateLimit: false,
    accessMode: "public",
    ...options,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  async function generate(identityCheckConsent) {
    const response = await fetch(url + "/api/personalize", {
      method: "POST",
      headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify({
        requestId: randomUUID(),
        face: "data:image/jpeg;base64," + face.toString("base64"),
        body: "data:image/jpeg;base64," + body.toString("base64"),
        profileId: "regular",
        templateTone: "medium",
        measurements: { heightCm: 175, weightKg: 72 },
        consent: true,
        consentScope: "face-and-body",
        consentProvider: "gemini",
        ...(identityCheckConsent ? { identityCheckConsent: true } : {}),
      }),
    });
    return { status: response.status, body: await response.json() };
  }
  try {
    await work({ url, generate });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("opt-in identity screening requires explicit local biometric consent before generation", async () => {
  let calls = 0;
  await withApi(
    {
      avatarIdentityEnabled: true,
      personalize: async () => {
        calls++;
        return avatarUrl;
      },
      avatarIdentityScreen: async () => {
        calls++;
        return true;
      },
    },
    async ({ url, generate }) => {
      const health = await (await fetch(url + "/api/health")).json();
      assert.equal(health.avatarIdentityScreenAvailable, true);
      assert.equal(health.avatarIdentityMode, "enforce");
      const missing = await generate(false);
      assert.equal(missing.status, 400);
      assert.equal(missing.body.code, "identity_consent_required");
      assert.equal(calls, 0, "Neither generation nor recognition should start");
      const accepted = await generate(true);
      assert.equal(accepted.status, 200);
      assert.equal(accepted.body.kind, "customer-avatar");
      assert.equal(accepted.body.needsReview, true);
      assert.equal(accepted.body.image, avatarUrl);
      assert.deepEqual(accepted.body.identityReview, { status: "screen_pass" });
      assert.equal(calls, 2);
    },
  );
});

test("mismatched faces are rejected without a usable customer avatar", async () => {
  let compared = 0;
  await withApi(
    {
      avatarIdentityEnabled: true,
      personalize: async () => avatarUrl,
      avatarIdentityScreen: async ({ face: original, image }) => {
        assert.equal(Buffer.isBuffer(original), true);
        assert.equal(image, avatarUrl);
        compared++;
        throw new ProviderError("identity_mismatch");
      },
    },
    async ({ generate }) => {
      const result = await generate(true);
      assert.equal(compared, 1);
      assert.equal(result.status, 502);
      assert.equal(result.body.code, "identity_mismatch");
      assert.equal("image" in result.body, false);
    },
  );
});

test("without opt-in, existing generation remains available with no biometric inference", async () => {
  await withApi(
    {
      avatarIdentityEnabled: false,
      personalize: async () => avatarUrl,
      avatarIdentityScreen: async () => assert.fail("Recognition must be disabled"),
    },
    async ({ url, generate }) => {
      const health = await (await fetch(url + "/api/health")).json();
      assert.equal(health.avatarIdentityScreenAvailable, false);
      assert.equal(health.avatarIdentityMode, "off");
      const result = await generate(false);
      assert.equal(result.status, 200);
      assert.equal(result.body.image, avatarUrl);
      assert.equal(Object.hasOwn(result.body, "identityReview"), false);
    },
  );
});

test("advisory mode needs biometric consent and returns only a review status", async () => {
  let comparisons = 0;
  let generations = 0;
  await withApi(
    {
      avatarIdentityMode: "review",
      avatarIdentityMax: "0.415",
      personalize: async () => {
        generations++;
        return avatarUrl;
      },
      avatarIdentityScreen: async ({ maxDistance }) => {
        assert.equal(maxDistance, 0.415);
        comparisons++;
        if (comparisons === 1) throw new ProviderError("identity_mismatch");
        if (comparisons === 2) throw new Error("private diagnostic");
        return true;
      },
    },
    async ({ url, generate }) => {
      const health = await (await fetch(url + "/api/health")).json();
      assert.equal(health.avatarIdentityScreenAvailable, true);
      assert.equal(health.avatarIdentityMode, "review");
      assert.equal((await generate(false)).body.code, "identity_consent_required");
      assert.equal(comparisons, 0);
      assert.equal(generations, 0);
      for (const expected of [
        { status: "needs_review", reason: "possible_mismatch" },
        { status: "needs_review", reason: "check_unavailable" },
        { status: "screen_pass" },
      ]) {
        const result = await generate(true);
        assert.equal(result.status, 200);
        assert.equal(result.body.image, avatarUrl);
        assert.equal(result.body.needsReview, true);
        assert.deepEqual(result.body.identityReview, expected);
        assert.ok(!JSON.stringify(result.body).includes("private diagnostic"));
      }
      assert.equal(comparisons, 3);
      assert.equal(generations, 3);
    },
  );
});

test("explicit identity mode overrides the legacy setting", async () => {
  await withApi(
    {
      avatarIdentityEnabled: true,
      avatarIdentityMode: "off",
      personalize: async () => avatarUrl,
      avatarIdentityScreen: async () => assert.fail("Recognition must be disabled"),
    },
    async ({ url, generate }) => {
      const health = await (await fetch(url + "/api/health")).json();
      assert.equal(health.avatarIdentityMode, "off");
      assert.equal(health.avatarIdentityScreenAvailable, false);
      assert.equal((await generate(false)).status, 200);
    },
  );
});

test("invalid identity screen configuration fails at startup", () => {
  assert.throws(
    () => createApp({ avatarIdentityMode: "unexpected" }),
    /TRYON_AVATAR_IDENTITY_MODE/,
  );
  for (const threshold of ["not-a-number", 0, 2]) {
    assert.throws(() => createApp({ avatarIdentityMax: threshold }), /TRYON_AVATAR_IDENTITY_MAX/);
  }
});
