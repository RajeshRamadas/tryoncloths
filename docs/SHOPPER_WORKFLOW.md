# Hosted shopper workflow — C16.4

Web `0.19.0-alpha.4` implements the photo → body reference → avatar review →
product try-on → reviewed download flow from the
[approved C16 design](commercial/SHOPPER_SELF_SERVICE_DESIGN.md). It uses
[C16.2 verified Shopify launches](SHOPIFY_SHOPPER.md) and the
[C16.3 temporary session guards](SHOPPER_SESSIONS.md).

The feature is **off by default**. [C16.5.1](SHOPPER_LAUNCH.md) now supplies trusted
startup configuration loading, optional Turnstile and launch diagnostics. No
moderation adapter or legally reviewed disclosure is configured by default. It cannot
accept shopper photos until those dependencies are supplied. This increment
implements and tests the complete flow using mocked services; it does not launch
public paid generation. C16.5 is the live-service, legal, cost and rollout check.
[C16.5.2](SHOPPER_GEMINI_SAFETY.md) now provides optional Gemini safety review;
it is not enabled or verified by adding the implementation alone.

## What the shopper can do

1. Open **Try it on me** on an enabled Shopify product. The signed launch is
   exchanged for independent HttpOnly shopper cookies; the ticket disappears
   from the URL. No store login or mobile access code is requested.
2. Read the merchant identity, active provider, privacy contact/policy, provider
   terms, disclosed processing/retention, session expiry and merchant cost.
   Adult, own-photo and action-specific consent start **unchecked**.
3. Confirm consent and complete the configured verification. The server verifies
   the challenge before the photo inputs become available. A verification token
   typed into a text field is not offered as a CAPTCHA substitute.
4. Use **Choose face/body file** or the separate **Take face/body photo** actions.
   File selectors have no capture restriction. JPEG/PNG/WebP files are checked
   locally, rotated, resized and normalized; previews are browser Blob URLs.
   Selecting a file makes no photo upload or AI call. Invalid replacements keep
   the previous valid preview. Removing a photo revokes its Blob URL.
5. Enter approximate height and weight; correct the suggested body profile and
   template complexion. Four male profiles and six reference tones are available;
   the existing `TRYON_FEMALE_PROFILES=true` pilot adds four female profiles.
   Height/weight are an approximation, not a fit or medical measurement. The
   reference is labelled as a standard body, not a personalized result; final
   face and exposed skin tone follow the shopper's own photos automatically.
6. Select **Generate my avatar**. Only this explicit action sends both normalized
   photos and measurements. The server chooses the template itself and uses the
   existing Gemini adapter/prompt. It does not call the staff account-saving API.
7. Review the generated face, complexion, neck and proportions. Confirm the review
   checkbox and select **Approve avatar**. The server binds approval to the exact
   generated PNG hash. No sample or input reference is shown as a generated result.
8. Give separate consent/verification, then select **Try this product**. The server
   resolves the merchant garment; shoppers cannot supply a prompt, garment, URL,
   tenant id or staff adaptation. The approved avatar is reused, not regenerated.
9. Review the clothing result before downloading. A second successful try-on can
   use another eligible product from the same verified shop. Product selections
   are opaque session-bound capabilities. Changing products clears the previous
   outfit and invalidates earlier consent/verification, while keeping the exact
   approved avatar. The chooser offers the current product plus up to 49 other
   products from the first catalogue page; this is a bounded pilot chooser.
10. Download an approved avatar or reviewed outfit as a PNG, or return to the
    verified product page. Downloads add **AI preview — fit and details may differ**
    below the original image, without cropping/stretching it. The store name is
    added only when its existing paid export-footer setting is enabled.
11. **End shopper session** clears private browser state and revokes server access.
    The same clearing happens on expiry, store revocation, or page navigation.
    Provider work is cancelled when possible; a late result cannot restore an
    ended preview. Local downloads remain on the shopper's device.

Invalid images, failed/expired verification, pause/product changes, exhausted
allowances/credits, provider quota and timeout failures have explicit messages.
No generation, retry, provider fallback or cap increase is automatic. A deliberate
retry requires fresh unchecked consent, verification and a new request UUID. A
lost response can still represent a committed charge; reloading never recovers
images or sends a replacement generation.

## Server configuration and launch boundary

The optional Compose override passes both flags, which default to false:

```ini
TRYON_SHOPPER_SESSIONS=true
TRYON_SHOPPER_WORKFLOW=true
# Use the actual direct reverse-proxy peer; see the session guide:
TRYON_SHOPPER_PROXY_CIDRS=172.18.0.2/32
TRYON_SHOPPER_CONSENT_REVISION=your_reviewed_public_version
```

**Flags alone do not enable generation.** The existing Shopify credentials,
verified published products, active Growth/Chain plan, owner-configured monthly
allowances, AI balance, Gemini key and trusted proxy are also required. Staff
mobile tokens are not shopper credentials. No secret goes into the theme block,
browser script or disclosure.

Production service selection and reviewed policy remain C16.5 work. The normal
bootstrap can now load them from the trusted [C16.5.1 service module](SHOPPER_LAUNCH.md).
The server factory still accepts these configuration contracts:

```js
createApp({
  // Existing provider, account/Shopify and proxy settings also apply.
  shopperSessionOptions: {
    enabled: true,
    consentRevision: reviewedDisclosure.revision,
    captcha: reviewedCaptcha,       // { id, verify(...) }
    moderation: reviewedModeration, // { id, check(...) }
  },
  shopperWorkflowOptions: {
    enabled: true,
    disclosure: reviewedDisclosure,
    verificationClient: reviewedVerificationClient,
  },
});
```

This is an integration contract, not a working vendor configuration. There is no
test-service environment switch, permissive production verifier or generic
moderation bypass. Do not copy the test fixture adapters into a deployment.

`disclosure` requires `revision` matching session consent, `privacyContact`,
HTTPS `privacyUrl`/`providerTermsUrl`, and nonempty reviewed `processingText`,
`avatarText`, `tryonText`. It must identify the actual AI, verification and safety
services and their data handling. Text is rendered as plain text; no HTML policy
injection is supported. A version id does not establish legal approval.

`verificationClient` requires an `id` matching the server CAPTCHA adapter and a
bounded trusted JavaScript `script`. The authenticated no-store
`/shopper-api/verification.js` endpoint serves it only when the workflow is ready.
It installs:

```js
globalThis.FormeShopperVerification = {
  id: 'your-reviewed-service-id',
  async challenge({action, container, nonce, signal}) {
    // Render the reviewed service's real widget in container.
    // Obtain a fresh token bound to action and the hosted studio hostname.
    // Honour cancellation. Never inspect/send photo inputs or image blobs.
    return tokenFromThatService;
  },
  reset() { /* dispose of widget state */ },
};
```

The server independently checks that token; trusting the browser return alone
does not authorize photos. Verification UI has a two-minute client deadline;
server verification still has its C16.3 fifteen-second deadline. Reviewed adapters
may declare up to six exact public HTTPS origins each in `scriptOrigins`,
`connectOrigins`, `frameOrigins` for CSP. No wildcards, private hosts, arbitrary
shopper origins, `unsafe-inline` scripts or `unsafe-eval` are introduced. Nonce
scripts and styles, no-referrer, no-store, noindex and frame-ancestors none apply
to the hosted shell. Public site keys belong in the reviewed adapter; secrets
stay exclusively in its server verifier configuration.

The complete flow currently requires Gemini. An OpenAI-only server cannot
silently use a different provider for clothing generation. Existing staff prompts,
contracts and provider selection remain unchanged.

The optional [Gemini image-safety adapter](SHOPPER_GEMINI_SAFETY.md) can reuse that
server key for bounded, separately metered input/output classification. Its live
policy coverage, costs, data terms and disclosure still require review.

Preserve the account volume and all shared deployment overrides when deploying
after the independent launch review:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml -f compose.shopify.yaml up -d --build tryon
```

The owner Shopify settings show whether the hosted workflow dependencies are
configured. Connecting/launching alone spends no AI credits; actual generation
continues to respect the separate owner spending controls. This task does not
deploy Lightsail, change DNS/Caddy, call live services or build an APK.

## Dedicated API and spending

All routes use the C16.3 shopper/device cookies and current installation authority.
Mutations require exact Origin and `X-Shopper-CSRF`.

| Route | Purpose / bounded input |
| --- | --- |
| `GET /shopper-api/session` | Metadata, disclosure, supported templates, remaining attempts and absolute expiry; never image recovery |
| `POST /shopper-api/consent` | Fresh adult/own-photo, provider/revision and purpose consent; 4 KB |
| `POST /shopper-api/challenge` | Server verification; 6 KB |
| `GET /shopper-api/template?profile=...&tone=...` | Bounded standard-body JPEG, no customer data |
| `GET /shopper-api/products` | Up to 50 same-installation eligible product capabilities |
| `GET /shopper-api/product-image?selection=...` | Session-scoped merchant JPEG thumbnail |
| `POST /shopper-api/product` | Select an opaque capability; 1 KB; reject during image work |
| `POST /shopper-api/avatar` | UUID, face/body data URLs, profile/tone, numeric height/weight |
| `POST /shopper-api/avatar/approve` | Server-issued output approval capability; 1 KB |
| `POST /shopper-api/tryon` | UUID and exact approved avatar data URL; no garment or prompt |
| `DELETE /shopper-api/session` | End/cancel; idempotent |

Image POSTs require `X-Shopper-Consent` and `X-Shopper-Proof` headers. Both are
checked **before** the 15 MB JSON parser. A shared shopper image slot is claimed
at that point, so concurrent verified uploads cannot accumulate large JSON buffers.
The 120-second deadline includes upload time; end/expiry cancels a slow upload.
Compressed bodies are refused. Uploaded
photos remain individually limited to 5 MB/12 MP; a generated approved PNG may be
up to 10 MB. Malformed/large/private payloads return sanitized errors without
echoing or logging their contents. Authentication, readiness and proof checks run
before parsing. Unknown extra fields are rejected.

Normalized inputs pass face and moderation checks before a metered provider call;
output is normalized, face-checked and moderated before commit. The call uses a
120-second deadline and the shared global slot. HTTP disconnect/session end aborts
work; late bytes are discarded. Unsettled holds refund once while dispatched
attempts remain consumed. Existing 1-avatar/2-try-on, 3-attempt, device/IP, monthly
image/moderation and shared staff/catalogue/shopper limits all remain in force.

Successful output travels only in that response and the original browser's Blob
memory. No photos, generated images, measurements, face descriptors or customer
records are written to the account DB, tmpfs state, logs, localStorage, IndexedDB
or a service worker. Only hashes, non-personal bookkeeping and short-lived session
authority remain. Navigation/pagehide deletion is best effort; absolute server
expiry and checks on resume/actions still apply. Provider retention and actual
host memory/swap behavior require the C16.5 live review.

## Validation and next step

Tests use independent synthetic customer photos from `tests/fixtures/customers`,
mocked Shopify/CAPTCHA/moderation/AI adapters and a deliberately stubbed generated
PNG. They verify integration, privacy, guards and accounting; they do not prove
customer likeness, anatomy or garment fit. The generated image in screenshots is
a test fixture, not evidence of a live AI call.

Validated on 2026-11-07: `npm test` **271 passed**, `npm run test:e2e`
**101 passed**, and `npm run build` passed. Coverage includes slow/concurrent
uploads, authentication before parsing, consent/proof replay, scoped product
switching, exact avatar reuse, female-library opt-in, provider failures/refunds,
disconnect/end cancellation, mobile file/camera selection, review/download,
expiry/resume and reload without regeneration. Mobile screenshots were inspected.
The Vite development proxy forwards shopper/Shopify routes while preserving staff
SPA routes; syntax, default-off flags, guide links and package versions were checked.

C16.5.1 now provides [service setup and readiness tooling](SHOPPER_LAUNCH.md).
Actual C16.5 verification remains: select/review/configure live safety services, approve actual disclosure
and data terms, verify Gemini billing/capacity/quality, test the Shopify development
store and theme, validate small-instance memory/expiry/proxy behavior, then run an
owner-supervised opt-in pilot. Production generation stays unavailable until its
required configuration exists.
