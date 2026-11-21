# On-device face and body photo preflight

## Purpose

Blurry or severely underexposed customer photos undermine the reusable master avatar before any generated image can be reviewed. This feature adds an **on-device, no-credit** preflight for both the customer's face photograph and the standing full-body photograph.

It is an engineering heuristic, not a calibrated image-quality classifier, biometric judgment, or guarantee of identity preservation.

## What the studio does

1. After consented upload, the UI independently checks the face and body photos with a small, temporary browser canvas. It displays likely exposure, low-contrast, low-resolution and low-detail problems, and recommends a retake where appropriate.
2. On **Generate customer avatar**, the studio repeats both checks against the exact current photos **before** making the paid provider request. This protects against a race in the UI's asynchronous display of warnings.
3. An **almost entirely black or white image** with negligible tonal range is blocked as unusable. Retake it before attempting generation.
4. Other cases (blur/softness, low contrast, dim light, bright highlights, low original resolution) are *advisory warnings* only. Customer review and consent are still mandatory.
5. If image decoding or canvas inspection fails, the analysis reports **unverified**; it never manufactures a successful check. Existing server face detection and image validation remain authoritative for hard validation.

## Face framing

After a face photo is added, the browser checks whether it detects a single face
and whether that face is small or close to an edge. Follow the retake guidance
when the face is unclear, cropped or accompanied by someone else. If the model
cannot run, the studio asks the operator to check the photo directly. These
hints are advisory because the detector can miss or miscount faces. Confirm that
the photo shows the consenting customer alone with their features visible.

The 230 KB MediaPipe BlazeFace short-range model loads from the studio when a
face photo is added. It uses the same bundled MediaPipe runtime as the body-pose
check. Inference stays on the device and only guidance text is returned to the UI.
The model performs face detection and framing. Review likeness separately on the
generated avatar. The confidence, face-size and edge thresholds need validation
on consented pilot photos.

The studio ships Google’s float16 v1 model with SHA-256
`b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`.
[Source model](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite) ·
[Model card](https://huggingface.co/litert-community/MediaPipe-FaceDetector-BlazeFace-Short-Range) ·
[Apache 2.0 license](../public/models/blaze_face_short_range.LICENSE.txt)

## Method and limits

The canvas is capped at **192 pixels along its longest edge**. A luminance histogram provides broad exposure and tonal-separation hints; a centre-weighted Laplacian-energy heuristic gives a possible softness warning. The thresholds are deliberately conservative, **synthetic-fixture heuristics, not calibrated photo-quality thresholds**.

A smooth complexion or blank background can trigger low-detail warnings. Busy, sharpened or noisy scenes may escape them even when a person's face is blurred. Mixed-light scenes, backlighting, compression and clothing textures may mislead the assessment. The check does not detect sharp eye focus, face identity, real age, photographic ownership or accurate body size. Staff must inspect photo suitability and the existing face/body-pose hints; never rely on this check alone to approve an avatar.

## Privacy, cost and resilience

- Upload hints are computed in the browser. The canvas and raw pixel array are cleared after inspection. The checker returns only issue codes and actionable messages.
- No input photos, pixel histograms or scores are stored by this feature. No extra provider request or AI credit is used.
- The existing explicit generation call, provider consent, tenant boundaries, privacy controls and fail-closed server verification remain unchanged.
- The staff `/api/personalize` endpoint applies the same near-blank rule to the normalized photos it already receives for generation. It returns `400 photo_unusable` with a retake message before reserving credits or calling the provider. The server keeps the downsampled pixels only for the check and lets advisory or unavailable checks pass. Browser and server sampling can differ because the server checks the normalized JPEG.
- No automatic retake, photo alteration, or paid retry is attempted.

## Verification

Synthetic tests cover near-black/white blockers, dim/bright exposure, soft and low-resolution warnings, clear textured photos, malformed input and minimal private output. Readiness tests ensure only severe blockers prevent a paid request. A browser test uploads a black face image, verifies the live retake warning and confirms that clicking Generate produces a local error with **zero** outgoing `/api/personalize` calls. An authenticated API test verifies that dark face and white full-body uploads create neither provider calls nor ledger entries. It also checks that an advisory-only photo can reach the provider. Browser tests exercise the bundled face detector with synthetic portraits, verify that replacing or removing a photo updates the guidance, and simulate model unavailability.

Evaluate the thresholds on consented real customer photos before widening hard rejection. Automated checks do not measure perceptual avatar fidelity.
