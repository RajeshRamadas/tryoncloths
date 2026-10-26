import test from "node:test";
import assert from "node:assert/strict";
import { checkGeminiAccess, checkOpenAIAccess, providerRequest, providerErrorDetails } from "../server/provider-errors.js";

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
    error: { code: "invalid_api_key", message: "SECRET_KEY" },
  }), { status: 400 })), error => error.code === "credentials");
  for (const [providerCode, code] of [["content_policy_violation", "blocked"], ["model_not_found", "model"], ["insufficient_quota", "quota"]]) {
    await assert.rejects(providerRequest("https://example.test", {}, async () => new Response(JSON.stringify({
      error: { code: providerCode, message: "SECRET_KEY" },
    }), { status: 400 })), error => error.code === code && !error.message.includes("SECRET_KEY"));
  }
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

test("OpenAI diagnostic requests only model metadata without photos or generation", async () => {
  let calls = 0;
  const result = await checkOpenAIAccess({ apiKey: "test-key-only", fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/models/gpt-image-1.5");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer test-key-only");
    assert.equal(options.body, undefined);
    return new Response(JSON.stringify({ object: "model", id: "gpt-image-1.5" }));
  } });
  assert.equal(calls, 1);
  assert.equal(result.modelAccessible, true);
  assert.doesNotMatch(JSON.stringify(result), /test-key-only/);
  await assert.rejects(checkOpenAIAccess({ apiKey: "" }), error => error.code === "configuration");
  await assert.rejects(checkOpenAIAccess({ apiKey: "test-key-only", model: "bad/model" }), error => error.code === "configuration");
  await assert.rejects(checkOpenAIAccess({ apiKey: "test-key-only", fetchImpl: async () => new Response("not-json") }), error => error.code === "response");
});

test("Gemini metadata check sends no photos and reports sanitized Gemini failures", async () => {
  const result = await checkGeminiAccess({ apiKey: "test-only", fetchImpl: async (url, options) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image");
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.headers["x-goog-api-key"], "test-only");
    return new Response(JSON.stringify({ supportedGenerationMethods: ["generateContent"] }));
  } });
  assert.equal(result.supportsGenerateContent, true);
  assert.doesNotMatch(JSON.stringify(result), /test-only/);
  for (const reason of ["API_KEY_INVALID", "API_KEY_EXPIRED"]) {
    await assert.rejects(checkGeminiAccess({ apiKey: "test-only", fetchImpl: async () => new Response(JSON.stringify({
      error: { details: [{ reason }], message: "PRIVATE PROVIDER MESSAGE" },
    }), { status: 400 }) }), error => {
      const details = providerErrorDetails(error, "gemini");
      assert.equal(details.code, "credentials");
      assert.match(details.message, /Gemini/);
      assert.doesNotMatch(details.message, /OpenAI|PRIVATE|test-only/);
      return true;
    });
  }
});
