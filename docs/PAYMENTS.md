# C5 — Razorpay payments and invoices

Web `0.16.0-alpha.5` adds the payment backend for R1. The owner checkout UI,
usage reports and admin plan tools remain C6. The existing Billing page continues
to show balances and directs owners to the administrator until C6 is released.
No APK is rebuilt and no live payment is made by this change.

## Behaviour

- Owners can save billing details, create INR credit-pack orders and create
  subscriptions. Manager/staff/anonymous sessions cannot call these endpoints.
  The organisation always comes from the authenticated session.
- Pack prices before GST: 100 credits INR 900, 500 INR 4,000, 2,000 INR 14,000.
  Plans before GST: Starter INR 1,999, Growth INR 5,999, Chain INR 14,999 monthly.
  All amounts sent to Razorpay include 18% GST and are calculated in integer paise
  on the server. These follow the indicative commercial requirements; pricing
  and margins still need business validation before live launch.
- Annual subscriptions charge ten monthly prices and grant twelve months of
  credits upfront per annual charge. Monthly subscriptions grant 300/1,000/3,000
  credits per captured charge. Razorpay plan amount, currency, interval and period
  must match the server configuration before a subscription can be created.
- A checkout signature is required, followed by an authenticated provider lookup:
  the payment must be captured, unrefunded and match the stored order, amount and
  INR currency. A signature alone does not grant credits.
- Webhooks use the raw request bytes and a separate HMAC secret. The webhook is
  mounted before JSON parsing and browser/token authentication so Razorpay can
  reach it; signature verification is its authentication. Browser billing actions
  still require same-origin requests, store authentication and the owner role.
- Payment ids and subscription invoice ids prevent duplicate credit grants.
  Webhook event ids deduplicate repeated deliveries. Current subscription state is
  fetched from Razorpay so an old activated event cannot reverse a current halt.
- Halted subscriptions receive three days of grace from the first observed halt.
  Afterwards paid generation returns HTTP 402 `subscription_past_due` before
  calling AI. Cancelled/completed subscriptions keep their remaining paid period,
  then the same grace applies. Saved avatars, looks and approved reuse stay free.
  Payment recovery restores access, but cannot remove an admin suspension.
- Captured payment, ledger grant, invoice row and financial-year sequence commit
  in one SQLite transaction. PDF generation or SMTP failure cannot undo a payment
  or trigger another charge. PDFs are stored in the database and can be regenerated
  from the immutable purchase snapshot after an interruption.
- Invoices use `FY26-27/0001` numbering in Indian financial years, SAC 998314,
  CGST/SGST when supplier and buyer state match, IGST otherwise. Legal name,
  address, state, email and optional customer GSTIN are captured before purchase.
  A supplier GSTIN is required to enable this taxable billing configuration.
  Have the supplier's accountant verify invoice/tax details before live use.
- Invoice emails carry the PDF attachment. Pending delivery is retried on startup
  and every five minutes (ten invoices per pass); downloads remain available.
  SMTP acknowledgement lost during a crash can result in a duplicate email, but
  never duplicate credits or invoices.

## API (owner session required)

| Method | Path | Input / result |
| --- | --- | --- |
| GET/PUT | `/api/billing/details` | `{name,address,billingEmail,stateCode,gstin}`; GET returns `{details}` |
| POST | `/api/billing/order` | `{pack:100\|500\|2000}` → orderId, public keyId, amount, currency, credits |
| POST | `/api/billing/subscribe` | `{plan:"starter"\|"growth"\|"chain",period:"monthly"\|"annual"}` → subscriptionId, keyId |
| POST | `/api/billing/verify` | `{orderId,paymentId,signature}` → invoiceId after capture verification |
| GET | `/api/billing/invoices` | This organisation's invoice metadata |
| GET | `/api/billing/invoices/:id` | Private PDF download |
| POST | `/api/billing/webhook` | Razorpay signature and event-id headers; no browser session |

Handled webhook events: `payment.captured`, `payment.failed`,
`subscription.activated`, `subscription.charged`, `subscription.halted`,
`subscription.cancelled`, `subscription.completed`, `subscription.resumed`.
Events for purchases not created by this application do not grant credits.
A failed payment is recorded without changing the balance. Later failure events
cannot overwrite a captured payment. Unknown events are acknowledged without
business-state changes.

## Configuration and deployment

Use the instance's ignored `.env`; never use `VITE_` variables or paste secrets
into source control. `compose.accounts.yaml` passes these settings to the backend:

- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- `RAZORPAY_PLAN_STARTER`, `RAZORPAY_PLAN_GROWTH`, `RAZORPAY_PLAN_CHAIN` and each
  corresponding `_ANNUAL` value. Create plans in Razorpay **including GST**.
  Monthly plan interval = 1, period = monthly; annual interval = 1, period = yearly.
- `FORME_LEGAL_NAME`, `FORME_ADDRESS`, `FORME_BILLING_EMAIL`, `FORME_GSTIN`,
  `FORME_STATE_CODE` (two-digit Indian state code).
- Existing `SMTP_URL` and `SMTP_FROM` for invoice delivery. `MAIL_FROM` is also
  accepted by the mailer in environments where it is supplied directly.

Configure Razorpay's webhook URL as
`https://studio.marketingadda.com/api/billing/webhook` with the listed events and
its separate webhook secret. Start in test mode. Test keys and test plan ids must
belong to the same Razorpay account. Checkout JavaScript/card handling is C6;
no card data is collected by this backend.

Back up the existing database and retain its accounts volume, then deploy:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Without payment configuration the existing pilot continues; new payment creation
returns a clear 503. No production credentials or supplier tax information have
been configured from the development workspace.

## Recovery and remaining work

Provider calls are not automatically retried. A subscription creation timeout
retains a local `creating` reservation; an authenticated webhook with the matching
local reference can reconcile a lost response. Check the Razorpay dashboard before
manually clearing an orphan reservation. Do not repeatedly create subscriptions to
recover from a timeout. A failed database write after order creation may leave an
unpaid orphan order in Razorpay; no credits are granted for unknown local orders.

Upgrade/cancellation controls, refunds/credit notes, plan/pack credit expiry,
trial lifecycle, usage views and live checkout UI are not added by C5. Credit
expiry requires ledger allocation rules and is not silently implemented as a
balance reset. Before selling plans, finish R1, validate tax/business policies,
and run a Razorpay test-mode checkout and real SMTP delivery in staging.

Tests inject the payment provider and email transport. They cover signatures,
capture/amount/currency/refund checks, duplicate and out-of-order events, owner
permissions and tenant isolation, failed payments, concurrent invoice numbering,
rollback, CGST/SGST/IGST, persisted email retries, annual pricing, subscription
halt/grace/recovery, and protected-mode webhook access. No external payment, AI or
email requests are used in automated tests.

Release validation: all 122 backend tests, all 58 Playwright browser tests and the
production web build passed. The payment-specific suite contains 13 tests. Live
Razorpay/SMTP access and the Lightsail deployment were not exercised here.
