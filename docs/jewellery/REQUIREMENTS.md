# Forme — Jewellery Try-On: Requirements

As of 2026-10-30 · Baseline: `main` web **0.15.0** · Stage: **later** (after commercial release R1) · Design: [`DESIGN.md`](DESIGN.md) · Build steps: [`IMPLEMENTATION_LLM.md`](IMPLEMENTATION_LLM.md)

## 1. Purpose

Let jewellery store staff show a customer wearing a piece of jewellery — earrings, necklaces, nose pins, rings, bangles, bridal sets — on the customer's own avatar, quickly and convincingly, without the customer handling every piece. This document defines what the jewellery feature must do and why it is different from clothing try-on.

## 2. Why jewellery needs its own design

| Clothing try-on today | Jewellery needs |
| --- | --- |
| Full-body 2:3 avatar, face ≈ 15 % of the image height | Earrings, nose pins and pendants need a **close-up**; on the full-body avatar an earring is a few pixels |
| Approximate garment look is acceptable | Design fidelity matters: stone count, motif, metal colour; jewellery is high value |
| Size from height and weight | Real-world scale: chain length, earring drop, bangle and ring size |
| Garment covers a body region | Pieces sit on precise anatomy: earlobes, nostril side, neck base, fingers, wrists, forehead parting |
| One item at a time, stacked | Sets: necklace + earrings + maang tikka worn together, often bridal |

## 3. Users and segments

| Segment | Example | Value |
| --- | --- | --- |
| A. Local and regional jewellers (gold, diamond, silver) | Family-run showrooms in Bangalore | Show more designs per visit, especially pieces not in stock at that branch |
| B. Bridal jewellery and ethnic stores (incl. imitation / temple jewellery) | Bridal set shops | Full bridal look with saree/lehenga on the same avatar |
| C. Chains with large catalogues | Multi-branch jewellers | Show catalogue items held at other branches or made to order |
| D. Clothing stores already using Forme | Ethnic wear stores | Accessorise a look; upsell imitation jewellery |

Users are **store staff**, as in the current product. Shopper self-service is out of scope.

## 4. Jewellery types

| Type | View | Placement notes |
| --- | --- | --- |
| Stud earrings | Portrait | Both lobes, matched pair |
| Drop / jhumka / chandbali earrings | Portrait | Both lobes; drop length matters; may rest on jaw/neck |
| Nose pin / nose ring (nath) | Portrait | Left or right nostril (staff chooses); nath chain to ear optional |
| Maang tikka / matha patti | Portrait | Hair parting and forehead; does not change hairstyle beyond the parting |
| Choker | Portrait | Close to neck base |
| Pendant / chain / necklace | Portrait (≤ 50 cm), Full body (> 50 cm) | Length from catalogue sets where it falls |
| Long haar / rani haar | Full body | Falls to chest or below |
| Mangalsutra | Portrait or full body by length | Treated as a necklace; no other marital symbols added |
| Ring | Hands | Chosen finger and hand |
| Bangles / kada / bracelet | Hands | One or both wrists; count from catalogue (e.g. set of 4) |
| Watch | Hands | Wrist; dial orientation |
| Waist belt (kamarbandh / oddiyanam) | Full body | Over the current outfit |
| Anklets (payal) / toe rings | Full body | Both feet visible required |
| Set | Mixed | Several catalogue items applied together, each in its own view |

## 5. Functional requirements

Priority: **P0** first jewellery release · **P1** soon after · **P2** later.

### J-A — Avatar views

| ID | Requirement | Priority |
| --- | --- | --- |
| JA-1 | Each saved avatar can have up to three views: **Full body** (existing), **Portrait** (head to upper chest, high resolution), **Hands** (both hands, palms down, wrists visible). | P0 |
| JA-2 | Portrait view is generated from the customer's face photo captured with consent (at avatar creation or later); one paid generation; reused for every jewellery try-on afterwards. | P0 |
| JA-3 | Portrait capture guidance: face forward, ears visible, hair tucked behind ears if the customer agrees, neck and collarbone visible, neutral neckline. | P0 |
| JA-4 | Hands view uses a standard hand template matching the avatar's complexion tone; optional customer hand photo for higher realism. | P0 template, P1 customer photo |
| JA-5 | Views are stored with the avatar in the store account and deleted with it. | P0 |
| JA-6 | Portrait and hands views keep the same skin tone as the full-body avatar (staff can confirm or adjust tone). | P0 |

### J-B — Jewellery catalogue

| ID | Requirement | Priority |
| --- | --- | --- |
| JB-1 | Catalogue items of category **jewellery** with type (§4), metal (yellow gold, rose gold, white gold, silver, platinum, oxidised, imitation), purity (e.g. 22K, 18K, 925), stones, weight (g), SKU, price or price formula, product URL, photos. | P0 |
| JB-2 | Real-world dimensions: necklace/chain length (cm), earring drop length (mm), pendant height (mm), bangle size (Indian sizes 2.2, 2.4, 2.6, 2.8, 2.10, 2.12), ring size (Indian 1–30). | P0 |
| JB-3 | Product photo from upload, product link (existing reader) or catalogue import. Photos on plain background preferred; staff pick the clearest one. | P0 |
| JB-4 | Optional transparent PNG cut-out per item for the no-AI overlay mode. | P1 |
| JB-5 | Variants: metal colour and stone colour variants of the same design linked together. | P1 |
| JB-6 | HUID / hallmark field shown on the catalogue item (display only). | P2 |
| JB-7 | Price from daily metal rate: weight × rate + making charge + stones + GST, with the rate entered by the store each day. | P2 |

### J-C — Try-on

| ID | Requirement | Priority |
| --- | --- | --- |
| JC-1 | Staff choose an avatar, a catalogue item (or upload/link), and the app selects the correct view automatically from the type and length; staff can override. | P0 |
| JC-2 | **AI mode**: one paid request places the piece realistically (scale, perspective, shadows, reflections, skin contact), on the chosen view. | P0 |
| JC-3 | The AI must not change face, identity, skin tone, hairstyle (except the parting for maang tikka), makeup, expression, clothing, or add jewellery that was not requested. | P0 |
| JC-4 | Existing jewellery on the avatar is kept unless staff choose **Replace existing** for that region. | P0 |
| JC-5 | Pairs (earrings) are placed on both sides; single items (nose pin) on the side chosen. | P0 |
| JC-6 | Scale follows catalogue dimensions; a scale note is shown ("45 cm chain — princess length"). | P0 |
| JC-7 | **Overlay mode** (no AI, free, instant): place a transparent PNG on detected anchor points (earlobes, nose side, neck base, wrist) with manual drag, scale and rotate. | P1 |
| JC-8 | Build sets: apply several items in sequence; each result becomes the base for the next; undo per item without AI. | P0 |
| JC-9 | **Compare**: same design in two metal variants side by side (two try-ons). | P1 |
| JC-10 | **Complete look**: combine the portrait jewellery result with the full-body outfit result in one shareable image (portrait inset on full body). | P1 |
| JC-11 | Approved results are reusable with no charge for the same avatar view, starting state and item (existing adaptation reuse rules). | P0 |
| JC-12 | Every result is labelled "AI preview — actual piece may differ in detail" on screen, downloads and share pages. | P0 |

### J-D — Quality checks

| ID | Requirement | Priority |
| --- | --- | --- |
| JD-1 | Reject results without exactly one face (portrait) or without two hands (hands view). | P0 |
| JD-2 | Reject portrait results where the face no longer matches the customer (face-descriptor distance above threshold). | P0 |
| JD-3 | Staff must review and approve before save, share or download (existing flow). | P0 |
| JD-4 | Rejected results due to checks are refunded (no credit charged) once metering exists. | P0 |

### J-E — Sizing help

| ID | Requirement | Priority |
| --- | --- | --- |
| JE-1 | Necklace length guide on the portrait/full view (choker, princess, matinee, opera). | P1 |
| JE-2 | Ring size from finger circumference (mm) or an existing ring's inner diameter; bangle size from hand circumference; stored on the customer profile. | P2 |
| JE-3 | Suggested ring/bangle size shown next to the item; never blocks a try-on. | P2 |

### J-F — Sharing and selling

| ID | Requirement | Priority |
| --- | --- | --- |
| JF-1 | Share look (portrait, hands or complete look) via the existing share link and WhatsApp flows, with item names, metal, purity and price (if the store enables price display). | P0 (after commercial C8) |
| JF-2 | Jewellery store branding and a stronger watermark option to protect unreleased designs. | P1 |
| JF-3 | Analytics events for jewellery try-ons, sets, compares, purchases. | P1 |

## 6. Non-functional requirements

| ID | Requirement |
| --- | --- |
| JN-1 | Portrait view ≥ 1024 × 1365 px (3:4); hands view ≥ 1024 × 1024 px; portrait resolution at least 2.5 px per real-world mm (a 10 mm stud ≈ 25 px). |
| JN-2 | One AI request per jewellery item in AI mode; 0 in overlay mode and reuse. |
| JN-3 | Face and hand photos follow existing consent, in-memory processing and DPDP erasure rules; portrait views are customer data. |
| JN-4 | Catalogue photos of unreleased designs stay private to the store; share pages show only approved results. |
| JN-5 | Works on a store tablet; pinch-zoom on results to inspect detail. |
| JN-6 | No new paid provider beyond Gemini for P0; the adapter keeps a provider interface for a later dedicated model. |

## 7. Pricing (to validate)

| Offer | Idea |
| --- | --- |
| Jewellery plan | ₹7,999 / month: 1 store, 10 staff, 1,000 credits, portrait and hands views, overlay mode, sets, compare |
| Add-on for clothing stores | ₹1,499 / month on Growth or Chain: jewellery types and views, shares the store's credits |
| Credits | Same credit rules as commercial plans; a portrait or hands view costs 1 credit once per customer |

## 8. Success metrics (pilot with 3 jewellers, 60 days)

| Metric | Target |
| --- | --- |
| Staff rate placement "correct" | ≥ 85 % of reviewed AI results |
| Design fidelity rated "recognisably the same piece" | ≥ 80 % |
| Identity check false rejects | ≤ 5 % |
| Pieces shown per customer visit | +50 % vs before |
| Shared looks per day per store | ≥ 10 |

## 9. Out of scope

- Exact gem, cut or carat rendering guarantees; certification of appearance.
- 3D or AR live camera try-on (possible later with a separate engine).
- Shopper self-service.
- Automatic background removal of product photos (P1 overlay requires a store-supplied PNG; automatic cut-out is a later item).

## 10. Dependencies and open decisions

- Depends on commercial **C1–C8** (stores, staff, credits, customers, share links). The jewellery release can ship earlier with the current per-IP limits if needed, but billing should come first.
- Decide whether portrait capture becomes part of the default avatar flow for jewellery stores (one extra credit per customer).
- Validate the face-descriptor threshold on 50+ pilot portraits before enforcing rejections.
- Confirm whether nose-ring chains (nath to ear) and hair accessories need their own types.
