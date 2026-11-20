import test from "node:test";
import assert from "node:assert/strict";
import { assessMasterAvatarReview, AVATAR_REVIEW_CRITERIA, canApproveAvatar } from "../src/avatar-quality-gates.js";

const scores = Object.fromEntries(AVATAR_REVIEW_CRITERIA.map((key) => [key, 4]));

test("accepts a fully reviewed avatar", () => {
  assert.deepEqual(
    assessMasterAvatarReview({
      scores,
      customerConsent: true,
      reviewerConfirmed: true,
    }),
    { approved: true, reasons: [] },
  );
});

test("rejects missing consent or reviewer confirmation", () => {
  assert.equal(assessMasterAvatarReview({ scores }).approved, false);
});

test("rejects poor face likeness", () => {
  assert.deepEqual(
    assessMasterAvatarReview({
      scores: { ...scores, faceLikeness: 2 },
      customerConsent: true,
      reviewerConfirmed: true,
    }).reasons,
    ["faceLikeness_below_threshold"],
  );
});

test("rejects missing, fractional, and out-of-range scores", () => {
  for (const value of [undefined, 3.5, 0, 6]) {
    assert.equal(
      assessMasterAvatarReview({
        scores: { ...scores, neckBlend: value },
        customerConsent: true,
        reviewerConfirmed: true,
      }).approved,
      false,
    );
  }
});

test("sample avatars keep their existing approval flow only without pending generation", () => {
  assert.equal(
    canApproveAvatar({
      hasPersonalizedResult: false,
      needsCustomerGeneration: false,
      qualityReviewPassed: false,
    }),
    true,
  );
  assert.equal(
    canApproveAvatar({
      hasPersonalizedResult: false,
      needsCustomerGeneration: true,
      qualityReviewPassed: true,
    }),
    false,
  );
});

test("personalized avatar approval fails closed until quality review passes", () => {
  const input = {
    hasPersonalizedResult: true,
    needsCustomerGeneration: false,
    qualityReviewPassed: false,
  };
  assert.equal(canApproveAvatar(input), false);
  assert.equal(canApproveAvatar({ ...input, qualityReviewPassed: true }), true);
  assert.equal(
    canApproveAvatar({ ...input, needsCustomerGeneration: true, qualityReviewPassed: true }),
    false,
  );
  assert.equal(canApproveAvatar(), false);
});

test("every criterion must be scored at least four before confirmation", () => {
  for (const criterion of AVATAR_REVIEW_CRITERIA) {
    const evaluation = assessMasterAvatarReview({
      scores: { ...scores, [criterion]: 3 },
      customerConsent: true,
      reviewerConfirmed: true,
    });
    assert.deepEqual(evaluation.reasons, [`${criterion}_below_threshold`]);
  }
});
