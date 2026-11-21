# On-device face and body photo clarity preflight

## Purpose

Blurry or severely underexposed customer photos undermine the reusable master avatar before any generated image can be reviewed. This feature adds an **on-device, no-credit** preflight for both the customer's face photograph and the standing full-body photograph.

It is an engineering heuristic, not a calibrated image-quality classifier, biometric judgment, or guarantee of identity preservation.

## What the studio does

1. After consented upload, the UI independently checks the face and body photos with a small, temporary browser canvas. It displays likely exposure, low-contrast, low-resolution and low-detail problems, and recommends a retake where appropriate.
2. On **Generate customer avatar**, the studio repeats both checks against the exact current photos **before** making the paid provider request. This protects against a race in the UI's asynchronous display of warnings.
3. An **almost entirely black or white image** with negligible tonal range is blocked as unusable. Retake it before attempting generation.
4. Other cases (blur/softness, low contrast, dim light, bright highlights, low original resolution) are *advisory warnings* only. Customer review and consent are still mandatory.
5. If image decoding or canvas inspection fails, the analysis reports **unverified**; it never manufactures a successful check. Existing server face detection and image validation remain authoritative for hard validation.

## Method and limits

The canvas is capped at **192 pixels along its longest edge**. A luminance histogram provides broad exposure and tonal-separation hints; a centre-weighted Laplacian-energy heuristic gives a possible softness warning. The thresholds are deliberately conservative, **synthetic-fixture heuristics, not calibrated photo-quality thresholds**.

A smooth complexion or blank background can trigger low-detail warnings. Busy, sharpened or noisy scenes may escape them even when a person's face is blurred. Mixed-light scenes, backlighting, compression and clothing textures may mislead the assessment. The check does not detect sharp eye focus, face identity, real age, photographic ownership or accurate body size. Staff must inspect photo suitability and the existing face/body-pose hints; never rely on this check alone to approve an avatar.

## Privacy, cost and resilience

- Photo sampling and comparisons happen **only in the browser**. The canvas and raw pixel array are cleared after inspection; the checker returns only issue codes and actionable messages.
- No input photos, pixel histograms or scores are stored by this feature. No extra provider request or AI credit is used.
- The existing explicit generation call, provider consent, tenant boundaries, privacy controls and fail-closed server verification remain unchanged.
- The new near-blank block applies to the staff studio's *client-side* request flow. Direct APIs retain their separate server validation rules; this is not a server-side fraud barrier.
- No automatic retake, photo alteration, or paid retry is attempted.

## Verification

Synthetic tests cover near-black/white blockers, dim/bright exposure, soft and low-resolution warnings, clear textured photos, malformed input and minimal private output. Readiness tests ensure only severe blockers prevent a paid request. A browser test uploads a black face image, verifies the live retake warning and confirms that clicking Generate produces a local error with **zero** outgoing `/api/personalize` calls. Regular generation fixtures continue to work.

Evaluate the thresholds on consented real customer photos before widening hard rejection. Automated checks do not measure perceptual avatar fidelity.
