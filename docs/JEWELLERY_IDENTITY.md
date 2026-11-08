# Local face similarity check — J2

Web `0.20.0-alpha.2` implements J2 from the
[jewellery guide](jewellery/IMPLEMENTATION_LLM.md). It supplies the internal
quality check needed by later portrait and jewellery generation tasks. There is
no new screen or HTTP endpoint, and existing avatar/clothing generation keeps
its current face-presence checks. `jewelleryAvailable` remains false.

## Internal interface

`server/identity-check.js` exports:

- `descriptor(pngBuffer)`: accepts a PNG buffer, detects exactly one face and
  returns a temporary `Float32Array(128)`. The internal caller must clear the
  returned array with `fill(0)` after use and must never persist, log or expose it.
- `requireSameIdentity(reference, candidate, max)`: compares two PNG buffers
  using Euclidean descriptor distance. Values above the threshold throw
  `ProviderError('identity_mismatch')`. Successful calls return only the distance
  rounded to two decimals. Acceptance uses the unrounded distance, including
  equality at the threshold.

The default threshold is `Number(process.env.TRYON_IDENTITY_MAX || 0.45)`, read
for each check. An explicit third argument overrides it. Thresholds must be
finite numbers greater than zero and no greater than one; invalid configuration
fails with `face_check` before processing either image.

The optional server setting is:

```ini
TRYON_IDENTITY_MAX=0.45
```

The account-storage Compose override passes this setting. It does not turn on
jewellery generation or change existing paid requests. J4/J6 will call this
helper within the consented generation and metering flow; their rejection and
refund integration remains pending.

## Models, memory and failure behaviour

The helper reuses the existing local TinyFaceDetector, TensorFlow WASM backend
and inference queue. Full 68-point landmarks and face recognition weights load
lazily from the pinned face-api package's `model/` folder. Already loaded nets
are retained across checks. A later request can retry a failed local model load
without reloading nets that succeeded. There are no model downloads, provider
calls, paid credits or automatic image-generation retries.

Inputs are bounded to 20 MiB and 25 million pixels, decoded to sRGB and resized
inside 600 × 600. Exactly one detected face is required before recognition.
The face is aligned with the same Dlib alignment used by face-api's descriptor
pipeline. Detection, landmark and recognition calls are awaited directly so
errors propagate and cropped image tensors are disposed at every stage.

Descriptors exist only for an individual comparison. The wrapper clears both
descriptor arrays on success, mismatch and downstream failure; inference clears
its raw descriptor, pixel buffer and tensors. The supplied caller-owned PNGs
remain unchanged. The module caches model weights only. No database changes,
face labels, descriptor logs or public descriptor responses are added.

No face, multiple faces, malformed images and unsupported image formats produce
`missing_face`. Model or inference failures are sanitized as `face_check`.
Mismatches use the provider-independent message:
“The result changed the customer's face and was rejected.” No underlying model
path, image content, score or descriptor is attached to that error.

## Validation and remaining calibration

`tests/identity-check.test.js` checks the full vector, threshold boundaries,
rounding, environment overrides, invalid configuration, descriptor cleanup,
sanitized errors, no retry and source guards against logging/persistence/network
calls or exposing descriptors in routes.

The real-model integration test uses existing synthetic fixtures: a resized
standard avatar passes; male vs female templates and a distinct independently
generated customer face fail at 0.45. Blank images and a two-face composite are
rejected. It exercises concurrent presence/comparison checks, model-load recovery
and failures at all three inference stages, then confirms per-image tensor counts
return to baseline. These tests run locally with the installed package assets.

This small fixture set establishes implementation behaviour only. The jewellery
requirements call for calibration on **50+ pilot portraits before enforcing
rejections**, including review of false accepts and rejects across customer
appearances and image conditions. That evidence remains pending. Runtime memory
and latency on the Lightsail instance have not been measured by this task.
The helper is intended for checking edits of the same consented customer.

[J3 hands templates and anchors](JEWELLERY_HANDS.md) are implemented in
`0.20.0-alpha.3`. [J4's portrait adapter](JEWELLERY_PORTRAITS.md) uses the local
comparison in `0.20.0-alpha.4`; J5 view routes and approval are next. Jewellery try-on remains
pending. No production deployment or APK build is part of J2.
