# Commercial C1 — tenancy foundation

Version `0.16.0-alpha.1` is the first R1 foundation update. It does not enable
subscriptions, billing, staff login or store switching. Those follow in C2–C8;
stable 0.16.0 remains the completed R1 release.

When account storage starts, `migrateTenancy(db)` adds organisations, stores,
users, memberships and invite records. Every legacy account not already mapped
becomes one **active pilot** organisation, one store using the original account
id, and one owner user. The scrypt salt and password hash are copied unchanged.
This follows implementation Task C1; the broader design's trial credits and session
conversion belong to later tasks. No credits are granted or charged here.

The schema, nullable avatar/customer and look/purchase columns, and account
backfill run in one `BEGIN IMMEDIATE` transaction. A failure rolls back all C1
writes and aborts startup; restarting after resolving the cause safely retries.
Repeated successful startups skip existing stores and preserve their metadata.
Foreign keys constrain memberships and prevent invitations from combining a store
with another organisation. Repository readers return membership-scoped store
metadata without password hashes or salts.

Existing accounts, sessions, APIs, saved images, catalogue and adaptation results
remain unchanged. The look insert now names its columns so it works with the
added nullable columns. The corresponding capacity-test fixture names the same
columns; its assertions and API expectations are unchanged.

## C2 handoff

Legacy accounts remain the login authority during C1. Accounts registered after
startup continue working immediately and are backfilled on the next startup.
Password resets still update the legacy account and revoke its sessions. Therefore
C2 must reconcile any later legacy credential changes before switching login to
`users`; the copied credentials must not be treated as authoritative prematurely.
C2 also needs atomic provisioning for new registrations and session conversion.
Existing mapping rows are deliberately not overwritten on every startup.

There are no new routes, staff invitations, emails, provider calls or frontend
screens in this update. The invite table is preparation for C3. No APK is built.

## Deployment

Use the existing accounts volume and take a normal database backup before the
update. Deploy the web image with the operator's shared Compose configuration:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

The migration runs automatically when `TRYON_DATA_DIR` is configured. No new
secrets or environment variables are required. Existing account login and saved
avatar/look retrieval should be checked after deployment.

## Verification

Tests cover a pre-C1 database with three independent stores, all saved-data tables,
legacy sessions and password hashes; repeated startup; empty databases and later
signups; transaction rollback and retry; schema constraints; membership isolation;
and disabled-user filtering in the new repository readers. Existing account tests
continue to verify login, password recovery, save/reopen, capacity and isolation.
The commercial roles are not yet connected to HTTP authentication; C2 will test
that integration.

Release validation: `npm test` passed all 84 tests; `npm run build` passed;
Playwright account, garment-catalogue and saved-avatar suites passed all 7 tests.
These checks used local databases and stubbed providers. The Lightsail production
database and deployment have not been accessed or migrated from this workspace.
