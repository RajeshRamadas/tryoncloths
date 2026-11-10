# Sarees, blazers and suits

Sarees are draped and blazers and suits are worn over a shirt, so they behave differently
from a top or trousers. This page describes how each part of the studio handles them and
what is only approximate.

## Clothing types

| Type   | Body library | Guessed from product names such as                          |
| ------ | ------------ | ----------------------------------------------------------- |
| Saree  | Female only  | saree, sari                                                 |
| Blazer | Both         | blazer, suit jacket, sports coat, dinner or tuxedo jacket   |
| Suit   | Both         | suit, two-piece or three-piece suit, tuxedo                 |

"Suit trousers" is guessed as **Trousers**. A women's salwar, churidar, anarkali, patiala,
sharara or palazzo suit, and a track, swim, jump, play or night suit, is guessed as
**Full outfit**, not a tailored suit. **Jacket** stays for hoodies, coats and casual jackets.
Staff always confirm the type before generating. Existing catalogue products typed
**Jacket** or **Full outfit** keep their type; change them to **Blazer** or **Suit** in
**Store catalogue** if wanted.

## AI try-on (product photo or link)

- **Saree** replaces the current top and bottoms with the saree and its blouse (a plain
  matching blouse when the photo shows none). The prompt asks for a Nivi drape unless the
  photo clearly shows another: wrapped at the waist, front pleats to the floor, and the
  pallu across the chest and over the left shoulder, with the border along the hem and
  the pallu's own pattern. A flat or folded saree photo is draped, not copied as folded.
- **Blazer** is added as an outer layer over the current shirt or top. The shirt collar
  stays inside the lapels and a little cuff may show; buttoned or open as photographed.
- **Suit** replaces the current trousers with the suit trousers and adds the jacket over
  the current shirt or top, in the same fabric. A waistcoat, shirt, tie or pocket square
  is added only if the photo shows it.

Each still uses 1 AI credit, as before. The model follows these instructions most of the
time; drape style, pleat count and the exact pallu fall can differ from the photo, so
review every result before saving.

## Clothing layers (no AI credit)

The outfit studio has two more tabs: **Blazers & suits** (every profile) and **Sarees**
(female profiles). Layers are drawn in this order: shoes, trousers, top, saree, then
blazer.

- **Blazers & suits.** The layer is measured across the torso at 55–80% of its height.
  An open front (a gap at the centre up to a quarter of the layer's width) is bridged, so
  both front panels count. The torso is matched to the body 8% wider than a top, so the
  blazer sits over the shirt, with its top edge just above the shoulders. Sleeves bend
  with the elbows and wrists like a top's. For a suit, import the jacket under **Blazers &
  suits** and the trousers under **Trousers**.
- **Sarees.** Use a photo of the saree draped on a model or mannequin, front view, from the
  shoulders to the floor. The layer is scaled to hang from just above the shoulders to the
  floor line, widened for fuller profiles, and centred on its front pleats (measured at
  65–85% of its height, below where a side-hanging pallu usually ends). Fit to the pose
  follows the shoulders and ankles only: a saree hangs, so it does not bend with the knees.
- **Forearms and hands** come in front of blazers and sarees too, on by default for
  imported layers.

Limits: a flat or folded saree cannot be draped by the layer tools (use AI try-on for
that). The original top and bottoms are covered, not erased, so a narrow saree photo can
leave them showing at the sides. There are no sample sarees or blazers yet; import the
store's own photos.

## Size charts and suggestions

**Blazer** and **Suit** are chart types like any other (the CSV template has example rows).

- **Blazer**: chest counts fully, waist for half and hip for a quarter, because a blazer
  is bought by chest and the front can sit open. Check sleeve length on the customer.
- **Suit**: chest and waist count fully. When the jacket fits one size by chest and the
  trousers another by waist, the suggestion says so (for example "The jacket fits 42R by
  chest but the trousers fit 38R by waist") and is never High confidence. Ask whether the
  suit is sold as separates, or plan a trouser alteration.
- **Saree**: with no saree chart for the brand, the suggestion is **Free size**: a saree
  is about 5.5 m (0.8 m more with a blouse piece) and only the blouse is stitched to the
  customer's bust and waist. A saree chart compares ready-made blouse sizes by chest
  (bust) and waist.

These weights are rules of thumb, not calibrated against real fittings. Drop (the chest to
waist difference), sleeve and inside-leg length are not modelled.
