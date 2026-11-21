# Server-enforced approval for reusable account avatars

## Why this is needed

An avatar returned by `POST /api/personalize` is a **draft**, not a reusable approved master. The browser's six-point human review already gated try-on, but a browser-only checkbox could not enforce that rule for direct account APIs.

This feature makes each saved **store-account avatar** carry a persisted **draft** or **approved** state. The server validates the human approval attestation before permitting account-backed reuse.

## Lifecycle

1. Generate a draft or import a PNG. No generation output is automatically saved.
2. Explicitly save to the store account using the existing storage-consent requirement. `POST /api/avatars` saves a **draft** regardless of client-provided fields.
3. Complete all six human scores (each 4 or 5), confirm customer permission, confirm the reviewer compared the images, and obtain separate final customer approval.
4. The authenticated same-origin `POST /api/avatars/:id/approval` validates the complete attestation and marks the **exact account-owned saved avatar** approved. The response includes `approvalStatus` and server-generated `approvedAt`. No supplied approval timestamp or status is trusted.
5. Only approved account avatars can be used to create saved looks, run account-backed clothing adaptation, create jewellery previews and generate portrait/hands views. Both preflight and post-image-processing checks reject a newly revoked or replaced avatar before reuse.
6. `DELETE /api/avatars/:id/approval` revokes approval. Resaving an avatar resets it to **draft**, including metadata updates; a fresh review is required. Reopening the avatar in the UI also requires the current human approval workflow.

The account library shows the state. Previously saved avatars migrate to **draft** (reviewable and downloadable by their owner) rather than being automatically grandfathered in. Users can reopen and approve legacy avatars without a new paid image-generation request.

## Server metadata and privacy

The database stores only an approval timestamp, the authenticated approving staff user's ID and the review policy version. No original source photos, facial embeddings, skin-colour values, or six individual scores are saved as part of the approval record. Validation of the scores is synchronous and the attestation is discarded.

This records an **authenticated human review declaration**, not independent proof of likeness, identity, consent validity, anatomical accuracy or garment fit. The UI still requires customer confirmation, and false declarations cannot be eliminated purely by software.

## Compatibility and limitations

- Applies to **saved store-account avatars** and the account-backed garment/jewellery/portrait/looks routes. It does not change the offline IndexedDB library, sample-avatar browsing, or raw image operations that have no account avatar identity.
- API integrations that create account avatars must now explicitly complete approval before requesting account-backed reuse. Directly setting `approved` in a JSON request or database input is not sufficient.
- Older account avatars retain their images and can be opened for review. Existing historical looks are not deleted by migration or revocation, but new downstream requests tied to a draft are rejected.
- Store authentication, same-origin request enforcement, existing generation consent and customer storage consent are still required.
- This feature does not create automated facial recognition or a new provider request. The optional identity, geometry and tone checks retain their own existing limitations.

## Tests

The test suite covers missing/low/unknown scores, independent consent and final customer approval, account isolation, draft storage, reopening, explicit promotion, revocation, re-saving, metadata persistence across database reopen and blocked look saves. Synthetic downstream fixtures include an explicit reviewed-attestation helper rather than bypassing the server approval check.

CI must pass Prettier, all unit tests, TypeScript/Vite build and Playwright tests before merge.
