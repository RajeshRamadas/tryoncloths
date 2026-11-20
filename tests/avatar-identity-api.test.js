import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { ProviderError } from "../server/provider-errors.js";

const photo = await sharp({
  create: { width: 400, height: 600, channels: 3, background: "#cccccc" },
})
  .jpeg()
  .toBuffer();
const output = await sharp({
  create: { width: 600, height: 900, channels: 3, background: "#eeeeee" },
})
  .png()
  .toBuffer();
const result = `data:image/png;base64,${output.toString("base64")}`;

async function generate(options) {
  const app = createApp({
    provider: "gemini",
    apiKey: "test-only-key",
    model: "gemini-2.5-flash-image",
    accessMode: "public",
    rateLimit: false,
    ...options,
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${url}/api/personalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: url },
      body: JSON.stringify({
        requestId: randomUUID(),
        profileId: "regular",
        face: `data:image/jpeg;base64,${photo.toString("base64")}`,
        body: `data:image/jpeg;base64,${photo.toString("base64")}`,
        measurements: { heightCm: 175, weightKg: 75 },
        consent: true,
        consentScope: "face-and-body",
        consentProvider: "gemini",
      }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("identity review results accompany generated drafts without exposing similarity scores", async () => {
  const calls = [];
  const response = await generate({
    avatarIdentityMode: "review",
    personalize: async () => result,
    avatarIdentityScreen: async ({ reference, output, mode }) => {
      assert.ok(Buffer.isBuffer(reference));
      assert.equal(output, result);
      calls.push(mode);
      return { status: "needs_review", reason: "possible_mismatch" };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.kind, "customer-avatar");
  assert.equal(response.body.needsReview, true);
  assert.deepEqual(response.body.identityReview, {
    status: "needs_review",
    reason: "possible_mismatch",
  });
  assert.deepEqual(calls, ["review"]);
});

test("strict identity mismatch rejects generation before releasing the customer image", async () => {
  const response = await generate({
    avatarIdentityMode: "enforce",
    personalize: async () => result,
    avatarIdentityScreen: async () => {
      throw new ProviderError("identity_mismatch");
    },
  });
  assert.equal(response.status, 502);
  assert.equal(response.body.code, "identity_mismatch");
  assert.equal(Object.hasOwn(response.body, "image"), false);
});

test("invalid identity-screen configuration fails at startup before a provider call", () => {
  assert.throws(
    () =>
      createApp({
        provider: "gemini",
        apiKey: "test-only-key",
        accessMode: "public",
        avatarIdentityMode: "unexpected",
      }),
    /TRYON_AVATAR_IDENTITY_MODE/,
  );
});

test("invalid avatar distance setting fails at startup before generation", () => {
  assert.throws(
    () =>
      createApp({
        provider: "gemini",
        apiKey: "test-only-key",
        accessMode: "public",
        avatarIdentityMax: "not-a-number",
      }),
    /TRYON_AVATAR_IDENTITY_MAX/,
  );
});
