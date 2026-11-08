# J7 — jewellery try-on API and approved reuse

Web `0.20.0-alpha.7` implements J7 from the
[jewellery implementation guide](jewellery/IMPLEMENTATION_LLM.md). It connects
the [J6 adapter](JEWELLERY_TRYON.md) to store authentication, consent, metering,
review and reusable adaptations. **The interactive [J8 jewellery studio](JEWELLERY_STUDIO.md) is now implemented.** The existing catalogue and avatar-view screens remain.

## Configuration and boundaries

Use the existing persistent account database and set `TRYON_JEWELLERY=1`.
New generation requires `TRYON_PROVIDER=gemini`, a server-side
`TRYON_GEMINI_API_KEY` and a supported image model. The operator's existing
female-body pilot flag is also respected for new paid female try-ons.
No deployment, flag change, APK or live provider request is made by this release.

`GET /api/health` exposes:

- `jewelleryAvailable`: flag + account storage + Gemini + configured image key.
- `jewelleryContract: 'jewellery-tryon-v1'` and the eighteen `jewelleryTypes`.
- Existing catalogue/view availability fields, unchanged in meaning.

These report server configuration, not verified provider quota or visual quality.
`GET /api/jewellery/types` reports the same generation availability to signed-in
catalogue users. All new actions require a current owner, manager or staff
session and an exact same-origin website request. Other stores' avatars, items,
views and receipts cannot be used. Store/user identifiers are never accepted
from action bodies. Suspended organisations cannot use these actions.

## Generate or reuse

`POST /api/jewellery/tryon` accepts JSON such as:

```json
{
  "avatarId": "saved-avatar-id",
  "itemId": "saved-jewellery-item-id",
  "view": "hands",
  "hand": "right",
  "finger": "ring",
  "consent": true,
  "consentScope": "view-and-item",
  "consentProvider": "gemini",
  "requestId": "a fresh UUID v4"
}
```

`avatarId` must belong to the active store. `itemId` selects an available,
type-confirmed jewellery catalogue item in that store (including visible shared
master items). Its type, attributes, title and product image come from the
server, and cannot be overridden in the same request. Alternatively, omit
`itemId` and supply `image` (product data URL), `type`, `attributes` and optional
`title`. An optional `secondAngle` product data URL is sent after the main photo.
Uploaded products use the existing bounded JPEG/PNG/WebP normalization.

View and placement follow J6. `view` can be omitted for automatic selection;
only necklace, pendant and mangalsutra allow portrait/full overrides.
`side`, `hand`, `finger`, `wrist` and `replaceExisting` use the
[adapter's validated options](JEWELLERY_TRYON.md). A ring on a portrait fails
with HTTP 400 before a credit reservation or provider call. Optional
`sessionId` must be a store-scoped UUID fitting session for this avatar.

The default base is loaded from the server: an approved portrait/hands view or
the saved full-body avatar. Legacy full avatars are contained on a 1024 × 1536
canvas without stretching or cropping anatomy. Hands use the trusted anchors
for that approved template's body library and selected tone. Client-provided
anchors or physical face metrics are not accepted.

For a stacked look, `base` can contain the current PNG. It must match the saved
view or be verified with one of:

- `baseReceipt` from a prior J7 response, plus `baseReviewed: true`. The original
  output, same store/user, avatar, view and current view revision must match.
- `baseResultId` for an already approved jewellery result in this store, for
  this avatar and view, with the exact matching output pixels.

Arbitrary PNGs, cross-user preview receipts and altered or expired proofs are
rejected before generation. Undo needs no AI: retain earlier images and their
proofs. A prior uploaded-item preview can be reviewed and used as the next base
without persisting the uploaded product. Customer hand photos remain P1.

On an approved reuse hit, the response has `reused: true`, `creditsUsed: 0` and
no provider call. Otherwise one candidate is requested once, costing one AI
credit after acceptance. There are no automatic retries or provider fallbacks.

Responses include `image` (PNG data URL), `kind: 'jewellery-tryon'`, `view`,
`type`, `provider`, `reused`, `resultId`, `itemId`, `needsReview`, `creditsUsed`
and `reuseAvailable`. New generation includes a signed `receipt` unless receipt
creation failed. In that case `receiptUnavailable: true` preserves the paid
image with a message to keep/download it, rather than regenerate it.

## Approve for automatic reuse

`POST /api/jewellery/results/:resultId/approve`:

```json
{
  "image": "the original PNG data URL from the response",
  "receipt": "the signed response receipt",
  "reviewed": true,
  "storageConsent": true
}
```

Both confirmations are required. Receipts bind the actual delivered image
(including any trial watermark), initiating user/store, avatar, view revision,
catalogue item and exact generation context. They expire after 24 hours, survive
server restart through the existing private database signing key, and cannot be
used as avatar-view or clothing receipts. No pending output or product input is
stored merely by generating a preview.

Only catalogue-backed adaptations can be approved for automatic reuse. Upload
previews can be downloaded and used as reviewed stacking bases. Repeating
approval of the same saved output is idempotent; a different preview for an
already saved context is rejected rather than silently claiming it was saved.
Clothing and jewellery share the existing limit of 200 saved adaptations.

## Reuse, invalidation and refunds

The reuse key covers the contract, provider/model, avatar/view epoch, canonical
starting image, item image and metadata, optional second angle, type, dimensions,
placement, replacement region and title. Harmless opaque alpha/PNG encoding
differences in the starting view are normalized. Different fingers, views,
products, starting looks or models cannot accidentally reuse a prior result.

Approved hits remain free at zero credits and when the image key is temporarily
removed, provided the configured provider/model context still matches. A fresh
request ID and the precise action consent are still required. Only saved,
reviewed outputs qualify; an unsaved preview is not an automatic reuse hit.

The additive, idempotent migration adds `garment_results.view` with default
`full`, preserving old clothing rows and image bytes. Existing clothing inserts
and regression fixtures now name their original columns explicitly. No clothing
prompt, contract or behavior is changed.

Deleting/replacing a view removes its derived reusable results. Visual avatar
changes invalidate jewellery results and receipts, including full-body results.
Avatar/item deletion cascades results; item edits and current stock/type checks
prevent stale reuse. Nonvisual customer-name/measurement edits preserve views.

Cross-worker adaptation leases prevent duplicate simultaneous calls. New paid
work also uses the existing two shared image slots. HTTP disconnects, revoked
sessions, suspension, view/avatar deletion or item changes abort work and
discard late results. Guards run after asynchronous steps and before credit
commit or saving. Twenty attempts per hour and a 15-second spacing apply per
user/store to durable try-on holds; refunded attempts still count. Reuse uses no
hold and does not consume this paid-attempt limit.

Failed local checks (`identity_mismatch`, `missing_face`, `framing_changed`,
`hands_changed`), provider errors, invalid output or cancellation refund the
application credit exactly once. They cannot undo a provider's possible charge.
Previously metered request IDs are rejected. Error responses never expose provider
bodies, keys, face descriptors or image data. Generic fitting analytics record
generated/reused jewellery events; jewellery-specific reporting remains later work.

## Validation and remaining work

Route tests cover role/tenant/origin boundaries, exact consent, wrong views,
refunds, review, expiry, restart, context changes, cross-worker locking, shared
slots, cancellation, trial watermarking and no paid retry. A mobile browser test
uses the existing saved-hands UI and calls the real J7 API with a stubbed image
adapter, then approves and reuses its result after reload. Provider calls in all
tests are injected; no real AI service is called.

Release validation: **374 backend tests, 118 browser tests and the production
web build passed**. No live paid provider request was sent.

[J8](JEWELLERY_STUDIO.md) now adds the staff-facing picker, stacking/review,
download and sharing flow. Live provider placement/fidelity, identity/hand threshold calibration,
quota/cost, retention, Lightsail load and pilot-store validation remain separate.
