# Store analytics — C14

Web version `0.17.0-alpha.1` adds **Analytics** beside Usage for signed-in owners
and managers. No APK rebuild is needed. Open `/analytics`, choose dates and a store,
then apply the filters. Owners can choose any store in their organisation or all
of them together. Managers can report only on their active store; staff cannot
open reports or export them. These rules are enforced by the API, not just the UI.

The dashboard includes generated/reused try-ons, fitting sessions, purchased looks,
credit use, daily activity, store/staff/product performance, and products tried
without an associated purchase mark. Expand **Show daily data** for the accessible
table behind the chart. The product tables show the first 50 products; **Download
analytics CSV** includes every tracked product for the displayed filters, including
when draft filters have changed without being applied.

## What the numbers mean

- Dates are inclusive calendar days in `Asia/Kolkata` (IST). The default is the
  latest 30 days. Reports accept 1–366 days and at most one million events; narrow
  the range or store selection if that limit is exceeded.
- A fitting session begins when the outfit editor is mounted for an avatar. All
  generated and explicitly opened cached adaptations in that editor share its
  session ID. Reopening the editor after a reload starts a new session. Sessions
  count only after at least one successful try-on. Automated new-arrival previews
  have one session per campaign item. Older clients without a session ID use a
  request ID as a single-try session.
- Successful AI results count as generated try-ons. **Use saved result** counts
  as a reused try-on and consumes no AI credit. Looking up an adaptation, opening
  an existing saved look, local sample-layer changes, rejected requests, and failed
  generation do not count as try-ons. Request IDs prevent duplicate event counts.
- Avatar generation counts successful provider results, including when subsequent
  account saving fails. Distinct look saves count once per saved image/avatar ID;
  renaming the same look does not increase that count.
- Purchased looks are active purchase marks reconstructed **as of the selected
  end date**, whose latest mark falls in the period. Undo removes that mark from
  a report that includes the undo date. Undo after the report end does not rewrite
  the earlier report. Re-marking a look counts it once in its latest mark period.
  Deleting customer data preserves the opaque event history and aggregate counts.
- Purchase/session is purchased-look marks divided by sessions with at least one
  try-on in the range. Several purchased looks per visit can exceed 100%. No
  denominator displays a dash. A mark for an old saved look can be unattributed
  to any session in the selected period; the dashboard reports that separately.
- Product purchase attribution uses catalogue IDs explicitly linked to the saved
  look. With stacked outfit edits this is the look's product ancestry, including
  earlier variants; it is not a verified final basket, unit sales, payment revenue
  or fit accuracy. Raw uploaded products without a catalogue ID are reported as
  untracked. Old labels are never guessed into catalogue matches. Deleted products
  retain an opaque ID and appear as “Deleted product”.
- Staff try-ons belong to the acting staff member. Staff purchases belong to the
  person who marked the purchase, which may differ from the fitting staff member.
  Anonymous public views appear under unattributed staff. Public preview-page
  views may include bots; image requests and HEAD probes do not count as views.
- Credits come from canonical committed ledger holds, split into AI and photo
  pools. Uncommitted holds, refunds and grants are excluded. This is actual
  committed usage, not an estimate based on the number of events.

New fitting/product attribution begins with this deployment; its start date is
displayed on the dashboard. Older sharing/purchase events and ledger entries can
still appear, with incomplete attribution. No historical events are fabricated.
`catalogue_photo` counts C13 previews created, including included regenerations.
Photo credits count approved base images and successful extra paid regenerations.
Report viewing itself makes no paid provider calls.

## Monthly owner emails

Monthly reports are enabled by default for owners and can be disabled in Analytics.
The preference belongs to the owner user across all of their organisations. Each
enabled owner receives one report per organisation, containing the previous
calendar month's totals and a CSV attachment with all tracked products. Emails
contain aggregate metrics and store/staff/product labels, not customer names,
phones, photos, measurements or share tokens.

Configure the existing server settings:

```ini
TRYON_PUBLIC_URL=https://studio.marketingadda.com
SMTP_URL=your_smtp_connection_url
SMTP_FROM=your_verified_sender_address
```

`MAIL_FROM` remains an alternative to `SMTP_FROM`. Keep credentials server-side
and outside Git. Report email is disabled unless SMTP and a public HTTPS address
are configured. The web UI shows when configuration is missing. These settings
are also used by existing transactional emails; see [staff invitations](STAFF_INVITES.md).

Production `server/index.js` checks once a minute, starting at **09:00 IST on the
1st**. If the server was down it catches up later that month. It processes up to
50 owner/organisation reports per tick. Development and app test instances do not
run the scheduler. The database claims each report before sending, so restarting
or running multiple instances does not resend it. A send left in progress for an
hour becomes `unknown`. An SMTP error is also `unknown`, because delivery may
already have occurred; neither is retried automatically. Report construction
errors become `failed`. Disabled recipients are skipped. The owner dashboard lists
the last 12 report states for the active organisation. `sent` means the SMTP
server accepted the message, not proof of inbox delivery.

Every email includes an unsubscribe link. Opening it shows confirmation without
changing preferences, so link scanners do not opt owners out. Submitting the form
or an email client's one-click unsubscribe POST disables the emails. Tokens are
unguessable, stored as hashes, expire after 366 days, and reveal no recipient
identity on the page. Turning emails on again revokes old unsubscribe links.

The reverse proxy must forward `/api/*`, `/analytics` and `/reports/*` to the app.
The existing whole-host Lightsail proxy already does this. Keep the persistent
database volume when rebuilding; it holds report delivery claims and preferences.

## API and data

- `GET /api/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&store=STORE_ID` — report JSON;
  an owner may pass `store=all`. Omitted store means the active store.
- `GET /api/analytics.csv` — same filters, all product rows; formula-like labels
  are escaped for spreadsheet use.
- `GET /api/analytics/preferences` — owner preference, email configuration and
  organisation delivery states.
- `PUT /api/analytics/preferences {"monthlyEmail":false}` — owner-only, with the
  existing same-origin/session checks.

Event references use an explicit allowlist of opaque IDs and small operational
labels. They exclude images, raw tokens, customer contacts and API credentials.
Customer erasure removes linked fitting sessions and look attribution with their
avatars/looks; aggregate events and accounting entries remain. Existing database
backup and retention policies still apply.

## Validation and rollout

API tests verify exact event aggregates, undo chronology, IST boundaries,
organisation/store isolation, product ID collisions across stores, ledger totals,
deduplication, event data filtering, CSV escaping, real route attribution, monthly
scheduling, unsubscribe and uncertain-delivery handling. Browser tests exercise
mobile reporting, filters, CSV downloads, roles and public unsubscribe confirmation.
AI and SMTP are mocked; no paid generation or actual report email is sent by tests.
Live SMTP delivery remains to be verified with your configured sender.

Update the existing Lightsail web container with:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

This is a web update, not a deployment performed by Codex. Commercial integration
rollout remains alpha until the configured live services are validated. The next
implementation task after C13 catalogue photos is **C15 — Store branding**.
