# Female body library — web 0.11 pilot

Four generated adult female templates are included: Slim, Regular, Athletic and
Curvy. Each has the same front-facing pose, grey crew-neck T-shirt and charcoal
mid-thigh shorts. The selection is approximate; height and weight do not measure
body proportions or determine athletic build. Male identifiers and default behavior
remain unchanged. Female measurements support 140–200 cm and 35–200 kg.

## Rollout

`TRYON_FEMALE_PROFILES=false` is the default. The requirements call for reviewing
10+ live female avatars/try-ons before release; these live provider checks have not
been performed. For a controlled pilot, set `TRYON_FEMALE_PROFILES=true` in the
Lightsail `.env`, then rebuild using the shared and accounts Compose files:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Health reports `supportedBodies`. When enabled, **Body library** appears in customer
details. Choose Female and a body profile, then generate/review as usual. Dress,
skirt, saree, lehenga and blouse join the shared garment options. Product-photo
try-on and transparent-layer imports work; the male sample garment catalogue is
hidden for female profiles until suitable sample assets exist.

Saved avatars retain profile identity and a `body_type` database column. Existing
records migrate to `male`. Saved looks and reopening use the correct library;
original customer photos are never persisted. The flag prevents new female
personalization/try-on calls when disabled. Existing saved images remain readable.

## Asset and validation

`public/avatar-library-female.png` is a newly generated synthetic 1536×1024 contact
sheet, not a customer photograph. Four 384×942 crops exclude the lower margin while
retaining complete feet. Local face landmarks measured horizontal eye midpoints
of 196, 191, 190 and 191 pixels for the four panels. Every crop passes one-face
detection and the anatomy-reference builder. Browser coverage checks selection,
the female asset, garment types, generation payload, export and mobile width.
These checks do not establish customer likeness, complexion accuracy or realistic
garment drape. Live visual review remains required before general enablement.

No Android APK was rebuilt.

Automated validation for this branch: 52 backend tests, 48 browser tests and the
TypeScript/Vite production build passed. Provider responses in browser tests are
stubbed, so the screenshots demonstrate UI behavior rather than Gemini quality.
