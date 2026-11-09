# Clothing layers

The outfit studio composites clothing layers over the avatar in the browser: shoes first,
then trousers, then the top. Nothing is sent to an AI provider, and no credit is used.

## Importing a layer

In **Try clothes → Import a clothing layer or product photo**, staff can choose either:

- **A transparent PNG or WebP layer.** It is used as supplied (no colour change).
- **A front-view product photo** (JPEG, PNG or WebP, up to 10 MB) on a plain backdrop.
  The background is removed on the device with the same colour-based method as
  [jewellery cut-outs](JEWELLERY_OVERLAY.md#automatic-background-removal). A
  **Background tolerance** slider and a **Clear enclosed gaps** option appear under
  **Adjust placement** to refine the result. Changing them resets the placement.

Images are reduced to at most 1600 px on the longer side. Layers stay in the current
session, up to 12 at a time.

## Mask clean-up

Before placement, each layer's alpha mask is cleaned:

- Disconnected regions smaller than 1% of the garment (dust and backdrop specks) are removed.
- Faint semi-transparent haze outside the garment is cleared, so it does not show as a veil.
- The layer is trimmed to the garment.

Separate parts of a garment, such as the two shoes of a pair, are kept.

## Alignment

Layers are placed by measuring the mask instead of using its outline:

| Category | Measured from | Lined up with                           |
| -------- | ------------- | --------------------------------------- |
| Top      | The opaque run through the centre at 60–85% of the height, below the sleeves | The torso width and body centre line; top edge at the shoulders |
| Trousers | The opaque run through the centre at the top 1–6% (waistband) | The waist width and centre line; long trousers are shortened to end above the feet |
| Shoes    | The whole pair | The feet, with the soles on the ground line |

Target widths come from the shipped sample layers (torso 53% of the top box, waistband
71% of the trouser box) and scale with the selected body profile. The unit tests check
that each sample layer, imported as a file, lands where the sample is drawn.

## Arms in front of tops

Imported tops are flat product shapes, so where a top's body overlaps the avatar's arms the
arms would disappear behind it. For each imported top, **Show forearms and hands in front of
this top** (under **Adjust placement**, on by default) draws the avatar's own forearms and
hands back over the top. Sample tops are already shaped around the arms, so the option
starts off for them.

The arm mask is made on the device from the same MediaPipe pose model as the
[body photo check](BODY_PHOTO_CHECK.md), with its person outline:

- Capsules follow each elbow → wrist and wrist → finger line (`src/arm-mask.js`), fading in
  below the elbow so the upper arm stays under the sleeve.
- Pixels are kept only inside the person outline and close to the arm's own colour (the
  median along the forearm), which drops backdrop and clothing behind a hand.
- The mask is made once per avatar image and cached. If the model cannot load or no arms
  are found, the outfit is drawn as before.

Turn the option off for long sleeves that already cover the forearms.

## Limits

- Garments keep their own shape; they are not warped to the avatar's pose.
- Only forearms and hands come forward (see below); upper arms stay under the sleeves, and
  a hand in front of trousers is not separated from them.
- Colour-based removal needs a plain backdrop that contrasts with the garment; white
  clothing on a white backdrop is the hardest case.
