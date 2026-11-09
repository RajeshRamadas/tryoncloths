# Changelog

Release notes for the Forme web studio, newest first. Feature guides live in [docs/](docs/); the [README](README.md) describes what the app does today.

## Unreleased

- Jewellery cut-outs can now be made from a product photo on a plain backdrop (PNG,
  JPEG or WebP). The background is removed on the staff device with no AI credit,
  with a tolerance control and an option to clear ring holes and chain loops. See
  [automatic background removal](docs/JEWELLERY_OVERLAY.md#automatic-background-removal).

## 0.21.0-rc.3

Web `0.21.0-rc.3` adds [J14 customer hand photos](docs/CUSTOMER_HAND_PHOTOS.md):
upload/camera input, twelve photo-specific placement markers, one consented
Gemini cleanup credit, review/save and reuse for jewellery. Standard hands stay
free. Saved looks retain their own geometry after the base hands view changes.
Enabled through the existing jewellery pilot flag; live photo quality remains
subject to pilot review.

## 0.21.0-rc.2

Web `0.21.0-rc.2` adds [J13 jewellery analytics](docs/JEWELLERY_ANALYTICS.md).
With the jewellery pilot flag enabled, open **Analytics → Jewellery activity**
for AI/reuse/overlay fittings, sessions,
saved sets, complete/partial comparisons, purchase marks and shares. Date/store
filters and CSV exports retain existing owner/manager scope. Historical gaps
remain explicit, and the report does not certify live pilot targets.

## 0.21.0-rc.1

Web `0.21.0-rc.1` adds [J12 private jewellery evaluation](docs/JEWELLERY_EVALUATION.md):
a 30-item × 10-portrait review matrix, local staff scoring, identity-distance
analysis and store-pilot reporting. Start with `npm run evaluate:jewellery -- template --out path/to/manifest.json`.
The [staff workflow](docs/JEWELLERY_TRYON.md) covers capture, setup and limits;
[release checks](docs/JEWELLERY_RELEASE.md) separate automated verification from
pending live pilot evidence. No paid calls, deployment, flag activation or APK
build is performed by these offline tools. General rollout remains pending.

## 0.20.0-alpha.11

Web `0.20.0-alpha.11` adds [J11 optional jewellery sizing](docs/JEWELLERY_SIZING.md).
Store finger/hand measurements and known ring/bangle sizes on customer profiles.
The Jewellery studio shows confidence-labelled size suggestions beside rings
and bangles, plus free portrait/full-body necklace length guides. Guidance never
changes the product size or blocks try-on, and uses no AI credits.

## 0.20.0-alpha.10

Web `0.20.0-alpha.10` adds [J10 jewellery comparisons and complete looks](docs/JEWELLERY_COMPARE_COMPLETE.md).
Link metal/colour variants in the catalogue, check the comparison cost, then
compare two designs on the same saved view. Approved exact variants reuse free.
Combine a saved outfit and jewellery portrait in **Complete look**, then save,
reopen, export and share the board without another AI request.

## 0.20.0-alpha.9

Web `0.20.0-alpha.9` adds [J9 free jewellery overlays](docs/JEWELLERY_OVERLAY.md).
Owners/managers attach transparent PNG cut-outs in **Jewellery catalogue**.
Staff choose **Overlay · free** in the Jewellery studio to drag, pinch, scale,
rotate and mirror pieces on saved avatar views. Reviewed looks save, reopen,
export and share with an **Overlay preview** label, without Gemini or AI credits.
The jewellery pilot flag and account sign-in are still required.

## 0.20.0-alpha.8

Web `0.20.0-alpha.8` adds the [J8 jewellery studio](docs/JEWELLERY_STUDIO.md).
Open and approve a saved avatar, then choose **Jewellery** beside **Try clothes**.
Prepare reusable views, select catalogue/link/upload items, set placement, stack
and undo pieces, review and save a look, then download/share labelled results.
Saved looks and exact approved adaptations reopen without new AI requests.
[Screen captures with dummy data](docs/testing/jewellery-studio/README.md).

## 0.20.0-alpha.7

Web `0.20.0-alpha.7` adds the [J7 jewellery try-on API](docs/JEWELLERY_API.md):
account-scoped generation, explicit consent, one-credit metering, refunds on
failed checks and free reuse of reviewed, saved results for the exact same
starting view, item and placement. Enable `TRYON_JEWELLERY=1` with account
storage and Gemini configuration to expose the API; the interactive jewellery
studio screen is the next task, J8.

## 0.20.0-alpha.6

Web `0.20.0-alpha.6` adds the internal [J6 jewellery try-on adapter](docs/JEWELLERY_TRYON.md):
type-specific placement and approximate size cues, an optional second product
angle, and face, identity, framing and hand-retention checks. The public route,
credit/refund integration and adaptation reuse follow in J7; the jewellery
try-on screen follows in J8. This update adds no public paid-generation action.

## 0.20.0-alpha.5

Web `0.20.0-alpha.5` adds [J5 saved avatar views](docs/AVATAR_VIEWS.md).
With account storage and `TRYON_JEWELLERY=1`, open **Saved avatars → Manage views**
to create a one-credit Gemini portrait or free sample hands, review and save it,
then reuse it from the same store account. Jewellery try-on remains pending.

## 0.20.0-alpha.4

Web `0.20.0-alpha.4` adds the internal [J4 portrait-generation adapter](docs/JEWELLERY_PORTRAITS.md)
with face, framing and identity checks. Account routes, approval and storage follow in J5;
no new generation screen or live paid request is added by this update.

## 0.20.0-alpha.3

Web `0.20.0-alpha.3` adds [J3 hands templates and anchors](docs/JEWELLERY_HANDS.md):
12 static male/female hand references across six tones, ready for later jewellery
views. Selecting these assets uses no AI credits; the interactive hands flow is pending.

## 0.20.0-alpha.2

Web `0.20.0-alpha.2` adds the internal [J2 local face comparison helper](docs/JEWELLERY_IDENTITY.md)
for future jewellery checks. Descriptors stay in memory; pilot threshold calibration
and public generation-route integration are still pending.

## 0.20.0-alpha.1

Web `0.20.0-alpha.1` adds the optional [J1 jewellery catalogue](docs/JEWELLERY_CATALOGUE.md):
18 jewellery types, product photos, metals, dimensions and reusable store inventory.
Enable `TRYON_JEWELLERY=1` with account storage, then open **Catalogue → Jewellery catalogue**.
Jewellery try-on and portrait/hands views remain later work; catalogue actions use no AI credits.

## 0.19.0 alphas — shopper self-service

The shopper **Try it on me** Shopify widget has an
[approved staged design](docs/commercial/SHOPPER_SELF_SERVICE_DESIGN.md).
Web `0.19.0-alpha.1` adds [shopper spending controls](docs/SHOPPER_SPENDING.md):
owner monthly allowances, durable attempt/credit accounting, manager usage and
immediate pause. Web `0.19.0-alpha.2` adds [Shopify app installation and signed
setup launches](docs/SHOPIFY_SHOPPER.md). Open **Shopper spending → Shopify widget**
after signing in. Web `0.19.0-alpha.3` adds [optional temporary shopper sessions
and guards](docs/SHOPPER_SESSIONS.md). Web `0.19.0-alpha.4` adds the
[hosted photo, review and try-on flow](docs/SHOPPER_WORKFLOW.md). It is disabled
by default and requires configured safety adapters and reviewed disclosure;
otherwise the button opens a setup/session preview without photo generation.
Web `0.19.0-alpha.5` adds [C16.5.1 setup and readiness tooling](docs/SHOPPER_LAUNCH.md),
including optional Turnstile and a read-only configuration mount. Live
service/legal/cost and rollout evidence remain C16.5; no live pilot is approved.
Web `0.19.0-alpha.6` adds [C16.5.2 optional Gemini safety review](docs/SHOPPER_GEMINI_SAFETY.md).
This is fallible image eligibility assessment, not verified age or identity.

## 0.16.0-alpha.6 — C6 owner billing and store usage

Web `0.16.0-alpha.6` adds [checkout, invoice downloads, usage reports and operator billing tools](docs/BILLING.md).
New accounts receive a 14-day, 30-credit trial; existing pilots retain their credits.
Owners use Billing, owners/managers use Usage, and all staff see remaining credits.
Live Razorpay and SMTP verification is still required before selling subscriptions.

## 0.16.0-alpha.5 — C5 payments backend

Web `0.16.0-alpha.5` adds [Razorpay orders, subscriptions and GST invoices](docs/PAYMENTS.md),
verified captured-payment credit grants, idempotent webhooks and invoice email
retry. Existing pilots work without payment credentials. The checkout UI is available in C6 below; configure and validate Razorpay test mode before enabling live payments.

## 0.16.0-alpha.4 — C4 credit metering

Web `0.16.0-alpha.4` adds [C4 credit metering](docs/CREDITS.md): one credit per
successful account-backed AI generation, refunds on failure, duplicate-request
protection, trial marks on new images and an owner credit-balance page. Approved
reuse remains free. Existing pilot organisations receive a one-time grant of
1000 AI credits by default. Generation requests now require a UUID v4 requestId;
use the updated web client (the older APK has not been rebuilt).

This builds on [C3 staff invitations](docs/STAFF_INVITES.md),
[C2 user sessions and store roles](docs/USER_SESSIONS.md), and
[C1 tenancy migration](docs/TENANCY_MIGRATION.md). Existing owners keep their login
and saved data. SMTP setup is needed for staff invitation emails. Payments,
subscriptions and invoices follow in C5; commercial R1 is not complete yet.

## 0.14 — my store clothes

Save product photos, categories, links and variants to your store account, then
select them for any customer from **My store clothes**. Duplicate photos/links
reuse the saved garment; similar photos are suggestions for staff to confirm.
After reviewing an adaptation, save it for automatic reuse on the exact same
avatar and starting outfit with **no new AI charge**. Different avatars/outfits
still need a new adaptation. See [catalogue, matching and deployment](docs/GARMENT_CATALOGUE.md).

## 0.13 — release validation

Operators can run a fixed 20-product-link benchmark with `npm run benchmark:links`,
and prepare a private image-review page with `npm run evaluate:quality`. The review
compares avatar/garment references with provider outputs, scores face and skin-tone
fidelity, proportions, neck joins and clothing, and reports failures, measured cost
and latency. It supports imported dedicated-provider results for evaluation; Gemini
remains active. Neither tool makes paid AI calls. See [instructions and examples](docs/RELEASE_VALIDATION.md).

Live rollout checks remain outstanding; female profiles and the browser worker are
still opt-in pilots. This is a web/operator-tool update; the APK is unchanged.

## 0.12

Reviewed outfits can be saved under customer avatars and reopened from the store account. Undo restores previous sample layers, and failed try-on requests require fresh consent. The [female body library](docs/FEMALE_PROFILES.md) and [isolated browser reader](docs/BROWSER_LINK_READER.md) are optional pilots, disabled by default pending live validation. No Android APK was rebuilt.
