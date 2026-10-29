# Forme — Commercial Features: Sales Requirements

As of 2026-10-30 · Baseline: `main` web **0.15.0**

## 1. Purpose

Turn Forme from a single-store pilot into a paid product that clothing retailers subscribe to. This document defines **what we sell, to whom, at what price, and which features must exist to charge for it**. Design: [`DESIGN.md`](DESIGN.md). Build steps for a coding LLM: [`IMPLEMENTATION_LLM.md`](IMPLEMENTATION_LLM.md).

## 2. What already exists (no new work to sell)

| Capability | Since | Sales value |
| --- | --- | --- |
| Customer avatar from face + body photo, 4 male + 4 female bodies, 48 complexion templates | 0.4–0.15 | Core demo |
| Try clothes from any product link or uploaded photo (Gemini) | 0.9 | "Any garment, any shop" |
| Ethnic and women's types: saree, lehenga, blouse, dress, skirt, kurta | 0.11 | Wedding / ethnic stores |
| Store account, saved avatars, saved looks | 0.8–0.10 | Repeat customers |
| Store garment catalogue (save photo once, reuse for every customer) | 0.14 | Store's own SKUs |
| Approved adaptation reuse with no AI charge | 0.14 | Lower cost per customer |
| Isolated browser reader for hard retailer pages (opt-in) | 0.12 | Higher link success |
| Quality review and provider comparison tools | 0.13 | Quality evidence for sales |

**Gap:** there is no way to bill, no staff logins, one store per account, no sharing to customers, no catalogue import, no reporting. Stores will not pay without these.

## 3. Target customers

| Segment | Example | Pain | First offer |
| --- | --- | --- | --- |
| A. Men's wear and ethnic stores (1–3 outlets), Bangalore | Shirt, kurta, sherwani stores | Trial-room queues, customers leave undecided | Starter → Growth |
| B. Wedding and ethnic women's wear | Saree, lehenga boutiques | Customers want to see many pieces; heavy items are slow to try | Growth + occasion pack |
| C. Small chains / franchises (4–20 outlets) | Regional apparel chains | No visibility into what sells; staff consistency | Chain |
| D. Small D2C brands and boutiques | Instagram-first labels | Costly photoshoots for every new design | Catalogue-photo credits only |

Primary pilot target: **segments A and B in Bangalore**. Segment D is a parallel, low-touch revenue line.

## 4. Plans and pricing (to validate in pilot)

Indicative INR prices excluding GST. A Gemini image costs roughly ₹3–4; every price below must keep gross margin above 60 % after provider cost.

| Plan | Monthly | Includes | Overage |
| --- | --- | --- | --- |
| Free trial | ₹0 for 14 days | 1 store, 2 staff, 30 AI credits, watermark on exports | Upgrade required |
| Starter | ₹1,999 | 1 store, 3 staff, 300 AI credits, link try-on, catalogue (500 items), WhatsApp share link | ₹8 / credit |
| Growth | ₹5,999 | 1 store, 10 staff, 1,000 credits, catalogue import, WhatsApp lookbook, size help, basic analytics, no watermark | ₹6 / credit |
| Chain | from ₹14,999 | Multiple stores, unlimited staff, 3,000 pooled credits, chain analytics, branding, priority support | ₹5 / credit |
| Catalogue photos (add-on or stand-alone) | Pay as you go | Garment → standard model image, 2 angles, web/Instagram sizes | ₹99 per image, packs of 50 at ₹69 |
| Credit packs | One-time | 100 / 500 / 2,000 credits | ₹900 / ₹4,000 / ₹14,000 |

**Credit rules.** 1 credit = 1 paid AI generation (avatar or try-on). Reusing an approved adaptation, opening saved looks, sample overlays and link reading cost 0 credits. Failed provider calls that return no image are refunded automatically. Annual plans: 2 months free.

## 5. Features to build

Priority: **P0** needed to charge at all · **P1** needed for Growth/Chain value · **P2** later.

### C1 — Plans, credits and billing (P0)

| ID | Requirement |
| --- | --- |
| C1-1 | Every store organisation has one plan, a billing period and a credit balance. |
| C1-2 | Paid AI routes deduct 1 credit only when an image is returned; failures are refunded. |
| C1-3 | When credits are 0, paid actions are blocked with a clear "Buy credits or upgrade" message; free actions keep working. |
| C1-4 | Owners subscribe and buy credit packs in INR via Razorpay (UPI, cards, net banking). |
| C1-5 | GST-compliant invoices (GSTIN capture, invoice PDF and email). |
| C1-6 | 14-day free trial with 30 credits and watermark; no card needed to start. |
| C1-7 | Usage page: credits used per day, per staff member and per type. |
| C1-8 | Platform admin (us) can grant credits, extend trials and suspend accounts. |

### C2 — Staff logins, roles and multiple stores (P0)

| ID | Requirement |
| --- | --- |
| C2-1 | An organisation has stores; each store has staff accounts with their own login. |
| C2-2 | Roles: **Owner** (billing, stores, staff), **Manager** (catalogue, reports for their store), **Staff** (customers, try-on). |
| C2-3 | Owners invite staff by email or phone; staff can be disabled instantly. |
| C2-4 | Customers, avatars, looks and catalogue belong to a store; chain owners can share a catalogue across stores. |
| C2-5 | Existing single store accounts migrate automatically: account → organisation + one store + owner. |
| C2-6 | Every paid action records which staff member did it. |

### C3 — Customer profiles and WhatsApp lookbook (P0 share link, P1 lookbook)

| ID | Requirement |
| --- | --- |
| C3-1 | Customer profile: name, mobile number, optional notes; links all their avatars and looks. |
| C3-2 | Find a returning customer by mobile number in under 5 seconds. |
| C3-3 | **Share look**: a private web link showing the look, product names, prices and the store's contact / "visit store" button; expires after 30 days by default. |
| C3-4 | One tap opens WhatsApp with the share link pre-filled (works with no API setup). |
| C3-5 | (P1) WhatsApp Business Cloud API: send lookbooks and new-arrival messages from the store's number using approved templates. |
| C3-6 | Marketing messages only to customers with recorded opt-in; one-tap opt-out honoured immediately. |
| C3-7 | (P1) "New arrivals on you": pick catalogue items, generate on selected opted-in customers (uses credits), send as a lookbook. |

### C4 — Catalogue import and sync (P1)

| ID | Requirement |
| --- | --- |
| C4-1 | Catalogue items gain price, MRP, sizes, colour, stock status, SKU and product URL. |
| C4-2 | Bulk import from CSV/Excel with photo URLs; validation report of rejected rows. |
| C4-3 | Connect Shopify or WooCommerce with a read-only key; nightly sync of products, prices and stock. |
| C4-4 | Out-of-stock items are hidden from staff by default. |
| C4-5 | Chain plan: one master catalogue shared by all stores. |

### C5 — Size recommendation (P1)

| ID | Requirement |
| --- | --- |
| C5-1 | Stores enter size charts per brand and garment type (chest, waist, hip, length, shoe size). |
| C5-2 | Customers can add optional measurements (chest, waist, hip, inseam, shoe size) to their profile. |
| C5-3 | Show a suggested size with a confidence (High / Medium / Low) and the reason; never block a sale on it. |
| C5-4 | Staff can record the size the customer actually bought, to improve suggestions. |

### C6 — AI catalogue photos (P1, also sold stand-alone)

| ID | Requirement |
| --- | --- |
| C6-1 | Choose catalogue items and a standard model (body type, complexion); generate on-model images. No customer photo involved. |
| C6-2 | Outputs: front image, plus optional second pose; sizes for website (4:5), Instagram (1:1, 4:5) and marketplaces (3:4, white background). |
| C6-3 | Batch up to 50 items per job with progress; billed per approved image from a separate photo-credit balance. |
| C6-4 | Regenerate once free if rejected at review. |
| C6-5 | Images are labelled AI-generated in file metadata and download names. |

### C7 — Analytics (P1)

| ID | Requirement |
| --- | --- |
| C7-1 | Dashboard per store and chain: customers served, try-ons, looks saved, shares, credits used. |
| C7-2 | Top tried products and categories; tried-but-not-bought list. |
| C7-3 | Staff can mark a look as **Purchased** (with size); conversion rate per product and per staff member. |
| C7-4 | Monthly report email to the owner; CSV export. |

### C8 — Branding (P1 for Chain)

| ID | Requirement |
| --- | --- |
| C8-1 | Store logo, colours and contact details on share pages, downloads and lookbooks. |
| C8-2 | Watermark: Forme watermark on trial; store watermark optional on paid plans. |

### C9 — Shopper self-service plugin (P2)

| ID | Requirement |
| --- | --- |
| C9-1 | "Try it on me" button for the store's website (Shopify app first). |
| C9-2 | Shopper consent, photo capture, per-use billing to the store, strong abuse limits. |

## 6. Non-functional requirements

| ID | Requirement |
| --- | --- |
| N-1 | Tenant isolation: no store can read another store's customers, catalogue, looks or usage. |
| N-2 | Billing correctness: every credit change is an immutable ledger entry; balance = sum of ledger. |
| N-3 | Payments: card data never touches our servers (Razorpay Checkout); webhooks verified by signature. |
| N-4 | India DPDP Act 2023: purpose-specific consent for photos and marketing; customer data deletion on request within 30 days; data stored in India (AWS Mumbai) for paid plans. |
| N-5 | WhatsApp: only Meta-approved templates outside the 24-hour window; opt-in evidence stored. |
| N-6 | Availability 99.5 % monthly for paid plans; daily encrypted database backup, 30-day retention. |
| N-7 | Secrets (Shopify/WooCommerce/WhatsApp tokens) encrypted at rest. |
| N-8 | Works on a ₹10k Android phone and a store tablet; pages usable on 3G. |

## 7. Success metrics (pilot, first 90 days)

| Metric | Target |
| --- | --- |
| Paying stores | 10 (from 25 trials) |
| Trial → paid conversion | ≥ 40 % |
| Try-ons per active store per week | ≥ 50 |
| Looks shared on WhatsApp | ≥ 30 % of saved looks |
| Marked purchases after try-on | ≥ 15 % of try-on sessions |
| Gross margin after AI cost | ≥ 60 % |
| Monthly store churn | ≤ 5 % |

## 8. Release plan

| Release | Contents | Enables |
| --- | --- | --- |
| R1 (sellable) | C1, C2, C3 share link + WhatsApp click-to-chat, watermark | Charge Starter |
| R2 (Growth) | C4 CSV import, C5, C7 basic, C3 Cloud API lookbook | Charge Growth |
| R3 (Chain + photos) | C4 Shopify/Woo sync, C6, C7 chain, C8 | Charge Chain, sell catalogue photos |
| R4 | C9 plugin | Online revenue |

## 9. Out of scope

- 3D body scanning, exact garment fit simulation.
- Our own payment gateway or wallet.
- Marketplace integrations that require seller-central write access (Amazon, Myntra listings).
- Android APK feature parity before R2 (web app is the sales vehicle).

## 10. Open decisions

- Final prices after 5 pilot store interviews.
- Whether trials need a phone OTP to limit abuse.
- WhatsApp: use the store's own WhatsApp Business number (preferred) or a shared Forme number.
