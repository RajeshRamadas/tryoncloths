import { AVATAR_REVIEW_CRITERIA } from "../../src/avatar-quality-gates.js";

// Synthetic, consent-free test fixtures represent an explicitly reviewed avatar.
// Production requests never call this helper and must use the authenticated route.
export function completeTestReview() {
  return {
    scores: Object.fromEntries(AVATAR_REVIEW_CRITERIA.map((criterion) => [criterion, 4])),
    reviewerConfirmed: true,
    customerConsent: true,
    customerApproved: true,
  };
}

export function approveTestAvatar(store, account, id) {
  return store.approveAvatar(account, id, completeTestReview());
}

export async function saveApprovedTestAvatar(store, account, input) {
  const saved = await store.save(account, input);
  approveTestAvatar(store, account, saved.id);
  return saved;
}
