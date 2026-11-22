# Server-enforced approval for reusable account avatars

## Why this is needed

An avatar returned by `POST /api/personalize` is a **draft**, not a reusable approved master. The browser's six-point human review already gated try-on, but a browser-only checkbox could not enforce that rule for direct account APIs.

This feature makes each saved **store-account avatar** carry a persisted **draft** or **approved** state. The server validates the human approval attestation before permitting account-backed reuse.

## Lifecycle

1. Generate a draft or import a PNG. No generation output is automatically saved.
2. Explicitly save to the store account using the existing storage-consent requirement. `POST /api/avatars` saves a **draft** regardless of client-provided fields.
3. Complete all six human scores (each 4 or 5), confirm customer permission, confirm the reviewer compared the images, and obtain separate final customer approval.
4. The authenticated same-origin `POST /api/avatars/:id/approval` validates the complete attestation and marks the **exact account-owned saved avatar** approved. The server returns the approval timestamp and version number. A repeated approval while that version is active returns the same version.
5. Only approved account avatars can be used to create saved looks, run account-backed clothing adaptation, create jewellery previews and generate portrait/hands views. Both preflight and post-image-processing checks reject a newly revoked or replaced avatar before reuse.
6. `DELETE /api/avatars/:id/approval` revokes approval. Resaving an avatar resets it to **draft**, including metadata updates; a fresh review is required. Reopening the avatar in the UI also requires the current human approval workflow.

The account library shows the state. Previously saved avatars migrate to **draft** (reviewable and downloadable by their owner) rather than being automatically grandfathered in. Users can reopen and approve legacy avatars without a new paid image-generation request.

## Server metadata and privacy

An approval records the timestamp, authenticated approving staff user's ID and review policy version. Individual scores are validated in memory. The historical record contains the same saved avatar details and generation provenance available in the account.

This records an **authenticated human review declaration**, not independent proof of likeness, identity, consent validity, anatomical accuracy or garment fit. The UI still requires customer confirmation, and false declarations cannot be eliminated purely by software.

## Generation provenance

For new account-backed generations, the studio returns a signed receipt scoped to
the store, staff user, customer and delivered PNG. The browser submits the receipt
on the explicit avatar save. The server verifies it and records the provider,
configured model, prompt revision, generation time, frame, template tone and
measurements used for that generation.

The record includes the SHA-256 of the delivered PNG and the SHA-256 of the
normalized PNG served by the saved avatar image endpoint. The saved avatar library
shows the model and prompt revision. Re-saving the same image keeps its first
verified generation record, and older avatars and imported PNGs can be reviewed
with no recorded provenance. The receipt travels with the current draft in browser
memory. The saved record contains the verified metadata and hashes.

## Approval version history

In **Saved avatars**, open **Version history** to see previously approved
revisions and identify the active one. Revoking approval or re-saving the avatar
clears the active version. The next successful review adds a new version with
the reviewed frame and measurements, generation provenance when available, and
the SHA-256 of the account PNG that was approved.

Versions share the account PNG. Once an approval version exists, the database
guards its PNG and historical records against updates. Deleting the avatar or
erasing its customer also removes the version history. An already-approved
avatar from before this feature receives its first version at its next review.

Authenticated `GET /api/avatars/:id/versions` returns up to 20 records from the
active store in descending version order. Pass the returned `nextBefore` value
as `?before=` to load earlier records.

## Regenerate a master avatar

In **Saved avatars**, choose **Regenerate as new version** on an approved account
avatar. The studio carries over the customer, body frame, measurements and template
tone. Add fresh photos and complete the usual generation consent, customer review
and storage consent. Saving creates a new numbered master version with its own
image, approval history and saved looks. Open **View master versions** to find the
related images. Earlier approved images remain available with their original looks.

Choose **Compare master versions** to see two saved PNGs side by side with their
body profiles, measurements and approval status. The two latest versions open
first. Use the version selectors when more versions are available, and zoom both
previews together to inspect details. **Open version** returns to the normal
customer review for that specific image. Comparing uses saved account images and
makes no generation request.

Master versions identify different PNGs. Approval revisions track reviews of a
particular saved PNG. The `regenerateFromId` field identifies the approved source
on both `/api/personalize` and `/api/avatars`. The generation receipt binds that
source to the delivered result. The save checks that the source is still approved
and belongs to the same store and customer. Retrying the same save returns the
existing version, and a different generation with identical bytes prompts staff
to use the existing saved version.

## Compatibility and limitations

- Applies to **saved store-account avatars** and the account-backed garment/jewellery/portrait/looks routes. It does not change the offline IndexedDB library, sample-avatar browsing, or raw image operations that have no account avatar identity.
- API integrations that create account avatars must now explicitly complete approval before requesting account-backed reuse. Directly setting `approved` in a JSON request or database input is not sufficient.
- Older account avatars retain their images and can be opened for review. Existing historical looks are not deleted by migration or revocation, but new downstream requests tied to a draft are rejected.
- Store authentication, same-origin request enforcement, existing generation consent and customer storage consent are still required.
- This feature does not create automated facial recognition or a new provider request. The optional identity, geometry and tone checks retain their own existing limitations.

## Tests

The test suite covers missing/low/unknown scores, independent consent and final customer approval, account isolation, draft storage, reopening, explicit promotion, revocation, re-saving, metadata persistence across database reopen and blocked look saves. Synthetic downstream fixtures include an explicit reviewed-attestation helper rather than bypassing the server approval check.

CI must pass Prettier, all unit tests, TypeScript/Vite build and Playwright tests before merge.
