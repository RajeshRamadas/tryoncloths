# Jewellery catalogue — J1

Web `0.20.0-alpha.1` implements the first task in the
[jewellery implementation guide](jewellery/IMPLEMENTATION_LLM.md). Signed-in
stores can save jewellery product photos and structured details for reuse.
Catalogue actions do not call AI or use credits. J2 adds the internal
[local face comparison helper](JEWELLERY_IDENTITY.md) in `0.20.0-alpha.2`.
Jewellery generation, portrait and hands views, sizing and overlays remain
later tasks J5–J12. J3 supplies [static hand references and anchors](JEWELLERY_HANDS.md)
in `0.20.0-alpha.3`; J4 adds the [internal portrait adapter](JEWELLERY_PORTRAITS.md)
in `0.20.0-alpha.4`. [Interactive views, approval and storage](AVATAR_VIEWS.md)
are implemented in J5 (`0.20.0-alpha.5`). J6 supplies the internal adapter and
[J7 adds guarded try-on and reuse API routes](JEWELLERY_API.md)
(`0.20.0-alpha.7`); the jewellery studio screen remains J8.

## Enable and use

The feature is off by default. Set the server environment variable
`TRYON_JEWELLERY=1` and recreate the web service with the existing account-storage
Compose overrides. `deploy/lightsail/compose.accounts.yaml` passes the variable;
keep the existing account volume and every deployment-specific override when
rebuilding. No production service has been changed by this implementation.

Sign in, open **Catalogue → Jewellery catalogue**, or visit
`/jewellery-catalogue`. Owners and managers can add, edit and delete local items;
staff can browse and match saved items. Shared chain-master items remain
read-only in branch stores. Disabling the flag hides access without deleting
saved records.

Add a product name, explicitly check its suggested type, choose its metal, and
upload a JPEG, PNG or WebP product photo (at least 160 × 160 pixels, at most 5 MB).
Confirm saving the product photo to the store account. Optional fields include
a metal/stone/SKU variant, product URL, SKU, selling price, stock and dimensions.
The URL is recorded for future matching; this page does not fetch or extract
photos from a retailer. Edit an existing item to change its attributes or price.
Use a distinct variant for separate metals, stones or SKUs sharing a photo.

The catalogue supports 18 types: stud earrings, drop/chandbali earrings, jhumka,
nose pin, nose ring/nath, maang tikka, matha patti, choker, necklace/chain,
pendant, long/rani haar, mangalsutra, ring, bangles/kada, bracelet, watch, waist
belt/kamarbandh and anklets/payal. Title hints recognise Indian terms, but are
suggestions for staff confirmation. Toe rings and jewellery sets have no new
type in J1.

## Fields and view selection

Every jewellery item requires one of seven metals: `yellow_gold`, `rose_gold`,
`white_gold`, `silver`, `platinum`, `oxidised`, `imitation_gold`.

| Optional attribute | Accepted value |
| --- | --- |
| `purity`, `stones`, `huid` | Text up to 10, 80 and 12 characters respectively |
| `weightG` | 0–2000 g |
| `lengthCm` | 20–120 cm |
| `dropMm` | 2–150 mm |
| `pendantMm` | 5–150 mm |
| `ringSizeIn` | Whole Indian ring size 1–30 |
| `bangleSize` | `2.2`, `2.4`, `2.6`, `2.8`, `2.10`, `2.12` |
| `count` | Whole piece count 1–24 |
| `pair` | Boolean; defaults true for earrings and anklets |

Text is trimmed and cannot contain control characters. Unknown fields, invalid
metals and out-of-range or incorrectly typed numbers fail validation. Hallmark
text is descriptive only; the app does not verify purity, authenticity or fit.

The shared type table specifies placement, preservation instructions and a
future view. Necklace, pendant and mangalsutra lengths up to 50 cm use portrait;
longer lengths use full body; an omitted length defaults to portrait. Rings,
bangles, bracelets and watches use hands; long haar, waist belts and anklets use
full body. Other types use portrait. This is metadata, not a generated view.

## API and persistence

All catalogue endpoints use the active store session. Writes also require same
origin; jewellery writes require an owner or manager. Examples:

| Endpoint | Behaviour |
| --- | --- |
| `GET /api/jewellery/types` | Shared definitions, metals and bangle sizes |
| `GET /api/catalogue?category=jewellery` | Search, type/metal/stock filters and pagination |
| `POST /api/garments` | Save with `category: "jewellery"`, `garmentType`, validated `attributes`, product photo and `storageConsent: true` |
| `POST /api/garments/match` | Add `category: "jewellery"` to match a photo or canonical product URL |
| `GET /api/garments/:id?category=jewellery` | Full saved product plus suggested view |
| `PATCH /api/catalogue/:id?category=jewellery` | Update attributes, price, stock and existing catalogue fields |
| `DELETE /api/garments/:id?category=jewellery` | Delete a local store item |

Jewellery category requests return 404 when disabled. A missing category means
clothing. Jewellery and clothing matching cannot select each other's records;
the existing clothing, CSV/sync, campaign, photo-job and Shopify shopper paths
continue to use garments only. Jewellery CSV import, retailer extraction and
Shopify sync are not implemented in J1.

Guarded, transactional migrations add `category` (default `garment`),
`attributesJson` (default `{}`) and nullable `overlayPng` to the existing table,
and refresh older shared catalogue views. Existing photos and adaptations stay
intact. The overlay column is reserved and cannot be supplied through this API;
J9 implements cut-outs. Jewellery and clothing share the store's existing
catalogue capacity. Shared-master metadata follows its category and remains
read-only. Changed jewellery attributes invalidate any stored item adaptations.

Health returns `jewelleryCatalogueAvailable` only when the flag and account
storage are enabled. Since J7, `jewelleryAvailable` additionally requires Gemini
and a configured image key; `jewelleryContract` identifies its adapter. Consumers
must not advertise generation from the catalogue flag alone.
No face photos, descriptors, provider credentials or AI outputs are added by J1.

## Verification

`tests/jewellery.test.js` covers all types, view boundaries, strict validation,
title hints, legacy migration, persistence, category isolation, no-charge
matching, access controls, feature-off behaviour, shared masters, combined
capacity and rejecting jewellery from clothing generation/Shopify shoppers.
`tests/browser/jewellery.spec.js` covers mobile upload, metadata, edits, filters,
view hints, staff read-only behaviour, deletion and the disabled feature.
Tests use synthetic product photos and local servers; no paid provider or live
store service is called. Docker deployment and jewellery visual fidelity are
not verified by these catalogue tests.
