# Avatar template library — web 0.15

The web app includes **48 reusable adult templates**: male and female libraries,
four body profiles per library, and six illustrative complexion ranges for each
profile. Browsing, selecting, downloading and layering sample clothing on these
assets makes no paid AI request.

| Library | Profiles | Template skin tones |
| --- | --- | --- |
| Male | Slim, Regular, Athletic, Broad | Very light, Light, Medium, Tan, Deep, Very deep |
| Female | Slim, Regular, Athletic, Curvy | Very light, Light, Medium, Tan, Deep, Very deep |

## Choosing a close match

1. Select **Body library**, then enter height and weight in customer details.
2. The app suggests Slim, Regular or Broad/Curvy using the existing approximate
   BMI rule. Staff can override it, including choosing Athletic.
3. Under **Find their frame**, choose a template skin tone and body profile.
4. Review the template, or provide customer photos and consent to personalization.

Male inputs accept 140–210 cm; female inputs accept 140–200 cm. Both accept
35–200 kg. The displayed ten-unit measurement bands describe the entered values,
not measured dimensions of the templates. There is no separate generated asset
for every centimetre/kilogram, body stretching, medical assessment, or garment-size
prediction. Height and weight alone cannot determine body proportions. These are
approximate visual choices, not calibrated fit models or an exhaustive range of
human complexions.

The template tone is a starting reference. Personalized output must match the
customer's natural complexion from both photos, including face, neck, arms, hands,
legs and feet. Tone names do not represent ethnicity. Changing a template after
personalization clears the active result and approval; it never silently recolours
an already generated customer avatar.

## Storage and compatibility

`templateTone` accompanies the profile in generation requests and avatar metadata.
Server-owned saved avatars persist it in the additive `avatars.template_tone`
column; local IndexedDB records retain it too. Existing records default to Medium,
and their saved image bytes are unchanged. PNG imports can record the original
template tone. Reopening an approved image makes no generation call.

Clothing previews use the selected template pixels. Adaptation reuse still matches
actual avatar/outfit image hashes, so differently coloured templates cannot share
a cached output accidentally. Metadata alone does not invalidate an unchanged
personalized image.

## Assets and deployment

The original male/female contact sheets remain the Medium defaults. Ten additional
AI-generated fictional-adult sheets live under `public/avatar-tones/`. All twelve
sheets are 1536×1024; each profile uses a 384×942 crop that retains its head and
feet. The additional sheets were created with Image Gen from the originals to
preserve pose, proportions and neutral clothing while varying exposed skin tone.
These are illustrative assets, not customer images or live Gemini results.

The Docker image includes the new directory. Update the existing web deployment:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Both libraries are always available for template browsing/export. Female paid
personalization and AI clothing try-on still require `TRYON_FEMALE_PROFILES=true`;
the existing live-review rollout requirement remains unchanged. See
[FEMALE_PROFILES.md](FEMALE_PROFILES.md). No APK is built by this update.

## Verification

Tests cover all 48 asset crops and face/anatomy references, selector validation,
measurement boundaries, selected-tone routing, database migration and persistence,
local reopening, mobile layout, and matching pixels in exported PNGs and clothing
bases. Provider calls are stubbed. Live customer likeness, whole-body skin-tone
matching and garment fit still require review on the deployed Gemini service.

Release checks: 79 backend tests, 53 browser tests and the production web build
passed. All 48 references also passed measured eye-alignment checks with an
independent fictional customer face. No live provider generation was performed.
