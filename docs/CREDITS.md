# Commercial C4 — credit ledger and generation metering

Web `0.16.0-alpha.4` charges one AI credit for each successful account-backed
avatar or clothing generation. Failed generations restore the credit. Approved
adaptation reuse, link reading, saved avatars/looks and local overlays remain free.
Owners can open **Billing** to see their organisation's credit pools and plan.
Zero-credit errors offer **Buy credits or upgrade**, leading to that page. Online
checkout, subscriptions and invoices are C5; this release has no payment gateway.

## Deployment and pilot migration

Back up the persistent account database before deploying. On startup, a transaction
creates the additive `ledger` table and gives each existing pilot organisation a
one-time AI grant. New pilot registrations receive the same grant atomically with
their organisation, store and user. No customer photos or saved images are changed.

`TRYON_PILOT_CREDITS` is a server-only integer from 0 to 1,000,000, default **1000**.
The accounts Compose override forwards it. Changing it affects newly provisioned
pilot organisations only; restarts never refill an existing organisation. An
explicit zero is recorded as the initial grant and is not topped up later.
Photo credits start at zero. Trial provisioning and plan entitlements are C6.

Use the updated web client with this server. Both generation routes now require a
UUID v4 `requestId`; older web/Android clients without it receive an update message.
No Android APK is rebuilt. Without `TRYON_DATA_DIR`, ephemeral mode keeps its
existing provider and rate limits and requires request IDs, but has no tenant,
credit ledger or durable replay protection. Use accounts for commercial metering.

## Ledger and requests

`AccountStore.billing` provides `balance(org,pool)`,
`grant(org,pool,amount,kind,ref)`, `reserve(...)`, `commit(holdId)` and
`refund(holdId,reason)`. Pools are `ai` and `photo`. Money never uses a mutable
balance column: available credits are the sum of immutable ledger amounts.
Updates and deletes are rejected by database triggers. Ledger store/user ids are
historical references, retained if a store is removed; records contain no images,
passwords or original customer photos.

Reservations use `BEGIN IMMEDIATE`: recheck active user membership, organisation
and suspension, check available balance and insert a -1 hold. A delivered image
gets a zero-amount commit marker. Failures get one +1 refund marker. A unique
terminal index prevents both commit and refund or multiple refunds for a hold.
Grant references are idempotent; supplying a different amount for an existing
reference is rejected. The application never accepts client-provided credit
amounts, organisation ids or staff ids for metering.

Request IDs are unique per organisation, across stores/actions/pools, and
normalised to lowercase. Replays of pending, committed **or refunded** requests
return 409 `duplicate_request` without another provider call. A rejected request
that never acquired a hold (for example zero balance or invalid consent) has no
ledger entry. A deliberate new generation uses a new UUID; retries are never
automatic. Check saved results after a browser timeout before starting again.
No response image is cached for replay; this is duplicate prevention, not replay
of the first response.

Only the provider call and its image checks/watermark are metered. Invalid input,
missing consent and approved reuse do not reserve credits. A successful image
still costs one credit if optional avatar storage or adaptation-receipt storage
fails; the response preserves the image for manual saving and never retries AI.
Network delivery to the browser cannot be guaranteed after response preparation.

The server refunds unresolved holds older than ten minutes at startup and every
five minutes. Commit/refund operations are idempotent. If a provider outlives the
reservation, its late result cannot commit a refunded hold. A process crash after
commit retains the charge; check saved output rather than repeating the request.
Provider-side charges are independent of Forme credits, including failed calls.

## Trial watermark and API

When an organisation has `status='trial'`, successful provider outputs receive a
small **Forme trial** mark in the bottom-right corner before being returned or
saved. Both avatar and clothing generations use this path. Existing saved files
and free results are not retroactively rewritten. Full export/branding policy is
C15; this task applies the mark to newly generated images.

`GET /api/billing` requires an owner session and returns only that organisation's
`{plan,status,balances:{ai,photo}}`. Manager/staff sessions receive 403 and anonymous
requests receive 401. The client never selects another organisation through a query.
Paid routes return 402 `{code:'credits_required'}` without a provider call when the
pool is empty. `requestId` is required in their JSON body; other consent and image
fields are unchanged.

## Validation

Tests use isolated SQLite databases and stubbed providers, with no paid AI calls.
They cover concurrent reservations from two connections, immutable/idempotent
ledger entries, migration/grants, replay while a call is pending, refunds after
provider and face-check failures, invalid outputs, stale-hold recovery, tenant and
role isolation, trial watermarking, and free approved reuse with zero balance and
no extra ledger rows. Browser tests cover both credit-limit messages, new UUIDs
on explicit retries, the owner balance page, staff denial and mobile width.
Production migration/deployment and payment integration have not been performed.
