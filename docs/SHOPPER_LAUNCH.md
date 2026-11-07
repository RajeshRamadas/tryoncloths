# Shopper launch setup and readiness — C16.5.1

Web `0.19.0-alpha.5` adds the implementation portion of C16.5 that can run without
live credentials or a production deployment:

- Optional Cloudflare Turnstile server verification and its browser widget.
- A trusted server configuration module loaded by the normal bootstrap, so the
  [C16.4 workflow](SHOPPER_WORKFLOW.md) can receive reviewed dependencies without
  editing the application entry point or baking secrets into a Docker image.
- **Shopify widget → Shopper launch readiness** for owners/managers. It shows
  local blockers separately from unverified live checks; staff/anonymous access
  remains denied. Refreshing changes no settings and calls no external service.
- An offline `check:shopper` command and optional read-only configuration mount.

**C16.5 is not complete.** No CAPTCHA/moderation vendor has been activated, legal
review recorded, Shopify development store tested, live image generated or
Lightsail pilot deployed by this task. Configuration presence cannot establish
valid credentials, quota, billing, policy coverage, data terms, likeness or fit.
The report always says `liveVerified:false`; it cannot approve a launch.

[C16.5.2](SHOPPER_GEMINI_SAFETY.md) now also provides optional Gemini input/output
safety review using the existing image key, with a separate model and bounded
classification requests. It remains unselected by default and does not verify
age/identity, legal approval, coverage or live accuracy.

## 1. Review the service and disclosure configuration

Keep `TRYON_SHOPPER_SESSIONS=false` and `TRYON_SHOPPER_WORKFLOW=false` until the
independent launch checks below have been completed. Existing staff/account
flows and their provider remain unchanged; the shopper image flow uses Gemini.

Prepare a **trusted server-code module** outside the repository, backups, public
assets and account data. On the existing Lightsail host, for example:

```sh
mkdir -p /home/ubuntu/forme-shopper-services
cp ~/tryoncloths/deploy/lightsail/shopper-services.example.mjs /home/ubuntu/forme-shopper-services/services.mjs
chmod 755 /home/ubuntu/forme-shopper-services
chmod 644 /home/ubuntu/forme-shopper-services/services.mjs
```

The example exports null dependencies and intentionally cannot enable photos.
Replace them only with the reviewed disclosure and selected safety implementation.
For the optional built-in Gemini safety adapter, see
[its configuration and limitations](SHOPPER_GEMINI_SAFETY.md); leave the module's
`moderation` null/omitted and explicitly select it through the server environment.
The default export must be an object with only these fields:

```js
import disclosure from './reviewed-disclosure.mjs';
import {moderation} from './reviewed-moderation.mjs';
export default {disclosure, moderation};
```

`disclosure` has the complete fields defined in [C16.4](SHOPPER_WORKFLOW.md):
`revision`, `privacyContact`, `privacyUrl`, `providerTermsUrl`, `processingText`,
`avatarText`, `tryonText`. Use the actual merchant/AI/safety services and data
handling, not the test disclosure. A revision identifier is not legal approval.
If `TRYON_SHOPPER_CONSENT_REVISION` is also set, it must match the module revision.

Custom `moderation` implements `{id, async check({images, stage, action, roles, policy, signal})}` and
returns `{allowed:true, policy:'adult-own-photo-v1'}` only after the selected
service enforces the reviewed policy. Missing, unknown and error results must
block acceptance. Local face presence is not age, ownership or identity
verification; a generic provider safety default alone is not the required
policy. Service selection, tariffs/limits and input/output coverage remain open.
`action`/`roles` are additive trusted server labels; older custom adapters may
ignore them. The built-in Gemini adapter validates them before any request.

Modules are trusted code with access to the server environment. Review the entry
module and all imports; they must make no network calls, log no credentials and
process no images during import. The loader does not invoke a configuration
factory. It accepts an absolute `.mjs` path, entry file ≤128 KB, and refuses
group/world-writable entry files. Import errors, unknown exports and conflicting
service/revision settings discard all shopper dependencies with a fixed code;
they do not crash the staff service or return raw errors/paths in diagnostics.
Restart/recreate the process after edits; Node's module cache is not a hot reload.

## 2. Optional Cloudflare Turnstile

Turnstile support is **an available integration, not service selection approval**.
After reviewing its terms/data processing for the pilot:

1. Open [Cloudflare Turnstile](https://dash.cloudflare.com/) and create a widget.
2. Add the exact hosted studio hostname, such as `studio.marketingadda.com`, to
   its allowed hostnames. Use a managed widget compatible with the visible
   shopper verification step. This does not require changing the existing DNS.
3. Put the public site key and server-only secret in the server's existing
   `deploy/lightsail/.env`, not in a theme block, Vite variable or chat message:

```ini
TRYON_SHOPPER_CONFIG_DIR=/home/ubuntu/forme-shopper-services
TRYON_SHOPPER_CAPTCHA=turnstile
TRYON_TURNSTILE_SITE_KEY=the_widget_site_key
TRYON_TURNSTILE_SECRET_KEY=the_widget_secret_key
```

The site key is public. The secret stays in the server verifier and is never
part of the browser script, readiness JSON or returned provider errors. The
server sends one POST to the fixed HTTPS Siteverify endpoint with `secret` and
`response`; the optional raw client IP is omitted. It permits no redirect/retry,
limits JSON response bytes and propagates cancellation. Success must match the
exact hosted hostname/action and a valid challenge timestamp; the existing
session layer additionally enforces two-minute freshness and single-use proofs.
Known public Cloudflare test keys are refused in production configuration.

The widget loads only during an explicit consent/verification action. It disables
automatic retry/token refresh, does not create a hidden form token field, uses
the page nonce and existing bounded CSP origins, and disposes on session end.
No photo input is read by this adapter. Photo controls still require successful
server verification, the reviewed moderation adapter and complete disclosure.

Outbound HTTPS and the hosted browser must be able to reach
`challenges.cloudflare.com`. Availability is not tested by the offline checker.
Implementation references:
[server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
and [widget settings](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/).
No current price or quota is assumed; record actual terms during service review.

For another reviewed verification provider, export both `captcha` and
`verificationClient` from the module using the [C16.4 contracts](SHOPPER_WORKFLOW.md)
and leave `TRYON_SHOPPER_CAPTCHA` blank. Do not configure both a custom verifier
and built-in Turnstile; that conflict fails closed. No generic always-pass
verifier or permissive production moderation example is provided.

## 3. Mount configuration without altering the existing services

Preserve the existing account volume, Caddy and shared network. Add the optional
override **last**, after the shared/account/Shopify overrides:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml -f compose.shopify.yaml -f compose.shopper-services.yaml up -d --build tryon
```

The extra override mounts the existing reviewed directory read-only at
`/run/forme-shopper-config` and supplies
`TRYON_SHOPPER_CONFIG_MODULE=/run/forme-shopper-config/services.mjs`. A missing
host directory is an error; Compose does not silently create it. Secrets remain
server environment variables. Both feature flags keep their existing default
false values. The tmpfs state mount still comes from `compose.shopify.yaml`.

For a source checkout instead, set `TRYON_SHOPPER_CONFIG_MODULE` to the absolute
private entry file. The normal `server/index.js` bootstrap loads it before creating
the app. An invalid configuration removes only shopper dependencies; existing
staff API/sample flows continue. Nothing in the loader changes payment plans,
budgets, mobile access mode, model selection, catalogue rules or feature flags.

## 4. Run offline and authenticated local checks

Within the running shared deployment:

```sh
cd ~/tryoncloths/deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml -f compose.shopify.yaml -f compose.shopper-services.yaml exec -T tryon node server/check-shopper.js
```

Or in a source checkout, run `npm run check:shopper`. Exit 1 means local blockers
remain; this is expected before setup. Exit 0 means only the inspected local
configuration passed. JSON still has `liveVerified:false` and a separate
unverified live checklist. This command is not a replacement container healthcheck.

The preflight reads environment/configuration and directory metadata, without
opening or migrating account databases, creating state files or probing any
provider. It checks flags, service dependencies, disclosure, Shopify/HTTPS key
formats, proxy CIDRs, accessible account directory and a private owner-only tmpfs
directory outside account storage. Runtime memory facts describe the machine
executing the command, not a remote Lightsail instance. The imported module is
trusted code and must honor the no-side-effect import contract above.

Sign in as the correct store owner/manager and open **Shopper spending → Shopify
widget → Shopper launch readiness**. Expand local checks for store-specific
installation/button status, current product eligibility, plan, pause/caps,
remaining monthly allowance and AI balance. A new avatar plus its first try-on
needs two successful image credits/attempts and four moderation invocations.
The report reads existing counters without reserving/spending or changing them.
It excludes secrets, module paths/scripts, private errors and customer payloads.

Injected test state is reported as a storage blocker; it cannot demonstrate the
production tmpfs mount. Local success checks credential presence/format, not
validity. The report's live items remain unverified and cannot be approved from
the screen. No implementation checkbox or environment flag supplies legal review.

## 5. Complete C16.5 live evidence before a public pilot

Keep evidence in the private deployment/operations record. Record the deployment
commit, model and service versions, consent revision, reviewer/date, test store
and result/reference. Do not publish customer images, credentials or photo logs.

| Evidence | Required result |
| --- | --- |
| Service review | Selected verification/moderation services, tariffs/capacity, policy limits and processing/retention terms accepted |
| Legal/privacy | Actual merchant/provider roles, adult own-photo wording, contact/deletion/complaints and processing location reviewed |
| Gemini | Image-generation billing/quota and output quality verified; model metadata HTTP 200 alone is insufficient |
| Shopify | App OAuth, published products, signed launches, lifecycle revocation and theme tested in the development store |
| Deployment | Actual private Caddy peer/forwarded IP checks, HTTPS cookies, shared tmpfs/cleanup and backup exclusions verified |
| Memory/retention | Target small-instance load, normal/cancelled/expired uploads, bounded concurrency, and host swap/core-dump handling checked |
| Pilot | Consented adult own photos, Chrome file/camera flow, review/reuse/download, fresh retries and end/resume checked with the owner |

Use the existing separate budgets: ≤50 store/200 organisation image credits
**and dispatched attempts**, plus 100/400 moderation invocations. Confirm the
selected adapter's actual external calls/cost per invocation; limits are not a
guaranteed cash budget. No automated paid probe, live generation, deployment,
message, purchase, top-up or APK build is part of this increment. The code tests
use mocked services; they cannot close the live evidence above.

Once those checks are recorded, the operator can explicitly enable both shopper
flags and the owner can unpause its reviewed limits/button for a supervised pilot.
Pause spending/button to stop new requests if any check fails. Ending a session
cannot recall an already dispatched provider call or delete a local download.

## Validation

On 2026-11-07, `npm test` passed **281 tests**, `npm run test:e2e` passed
**105 tests**, and `npm run build` passed. New coverage checks Turnstile
host/action/timestamp validation, secret isolation, bounded/error responses,
cancellation and no retries; module validation/conflicts/revision drift;
non-mutating tenant/role-scoped readiness; read-only preflight; and staff startup
when shopper configuration is invalid. Browser tests cover visible local/live
status, consent-before-widget loading, server rejection and end/late callbacks.
The mobile readiness screen was inspected. All external service calls were mocked.
These results do not constitute any of the live evidence in section 5.
