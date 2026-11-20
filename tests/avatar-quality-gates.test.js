import test from "node:test";
import assert from "node:assert/strict";
import { assessMasterAvatarReview, AVATAR_REVIEW_CRITERIA } from "../src/avatar-quality-gates.js";

const scores = Object.fromEntries(AVATAR_REVIEW_CRITERIA.map((key) => [key, 4]));

test("accepts a fully reviewed avatar", () => {
  assert.deepEqual(assessMasterAvatarReview({
    scores, customerConsent: true, reviewerConfirmed: true,
  }), { approved: true, reasons: [] });
});

test("rejects missing consent or reviewer confirmation", () => {
  assert.equal(assessMasterAvatarReview({ scores }).approved, false);
});

test("rejects poor face likeness", () => {
  assert.deepEqual(assessMasterAvatarReview({
    scores: { ...scores, faceLikeness: 2 },
    customerConsent: true, reviewerConfirmed: true,
  }).reasons, ["faceLikeness_below_threshold"]);
});

test("rejects missing, fractional, and out-of-range scores", () => {
  for (const value of [undefined, 3.5, 0, 6]) {
    assert.equal(assessMasterAvatarReview({
      scores: { ...scores, neckBlend: value },
      customerConsent: true, reviewerConfirmed: true,
    }).approved, false);
  }
});
