import test from "node:test";
import assert from "node:assert/strict";
import { AVATAR_REVIEW_CRITERIA } from "../src/avatar-quality-gates.js";
import { AVATAR_REVIEW_POLICY_VERSION, validateAvatarApproval } from "../server/avatar-approval.js";

const completeReview = () => ({
  scores: Object.fromEntries(AVATAR_REVIEW_CRITERIA.map((name) => [name, 4])),
  customerConsent: true,
  reviewerConfirmed: true,
  customerApproved: true,
});

test("server requires explicit six-point quality review and customer approval", () => {
  assert.equal(AVATAR_REVIEW_POLICY_VERSION, 1);
  assert.equal(validateAvatarApproval(completeReview()), true);
  for (const criterion of AVATAR_REVIEW_CRITERIA) {
    const low = completeReview();
    low.scores[criterion] = 3;
    assert.equal(validateAvatarApproval(low), false, criterion);
    delete low.scores[criterion];
    assert.equal(validateAvatarApproval(low), false, criterion);
  }
  for (const field of ["customerConsent", "reviewerConfirmed", "customerApproved"]) {
    const unconfirmed = completeReview();
    unconfirmed[field] = false;
    assert.equal(validateAvatarApproval(unconfirmed), false, field);
  }
});

test("server rejects unknown, malformed and fabricated review fields", () => {
  for (const review of [null, undefined, [], {}, { ...completeReview(), scores: [] }]) {
    assert.equal(validateAvatarApproval(review), false);
  }
  const unknownCriterion = completeReview();
  unknownCriterion.scores.unrecognized = 5;
  assert.equal(validateAvatarApproval(unknownCriterion), false);
  const fabricated = completeReview();
  fabricated.scores.faceLikeness = "5";
  assert.equal(validateAvatarApproval(fabricated), false);
  const fractional = completeReview();
  fractional.scores.skinToneConsistency = 3.5;
  assert.equal(validateAvatarApproval(fractional), false);
});
