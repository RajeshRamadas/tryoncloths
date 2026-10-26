# Gemini customer reference correction

## Reproduced live failure

On 26 October 2026, the public studio loaded successfully and `/api/health` reported Gemini configured with `customer-avatar-v4`. One live generation used the independent synthetic green-sweater customer, Regular template and 175 cm / 72 kg measurements. The API returned HTTP 200 and an image, but visual review failed: the result omitted the customer's glasses, retained the template's styled hair and appearance, and cropped the feet.

| Customer reference | Failed live output |
| --- | --- |
| ![Synthetic customer with glasses](../../../tests/fixtures/customers/green-sweater-face.jpg) | ![Failed output; not an acceptable customer likeness](failed-live-output.png) |

The request/response path worked. The image did not satisfy personalization. The old request included a full-colour template person first, creating a competing identity and skin-tone reference. This is a plausible contributor; a single output does not prove a sole cause.

## Natural-colour correction (`customer-first-v2`)

After deploying `customer-first-v1`, the user reported that the face came from the customer but the lower body was gray. That version supplied a grayscale body reference. Version 2 removes desaturation while retaining the identity mask and customer-first ordering. A subsequent live test of v2 returned a recognizable synthetic customer with coloured skin and full-body framing. It also copied the template separator lines. The user reported unnatural head/body proportions in their result.

## Proportion correction (`customer-first-v3`)

The old 160 × 210 blank region erased neck/collar landmarks along with identity. Version 3 replaces a smaller head region with a featureless head-size guide, centred on each standard profile’s neck. The source body from row 175 downward stays at its original scale, including the collar, shoulders, neck, limbs and feet. Customer facial proportions must be preserved by uniform scaling; the prompt explicitly separates canvas aspect ratio from anatomical proportions and asks for roughly seven head lengths as a visual guide, not a calibrated rule. The four-pixel contact-sheet separator strips are removed without moving or resizing body pixels.

The latest live test used v2, not this new v3 code. [View that live output](live-v2-output.png). It does not establish that v3 resolves all proportion issues.

## Backend change

Gemini now receives three explicitly labelled references in this order:

1. Unchanged customer face: primary identity, hair, glasses and complexion reference.
2. Unchanged customer full-body photo: supporting appearance/complexion reference.
3. Selected standard body with natural colour, texture and shading preserved, its original face/hair removed, and a featureless head-size guide aligned to its neck. Padding gives the complete figure room on a 2:3 canvas, without cropping or stretching.

![Prepared anatomy reference; not a customer output](anatomy-reference.png)

Instructions explicitly preserve customer glasses and hairstyle, match all exposed skin to customer references, replace the head-size guide, and include both complete feet with floor below. They request one natural full-colour photograph with coherent lighting and neck blending; gray garments must not cause gray exposed skin. The template supplies shape and realistic shading, not the target complexion. The image configuration requests a 2:3 portrait. Original sample previews/exports remain intact. This transformation is specific to the four bundled templates and rejects different dimensions until mask placement is reviewed.

There is still one provider call per explicit attempt, with no automatic retry, second AI pass, provider switch or extra AI analysis. OpenAI's optional adapter is unchanged. Existing v0.4 Android/browser clients remain compatible.

## Verification and limits

- 28 unit/API tests passed, including request image order, separate labels, unchanged customer bytes, complete source-identity removal, natural colour/texture retention and unscaled body/feet preservation for all four templates.
- The preceding version passed four focused browser scenarios. This change leaves the UI and request/response contract unchanged; no Android rebuild is required.
- Production Docker build and runtime checks passed, including public Gemini configuration and reference rendering inside the container.

**The head-proportion correction has not yet been tested through the live Gemini account.** The available API key is on Lightsail, and this workspace cannot deploy that server. The live failure above is evidence for the defect, not proof that the new reference strategy solves facial fidelity. Gemini output can still vary; likeness, skin tone and full-body framing require a real generated result and customer review. HTTP 200 alone is not a quality check.

## Deploy and verify

Keep the existing Gemini key and public-access settings. From Lightsail:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml up -d --build tryon
```

Then open `/api/health`. It must include `"generationRevision":"customer-first-v3"`. Refresh the app and generate a new result; existing images are not changed by deployment. Repeat the green-sweater test and visually compare face, glasses, hair, complexion and both feet before approving. Do not automatically retry a failure.
