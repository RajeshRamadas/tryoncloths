import {
  assessMasterAvatarReview,
  AVATAR_REVIEW_CRITERIA,
} from "../src/avatar-quality-gates.js";

export const AVATAR_REVIEW_POLICY_VERSION = 1;

/**
 * Staff and customer approval is checked on the authenticated studio server.
 * This is an attestation of the human review, not a biometric identity proof.
 * Never persist photo input, scores, or facial embeddings as approval metadata.
 */
export function validateAvatarApproval(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    input.customerApproved !== true ||
    !input.scores ||
    typeof input.scores !== "object" ||
    Array.isArray(input.scores) ||
    Object.keys(input.scores).length !== AVATAR_REVIEW_CRITERIA.length ||
    Object.keys(input.scores).some((key) => !AVATAR_REVIEW_CRITERIA.includes(key))
  )
    return false;
  return assessMasterAvatarReview(input).approved;
}
