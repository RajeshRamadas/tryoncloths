# Local generated-avatar skin-tone consistency audit

## Purpose

A reusable avatar should have natural, consistent-looking colour across the face, neck and visible skin. The existing human quality review covers this, but a generated face can still appear visibly different from the neck or forearms.

The **Check skin-tone consistency** button adds a small, optional **on-device colour comparison** before final customer approval. It is *not* a skin-colour classifier, a complexion-matching guarantee, or automated identity verification.

## How it works

1. The existing browser MediaPipe pose/segmentation runtime locates the head, shoulders, elbows and wrists on the generated or reopened avatar.
2. Tiny opaque foreground patches near the nose/cheeks provide an **internal generated-face colour reference**.
3. Similar patches near the neck and lower forearms are sampled when pose confidence permits.
4. A broad, uncalibrated **CIELAB Delta E 1976 distance of 28** flags large deviations as *possible colour or coverage differences*. This is not a validated quality threshold or a measurement of human skin tone.
5. Staff see which region needs review. If face or exposed-region samples cannot be obtained, the result is **unverified**, not a pass.

The display never shows an inferred race, ethnicity, Fitzpatrick type or a numeric skin-tone label. The check does **not** compare the output with the customer's original face photograph: different camera lighting and white balance make simple RGB comparison especially unreliable. Staff must compare with the customer or consented references as part of the existing six-point review.

## Safety, limits and cost

- Runs **only when requested** on the active generated avatar in the web client, reusing the bundled pose model. No new paid image-generation call is made.
- The image, pixel samples, raw colour values and pose landmarks are **not sent to the backend**, persisted in saved avatars, or included in reports. A temporary analysis canvas and its pixel buffer are cleared after use.
- **Clothing, sleeves, hair, jewellery, shadows, makeup, lighting and different sun exposure** can cause false warnings or conceal genuine differences. The algorithm does not perform semantic skin segmentation and may sample fabric.
- A **clear** result means only that sampled colour patches did not differ strongly under this heuristic. It must never auto-approve a reusable avatar. An **unverified** result means staff must rely on visual review.
- Existing customer consent, six review scores (minimum 4/5), reviewer confirmation and final customer approval remain unchanged. Reopening or changing the active avatar clears the transient on-screen audit result.
- The check cannot repair skin blending or recolour a flawed avatar. Regeneration requires a new explicit provider request and may incur a fee.

## Tests

Pure unit tests use synthetic colour patches to check consistent colours, mismatched neck/forearm colours, missing face landmarks, transparent pixels and excluded foreground masks. Browser smoke tests verify that the optional action is visible in the personalized review screen. CI validates formatting, tests and build. Visual performance and the threshold need evaluation on diverse consented images before any claim of reliable detection.
