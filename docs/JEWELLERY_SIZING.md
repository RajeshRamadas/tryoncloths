# J11 — Optional jewellery sizing help

Web `0.20.0-alpha.11` adds necklace-length illustrations and ring/bangle size
suggestions. Enable `TRYON_JEWELLERY=1` with account storage and sign in to the
store. These actions use **zero AI credits** and need no Gemini key. They never
change the selected product's size or add a size-based restriction to try-on,
comparison, saving or downloading.

## Store measurements for later visits

In Forme, select a customer, open **Edit customer → Optional jewellery
measurements**, and record the optional values. The same fields appear in
**Jewellery studio → Fit this piece → Size help → Customer measurements** when
a ring or bangle is selected. The avatar must already belong to that customer.
An unlinked avatar still supports try-on. For an older unlinked avatar, download
its reviewed PNG, select the customer in Forme, then use **Saved avatars → Open a
downloaded avatar PNG**, review and save it to the account. This existing import
flow makes a customer-linked copy without generating the body again; the
original saved avatar and its views remain separate.

| Customer measurement key | Meaning | Accepted value |
| --- | --- | --- |
| `fingerCircumferenceMm` | Circumference of the selected finger | 35–85 mm |
| `ringInnerDiameterMm` | Inside diameter of an existing ring, excluding its band | 11–27 mm |
| `handCircumferenceMm` | Widest knuckles with the thumb tucked in; not wrist circumference | 140–300 mm |
| `ringSizeIn` | A known Indian ring size | Integer 1–30 |
| `bangleSizeIn` | A known Indian bangle label | `2.2`, `2.4`, `2.6`, `2.8`, `2.10`, `2.12` |

Each customer has one optional jewellery measurement set. Confirm it applies to
the hand/finger currently selected; the application does not infer measurements
for another finger. Blank fields clear only those values. Other customer and
clothing measurements are preserved. The studio form previews unsaved values
locally and asks for customer storage agreement before **Save jewellery
measurements**. Reload saved values to discard local changes. Main Forme's
existing **Save customer** also retains these fields.

The values live in the existing customer `measurementsJson`. No schema column or
new external service is required. Existing clients that edit only clothing
measurements retain the jewellery values through partial merge. Customer erasure
removes the measurement record and its avatars/looks through the existing rules.

## Understand the suggestion

A saved ring/bangle size takes priority as a recorded customer choice. If it
conflicts with measured inputs, it is shown with **Low confidence** and an
explanation. A known size alone, or agreement with its converted measurement,
is **Medium confidence**. Generic measurement-to-chart estimates remain **Low**;
none of this release's jewellery suggestions claims High confidence or physical
fit certification.

The item panel shows the catalogue size beside the suggestion and flags a
difference in text. Staff can continue trying that item. No catalogue attribute,
avatar proportions, paid reuse key or provider prompt changes as a consequence
of sizing advice. The measurements are not added to Gemini requests.

### Pilot reference charts

The shared, versioned-in-source chart is in `src/jewellery-sizing.js`. It is a
pilot reference, not a universal retailer or BIS-certified fit chart. Confirm the
jeweller's chart and an actual fitting before purchase.

- Indian ring labels 1–30 map to nominal circumferences 41–70 mm in 1 mm steps.
  The closest label is suggested; an exact midpoint chooses the larger label.
  Diameter converts through `circumference = π × inner diameter`. Only a 0.02 mm
  circumference allowance at the chart edges compensates for diameters displayed
  to 0.01 mm. Conflicting circumference/diameter values differing by more than
  1 mm of circumference produce no computed suggestion; a recorded size remains
  visible with Low confidence. Values outside the chart are not silently clamped.
- Bangle labels are inches plus sixteenths: `2.10` means `2 + 10/16` inches,
  **not** decimal `2.1`. The derived inside diameter uses 25.4 mm/inch. The
  reference circumference is rounded to 0.1 mm, and the first listed value not
  smaller than the entered hand circumference is suggested. This circular
  approximation does not model knuckle shape, compression or bangle width.

| Bangle | Inside diameter (mm) | Reference circumference (mm) |
| --- | ---: | ---: |
| 2.2 | 53.975 | 169.6 |
| 2.4 | 57.150 | 179.5 |
| 2.6 | 60.325 | 189.5 |
| 2.8 | 63.500 | 199.5 |
| 2.10 | 66.675 | 209.5 |
| 2.12 | 69.850 | 219.4 |

## Necklace length guide

Open a saved **Portrait** or **Full body** view and choose **Show necklace length
guide — free** below the preview zoom control. Toggle the illustrative Choker
40 cm, Princess 45 cm, Matinee 60 cm and Opera 80 cm curves. A selected product's
catalogue length adds a solid curve and label. The white point marks the neck
anchor. Long curves extending beyond a portrait are labelled accordingly; use
the full-body view for more context.

Portraits use J5's saved neck-base anchor and approximate px/mm scale. Full-body
avatars are normalized to the same 1024 × 1536 contain-fit canvas as jewellery
try-on, preserving anatomy and the full head/feet. Shipped local face/landmark
models locate the eyes and chin in the upper image; neck base is estimated from
the chin plus 55% of the face-box height. This is local inference, not a paid
image-generation call. No face descriptors are produced or stored by the guide.

Both guides assume a 63 mm eye-distance reference. The illustrative chain spread
is 65 mm either side of the anchor, capped to the canvas; the representative drop
is `max(4, 20 + (lengthCm - 40) × 5)` mm. Curves translate/rotate with the anchor
and scale with px/mm. These assumptions illustrate length categories, without
measuring neck circumference or predicting actual chain drape. They do not
certify where a particular chain will sit.

The guide is a separate, clearly labelled SVG illustration of the current
preview. Its lines never enter saved images, downloads or share links. It is
collapsed by default and makes no request until opened. A missing, small or
unclear face only makes the optional guide unavailable; other studio actions
remain usable. Changing the customer/view or replacing a saved view resets it.

## API, privacy and validation

- `GET /api/jewellery/size?avatarId=ID`: resolves the avatar's owned linked
  customer and returns the saved measurements plus ring/bangle suggestions.
  Unlinked avatars return empty suggestions, not a guessed customer.
- `POST /api/jewellery/size`: `avatarId`, the linked `customerId`, a partial object of the five supported
  jewellery measurement keys, and `storageConsent: true`. Changes are atomic,
  role/session-checked and restricted to the linked customer in that store.
- `GET /api/jewellery/necklace-guide?avatarId=ID&view=portrait|full`: returns the
  saved source's anchor coordinates, scale, canvas dimensions and source hash.
  Source revision/session checks run again after asynchronous inference; the browser
  verifies the source hash against its loaded reference before drawing. Existing
  per-worker preparation bounds apply. Source PNGs and temporary pixels remain
  in memory and are cleared; the response contains no descriptor or new image.

All three studio routes enforce the jewellery flag, active owner/manager/staff
membership, tenant scope and studio origin. Existing generic customer-profile
routes retain their usual permissions. Measurements are optional there, so
turning the jewellery flag off does not destroy already-recorded values.

Tests cover every ring and bangle reference row, boundary/tie/diameter conversions,
known-size conflicts, invalid units and types, form round-trips, clothing-chart
isolation, partial clearing, persistence/restart, tenant/origin/role and erasure
rules, guide translation/scale/rotation, full-body local inference, stale views,
revoked sessions, unavailable data and disabled flags. Mobile browser coverage
checks editing, reload, a still-enabled try-on button despite a size mismatch,
portrait/full guide curves and late-response cleanup without a provider call.

[Browser screenshots](testing/jewellery-sizing/README.md) use local fixtures and
injected guide anchors. They verify controls, geometry and privacy behavior,
not calibrated sizing accuracy. J12 evaluation/release work and the separate
commercial live-service/pilot evidence remain pending.
