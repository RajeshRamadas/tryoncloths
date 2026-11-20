// Pure, conservative review gate for a reusable master avatar.
// This is a human-reviewed quality policy, not automated identity verification.
export const AVATAR_REVIEW_CRITERIA = Object.freeze([
  "faceLikeness",
  "skinToneConsistency",
  "bodyProportions",
  "neckBlend",
  "handsAndFeet",
  "fullBodyFraming",
]);

/**
 * Scores are explicit reviewer judgements on a 1–5 scale. A master avatar may
 * be approved only when every criterion is at least 4 and the reviewer confirms
 * the customer owns/consented to use of the input photos. Unknowns fail closed.
 */
export function assessMasterAvatarReview(review = {}) {
  const { scores, customerConsent, reviewerConfirmed } = review;
  const reasons = [];
  if (customerConsent !== true) {
    reasons.push("customer_consent_required");
  }
  if (reviewerConfirmed !== true) {
    reasons.push("reviewer_confirmation_required");
  }
  for (const criterion of AVATAR_REVIEW_CRITERIA) {
    const score = scores?.[criterion];
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      reasons.push(`${criterion}_not_scored`);
    } else if (score < 4) {
      reasons.push(`${criterion}_below_threshold`);
    }
  }
  return { approved: reasons.length === 0, reasons };
}
