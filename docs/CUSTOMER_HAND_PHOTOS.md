# J14 — Customer hand photos (JA-4, P1)

Web `0.21.0-rc.3` adds customer-photo hands alongside the existing free standard
hands. Generate one cleanup with Gemini, review/save it with the customer's
avatar, and reuse that hands view for rings, bangles, bracelets and watches.
The feature follows [design §4.2](jewellery/DESIGN.md) and stays behind the
existing server pilot flag `TRYON_JEWELLERY=1`.

## Staff workflow

1. Sign in, select a saved avatar, then open **Avatar views → Hands view** (or
   prepare hands inside the Jewellery studio).
2. Choose **Customer hand photo — 1 AI credit**. Standard hands remain the free
   default and work without a provider key or available AI credits.
3. Use **Choose customer hand photo** for files or **Take customer hand photo**
   for a camera. Use a colour JPEG/PNG/WebP under 5 MiB, with both hands in one
   photo, palms down, fingers pointing up and slightly apart, and both wrists
   fully visible. Put anatomical left in the image's left half and right in its
   right half. Use even lighting and a plain light neutral surface. Remove
   jewellery only with customer agreement; crop out other people/documents.
4. The browser contains the whole photo on a 1024 × 1024 square without stretching
   or cropping. Place all twelve markers: ten finger-band centres plus two
   wrists. Click the image for the selected marker or enter X/Y coordinates.
   Markers are numbered 1–12, with the selected point highlighted.
   Set each visible band width and angle to fit the photographed finger/wrist.
   Markers begin empty; template coordinates are never filled into a customer
   photo. Complete bands must stay inside their hand's half, markers must be
   distinct, and wrists must sit below the fingers.
5. Confirm that these are the customer's own two hands, all fingers/wrists and
   markers are correct, and the complexion matches the approved avatar. The
   tone dropdown is a reference label; it does not recolour the customer's photo.
6. Confirm consent to send the hand photo to **Google Gemini** for a single
   cleanup using **1 AI credit**, then choose **Generate customer hands**.
   Nothing is sent when selecting/marking a photo. The saved full-body avatar
   and face photo are not sent by this operation. Adjust markers before paying;
   changing geometry afterward requires a new explicitly consented cleanup.
7. Review the output with its placement markers. Check both hands, every finger,
   wrists, proportions, complexion and skin texture. Approve separate account
   storage consent and save. A generated preview is not automatically stored.
8. Reopen the approved view for future fittings without another cleanup charge.
   Jewellery AI fitting still uses one credit per new item; approved exact reuse
   and overlays remain free. A saved look keeps its own placement geometry even
   if the avatar's current hands view is later replaced.

The existing Gemini image key/model and account storage are used. No new secret
or service is required. `customerHandsGenerationAvailable` and
`customerHandsContract: customer-hands-v1` advertise the capability in health.
The existing female-generation pilot gate also applies. There is no APK or
Lightsail deployment in this source change.

## Checks and limits

The local checks are **colour/skin-area and pixel-retention heuristics**, not a
learned anatomy detector, identity proof, age check or physical size measurement.
They cannot certify ten correct fingers or guarantee design/skin fidelity.
Staff review is required. Extreme lighting, low saturation, skin-coloured
backgrounds, very small hands and obstructions can fail the heuristic. Use a
clearer colour photo/light background or the free standard hands rather than
repeatedly paying for unsuitable inputs. Live photo/provider quality across
customers remains unverified and part of the pilot.

The source is bounded to 5 MiB/25 MP and still PNG/JPEG/WebP with dimensions at
least 256 px. It is EXIF-oriented and contained on the square, flattened and
converted to sRGB PNG with metadata stripped. Geometry uses image pixels:
finger widths 30–90, wrist widths 120–300, angles −180° to 180°. These rendering
widths are not millimetres or a ring/bangle fit guarantee.

Before metering, each half needs a bounded plausible skin-area fraction, skin
coverage in the derived hand region, and skin around all authored bands.
The region is derived from these markers, never from another customer's or a
standard avatar's hand shape. Flat skin-colour canvases, blank halves and grossly
misplaced markers are rejected. Heuristics can still mistake other coloured
objects for skin; the customer/staff own-hands confirmation is independent.

One bounded 180-second Gemini request asks to preserve the exact hands, skin,
proportions and positions while tidying lighting/background. No photo coordinates,
customer IDs or face descriptors enter the provider prompt. The response must be
a correctly oriented square image (minimum 512 px) at the expected MIME type,
then is normalized to 1024 × 1024 without aspect repair. At least 70% of source
skin pixels in each hand region must retain compatible skin colour/position.
Background change is allowed. Cleanup also checks skin at the band markers;
subsequent jewellery edits allow bands to be occluded by the requested product
while retaining the per-hand colour/position check. These thresholds are pilot
heuristics, not calibrated performance claims.

Invalid source/geometry returns `hands_input` (400) before an image request.
Changed or missing hands after generation returns `hands_changed`; malformed
output/provider failures use the existing sanitized codes. Failed post-request
checks refund the app credit exactly once; provider billing may still apply.
There are no automatic retries or provider fallbacks. Explicit retries need new
consent and a new request ID. Cleanup shares the existing avatar/view attempt
limits (20/hour, 15-second gap), view lease and global image slots. Zero balance,
revoked sessions, deleted/replaced views and suspended accounts stop delivery.

## Storage, consent and geometry

Only the explicitly approved cleanup PNG and its twelve placement markers are
stored in `avatar_views` (`sourceKind: photo`, additive `handPointsJson`). A signed
receipt binds the exact pixels, markers, actor, store, avatar, view revision and
expiry. Approval rejects modified/stale receipts or geometry; idempotent approval
also verifies the same geometry. A new view invalidates old adaptation receipts
and caches as before. Photo-specific anchors are available only through the
authenticated `GET /api/avatars/:id/views/hands/anchors` route.

Approved hands looks and paid reusable results additionally retain a compact
`handsGeometryJson` packet: either their own photo markers or the original
standard template's body/tone. This keeps old images aligned when reopening or
stacking after view replacement. Geometry is signed into result receipts; request
JSON cannot supply it as a trusted base. Missing/malformed photo geometry fails
closed rather than being replaced with template coordinates. Existing template looks remain reopenable. Older hands looks/adaptations
without a geometry packet are not silently assigned today’s markers for a new
fit: reopen/download them, or start from the approved hands view (standard hands
remain free). These are customer placement data and follow the saved
view/look storage consent and existing access/retention/erasure policy.

Raw uploads and unapproved outputs are not written to disk, account storage,
analytics or logs. Processing buffers are cleared after use; browser photo data
stays in memory and is cleared after success, source/avatar changes, cancellation
or session expiry. This is not a guarantee of immediate zeroization of every
JavaScript/browser copy. No face/hand identity descriptor is created or stored.
Approved view/pose/look/result rows cascade with avatar/account deletion. Public
share pages show only approved labelled results, not markers or source uploads.

Client request example (POST `/api/avatars/:id/views`): `kind: hands`,
`source: photo`, `handPhoto` (data URL), `handPoints` (exactly `left/right` ×
`thumb/index/middle/ring/little/wrist` keys with numeric `x,y,angle,widthPx`),
`tone`, `handsConfirmed: true`, `avatarReviewed: true`, `consent: true`,
`consentScope: hands-for-cleanup`, `consentProvider: gemini`, and a UUID-v4
`requestId`. Storage continues through the existing `/hands/approve` endpoint
with `image`, `receipt`, `reviewed` and `storageConsent` only.

## Verification

On 2026-11-09, `npm test` passed **450 backend tests**, the full browser suite
passed **141 tests**, and production build passed. The ten focused customer-hand
and existing avatar-view browser tests passed again after the final marker-label
improvement. The existing main-bundle size advisory remains (about 515 kB).

Production staging using the Dockerfile source selection passed health, built
web loading, one mocked cleanup, approval and authenticated photo anchors. This
verified the new shared module is packaged; no real Docker image, APK, external
message, Lightsail deployment or live provider request was made.

Tests cover consent/roles/tenants/flags, fresh request IDs, shared rate/slot/view
limits, buffers and source cleanup, six schematic tones and twelve authored
reference assets, blank/single/flat/changed hands, provider failure/refunds,
receipt pixels and geometry, same-image stale markers, custom ring/overlay
placement, cache reuse, saved geometry after root-view replacement, missing
geometry rejection, cascaded deletion, mobile file input/markers, cancellation,
session expiry and free-template regression. Provider responses are mocked;
these checks do not verify live Gemini output or real customer-photo quality.

[Workflow screenshots with their fixture limitations](testing/customer-hands/README.md).
