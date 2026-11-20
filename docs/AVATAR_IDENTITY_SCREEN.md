# Generated-avatar identity screening (opt-in)

The customer-avatar generator already uses a consented customer face and requires one
detectable face in the output. This addition **optionally** compares the customer's
source face with the generated full-body avatar **before releasing the draft image**.
It is a supplementary risk signal, not a proof of identity or an assessment of skin
tone, body size, neck seams or garment fit.

## Server configuration

The feature is **off by default** to avoid uncalibrated rejections and additional
CPU/memory pressure in the current pilot. Configure server-only variables:

```dotenv
TRYON_AVATAR_IDENTITY_MODE=review
TRYON_AVATAR_IDENTITY_MAX=0.45
```

Available modes:

| Mode | Behavior |
| --- | --- |
| `off` (default) | No recognition inference; the API reports `not_checked` |
| `review` | Run a comparison. `screen_pass` means no mismatch was flagged; `needs_review` flags a possible mismatch or an unavailable/inconclusive check. **The generated draft remains subject to the six-point human review.** |
| `enforce` | Reject potential mismatches, missing/ambiguous faces and model errors before returning an image. This is **not recommended without real-world calibration**. |

The default distance limit is **0.45**, a provisional engineering starting point
shared with the existing face model but controlled separately by
`TRYON_AVATAR_IDENTITY_MAX`. It has **not** been calibrated for generated, small
full-body faces. Valid limits are greater than 0 and at most 1. Invalid modes
or thresholds prevent server startup instead of silently turning checks off.
No automatic retry is made if a check fails. An upstream generation may already
incur a provider charge even if the result is rejected.

The health endpoint reports `avatarIdentityMode` so operations can confirm which
mode is deployed. No threshold, input images, face descriptors, or distances appear
in the response or in persistent account records.

## Implementation

1. The source photograph is already normalized in memory under the explicit
   generation consent.
2. A bundled face detector locates one face in the source photo and the upper
   portion of the newly generated full-body PNG.
3. Both are cropped around their detected face bounds and resized to temporary
   512 × 512 PNGs. This improves the model's ability to process the small avatar
   face; it cannot recover missing image detail.
4. The existing, locally bundled 128-dimensional face-comparison model measures
   distance, using its serialized inference queue. Nothing is uploaded for this
   check and **the vectors, distance, and temporary crops are not saved**.
5. Review-mode results are limited to `screen_pass` or `needs_review`.
   An inconclusive result cannot be labelled a match. Enforce-mode failure
   returns a sanitized provider error and no output image.
6. A reviewer still compares the avatar with consented references and completes
   the mandatory human review before approving or saving the avatar.

The `not_checked` and `screen_pass` results should never be represented as
biometric verification or as guarantees of resemblance. Stored avatars are not
retroactively scored; reopening an avatar still requires human review.

## Release verification and rollout

- Run `npm run format:check`, `npm test`, `npm run build`, and
  `npm run test:e2e`. Unit and route tests use synthetic images and injected
  recognition outcomes; no provider credits are spent.
- In staging, enable `review` with consented/synthetic representative subjects.
  Record false-match and false-rejection rates, varying lighting, complexion,
  hair, eyewear, pose and avatar resolution. The test report must not retain
  source photos or vectors without explicit consent and retention controls.
- Monitor CPU, memory, model load time and concurrency on the actual deployment.
  The extra local comparison is not free of resource cost.
- Only consider `enforce` after reviewing the error trade-offs with users and
  validating the threshold on the same production model and image dimensions.
- Roll back with `TRYON_AVATAR_IDENTITY_MODE=off` and restart the service if
  quality checks are too slow or unreliable. This does not change already
  generated or saved images.

See [the six-point approval policy](AVATAR_QUALITY_REVIEW.md),
[the backend setup](GENERATION_SETUP.md) and
[release evaluation](RELEASE_VALIDATION.md).
