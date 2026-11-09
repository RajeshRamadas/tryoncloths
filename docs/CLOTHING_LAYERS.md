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

## Limits

- Garments keep their own shape; they are not warped to the avatar's pose.
- There are no avatar-side occlusion masks yet, so a top is drawn over the arms rather
  than behind them. This needs body segmentation (see the pose and silhouette item in
  [pending implementation](PENDING_IMPLEMENTATION.md)).
- Colour-based removal needs a plain backdrop that contrasts with the garment; white
  clothing on a white backdrop is the hardest case.
