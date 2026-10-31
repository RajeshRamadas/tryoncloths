# C6 — billing, usage and trial management

Web `0.16.0-alpha.6` adds owner checkout controls, usage reports, credit indicators,
operator billing commands and new-account trials. This is still an R1 prerelease;
customer profiles and look sharing follow in C7/C8. No APK is built.

## Store workflow

The signed-in owner opens **Billing** from the account header. Save legal name,
billing address, email, Indian state code and optional GSTIN first. The page shows
plan/status, AI and photo balances, trial expiry or current paid-period end,
monthly/annual plans, credit packs and downloadable invoices. Prices include 18%
GST. Plans whose Razorpay id is not configured are disabled. All prices, permissions
and credit grants are validated by the server.

Razorpay Checkout is loaded only when a purchase is started on the Billing page.
The browser never receives provider secret keys or handles card data. Pack checkout
success is verified by the server before the balance is refreshed. Subscription
success waits for the verified Razorpay webhook; **Refresh billing** shows the
confirmed state. Closing checkout does not verify a payment or automatically retry
an order. If a connection fails after payment, refresh and check invoices before
paying again. Existing subscriptions must be managed through the administrator;
upgrade/cancellation controls are not included yet.

The account header shows remaining AI credits for all signed-in staff. A warning
appears at or below 10% of the plan's credit allowance (30 for a trial, configured
initial allowance for a pilot). It refreshes after generation/payment responses,
on store changes and when the window regains focus. Staff can see the balance but
cannot open billing or invoices.

Owners and managers open **Usage** for the active store. It displays the last 30
calendar days in India time, credits per staff member and generation action, and
CSV export. Only committed delivered images count: refunds, unresolved holds,
saved-result reuse and grants do not. Owners switch stores in Forme to see another
store's report; this is not the later chain-wide analytics dashboard. Query-string
store/org ids cannot change the authenticated reporting scope. CSV text is escaped
to avoid interpreting staff names as spreadsheet formulas.

## New trials and existing pilots

New production registrations receive plan/status `trial`, 30 AI credits once and
an expiry 14 days later. Generated outputs retain the existing trial watermark.
After expiry, paid actions return `trial_expired` (402) before any provider call;
saved data and free reuse remain accessible. Credit packs do not extend a trial:
a subscription or explicit operator plan change is needed after expiry.

Email is required; optional mobile and GSTIN fields also participate in duplicate
trial checks. Mobile numbers normalize to E.164 (+91 for ten-digit Indian numbers).
Identity hashes are claimed in the same transaction as registration and the credit
grant. A repeat supplied email, phone or GSTIN cannot obtain another trial, even
under concurrent registration. Adding GSTIN/billing email to a trial also checks
existing claims. Phone/GSTIN ownership is not verified; omitting optional identifiers
or supplying different ones is not strong identity verification. OTP policy remains
an open commercial decision.

Trial-eligibility hashes are retained separately from account deletion to prevent
repeat grants. Define retention and erasure policy before general paid rollout.
Existing pilot organisations and credits are unchanged. Test fixtures explicitly
provision established pilots; the new C6 tests use production-default trial signup.

## Operator commands

Run inside the configured backend with `TRYON_DATA_DIR` set (already configured in
the accounts Compose overlay). These commands are not exposed to browser users.
Use `list-orgs` to obtain the organisation id. Example command prefix:

```sh
sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml exec -T tryon node server/account-admin.js list-orgs
```

Available arguments after `server/account-admin.js`:

```text
list-orgs
grant-credits ORG_ID ai 100 unique-support-reference
grant-credits ORG_ID photo 50 unique-photo-reference
set-plan ORG_ID pilot|starter|growth|chain
extend-trial ORG_ID 7
suspend ORG_ID
reset-password EMAIL                 # new password on stdin, never argv
```

Grant references make repeated commands idempotent; reuse with a different amount
fails. Grants always use the immutable ledger. Plan changes explicitly activate
access but do not create a payment, subscription or credit grant. Extensions add
1–365 days to an existing trial from the later of now/its expiry, without adding
credits. Suspension blocks paid generation and new checkout creation, preserving stored data and free reuse. It does not cancel recurring Razorpay billing; manage provider subscriptions separately.
Plan, extension and suspension changes are recorded in the admin audit table.
Existing password recovery still revokes all previous sessions.

## API and deployment

- Owner: existing `/api/billing` now includes plan/pack prices and availability,
  subscription period, trial expiry and balances. Payment endpoints are documented
  in [PAYMENTS.md](PAYMENTS.md).
- Owner/manager: `GET /api/usage`, `GET /api/usage.csv`, scoped to active store.
- Any authenticated member: `GET /api/credits` for remaining credits and low flag.

No additional secrets are introduced. Configure the existing Razorpay plans, keys,
webhook and SMTP settings from [PAYMENTS.md](PAYMENTS.md); without them the Billing
page clearly shows payments unavailable. An external script must be allowed at
`https://checkout.razorpay.com/v1/checkout.js` on the deployed browser network.

Back up the persistent database and retain the accounts volume before deploying:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Automated checkout uses a mocked Razorpay script with a real local payment API,
SQLite ledger and PDF generation. Real payment, SMTP delivery, live supplier tax
configuration and Lightsail deployment are not verified by these tests. Credit
expiry/allocation rules, refunds/credit notes and plan-change checkout remain
separate work before general commercial rollout.

Release validation: 127 backend tests, 60 Playwright browser tests and the
production build passed. After the suspension purchase guard was added, all 18
payment/trial-focused tests and the build passed again. The new browser suite
covers real trial registration, mocked Checkout with real local payment verification,
invoices, usage export, mobile width, access restrictions and cancellation.
