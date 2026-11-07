# Shopper sessions and guards — C16.3

Web `0.19.0-alpha.3` adds temporary anonymous shopper sessions, consent/verification
interfaces, rate limits, cancellation, image validation and shared image-call
leases. This follows the approved [shopper design](commercial/SHOPPER_SELF_SERVICE_DESIGN.md)
and [Shopify launches](SHOPIFY_SHOPPER.md).

**With the workflow flag off, this is a session preview.** The hosted page shows
the product, remaining session time and **End shopper session**, without photos or
AI credits. [C16.4](SHOPPER_WORKFLOW.md) now supplies guarded image routes and
photo/review/try-on screens behind an additional default-off flag. Absent reviewed
disclosure and configured safety adapters still block shopper photo processing.
No live CAPTCHA, moderation or AI service was called by this task.

## Enable the optional session preview

Use the existing Shopify/account setup and its tmpfs override. In the server's
`deploy/lightsail/.env`, set:

```ini
TRYON_SHOPPER_SESSIONS=true
# Replace with the actual direct Caddy peer or its narrowly trusted subnet:
TRYON_SHOPPER_PROXY_CIDRS=172.18.0.2/32
```

When `TRYON_TRUST_PROXY_HOPS=1`, sessions require an explicitly trusted direct
proxy CIDR. Get the current Caddy container address/network from Docker inspect;
do not copy a stale example blindly. The backend must remain private behind
Caddy. Only a single, valid forwarded client address from that trusted peer is
accepted. With no trusted proxy configured, session creation fails closed. Direct
development connections use the socket address and ignore forwarded headers.

Update the current shared deployment, preserving all overrides and its volume:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml -f compose.shopify.yaml up -d --build tryon
```

Open an enabled, selected product through the Shopify theme button. With sessions
off, the existing stateless setup preview continues to work. With sessions on,
the page exchanges the single-use ticket for an isolated session. Photo and AI
controls remain unavailable regardless of the flag. No APK or live deployment
was built/performed here.

## Session authority and privacy

- Sessions last **up to 30 minutes from creation**, without sliding on requests.
  Store pause, installation/product/configuration changes and uninstall revoke
  access earlier. The page rechecks on visibility/resume and clears its active
  state on end/expiry/navigation. A fresh product launch supersedes the browser's
  previous session. Closing/navigating the page sends a best-effort end request;
  server expiry still applies when the browser is offline or suspended.
- Production uses independent `__Host-forme_shopper` and
  `__Host-forme_shopper_device` cookies: Secure, HttpOnly, SameSite=Strict, Path=/,
  no Domain. Development HTTP uses unprefixed equivalents. Staff cookies,
  mobile/store codes and shopper cookies do not substitute for one another.
- The device cookie is random and signed, with an **absolute 24-hour** expiry;
  creating sessions does not extend its lifetime. A session cannot outlive that
  device cookie. It is an abuse control, not a fingerprint or proof of identity;
  clearing cookies can evade the device limit but not the IP/monthly limits.
- Each mutation requires an exact studio Origin and the session's CSRF proof.
  Session/product/store authority comes from the verified launch and stored
  installation, never from shopper-supplied tenant/catalogue ids. The exact
  session avatar must be generated and explicitly approved before try-on.
- Capabilities, session metadata, consent, approvals and rate records stay in the
  bounded shared `ShopperState` SQLite file on **tmpfs**, outside account backups.
  Rate keys are purpose-separated HMACs; raw IPs and device-cookie values are
  not stored in rate records. Consent retains only purpose/provider/service ids,
  policy revision and timestamp. Image bytes/measurements are not stored there.
- Expired entries are denied immediately even if cleanup is delayed. Runtime
  cleanup runs at startup/every minute, pruning records and checkpointing/truncating
  the transient WAL when possible. Container recreation loses tmpfs state;
  process-only restarts on a retained shared mount may preserve unexpired session
  metadata, but never resume or retry provider requests. Monthly budgets and
  ledger entries remain durable in the account DB.
- No photos, session credentials or CSRF proof go into localStorage, IndexedDB,
  analytics, logs or account avatar/customer tables. Ending removes session-bound
  consents/proofs/attempt metadata immediately; rolling rate limits remain until
  their expiry. Browser pagehide cleanup is best effort, with server limits as
  the authority. Provider retention and host swap/core dumps need separate launch
  review; discarding JS buffers cannot prove immediate physical RAM erasure.

## Abuse and spending controls

| Scope | Limit |
| --- | --- |
| Session starts | 2/device and 10/IP per rolling hour |
| Dispatched generation attempts | 3/device and 12/IP per rolling hour, across installations |
| Per session | 3 dispatched attempts, at most 1 successful avatar and 2 successful try-ons |
| CAPTCHA verification calls | 6/device and 36/IP per rolling hour, including failed verification |
| Shopper work | 1 shared image slot globally |
| Staff + catalogue + shopper image work | 2 shared slots globally per account DB |
| Image attempt | 120-second shopper deadline; abort on end, expiry, revocation or external disconnect signal |
| Uploaded photo | JPEG/PNG/WebP; 5 MB, 12 MP, at least 128×128; single-frame |

Rolling windows do not reset on session end. Limits share the transient store
across workers; container loss of that store also loses its rate history. Durable
monthly image-attempt/credit/moderation caps remain the final financial boundary
across restarts. A restart cannot refill those caps or make an old request id
eligible for another provider call.

Existing [C16.1 monthly allowances](SHOPPER_SPENDING.md) still apply: store ≤50,
organisation ≤200 delivered credits **and** dispatched image attempts; separate
100/store and 400/org moderation invocations. Failure refunds a credit hold,
while dispatched attempt consumption remains. CAPTCHA/moderation errors never
silently pass. No automatic retry, fallback provider, top-up or cap increase is
introduced. These limits are not a guaranteed rupee budget.

The shared `image_call_leases` table contains only random lease ids, workload
kind and expiry. Staff calls acquire a slot before the adapter runs; a busy studio
returns 429 and refunds its temporary credit hold. Catalogue jobs remain pending
when no slot is free. Existing unexpired catalogue leases from before this limiter
are conservatively counted. Each workload releases its slot in cleanup, and stale
leases expire. Staff/provider prompts, model selection and contracts are unchanged.

## Consent, verification and moderation interfaces

Production CAPTCHA/moderation adapters are **not selected or configured** in this
increment. An environment flag or a store access code cannot bypass that absence.
The server factory can inject reviewed adapters through `shopperSessionOptions`:

- `consentRevision`: public version id for legally reviewed photo-processing
  wording, including the actual AI and safety services. Optional server variable
  `TRYON_SHOPPER_CONSENT_REVISION` supplies the version, not legal approval itself.
- `captcha: {id, verify({token, action, hostname, signal})}` returns
  `{success: true, action, hostname, issuedAt}`. The id is a non-secret service
  identifier. Proofs must match purpose/host and be issued within two minutes;
  CAPTCHA tokens are checked against local replay markers before external calls.
- `moderation: {id, check({images, stage, policy, signal})}` returns
  `{allowed: true, policy: "adult-own-photo-v1"}` only after the chosen service
  enforces that policy. `images` are decoded/normalized buffers and stage is
  `input` or `output`. Missing, ambiguous, rejected or failed results are blocked.

These are **adapter contracts**, not assertions that a chosen vendor supports
them or that the existing face model verifies adulthood/identity. Services,
tariffs, processing/retention terms and consent text still need launch review.
Public metadata reports check availability. `shopperGenerationAvailable` stays
false unless the additional [C16.4 workflow](SHOPPER_WORKFLOW.md) and all of its
reviewed dependencies are configured.

Generation consent requires explicit adult/own-photo acceptance for the exact
action, active AI provider and current wording revision. Its five-minute, single-use
record also binds the configured safety-service ids. CAPTCHA creates a separate
two-minute, single-use proof tied to that session, action and consent. A manual
retry requires new consent/proof and a fresh request id; duplicate ids never
dispatch again. Changes in provider/policy/service configuration invalidate the
old authorization rather than silently sending photos to another service.

The internal guarded runner validates bounded image magic/MIME/decoded dimensions,
strips metadata and checks one usable face before input moderation. Only then can
it reserve and dispatch a metered image call. Output is decoded, face-checked and
moderated before settlement. An approved-avatar capability binds exact generated
PNG bytes to its session; the garment is loaded from the verified store catalogue.
An arbitrary shopper garment, URL, prompt or borrowed avatar is not accepted.
The built-in face checks verify presence/pose, not identity, age or exact likeness.

Ending or revoking a session aborts local work immediately; other workers poll
session authority every 250 ms during the guarded attempt. Signals propagate to
the existing Gemini/OpenAI transports. Late output is discarded and unsettled
holds are refunded once. Already submitted requests may still cost the provider,
and aborting HTTP cannot recall transmitted photos or prove remote cancellation.

## Public routes and next increment

| Route | Requirements |
| --- | --- |
| `POST /shopper-api/session` | Exact Origin, one-use launch ticket, trusted client IP, start-rate allowance; 1 KB JSON |
| `GET /shopper-api/session` | Shopper + device cookies, current session/product authority; no TTL extension |
| `DELETE /shopper-api/session` | Exact Origin, shopper/device cookies and CSRF when the session exists; idempotent when ended |
| `POST /shopper-api/consent` | Session + CSRF + reviewed/configured checks; 4 KB JSON |
| `POST /shopper-api/challenge` | Session + CSRF + consent + configured verifier; 6 KB JSON |
| `POST /shopper-api/avatar/approve` | Session + CSRF + actual generated approval capability; 1 KB JSON |

All precede the optional staff API token gate and use their own auth. Parse and
size errors return sanitized JSON without logging/echoing request contents.
[C16.4](SHOPPER_WORKFLOW.md) now wires the guarded runner into public avatar and
try-on routes and the consent/photo/review/download screens. Those routes reject
requests before photo parsing when their opt-in/configuration, session or proof
is missing. The setup/session preview must never be presented as a generated result.

## Validation

Validated on 2026-11-07: `npm test` (259 passing), `npm run test:e2e`
(93 passing) and `npm run build`. The new coverage checks session isolation,
absolute expiry, rolling limits, proxy spoofing, consent/proof replay, input and
output rejection, refunds, cross-worker cancellation, shared image slots and
mobile end/resume flows. The mobile session preview was also inspected visually.
Shopify, safety, AI, payment and messaging providers were mocked; these results
do not verify live provider capacity, legal approval or production deployment.
