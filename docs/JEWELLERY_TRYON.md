# J6 — internal jewellery adaptation adapter

Web `0.20.0-alpha.6` implements Task J6 from
[the implementation guide](jewellery/IMPLEMENTATION_LLM.md), following
[design sections 6–7](jewellery/DESIGN.md). It prepares a single Gemini image
request and rejects invalid results before returning a PNG data URL.

This is an internal server module. Web `0.20.0-alpha.7` now exposes it through
the [J7 API](JEWELLERY_API.md), enforcing `TRYON_JEWELLERY=1`, account/store
ownership, approved base views, item ownership, same origin, explicit consent,
request IDs, concurrency, credit reservation/refund and review before reusable
storage. The interactive [J8 studio](JEWELLERY_STUDIO.md) is now implemented.

## Module contract

`server/jewellery-tryon.js` exports:

- `JEWELLERY_CONTRACT = 'jewellery-tryon-v1'`.
- `scaleSentence(type, attributes, anchors)` and `jewelleryPrompt(options)`.
- `jewelleryTryOn(options)`, with `createJewelleryTryOn(dependencies)` for local
  test injection. Dependencies are server-selected, never request JSON.
- `requireUnchangedHands(base, output, anchors)` for the local hands check.

The adapter accepts `base` (PNG Buffer), `product` (JPEG, PNG or WebP Buffer),
optional `secondAngle` (same formats), `type`, validated `attributes`, `view`,
placement options, optional `title`, `apiKey`, optional `model`, `signal` and
`fetchImpl`. Products are normalized to JPEG, at most 1600 px per dimension.
Base inputs are limited to 20 MiB, products to 10 MiB, decoded images to 25 MP.
The API key stays server-side. HUID is display-only and is never sent to Gemini.

Placement options:

| Item | Options |
| --- | --- |
| Earrings / anklets | `attributes.pair: true` (default) uses both sides; `false` requires `side: 'left'` or `'right'` |
| Nose pin / ring | Required `side: 'left'` or `'right'` |
| Ring | Required `hand: 'left'` or `'right'`, `finger: 'thumb'`, `'index'`, `'middle'`, `'ring'` or `'little'` |
| Bangles / bracelet | Required `wrist: 'left'`, `'right'` or `'both'`; bangle count is **per selected wrist** |
| Watch | Required `wrist: 'left'` or `'right'` |

Left/right always means the wearer's anatomy. Contradictory or irrelevant
placement options are rejected before a request. Existing jewellery is preserved
by default. `replaceExisting` can name only the selected type's region: `ears`,
`nose`, `forehead`, `neck`, `finger`, `wrist`, `waist` or `ankles`. It replaces
only the selected placement in that region, preserving jewellery elsewhere.
Arbitrary replacement instructions and a blanket boolean `true` are rejected.

## Views, scale and request

View selection follows the shared catalogue rules. Only necklace, pendant and
mangalsutra allow a portrait/full override; all other types use their required
view. A ring on a portrait is rejected before sending images.

| View | Request aspect | Canvas and normalization |
| --- | --- | --- |
| Portrait | 3:4 | Base must be 1152 × 1536; output at the correct aspect is normalized to that size |
| Hands | 1:1 | Base and output must both be 1024 × 1024; validated template anchors/mask are required |
| Full | 2:3 | Legacy portrait-shaped bases are contained on a 1024 × 1536 canvas with neutral margins, preserving proportions and all anatomy |

Portrait/full outputs with a different aspect (tolerance 0.01 for provider pixel
rounding) are rejected, rather than stretched or cropped. Uniform resolution
normalization preserves framing. Non-default orientation metadata is rejected
for view/result PNGs rather than interpreted against unrotated anchors.

Portrait scale uses the actual base image's detected eye centres divided by
the approximate adult interpupillary distance of 63 mm; supplied face metrics
are ignored by the adapter. Hands use the selected template's finger/wrist
widths with illustrative adult reference widths of 18/60 mm. Indian bangle
sizes are interpreted as inches and sixteenths (`2.6` = 2 + 6/16 inches).
These are approximate rendering cues, **never customer measurements or a fit
guarantee**. Missing catalogue dimensions produce no invented numeric sizes.
Necklace length, earring drop, pendant size, ring placement and bangle count use
anatomy-relative instructions from the design.

The single request orders instruction → view PNG → product JPEG → optional
second-angle JPEG. It requests one candidate, with a 180-second deadline that
also covers local checks and caller cancellation. There are no automatic
retries or provider fallbacks. The second angle describes the same piece and
does not request a second item. Product names share clothing's unchanged
`cleanTitle` sanitizer; catalogue text is quoted reference data. Instructions
explicitly ignore embedded text, model faces and other products. The prohibited
accessory names appear only in the single “Never add” sentence.

## Local acceptance checks

| Check | Error |
| --- | --- |
| Unsupported item, attributes, placement, view or input | `jewellery_input`, before any request |
| Portrait has no single face | `missing_face` |
| Portrait face box outside canvas or outside inclusive 30–60% height | `framing_changed` |
| Portrait changes identity against its approved base | `identity_mismatch`, using J2's in-memory descriptor check |
| Full body has no single detectable face | `missing_face`, using the existing full-body helper |
| Wrong output aspect / dimensions | `framing_changed`, or `hands_changed` for hands |
| Hands removed, substantially moved or recoloured | `hands_changed` |

The hands check compares RGB changes at fixed positions within the authored
mask, retaining at least 70% separately in each hand's half. A pixel is retained
when each channel changes by at most 40 and changes in adjacent-channel
differences stay within 22. At least 70% of the background must also remain,
rejecting flat skin-colour canvases and large silhouette changes. Small product
occlusion and JPEG noise are tolerated. This relative reference comparison
uses no fixed skin-colour range and is tested across all twelve template tones.
It is a conservative heuristic, not a hand detector or verified anatomy check;
staff must review results. It must use the trusted mask belonging to the actual
base template, never an arbitrary client mask. Customer hand photos remain P1.

J4 initial portrait generation still uses its original 35–55% framing default;
only J6 editing opts into the design's 30–60% range. Clothing prompt and contract
are unchanged. Provider errors use safe error codes/messages with no provider
bodies, keys, face descriptors or image data. The adapter stores/logs nothing
and clears its owned transient image buffers without modifying caller inputs.

## Verification and remaining work

`tests/jewellery-tryon.test.js` covers five committed prompt snapshots, all 18
types, scale and placement validation, request order/aspects, optional second
angle, output decoding, all twelve hand tones, missing/moved hands, wrong
framing, changed identity, provider failures, cancellation and buffer cleanup.
Real local face models compare independent synthetic customer fixtures;
provider transport is stubbed throughout. No test sends a paid request.

Release validation: **357 backend tests, 117 browser tests and the production
web build passed**. No live paid provider request was sent.

Live Gemini jewellery fidelity, tiny stone/count reproduction, side placement,
chain drape, identity-threshold calibration, hand thresholds and Lightsail
performance remain unverified. J7 refunds failed acceptance checks and
saves only explicitly approved results for reuse. J6 does not claim that the
interactive jewellery try-on workflow is available yet. No APK or production
deployment is part of this change.
