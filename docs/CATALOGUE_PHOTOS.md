# AI catalogue photos — C13

Web `0.18.0-alpha.2` adds **Catalogue photos** for owners and managers. Select saved
store products, an adult standard model/body profile and complexion, one or both
poses, and export formats. A batch supports **50 product/pose combinations**.
Formats reuse the same generated pixels and do not add AI calls. No APK rebuild
is needed.

The inputs are the selected catalogue product photo and a prepared standard
model. Customer photos, customer measurements and saved customer avatars are
not used. The separate `catalogue` prompt requests a natural full-body marketing
photo with faithful garment details, the selected front/three-quarter pose and
a plain white studio backdrop. The existing customer try-on prompt is unchanged.

## Use the web workflow

1. Sign into the correct store as an owner or manager and open **Catalogue photos**.
2. Add products to Catalogue first. Confirm any unmapped clothing types there.
   Read-only Chain master products can be selected; generated assets stay in the
   receiving store, without sharing customer data or adaptation results.
3. Select products across catalogue pages, a standard model/complexion and poses.
   Female models follow the existing `TRYON_FEMALE_PROFILES` server setting.
4. Choose square **1:1**, portrait **4:5**, portrait **3:4**, and/or **White studio
   2:3** exports. Confirm sending the selected products/templates to Gemini and
   the displayed photo-credit reservation, then queue the batch.
5. Leave the page if needed. Open the job later under **Saved photo jobs**. The
   selected job polls while processing; Refresh updates its stored state.
6. Inspect the garment, face, body, hands, drape, background and framing. Reject
   an unsuitable result before explicitly requesting regeneration, or approve it
   to charge its base photo credit and unlock downloads.
7. Download individual JPEG formats or a ZIP containing only approved items.
   Download the assets before deleting a job.

Previews are watermarked and limited to 480 × 720. Full-resolution files require
approval. Generated quality remains variable; approval is a human judgement, not
an identity/fit certification. The provider's face-presence check still rejects
headless outputs. Catalogue generation has no automatic provider retries.

## Photo credits and purchases

Photo credits are a separate ledger pool from avatar/try-on credits. Purchase
them in **Billing → Catalogue photo credits**, using the existing verified
Razorpay flow and invoice details:

| Pack | Before GST | Including 18% GST |
| --- | --- | --- |
| 1 photo credit | ₹99 | ₹116.82 |
| 50 photo credits | ₹3,450 (₹69 each) | ₹4,071 |

The server chooses the price and credit amount. Callback and signed-webhook
replays cannot grant the pack twice. Invoice descriptions identify photo credits.
A trial buyer purchasing a photo pack becomes a **photo-only** account, without
creating a subscription. Existing AI balances remain recorded but cannot be used
until the owner subscribes to a try-on plan. Existing paid/pilot plans are kept
when buying photo credits. Prepaid photo use does not depend on an active try-on
subscription; suspended organisations remain blocked.

Charging rules:

- A new job reserves **one photo credit per product/pose**, atomically. Insufficient
  balance rolls back the entire job and all new reservations. The base credit is
  committed only when the result is approved, once per item.
- Each item includes **one successful regeneration**. It reuses the original base
  entitlement, whether approval already happened or is still pending.
- Further successful regenerations charge **one extra photo credit each** when
  the new preview is ready, including previews later rejected. This is additional
  to the base credit on approval. The UI requires a fresh, explicit cost
  confirmation before each manual retry; it cannot silently switch a free retry
  into a paid retry.
- Failed attempts refund unsettled base/extra reservations. Previously committed
  approvals and successful extra regenerations stay charged. If processing failed
  after raw pixels were saved, reprocessing uses those pixels without another AI
  call; any applicable base/extra reservation is shown again before reprocessing.
- Review/reservation time is **7 days from job creation**. Expired unfinished
  items are cancelled and unsettled credits refunded. Approval already committed
  and previously successful paid regenerations are not refunded by expiry.
- Cancelling unfinished work also refunds unsettled reservations; approved files
  remain downloadable. Deleting a job removes its snapshots, attempts and outputs.
  A provider request already sent may still incur an external provider charge
  after a timeout, cancellation or interruption, even when app credits refund.

Photo reservations are excluded from the generic ten-minute stale-credit sweep
while the job/review is valid. Holds, commits and refunds all use the existing
immutable credit ledger. Analytics records successful catalogue previews and
committed photo-credit usage separately; included regenerations can therefore
increase preview counts without increasing credit use.

## Formats and provenance

Exports are JPEG quality 90, padded with white to preserve the complete model
and garment rather than cropping feet or stretching the person:

| Format | Pixels |
| --- | --- |
| 1:1 | 1024 × 1024 |
| 4:5 | 1024 × 1280 |
| 3:4 | 960 × 1280 |
| White studio 2:3 | 1024 × 1536 |

The white backdrop is requested from Gemini; white padding does not segment or
replace a background the provider rendered incorrectly. Reject such output if
it does not meet the store's requirements. Trial outputs retain the existing
Forme trial watermark.

Every approved JPEG contains IPTC XMP `DigitalSourceType` with the value
`http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`.
Filenames follow `<sku>-ai-model-<format>.jpg`; missing SKUs fall back to the product
name. Filenames are sanitized. The streamed ZIP uses item/pose directories to
avoid duplicate SKU filenames; JPEGs are stored without redundant compression.
Metadata can be stripped by other platforms, so retain appropriate AI disclosure
when publishing.

## Queue, recovery and access

The in-process worker runs only in production (`node server/index.js --production`).
The API application itself does not start generation on construction. Production
wakes the durable queue every two seconds and after explicit queue actions.
SQLite leases allow **one active catalogue item per organisation and two globally**
across workers sharing this database. A store may keep 100 jobs; an organisation
may have up to 200 open items. Download/delete old jobs to free retained-job slots.

Pending items resume after a restart. A worker lease lasts five minutes, longer
than the provider request timeout. An interrupted request without saved raw pixels
becomes **unknown** after lease expiry, with unsettled credits refunded; it is
never automatically submitted again. When raw pixels were saved, local processing
can resume after lease expiry without a second generation. A key/configuration
removed from the server pauses pending work until restored. Review expiry/refunds
continue while the production worker is running.

The worker rechecks membership, organisation status, product availability and its
lease before publishing. A cancelled/deleted job cannot publish a late provider
result. Disabling a model library prevents pending generation with that library.
Provider errors are sanitized; keys, response bodies and product pixels are not
written to event references or error logs.

Owners/managers can manage only jobs in their active store. Staff, anonymous
users and other stores cannot read job metadata, previews, files or ZIPs, or
create/review/retry/cancel/delete jobs. Mutations require same-origin checks.
Creation request IDs prevent duplicate reservations after an interrupted browser
response. Raw model/product snapshots and generated images remain in the live
database until job deletion; review expiry refunds credits but does not purge all
history automatically. Existing backup-retention policies still apply.

## Setup, API and verification

Use the existing server-side Gemini settings (`TRYON_PROVIDER=gemini`,
`TRYON_GEMINI_API_KEY`, `TRYON_GEMINI_MODEL`) and persistent account database. There
is no new provider key and no automatic switch to OpenAI. Configure Razorpay and
transactional email as described in [payments](PAYMENTS.md) for actual purchases;
an operator can also grant photo credits through the existing billing CLI.

Routes under `/api/photo-jobs` include config/list/create, job retrieval, item
review/retry, watermarked preview, approved JPEG download, approved ZIP download,
cancel and delete. Creation accepts
`{requestId,garmentIds,model:{profileId,tone},poses,formats,generationConsent:true,maxCredits}`.
The item retry endpoint accepts a fresh request ID, generation consent and the
server-quoted `maxCredits`; review accepts `{approved:true|false}`. The initial
batch limit counts product/pose combinations, not export formats.

Tests use mocked Gemini, Razorpay and email. They verify separate credit pools,
approval charging, free/paid regenerations, failed-attempt refunds, atomic batch
creation, sweeper/lease behaviour, restart recovery, roles/store boundaries,
render dimensions/XMP, valid ZIPs, photo-only payments and mobile review/downloads.
No real provider images, payments or emails were created by these tests. Live
catalogue image fidelity, model/pose quality, Gemini quota and payment delivery
remain to be verified with your configured accounts after deployment.

Update the existing Lightsail web container:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Codex has not deployed this update or built an APK.
[C15 — Store branding](STORE_BRANDING.md) is now implemented. The next outlined
task is C16 shopper self-service design review.
