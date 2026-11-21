# Personalized avatar quality review

This adds a **human-reviewed approval gate** for the reusable full-body customer avatar. It builds on the conservative quality policy in `src/avatar-quality-gates.js`, not on a claimed automated identity-verification model.

## Review workflow

1. Upload consented face and full-body photographs, choose a body profile and generate an avatar.
2. On the review step, use the [side-by-side reference comparison](AVATAR_REFERENCE_COMPARISON.md) to inspect the original face and full-body photos alongside the generated result, including a magnified face view. Reopened and imported images show when original photos are unavailable; compare with the customer or separately consented references.
3. Score six criteria from 1 to 5: face/hair likeness, whole-body skin-tone consistency, body proportions, neck/collar blend, hands/feet anatomy and full-body framing.
4. Each score must be **4 or 5**. A missing score, low score, lack of customer permission or lack of reviewer confirmation blocks the **Confirm quality review** button. Do not guess when a criterion cannot be checked.
5. After confirming the quality review, the separate customer-approval checkbox becomes available. Only then can the user download, explicitly save locally, try clothes or proceed to jewellery from this screen.

Changes to any quality score or confirmation revoke the review pass and clear customer approval and pending local save consent. Changing photos, body measurements, templates, generating another avatar, reopening a saved one or starting a new session resets the review.

**Sample avatars without customer photos** retain the previous simple sample-approval workflow. A session awaiting photo-based generation cannot approve or export a sample in place of a personalized avatar.

An optional [local identity screen](AVATAR_IDENTITY_SCREEN.md) can flag a possible
face mismatch or an inconclusive comparison for the reviewer. A passing screen
is not proof of likeness and never replaces the six scores or customer approval.

## Limitations and privacy

- These are human scores, not calibrated similarity, anatomical or garment-fit measurements. No score may be interpreted as a guarantee of fidelity.
- The scores and review confirmation are session-only. Reopening a saved personalized avatar requires another review, because the original photos may not be available and the image could be shown to a different customer.
- The review UI does **not** change provider data retention, add biometric storage or transmit input photos. The review checklist itself is not saved.
- Store-account avatars additionally have a [server-enforced draft/approved lifecycle](AVATAR_SERVER_APPROVAL.md). The server validates the human review attestation before account-backed reuse; legacy saved avatars require re-review. The local-only IndexedDB library continues to use its existing in-browser gate.
- Live identity and visual quality validation still needs consented, representative images and manual review. CI tests validate workflow rules, not perceptual accuracy.

## Verification

Unit tests cover each threshold, missing consent, customer-review confirmation, sample behavior, pending generation and the personalized review gate. CI must also pass formatting, build and browser tests. These checks do not make paid provider calls.
