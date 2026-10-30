# Commercial C2 — users, sessions and store roles

Web `0.16.0-alpha.2` moves authentication from legacy store accounts to individual
users. Pilot owners keep their email/password, saved avatars, looks and catalogue.
New registrations atomically create an organisation, store, user and owner membership.
This is the next commercial foundation release; billing and invitations remain
C3–C8 work. No Android APK is rebuilt.

## Sessions and migration

Startup adds nullable `user` and `store` foreign keys to sessions in a transaction.
The existing `account` column remains a compatibility mirror of the active store.
Tokens remain SHA-256 hashes; cookies retain HttpOnly, SameSite=Strict and production
Secure settings, with their original expiry.

At the first C2 startup, legacy account credential changes made during C1 are
copied to their matching owner users, once, under an `auth_migrations` marker.
Subsequent starts preserve user credentials. An old cookie is upgraded on first
use to that account's original email-matched owner, only if active and still an
owner. Unknown, expired or disabled sessions do not authenticate. Membership and
role are rechecked on every request. Password recovery now updates the user and
revokes all their sessions, including sessions switched to another store.

## API and UI

`GET /api/account` retains `enabled`, `signupAllowed` and `account`. The account's
`id` remains the store id; it additionally includes `user: {id,name,role}` and the
organisation id `org`. Responses add top-level `user`, `role` and `stores` (only
the authenticated user's active memberships). Login/register return these same
identity fields without credentials.

`POST /api/auth/switch-store` takes `{storeId}` and requires a same-origin request,
a valid session and an owner, manager or staff membership in the destination.
Anonymous requests receive 401; non-members receive 403 without changing the
session. Store ids in other request bodies do not change the active store.
`requireRole(...roles)` is available for later role-restricted routes, after
request authentication has populated `req.account`.

The account panel shows the user's name and active role. Users with multiple
memberships see an Active store selector. Switching resets the current customer
session and reloads the saved library for the destination store; refresh preserves
the selection. Store and staff provisioning screens/invitations are C3 work.

## Deploy and verify

Use the existing persistent account volume and back up the SQLite database before
deploying. No new secrets are required. Check an existing owner login, an old
cookie, saved data and password recovery after updating. Migration is automatic;
rolling back to pre-C2 authentication after staff access is introduced is not
supported, because the old server does not understand user memberships.

Automated tests use isolated local databases and mocked providers. No paid provider
calls, production database migration or production deployment are part of validation.

Release validation: all 88 unit/API tests passed; `npm run build` passed; all 8
Playwright account, catalogue and saved-avatar checks passed, including a 390 px
store-switch flow and persistence across reload.
