# Static sample hands — J3

Twelve fictional adult hand photographs, generated once with Image Gen for
Forme's jewellery templates on 2026-11-08. Both libraries use the six illustrative
tone ids from `src/profiles.js`. They are not customer photos or calibrated skin
measurements. Images have no jewellery and are normalized to 1024 × 1024 RGB PNG.

Each matching JSON contains authored finger/wrist positions and a hand mask in
the final image's pixel coordinates. Tone edits retain the corresponding male
or female pose. Angles are clockwise from a horizontal jewellery band. Left and
right refer to the wearer's anatomical hands. The polygon joins the separated
forearms along a one-pixel strip at the image's bottom edge and excludes the gap
above it.

The development contact sheet, overlay review and checks are described in
`docs/JEWELLERY_HANDS.md`. Store operator review is still needed before pilot
use. Future interactive views, jewellery placement, export and fit guidance
remain separate implementation tasks. These files require no runtime AI calls.

Prepare replacement assets only through the offline workflow in
`scripts/make-hand-templates.mjs`; never generate them in a customer request,
application build or CI run.
