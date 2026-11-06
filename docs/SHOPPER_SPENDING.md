# Shopper spending — C16.1

Web `0.19.0-alpha.1` implements the first increment of the approved
[C16 shopper design](commercial/SHOPPER_SELF_SERVICE_DESIGN.md). Owners can
prepare monthly spending limits and pause spending; owners/managers can inspect
the active store and organisation counters. **The shopper widget is not available
yet.** There is no Shopify theme extension, public shopper session or shopper
generation endpoint in this release.

## Use the settings page

1. Sign in to the appropriate store and open **Shopper spending**, or visit
   `/shopper-spending`.
2. Owners set a **Store monthly limit** from 0–50 and an **Organisation monthly
   limit** from 0–200. Both limits independently cap successful image credits
   and dispatched image-provider attempts. All stores share the organisation
   allowance and the organisation AI credit balance.
3. **Allow shopper spending when the widget is ready** can be selected only for
   active Growth/Chain organisations with positive limits. It prepares the budget;
   it does not publish or enable the unfinished widget. Defaults are paused,
   store limit 0 and organisation limit 0, including existing accounts.
4. Save. A concurrent change in another tab/store requires **Refresh shopper
   spending** before saving; refreshing discards unsaved fields. Changing limits
   never clears counters. Reducing a cap below usage blocks new work.
5. **Pause shopper spending now** immediately pauses the active store, even if
   the form contains invalid/unsaved values or stale revisions. Only an owner
   can pause or change allowances. To block all stores, set the organisation
   limit to zero and save with the active store paused.

Months reset at midnight on the first day in **Asia/Kolkata**. The page shows
the current month, next reset, shared AI balance and both scopes' usage:

- **Successful image credits / held credits:** committed results and unsettled
  credit reservations. Available credit allowance subtracts both.
- **Provider attempts / reserved attempts:** conservatively recorded dispatches
  and reserved calls not yet dispatched. Available attempt allowance subtracts
  both. Failed or unknown dispatched attempts are never restored that month.
- **Moderation calls:** a separate invocation allowance of 100/store/month and
  400/organisation/month, including failures. Moderation does not debit AI credits.

An avatar plus its first try-on costs two successful AI credits. A 50-attempt
store allowance permits at most 25 such journeys if every call succeeds;
additional try-ons or retries reduce that number. Limits bound credits and
provider invocation counts, **not a guaranteed INR amount**. Provider billing
for failed/timed-out calls and moderation tariffs must be verified before launch.

Managers see counters and eligibility but cannot edit. Staff and anonymous users
are denied. Switching stores uses the authenticated active membership; the API
accepts no caller-selected store or organisation id. Editing settings, refreshing
and pausing make no provider call and use no credits.

## HTTP contract

Both routes require the existing authenticated store session and, when configured,
the existing studio access token. Responses use `Cache-Control: no-store`.

| Route | Role | Behaviour |
| --- | --- | --- |
| `GET /api/shopper-settings` | Owner, manager | Current active-store/org policy, counters, IST period, credit balance, revisions, `widgetAvailable:false`, `stage:"budgets-only"` |
| `PUT /api/shopper-settings` | Owner, same-origin | Save `storeLimit`, `organisationLimit`, `paused`, `storeRevision`, `organisationRevision` |
| Same PUT with only `{ "action": "pause" }` | Owner, same-origin | Unconditionally pause the active store; no stale-form overwrite |

Updates reject unknown fields, noninteger/out-of-range limits, zero limits with
spending allowed and stale revisions. Active Growth/Chain eligibility is checked
again on the server; client controls are not authorization. Trial, pilot, Starter,
photo-only, past-due and suspended organisations can prepare paused limits but
cannot allow shopper spending. Pausing is always available to the current owner.

## Internal accounting foundation

`server/shopper-budgets.js` is an internal service, not a public billing API.
Future shopper handlers must resolve its `store` argument from a verified
installation/session and enforce consent, CAPTCHA, moderation, session/device/IP
limits and product access **before** invoking it. No staff membership is created
or impersonated. Existing staff meter authorization and route contracts remain.

- `reserve`: validates a UUID v4, action, request-body hash and session hash;
  atomically reserves both caps and one organisation AI ledger credit. One live
  shopper operation is allowed globally across stores/organisations in this DB.
- `dispatch`: rechecks policy, revisions and the 120-second deadline, moves a
  reserved attempt to the durable dispatched count **before** an external call.
  It may be called only once. A crash between marking and sending conservatively
  consumes the attempt; the server never resends.
- `commit`: after the caller validates/moderates an output, rechecks current
  policy/deadline and atomically commits the ledger hold and both budget scopes.
  A completed HTTP response lost in transit is still charged; this cannot prove
  that the browser received the image.
- `refund`: returns the credit hold and delivered-credit allowance. Undispatched
  reservations also restore attempt room. Dispatched attempts remain consumed.
  Repeating commit/refund never creates duplicate terminal ledger entries.
- `reserveModeration`: atomically consumes a separate invocation allowance;
  duplicate request ids do not permit another call. Output moderation can use
  the existing operation even when it holds the last AI credit. Its allowance
  belongs to the generation's reserved month, including midnight crossings.

Stable request ids are bound to store, session, action and body hash. Replaying
the same context on the same live process returns `fresh:false` and operation
metadata; callers must not dispatch it again. A changed/expired context, process
restart or different worker conflicts, without another credit hold or dispatch.
Shopper request ids also
cannot collide with prior staff ledger request ids. No images are cached here.

Reservations stay assigned to their original IST month. Owner changes, pause,
subscription suspension or expiration during work block completion and refund
the hold; dispatched-attempt consumption remains. After pause, a call already
sent to the provider may still incur a provider charge.

`BillingStore.reserveShopper()` accepts only an existing pending operation inside
its transaction, derives tenant/plan from the database, leaves ledger user null
and records `shopper_avatar` / `shopper_tryon` actions. It does not weaken the
membership checks in staff `reserve()`. Generic Usage and Analytics group these
charges under **Shopper self-service**, rather than attributing them to staff.

## Persistence and recovery

Additive transactional migrations create `shopper_org_settings`,
`shopper_store_settings`, `shopper_budgets`, `shopper_operations` and
`shopper_moderation_operations` in the existing persistent account database.
All cap and ledger mutations use `BEGIN IMMEDIATE`; concurrent workers share
the same durable counters and cannot overspend. Settings survive updates without
additional environment variables or a new volume.

The dedicated sweeper runs at startup and every minute; new reservations also
sweep expired work. It refunds expired unsettled operations once, marks
dispatched work `unknown`, releases cap reservations and never calls a provider.
Expired operations cannot dispatch/complete while waiting for cleanup. The
generic credit sweeper excludes unsettled shopper holds, keeping cap/credit
settlement atomic. Other processes' unexpired leases are preserved on startup.

Request/session fingerprints stay in a bounded, process-memory replay cache for
30 minutes; they are never written to SQLite or backups. Expired bindings are
checked/pruned before replay and swept every minute, well within the 24-hour
retention policy. Eviction or restart fails closed rather than dispatching again.
C16.3 will replace this cache with the shared transient session store if needed
for routing between workers. Accounting ids, counts, months and settlement
metadata remain durable. This foundation receives/stores **no customer photo, name,
measurement, email, phone or IP**. No anonymous shopper records are created by
visiting or saving the settings page. Transient session storage and its strict
retention enforcement belong to C16.3; default backups must exclude that future
store as specified in the design.

## Validation and remaining work

Tests cover role/origin/store boundaries, revision races, emergency pause, plan
changes, credit exhaustion, ledger and payload deduplication, SQL failure
rollback, 50/200 attempt ceilings, 100/400 moderation ceilings, IST month/year
rollover, crash recovery, generic sweeper isolation, transient fingerprint expiry, and
simultaneous reservations in independent worker/database connections. Browser
checks cover mobile settings/usage, stale forms, invalid unsaved values during
pause, manager read-only views and ineligible plans. No paid generation,
moderation, CAPTCHA, Shopify installation, external message or payment is made
by these tests.

Validation: **223 unit/API tests passed**, **86 browser tests passed**, and
`npm run build` passed. The mobile settings screenshot was inspected for layout
and horizontal overflow. The full run exposed an existing catalogue-photo test's
fixed 100 ms start assumption; that test now waits for mock generation signals
and always releases blocked work during cleanup.

Update an existing account-enabled Lightsail deployment with:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

The existing account volume keeps both settings and monthly counters. No new
API key or environment variable is required for these spending controls.

[C16.2 Shopify installation, signed launches and theme extension](SHOPIFY_SHOPPER.md)
are now implemented as a setup preview. Next: **C16.3 — shopper sessions and guards**.
C16.3/C16.4 must add transient authenticated sessions, consent, abuse/safety guards,
shared concurrency with existing image workloads, and the hosted shopper flow.
Service selection, legal review and live deployment/provider verification remain
launch prerequisites. No Docker image, Lightsail deployment or APK is built here.
