import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStudioUrl } from "../src/connection.js";

test("studio address accepts HTTPS origins and removes the trailing slash", () => {
  assert.equal(
    normalizeStudioUrl(" https://studio.example.com/ "),
    "https://studio.example.com",
  );
  assert.equal(
    normalizeStudioUrl("https://studio.example.com:8443"),
    "https://studio.example.com:8443",
  );
});

test("studio address rejects plaintext, embedded credentials, and misleading paths", () => {
  for (const input of [
    "http://studio.example.com",
    "https://user:secret@studio.example.com",
    "https://studio.example.com/api",
    "https://studio.example.com/?key=secret",
    "https://studio.example.com/#secret",
    "javascript:alert(1)",
    "not-a-url",
  ]) {
    assert.throws(() => normalizeStudioUrl(input));
  }
});
