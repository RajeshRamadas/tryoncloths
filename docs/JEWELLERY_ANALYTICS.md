# J13 — Jewellery analytics (JF-3)

Web `0.21.0-rc.2` implements the P1 analytics requirement JF-3 from the
[jewellery requirements](jewellery/REQUIREMENTS.md). It adds a **Jewellery
activity** section to the existing **Analytics** page and separate jewellery
rows in the CSV. It does not generate images, spend credits or approve a pilot.

## Open and filter

On a studio with `TRYON_JEWELLERY=1`, sign in as an owner or manager, open
**Analytics**, then find **Jewellery activity**. Apply the existing date and store filters. Dates use India time
(Asia/Kolkata), with a maximum 366-day range. Owners can select any store or all
stores in their organisation; managers see only their active store. Staff and
other organisations cannot access the report or CSV.

Cards show AI-generated fittings, approved AI reuse, free overlays, sessions,
saved sets, complete and partial comparisons, purchased looks and share links.
Expand the daily, store, staff and product tables for details. Tables scroll
sideways on narrow screens and can receive keyboard focus. Product tables show
up to 50 rows; CSV exports all tracked products for the displayed report.
Editing draft filters does not change a download until **Apply analytics
filters** succeeds. Existing monthly CSV attachments include the same rows.

## What counts

| Metric | Meaning |
| --- | --- |
| AI generated | One jewellery generation accepted by the server; an uploaded product may have no catalogue ID |
| AI reused | An explicit use of an approved exact jewellery adaptation, without another provider call |
| Free overlays | A successfully applied overlay; opening/preparing the placement editor does not count |
| Fittings | AI generated + AI reused + free overlays; this is an operation count, not unique designs or units |
| Sessions | Sessions with at least one recorded jewellery fitting, scoped to a store and avatar studio visit |
| Completed comparisons | An explicit comparison run returned two successful variants, including free cached variants |
| Partial comparisons | An explicit run returned one successful variant and an error for the other |
| Looks saved | First save of a distinct jewellery look image for an avatar; renaming/resaving it does not add a new save |
| Sets saved | A saved jewellery look with at least two item entries; a matched earring pair in one entry is one item |
| Complete looks saved | A saved outfit/portrait board; counted separately from sets, and included in looks saved |
| Purchased looks | Staff purchase marks in the date window that remain active as of its end; undo and re-mark do not inflate the count |
| Share links | Consented share links actually created; a new link is a new share |
| Share views | Share-page GET requests; image retrieval/reopening the staff look does not count; bots may be included |

Each successful comparison variant also counts as its own fitting. A comparison
cost quote, failed first variant, failed fitting, placement preparation, catalogue
browse and read-only reuse lookup produce no successful activity count. A partial
comparison preserves the successful preview; the failed variant keeps the
existing app-credit refund. Counts describe successful server operations, not proof that a device received
or the customer viewed an image. A telemetry write failure is logged with a
fixed code and can leave a reporting gap; reconcile overall credit use with the
ledger. Recording failures never discard paid previews or trigger a provider retry.

The web studio uses one in-memory UUID session per selected avatar/open visit,
shared by AI, overlay, comparison and save actions. Switching views within that
visit preserves it. Reloading/reopening starts another visit; it is **not a
unique customer or a count of every physical showroom visitor**. Older clients
without session IDs fall back to request IDs. Overlay clients without request
IDs remain supported, but cannot deduplicate a repeated manual submission.
Current clients send UUIDs. Repeated operation IDs do not create duplicate
fitting/comparison events. No browser-persistent tracking identifier is added.

## Attribution and history

Successful actions record only whitelisted opaque IDs, enums and bounded item
counts. View, preview mode, jewellery item IDs and item count are captured from
server-owned saved looks at save/share/purchase time. They are not guessed later
from a product or look that may have changed or been deleted. A complete-look
purchase counts once; only its jewellery item IDs enter jewellery product
purchase attribution, even though the generic report may also attribute clothes.
Repeated use of one catalogue item in a set still counts one product attribution
per purchased look, not multiple units sold.

New event types are `jewellery_overlay_applied` and `jewellery_compared` (with a
`complete`/`partial` outcome). Existing generated/reused try-on, saved-look,
share and purchase events gain a server-selected category and relevant view
metadata. The existing all-category AI counters keep their original meaning;
free overlays appear only in the new jewellery fitting metrics. Generic committed
ledger credit totals remain the authoritative overall usage report. Jewellery
CSV rows leave **Credits used** blank because category-specific ledger attribution
is not established; no zero cost or cash revenue is invented from event counts.

Existing events whose source is explicitly `jewellery` can be included as
historical AI fittings. Older look/share/purchase events with no category stay
unclassified and their count is shown. The feature records when detailed
jewellery tracking began. It does not backfill unknown categories from current
inventory or claim that unrecorded past activity was zero. Known snapshots remain
after look/product deletion as anonymous analytics references, under the existing
store analytics retention policy; deleting the store/organisation cascades its
events. No new customer photos, names, contact details, product names, prices,
measurements, HUID or provider payloads are written to events. Product/staff
labels displayed in reports come from the current authorised catalogue/user
records; removed records receive a deletion label.

CSV retains the original first nine columns, appends overlay/comparison/look/
set/share columns, and adds `Jewellery total`, `Jewellery day`, `Jewellery store`,
`Jewellery staff` and `Jewellery product` groups. The same formula-escaping and
store/date scope apply to all rows. Update external CSV consumers for the new
columns/groups rather than treating jewellery rows as additional all-category
sales. A look-level purchase/session ratio can exceed 100%; it is not verified
sales, a unique-customer conversion rate or payment revenue.

## Pilot limits and remaining work

This activity helps operators review usage; it does not measure placement,
design fidelity, identity false rejects or every showroom visitor. It cannot
close the [J12 live pilot gates](JEWELLERY_EVALUATION.md), establish the +50%
pieces-per-physical-visit target, or approve rollout. Collect baseline and pilot
visit/share evidence separately. Customer hand photos (JA-4, P1) remain the next
unimplemented jewellery extension; standard hands templates continue to work.

Enable the existing `TRYON_JEWELLERY=1` pilot flag to expose this report section,
its CSV groups/columns and monthly attachment. With the flag off, those fields
and controls are absent and the CSV keeps its original nine-column format.
No new key or environment variable is needed. Provider restrictions keep their defaults, and analytics
retains the existing owner/manager permissions. No APK, deployment, paid image
request or external message is performed by this change.

[Desktop and mobile fixture screenshots](testing/jewellery-analytics/README.md) show the new section.

## Verification

On 2026-11-09, the final code passed `npm test` (**435 tests**),
`npm run test:e2e` (**136 tests**) and `npm run build`. The existing main-bundle
size advisory remains. Production staging with the Dockerfile's selected source
files passed health, the built web page and authenticated report/CSV checks with
the pilot flag both off and on; no Docker image or deployment was performed.

Coverage includes server-derived category snapshots, deleted-look history,
IST boundaries, purchase undo/re-mark, same IDs in different stores, duplicate
free actions, partial comparison refunds, telemetry failure without retry,
role/store scopes, all-product CSV export, unknown historical data, flag-off
JSON/CSV compatibility and monthly attachment gating. Browser tests inspect
responsive tables, applied-versus-draft filters, downloads and manager/staff
boundaries. All provider and mail services are mocked; screenshots contain
synthetic counts, not live pilot evidence.
