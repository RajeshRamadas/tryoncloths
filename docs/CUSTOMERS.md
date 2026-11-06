# Customer profiles — C7

Web `0.16.0-alpha.7`. Customer lookup and reusable avatars require account storage
(`TRYON_DATA_DIR` on a persistent volume). No new environment variables or
external services are needed. The Android package is unchanged.

## Store workflow

1. Sign in and open **Customer details**. Use **Find customer by mobile** (at least
   three starting digits), or **New customer**.
2. Save the name and mobile number. Notes and approximate measurements are optional.
   Marketing consent starts unchecked and is separate from photo/generation consent.
3. Select the customer before adding photos or importing a PNG. Selection clears
   the previous customer's active photos, preview and approvals. Saved measurements
   fill the session fields; changing session measurements does not silently rewrite
   the profile. Edit the profile explicitly when measurements change.
4. Generate with the usual photo and storage consent. The result is automatically
   linked to the selected customer. A session may also proceed without a customer;
   those avatars appear under **Unassigned avatars**.
5. **Saved avatars** groups account avatars by customer. Reopening an account avatar
   or look restores its customer association without generating again. Opening a
   downloaded PNG/local copy uses the currently selected customer when subsequently
   saved to the account. Review that selection before saving.
6. Find/select a customer and choose **Edit customer** to update contact details,
   notes, measurements or marketing consent. **Delete customer** requires a separate
   permanent-deletion confirmation.

Phone numbers normalize to E.164: ten Indian digits use `+91`; other countries
require an explicit `+` country code. A leading zero on an eleven-digit Indian
number is accepted. This is format normalization, not phone ownership verification.
Search matches a prefix of the stored number's last ten digits. Enter the full
international number to search its national suffix. Each response is limited to 50
customers; narrow the prefix or use the API's `offset` for additional pages.

## API and tenancy

All routes use the signed-in session's active store and accept owner, manager and
staff roles. Mutations require the same website origin. No client-supplied store ID
is trusted. Missing and other-store customer IDs both return 404.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/customers?offset=0` | Up to 50 newest profiles |
| GET | `/api/customers/search?phone=987&offset=0` | Indexed phone-prefix lookup |
| POST | `/api/customers` | Create; 409 for a duplicate normalized number in this store |
| GET | `/api/customers/:id` | Customer profile |
| PATCH | `/api/customers/:id` | Update supplied profile fields |
| DELETE | `/api/customers/:id` | Erase profile and linked data atomically |

Create/update fields: `name`, `phoneE164`, `notes`, `measurements` (null or
`{heightCm, weightKg}`), `marketingOptIn`, `optInSource`. Consent timestamps are
server-owned. Sources are `in_store` or `whatsapp`; the web form records in-store
consent. Recording `whatsapp` through the API is not evidence of a verified WhatsApp
integration (C9 remains pending). Opting out clears `optInAt` and `optInSource`.

`POST /api/avatars` and `POST /api/personalize` accept optional `customerId`.
Ownership is checked before image processing/provider work and again before saving.
Avatar listings include `customerId`, `customerName` and `customerPhone`. Contact
fields are not added to the browser's older IndexedDB avatar records.

Identical image bytes deduplicate within a customer, not across customers. New
looks deduplicate within an avatar. Existing unassigned avatars and older looks
remain readable; there is no automatic reassignment or inference from avatar names.
Saving a PNG for a customer can therefore coexist with an older unassigned copy.

## Migration and erasure

Startup adds `customers`, indexed phone suffixes, ownership triggers and the C8
`share_links` table, transactionally and idempotently. Existing account assets are
preserved. The sharing schema has a look foreign key with delete cascade; sharing
endpoints/public pages are still C8 work.

Customer deletion removes associated avatars, their looks, garment adaptation
results and share links in one SQLite statement with cascades. It preserves the
store's reusable clothing catalogue, unrelated customers and other stores. A
customer deleted during generation cannot be recreated by autosave; a paid result
may still finish in the requesting browser, with a save-failure message and no
automatic retry. Customer erasure does not issue another AI request.

Erasure covers live database records, not previously downloaded files, separately
saved unassigned copies, another open browser's memory, provider retention or
backups. Operators must apply their backup/WAL retention policy as well; this
feature alone is not a claim of full DPDP compliance. Original input photos are not
stored in customer profiles.

## Validation and deployment

`tests/customers.test.js` covers normalization, consent, indexed lookup, store and
role isolation, duplicate images, cascaded erasure, in-flight deletion and linked
autosave. `tests/browser/customers.spec.js` exercises mobile creation, lookup,
generation, grouped reopening, saved looks, editing, deletion and selection reset
against an isolated real database. Provider output is stubbed; tests make no paid
AI requests. Existing backend/browser suites and production build are also run.

On the existing Lightsail instance, preserve the account data volume and deploy:

```bash
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

The shared Compose file is operator-local. No production deployment is performed
by these repository tests. C8 is next: expiring look links and WhatsApp click-to-chat.
