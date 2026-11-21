# Side-by-side customer reference review

## Why this matters

An identity-preserving reusable avatar is only as dependable as its review. The six-point customer approval workflow asks staff to compare the generated face, body proportions and skin tone with the original customer. Previously there was no dedicated side-by-side display in the review checklist.

This feature adds **Compare with customer references** to the existing personalized-avatar quality review. It is an image comparison aid, not a similarity algorithm or proof of identity.

## Review procedure

1. With customer permission, upload the face and full-body photographs, select a body template and generate a draft avatar.
2. Open **Review avatar**. In **Face comparison**, inspect the original face photo beside an enlarged view of the generated avatar's head. Move **Generated face zoom** to look more closely; magnification only changes the view, not the image pixels.
3. Switch to **Full-body comparison** to inspect the customer's standing photo alongside the generated full-body avatar. Check proportions, pose, visible skin, neck and extremities. The optional geometry and tone audits can also highlight issues.
4. Complete the six human-reviewed quality scores and both consent/reviewer confirmations. Only assign scores of 4 or 5 when justified. The separate customer approval checkbox remains required for export or try-on.

The comparison has **no similarity score, facial alignment, skin-tone classification, virtual measurement or automatic approval**. Face zoom does not crop, edit, regenerate or save the avatar.

## Reopened, saved and imported avatars

Original face/body photographs are not stored in locally saved avatars or account avatar metadata. When an avatar is reopened or imported, the review shows **Original face photo unavailable** and **Original full-body photo unavailable** rather than displaying fictional references or asserting that the generated result matched the original.

In that situation the reviewer must compare the image with the customer in person or other separately consented references. The existing six-point review must still be completed before customer approval.

## Privacy and security

- Reference images shown in the comparison are the original **in-session** photo data already present for that consented generation request.
- Only valid local JPEG, PNG and WebP data URLs are accepted as reference sources; remote URLs, SVG and invalid data are not rendered as customer references.
- Comparison display and zoom do **not** send a new request, invoke a paid model, upload imagery, store reference photos or persist comparison state.
- Generating an avatar has separate, existing provider consent and data handling. This feature does not alter those policies or assert that photos were never sent for generation.
- Leaving the review, changing source photos/templates or starting a new session follows the existing image-clearing and approval-reset behaviour.

## Verification

Pure tests cover acceptable local reference sources, rejection of remote/malformed sources and that reference availability never contains images. Browser tests cover in-session face/full-body display, face zoom, missing references on reopening, and the unchanged human-approval workflow. They use existing synthetic test images and no paid provider calls. CI must pass formatting, unit tests, production build and browser tests.
