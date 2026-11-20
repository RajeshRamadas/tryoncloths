# On-device generated-avatar geometry audit

## Purpose

The standard avatar selected by staff is the body reference for all later clothing, shoes and jewellery. A generated or reopened avatar can still have clipped feet, an altered pose, or a distorted torso even if the face is visible and a facial-identity screen passes.

This feature adds an **optional local review action** in the personalized avatar quality checklist: **Check framing and body proportions**. It gives staff specific warnings **before approval**, without storing measurements or charging another image-generation credit.

## Implementation

The web app reuses its existing, bundled MediaPipe pose and person-segmentation model. With the current avatar image only, it:

1. Locates a foreground person and estimates whether the head and feet are visible, the person is centred and front-facing, and arms rest near the body.
2. Measures dimensionless **shoulder, waist and hip breadth relative to torso length**, using the same on-device silhouette geometry as template selection.
3. Compares those ratios with the chosen body profile in `BUILD_REFERENCES` using a **broad 18% relative deviation** as an advisory flag. This is an engineering heuristic, **not a clinically or commercially calibrated fit tolerance**.
4. Displays a list of possible issues next to the human review scores. Re-running the action refreshes the evaluation; opening a different avatar resets its output.

When pose/segmentation cannot run, the UI explicitly reports **unverified**. It does not silently claim that the image passed. A result with no detected issues reads **no obvious concerns found**, not **guaranteed accurate**.

The check is optional and **does not automatically approve or reject** an avatar. Human review of likeness, skin tone, body proportions, neck blend, hands, feet and framing remains mandatory. Staff must not assign a score of 4 or 5 to a criterion they cannot genuinely verify.

## Privacy, costs and limits

- The check operates on the active image in the browser/app only. No additional request to the provider or studio backend is made by this action.
- The image, pose landmarks and measured silhouette are **not saved** by the check or included in logs or exports.
- The pose model evaluates **one foreground person**; background people cannot reliably be excluded by this implementation.
- Clothing, long hair, footwear, camera pose, lighting and occlusion can produce false positives or false negatives.
- Output silhouette is an **approximate 2D visual comparison**. It does not infer exact waist/chest/hip circumference, 3D shape, dress size or fit.
- The audit does not modify the generated avatar image and cannot repair a flawed one. Correct or regenerate a visibly flawed result before approving it.

## Verification

Pure tests exercise matching male/female profiles, individual silhouette drift, cropped-head/feet warnings, unavailable inference and unsafe hint handling. A browser smoke assertion confirms that the action is offered during personalized-avatar review. CI must pass formatting, unit tests, build and browser tests. Real perceptual accuracy requires representative consented evaluations outside the current automated tests.
