# Commercial C3 — staff invitations and management

Web `0.16.0-alpha.3` adds **Staff** to the account panel for owners and managers.
Owners invite users as staff, managers or owners; managers may invite and manage
staff in their own active store only. Invitations are emailed, expire after seven
days and can be used once. No Android APK is rebuilt.

## Server setup

Keep these settings on the server, never in `VITE_` variables:

```dotenv
TRYON_PUBLIC_URL=https://studio.example.com
SMTP_URL=smtps://username:password@mail.example.com:465
SMTP_FROM=Forme <staff@example.com>
```

Use a verified From address and SMTP credentials from your provider (for example
SES SMTP credentials). Percent-encode special characters in SMTP URL credentials.
`TRYON_PUBLIC_URL` is the actual studio origin, with no path, query or fragment;
HTTPS is required in production. The accounts Compose override passes these
variables into the application. Configure the SMTP provider's network access and
sender verification separately; none are provisioned by the application.

The emailed link must open the browser account website; a deployment protecting
all APIs with a shared bearer access code must also arrange that access for the
recipient. Public browser account mode works with account authentication for
staff APIs. Without mail configuration, invitations fail with an actionable 503;
no invitation token or fallback link is returned to the inviter or logged.

## Staff workflow

1. Sign in, select the store and open **Staff**.
2. Enter a staff email, select a permitted role and send the invitation.
3. The recipient opens the link, enters their name and chooses a 12–128 character
   password. Existing Forme users must enter their **current** password; accepting
   adds the membership without changing their existing name, password or access.
4. After acceptance, sign in with the invited email. Staff see their name and
   role; users with multiple memberships can switch stores.
5. Owners change roles; owners and managers can disable or enable staff within
   their authority. Disabled users lose all sessions immediately and cannot log in.

Staff lists are limited to the selected store. The API permits owners to select
another store only if they hold a management membership there in the same
organisation; use the store switcher in the UI. Managers cannot promote staff or
manage managers/owners. The last active owner of any affected store cannot be
disabled or demoted.

Disabling is an account-wide operation. If the user also belongs to stores outside
the administrator's authority, it is refused with 403; it never silently disables
another business's user. Re-enabling does not restore deleted sessions. Invitations
for an existing membership are refused; use Staff to change its role. Password
recovery continues through the operator CLI.

## API and security

- `POST /api/invites {email,role,storeId?}`: owner/manager, same origin; returns
  `{ok,expiresAt}` after mail transport acceptance. Delivery failures remove the
  unused token; mailbox delivery itself depends on the mail provider.
- `POST /api/invites/accept {token,name,password}`: public with same-origin and
  rate/concurrency limits. The emailed 256-bit token supplies membership consent.
  Existing accounts additionally require their current password.
- `GET /api/staff?storeId=`: owner/manager; returns safe profile and role fields.
- `PATCH /api/staff/:user {role?,disabled?,storeId?}`: owner/manager, same origin;
  all membership, authority and last-owner checks run transactionally.

Only a SHA-256 token hash is stored. The token travels in the email URL fragment,
which is not sent in HTTP paths or referrers, and the page removes the fragment
from browser history after reading it. Customer photos and provider credentials
are unrelated to staff invitations. Acceptance rechecks expiry, credentials and
single-use state in a transaction after password hashing. A failed transaction
creates no partial user/membership and does not consume the invite. Pending
invitations expire; invite revocation/listing and phone invitations are not C3.

## Validation

All 96 unit/API tests, the production build and all four account/staff browser
tests passed. Coverage includes owner/manager/staff/other-store/anonymous access,
tampered/expired/reused links, concurrent acceptance, rollback, existing-user
password protection, failed mail delivery, cross-store disabling, last owners,
login and immediate revocation, plus a 390 px browser check.

Mail tests inject a transport; browser tests capture invitations in memory.
No real email, paid AI request, production migration or deployment was performed.
