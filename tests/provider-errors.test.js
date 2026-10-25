import test from "node:test";
import assert from "node:assert/strict";
import { checkGeminiAccess, providerRequest, providerErrorDetails } from "../server/provider-errors.js";

test("provider HTTP failures have distinct safe categories and never retry", async () => {
  for (const [status, code] of [[400, "request"], [401, "credentials"], [403, "credentials"], [404, "model"], [429, "quota"], [500, "unavailable"], [503, "unavailable"], [504, "timeout"]]) {
    let calls = 0;
    await assert.rejects(providerRequest("https://example.test", {}, async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "SECRET_KEY customer photo data" } }), { status });
    }), error => {
      const details = providerErrorDetails(error);
      assert.equal(details.code, code);
      assert.equal(details.providerStatus, status);
      assert.doesNotMatch(JSON.stringify(details), /SECRET_KEY|customer photo data/);
      return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(providerRequest("https://example.test", {}, async () => new Response(JSON.stringify({
    error: { details: [{ reason: "API_KEY_INVALID" }], message: "SECRET_KEY" },
  }), { status: 400 })), error => error.code === "credentials");
});

test("network and deadline errors remain distinct without leaking exception text", async () => {
  for (const [name, code] of [["TimeoutError", "timeout"], ["AbortError", "timeout"], ["TypeError", "network"]]) {
    await assert.rejects(providerRequest("https://example.test", {}, async () => {
      throw Object.assign(new Error("SECRET_KEY"), { name });
    }), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /SECRET_KEY/);
      return true;
    });
  }
  assert.equal(providerErrorDetails(new Error("SECRET_KEY")).code, "unknown");
  assert.doesNotMatch(JSON.stringify(providerErrorDetails(new Error("SECRET_KEY"))), /SECRET_KEY/);
});

test("Gemini diagnostic requests only model metadata without photos or generation", async () => {
  let calls = 0;
  const result = await checkGeminiAccess({ apiKey: "test-key-only", fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image");
    assert.equal(options.method, "GET");
    assert.equal(options.headers["x-goog-api-key"], "test-key-only");
    assert.equal(options.body, undefined);
    return new Response(JSON.stringify({ supportedGenerationMethods: ["generateContent"] }));
  } });
  assert.equal(calls, 1);
  assert.equal(result.supportsGenerateContent, true);
  assert.doesNotMatch(JSON.stringify(result), /test-key-only/);
  await assert.rejects(checkGeminiAccess({ apiKey: "" }), error => error.code === "configuration");
  await assert.rejects(checkGeminiAccess({ apiKey: "test-key-only", model: "bad/model" }), error => error.code === "configuration");
  await assert.rejects(checkGeminiAccess({ apiKey: "test-key-only", fetchImpl: async () => new Response("not-json") }), error => error.code === "response");
});
