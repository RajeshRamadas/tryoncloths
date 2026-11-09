# J9 — Free jewellery overlays

Web `0.20.0-alpha.9` adds placement of saved transparent jewellery cut-outs on
approved avatar views. Enable `TRYON_JEWELLERY=1` with account storage. Overlay
placement, saving, reopening, sharing and downloading use **zero AI credits** and
work without a Gemini key. Creating a new portrait still uses the existing
explicitly consented, one-credit portrait flow; saved portraits and free sample
hands can be reused.

## Staff workflow

1. An owner or manager opens **Jewellery catalogue**, saves a product normally,
   then expands **Transparent cut-out** on its card.
2. Upload a single jewellery piece as a transparent PNG, or a product photo on a
   plain backdrop (PNG, JPEG or WebP under 10 MB). A photo without transparency has
   its background removed on the staff device, with no upload, Gemini request or
   AI credit; see [automatic background removal](#automatic-background-removal).
   Check the preview, confirm storage consent, and choose **Save cut-out**. The anchor follows the catalogue type. Source
   images must be at least 200 × 200 px, at most 2048 px per side, 4 megapixels
   and 2 MB. The server checks the decoded image for visible content and genuine
   transparency, trims transparent margins and removes metadata. A solid
   background or empty image is rejected. Upload one earring, rather than a pair.
3. Open and approve a saved avatar, choose **Jewellery**, select its approved
   portrait/hands/full-body view and a saved product with a cut-out.
4. Select **Overlay · free**, review the starting view, and choose **Load overlay
   placement**. The editor starts at the saved anchors. Select a piece, drag it,
   pinch with two fingers to resize/rotate, or use the position/scale/rotation
   controls. The second earring starts mirrored. **Reset all placements** restores
   every starting position. **Reload starting placement** reads the current asset.
5. Choose **Apply overlay — free**, review the composite and save it with customer
   storage agreement. Undo removes the latest addition; reset restores the saved
   view. Add more pieces to the reviewed result in the same way.
6. Download a full-resolution PNG or share the saved look. Both carry **Overlay
   preview**. Reopen from the avatar’s saved looks without generating again.

Portrait ear/nose sides follow the wearer’s anatomy, with the J5 coordinates
interpreted as image sides. Template hands use their anatomical hand/finger/wrist
coordinates. Earring drop/stud width and forehead pendant dimensions use the
portrait’s approximate eye-distance scale (63 mm reference). Hand bands start
from template finger/wrist widths. Necklace width uses 40% of the catalogue chain
length at the approximate portrait scale; other pieces use view proportions;
full-body waist/ankle positions are manual starting suggestions, not measured
customer anatomy. Staff can adjust all pieces without distorting the cut-out.

The overlay preserves the cut-out’s design and colours. It adds pixels and does
not infer lighting, depth, hidden chain sections, physical fit or occlusion. It
cannot erase existing jewellery; use an undecorated view or undo first. AI
adaptation remains available separately with explicit provider consent and the
existing credit rules. A look combining both modes is labelled **AI + Overlay
preview — actual piece may differ in detail**.

## Automatic background removal

`src/jewellery-cutout.js` runs in the browser before anything is saved:

- The backdrop colour is the median of the photo's border pixels. If fewer than 60%
  of border pixels match it, the photo is rejected as too busy; use a plain backdrop
  or supply a transparent PNG.
- Backdrop is flood-filled from the edges, following smooth gradients, vignettes and
  soft shadows. With **Clear enclosed gaps** (default on), enclosed areas that closely
  match the backdrop, such as ring holes and chain loops, are cleared too; small light
  details such as pearls or highlights are kept.
- Edge pixels are feathered and the backdrop colour is removed from them to avoid a
  halo. Photos are scaled to at most 2048 px per side and 4 megapixels, and the PNG
  is shrunk if needed to stay under 2 MB.
- **Background tolerance** (default 32) can be raised when backdrop remains, or lowered
  when light metal, white stones or pearls are cut away. Silver or white pieces on a
  white backdrop are the hardest case; a contrasting backdrop works best.

A PNG that already has transparency is used as supplied. The saved result still goes
through the server validation below, so the stored asset format is unchanged.

## API and storage

- `POST /api/garments/:id/overlay?category=jewellery`: owner/manager writes a
  `overlayPng` data URL plus type-compatible `overlayAnchor` and
  `storageConsent: true`. `overlayPng: null` removes it. Shared master copies are
  read-only; edits belong in the master store.
- `POST /api/jewellery/overlay/prepare`: resolves a catalogue item and approved
  owned view, returning the normalized base, cut-out hash, full dimensions and
  default placements. Subsequent reviewed bases need the same signed receipt,
  approved result ID or saved-look proof as J7.
- `POST /api/jewellery/overlay`: accepts the same context, asset hash and bounded
  placements. Sharp renders at full view resolution and issues a signed receipt.
  No Gemini request, credit hold, paid job or AI adaptation cache entry is made.
  Concurrent preparation/compositing is bounded to two requests per worker.
- Existing jewellery look save/reopen and share APIs accept these receipts.
  Output provenance (`ai`, `overlay`, `mixed`) comes from verified receipts and
  stored bases, never a client-supplied look label. Overlay receipts cannot be
  approved as paid AI adaptations. The raw saved output has no footer, allowing
  another piece to be stacked without accumulating labels; downloads/shared
  images get their label once.

Every write requires the studio origin, active store session and role. Preparation,
compositing and saving recheck the session, catalogue availability, asset hash and
view revision after asynchronous work. Unreviewed or arbitrary customer bases are
rejected. Client cancellation/session expiry discards late images and clears the
placement editor. Changing a cut-out invalidates unsaved receipts for it; saved
looks remain reopenable. Clothing flows and paid generation contracts are retained.

## Validation

Automated tests cover decoded PNG validation, anchor accuracy, millimetre scale,
anatomical side selection, mirrored asymmetric products, rotation, crop, dimensions,
48-piece bangle bounds, tampered placements, roles, tenant/origin/session checks,
stale assets, saved-look provenance, labelled export/sharing and disabled flags.
The mobile browser workflow uploads a cut-out, drags, pinches, rotates, resets,
applies, saves, shares, downloads and reopens it with no paid try-on route request
and no credit change. Tests use local fixtures and injected portrait anchors;
no live provider call is made and no real product-fit quality claim is inferred.

[Mobile editor and saved-look screenshots](testing/jewellery-overlay/README.md)
show the actual browser workflow with the independent customer fixture and a
synthetic product design.
