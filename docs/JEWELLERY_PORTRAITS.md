# Portrait-generation adapter — J4

Web `0.20.0-alpha.4` implements the internal portrait adapter required by later
jewellery views. It sends one fresh customer face reference and the approved
full-body avatar to Gemini, requests one portrait, and checks the returned face.
This task adds **no HTTP route, screen or stored view**. J5 supplies account
ownership, consent, metering, approval and view storage. Jewellery generation
remains unavailable in health until the later flow is ready.

## Internal interface

`server/avatar-views.js` exports:

```js
generatePortrait({
  facePhoto, avatar, hairBehindEars: false,
  apiKey, model: 'gemini-2.5-flash-image', fetchImpl, signal
}) // -> data:image/png;base64,…
```

`facePhoto` and `avatar` are buffers. The face may be JPEG, PNG or WebP, at least
128px on each side, at most 5 MiB and 25 megapixels. It is rotated, flattened to
white, converted to sRGB and resized inside 1024px before JPEG encoding. The
existing clear/front-facing single-customer-face check runs before the request.
The approved avatar must be a portrait PNG at least 128 × 256px, at most 10 MiB
and 25 megapixels. It is normalized inside 1024 × 1536 with preserved proportions.
Animated/multipage inputs and invalid settings fail before any provider call.

The adapter validates image content and shape. The caller is responsible for
checking that the supplied avatar belongs to the active store/customer and is
approved; image dimensions cannot establish those facts.

`portraitPrompt({hairBehindEars})` produces the fixed, provider-independent
instructions. `PORTRAIT_CONTRACT` is `avatar-portrait-v1`. The prompt requests:

- The customer's same face, age, expression, complexion, hair, facial hair,
  glasses and makeup, with realistic skin texture and proportions.
- A front-facing head-and-shoulders view, complete head/hair, neck and collarbones,
  a neutral open neckline matching the avatar's top colour, and a light background.
- A clean base with no jewellery, new accessories or makeup changes.
- Hair placement behind the ears **only** when `hairBehindEars === true`, after
  the customer has agreed to that change. The default preserves the hairstyle.

Instructions embedded in either photo are treated as untrusted image content.
There is no product-name or arbitrary prompt field.

## One request and output checks

The request uses `generateContent` with the server's Gemini key. Its image parts
are always ordered **customer face JPEG first, approved avatar PNG second**.
It requests one candidate, image output and a `3:4` aspect ratio. No provider
fallback or automatic retry is made. A combined 180-second deadline and optional
caller cancellation signal apply through the request and subsequent checks.

The supported returned formats are PNG, JPEG and WebP with matching actual image
content, bounded encoded size and at most 25 megapixels. Output is rotated and
normalized to **1152 × 1536 RGB PNG** using `fit: cover`, aligned to the top.
Checks then require:

1. Exactly one detectable face.
2. A complete face box inside the frame, with height from **35% to 55%** of image
   height, including both boundaries. `requirePortraitFraming()` exports this rule.
3. J2's local identity comparison against the transmitted face reference,
   converted to PNG for that helper. `TRYON_IDENTITY_MAX` defaults to 0.45.

Successful output is a PNG data URL for later explicit review. A face box cannot
prove that every hair or shoulder detail is intact. Customer likeness, complexion,
hairstyle and portrait quality still require human review.

The existing face detector now awaits the face-api task's real `run()` promise,
so an inference rejection reaches the safe error handler instead of an unhandled
thenable rejection. Its normal detection model, thresholds and output stay the same;
the clothing prompt and generation contract are unchanged.

## Errors, privacy and charging

`portrait_input` reports an invalid avatar/reference combination or hair option;
invalid face uploads use `face_input`. `missing_face` rejects no-face/multiple-face
outputs; `framing_changed` rejects incorrect framing; `identity_mismatch` rejects
a changed customer face. Model/inference failures become `face_check`. Other
provider errors retain the existing safe Gemini codes, including quota, credentials,
blocking and timeout. Raw SDK exceptions, image bytes and provider response text
are not returned in errors.

The adapter has no database, logging, output cache or filesystem writes. Its
temporary normalized reference buffers are cleared in `finally`; caller-owned
originals remain untouched and must be discarded by the calling request flow.
Request encoding and transport use temporary in-memory strings governed by
ordinary garbage collection. Descriptors remain inside the J2 comparison and
are never included in the response. Google processing/retention follows the
chosen service terms and must be covered by the eventual consent flow.

Calling this adapter against a live provider can incur a charge even if an
output fails checks or a request times out. **J4 does not charge/refund app credits**;
the later J5 route must reserve/refund them under the existing metering rules,
enforce the jewellery flag, provider, store/session permissions, fresh-photo
consent scope `face-for-portrait`, agreed hair changes, request IDs and shared
image concurrency limits. It must return `needsReview: true` and store only an
approved result. Do not expose the adapter directly without those controls.

The default identity threshold still requires calibration on the jewellery
requirements' 50+ pilot portraits before live enforcement. Model installation,
actual generation quota/billing, provider retention and portrait visual fidelity
remain unverified on the deployed service. No live generation was performed by J4.

## Verification

`tests/avatar-views.test.js` uses a stubbed transport to check request order,
aspect ratio, optional hair instructions, input limits, normalization, exact
framing boundaries, cancellation, safe errors and no retries. A real local-model
test uses independently generated synthetic customer fixtures: a prepared matching
portrait passes, another face fails, a faceless upload cannot start a request,
and a detector failure rejects safely then recovers. These are local model checks,
not evidence that Gemini produced a matching portrait.

Release validation for `0.20.0-alpha.4`: **326 backend tests, 112 browser tests
and the production web build passed**. The provider transport was mocked; no
live paid portrait request or production deployment was made.

[J5 view storage, authenticated routes and the web review page](AVATAR_VIEWS.md)
are implemented in `0.20.0-alpha.5`. They enforce consent, ownership, credits and
signed approval before saving a view. J6 jewellery adaptation is next; live
provider quality and pilot threshold calibration are still unverified.
