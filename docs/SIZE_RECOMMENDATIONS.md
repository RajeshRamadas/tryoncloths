# Size guidance and purchase tracking — C12

Web `0.16.0-alpha.11` adds customer body measurements, manager-maintained size
charts, optional size suggestions below saved-product try-ons, and purchase marks
on saved looks. These actions make no AI calls or credit deductions. No Android
APK was rebuilt.

## Store workflow

1. In **Customer details → Find customer → Edit customer**, record actual chest,
   waist and/or hip circumferences in centimetres. Height and weight remain
   optional. Do not enter flat garment widths or copy estimated values as measured
   dimensions. An optional body profile controls the fallback estimate; otherwise
   the most recently saved customer avatar supplies its profile.
2. Owners/managers open **Size charts** from store navigation. Create rows for each
   exact product brand and clothing type, or download the CSV template and import
   it. Match the brand label used in Catalogue. Distinct sizing ranges (for example,
   separate men's/women's collections) need distinct, matching brand/range labels;
   the current lookup key is brand + clothing type, not gender or collection.
3. Enter nominal chart targets in cm and a label such as S, M, L or 32. Use the
   same measurement fields throughout a range. The chart type must match the
   product's stored type: shirt and tshirt, for example, are different lookups.
   Blazers, suits and sarees have their own rules; see
   [sarees, blazers and suits](SAREES_AND_SUITS.md#size-charts-and-suggestions).
4. Reopen a customer-associated avatar, select a saved catalogue product, and try
   it on. Under the result, **Suggested M · High** expands to explain the dimensions,
   ease allowance and alternatives. Guidance appears for the most recent stored
   product when no local sample layers cover the result. Opening a standalone PNG
   or older look without a product ID cannot reconstruct its brand/chart association.
5. Missing charts or unavailable guidance never block generating, reviewing,
   downloading or saving an outfit. Size suggestions do not guarantee fit, fabric
   stretch or drape, and do not check per-size stock availability. Confirm the
   product's available sizes and fit with the customer.
6. After saving a look, enter the confirmed **Purchased size** and choose **Mark
   purchased**. The app records the actual signed-in staff member and server time.
   This is a manual conversion mark, not checkout, an order, stock deduction or a
   payment. One purchase-size value is stored per look, not per garment in an outfit.
   It is deliberately not prefilled from an estimated suggestion.
7. Purchase status also appears under **Saved avatars → View looks**. **Undo purchase
   mark** corrects mistakes; then a different confirmed size can be recorded.

Chart management requires owner/manager. Staff can edit customer measurements,
request size guidance and mark/undo purchases within their active store. Clothing
charts cover chest/waist/hip fields; footwear requires foot measurements and is
excluded from this release rather than guessing shoe size from body dimensions.

## Measurements and validation

| Field | Allowed range |
| --- | --- |
| `heightCm` | 140–210 cm |
| `weightKg` | 35–200 kg |
| `chestCm` | 60–200 cm |
| `waistCm` | 40–220 cm |
| `hipCm` | 50–240 cm |
| `bodyProfileId` | One of the eight existing body profile IDs |

All body measurement fields are optional. API PATCH merges supplied measurement
fields with existing ones; null deletes an individual field, and
`measurements:null` clears the profile measurements. The web form submits explicit
nulls for cleared inputs. Existing height/weight records remain compatible.
Changing these values does not redraw or overwrite saved avatar images or their
original height/weight. If profile measurements are cleared, a retained avatar can
still provide the explicitly Low-confidence fallback described below.

## Scoring and confidence

Charts use positive nominal chest/waist/hip targets in the same ranges as body
measurements. Compare only fields present in the customer's real measurements and
in every size row of that matching chart, so a sparse row cannot win simply by
omitting a difficult dimension. For each size:

```text
score = sum(max(0, abs(customer[field] - chart[field]) - ease[field]) / chart[field])
ease: chest 2 cm, waist 2 cm, hip 3 cm
```

Pick the smallest score. Ties use chart `sortOrder`, then size label. Alternatives
are the next three sizes with scores. The response's score values are rounded to
six decimal places; selection/confidence use the full precision.

- **High:** at least two measured comparable fields and a strictly worse next size
  scoring at least twice as badly. Two zero scores are tied, so never High.
- **Medium:** one measured field, or a close/tied second size. Girths estimated from
  the full-body photo (`fitSource: "photo"`) are capped at Medium, and the reason
  starts with "Chest, waist and hip were estimated from the full-body photo, not
  taped." The `source` is `photo`.
- **Low:** insufficient comparison (such as only one row with two measured fields),
  missing comparable dimensions, or any height/weight/profile estimate.

If actual circumference measurements exist, do not supplement them with guessed
fields to raise confidence. If no real circumference was recorded at all, estimate
chest/waist from height, weight and the body profile using the illustrative table
below. Prefer both height/weight values from the customer profile; otherwise use
both values from the newest associated saved avatar. The profile comes from the
explicit customer choice or that avatar. Without a valid profile or valid
height/weight, return no size and Low confidence.

| Profile | Base chest / waist | Base height / weight |
| --- | --- | --- |
| slim | 90 / 74 cm | 175 cm / 65 kg |
| regular | 98 / 84 cm | 175 cm / 72 kg |
| athletic | 106 / 82 cm | 180 cm / 80 kg |
| broad | 114 / 100 cm | 175 cm / 90 kg |
| f-slim | 82 / 66 cm | 165 cm / 52 kg |
| f-regular | 90 / 74 cm | 165 cm / 62 kg |
| f-athletic | 96 / 76 cm | 170 cm / 68 kg |
| f-curvy | 106 / 88 cm | 165 cm / 78 kg |

Adjustment: chest adds `0.2 × height difference + 0.5 × weight difference`; waist
adds `0.15 × height difference + 0.65 × weight difference`. Clamp to the validated
adult ranges and round to one decimal place. This table is **uncalibrated**, not an
empirically validated fit model. It never infers hip, never writes guessed values
back to the customer, never analyzes photos and always reports **Low** confidence,
even if its predicted dimensions exactly match a chart row. Confirm real
measurements before relying on it.

### Girths from the full-body photo

The studio can also estimate chest, waist and hip girths from the full-body photo on
the staff device ([measurements in cm](BODY_PHOTO_CHECK.md#measurements-in-cm)).
Staff choose **Save to [customer] for size suggestions** to store them with
`fitSource: "photo"`. They are then used like measured girths, but capped at Medium
confidence. The button is not offered when the customer already has taped girths.
When staff edit any of the three girths in **Edit customer**, `fitSource` becomes
`tape`.

## Charts and purchase API

All identities are scoped to the active store from the session. Manager actions
and purchase mutations require the same studio origin. Other-store resource IDs
return 404 without disclosing customer or chart data.

| Method / route | Access and behavior |
| --- | --- |
| GET `/api/size?customer=<id>&garment=<id>` | Staff+: `{size,confidence,reason,alternatives,source,score?}`; `size:null` when comparable measurements are unavailable |
| GET `/api/size-charts` | Manager+: list 100 rows; optional exact `brand`, `type`, `offset` filters |
| GET `/api/size-charts/:id` | Manager+: read an owned chart row |
| POST `/api/size-charts` | Manager+: create a chart row |
| PATCH `/api/size-charts/:id` | Manager+: edit a chart row |
| DELETE `/api/size-charts/:id` | Manager+: remove a chart row |
| GET `/api/size-charts/template.csv` | Manager+: download the chart template |
| POST `/api/size-charts/import` | Manager+: multipart CSV `file`, up to 5 MB / 10,000 rows |
| GET `/api/looks/:id/purchase` | Staff+: current purchase status |
| POST `/api/looks/:id/purchase` | Staff+: `{size}`; records server time and current staff ID |
| DELETE `/api/looks/:id/purchase` | Staff+: undo the purchase mark |

Chart JSON is `{brand,garmentType,size,measurements:{chestCm?,waistCm?,hipCm?},sortOrder}`.
At least one measurement is required. Labels normalize to uppercase; brand matching
ignores case and repeated whitespace. Identity is `(store,brandKey,garmentType,size)`.
`sortOrder` ranges from 0 to 10000. Partial chart measurement PATCHes merge; explicit
null clears a dimension while retaining at least one. Deleting/editing a chart only
changes future suggestions, never saved avatars or looks.

CSV headers: `brand,type,size,chest_cm,waist_cm,hip_cm,sort_order`. The first three
headers are required; each row still needs a measurement. Blank dimensions clear
those targets when a row is updated. Imports upsert stable IDs, skip unchanged rows
and report invalid rows in `{created,updated,skipped,errors:[{row,message}]}`; download
errors from the page. Duplicate brand/type/size rows within a file are errors.
Malformed CSV/headers/UTF-8 reject the file before writes; valid records are handled
in one transaction. Importing a chart does not read URLs or invoke AI.

No matching product brand/type chart returns **404 `code:no_chart`**. Unknown or
other-store customer/product IDs return a generic 404 instead. The web hint handles
both absent charts and general service failures as optional guidance, independently
of generation and saving controls.

Repeated purchase marking with the same size is idempotent and emits no duplicate
event. A different size requires undo first. Purchase updates and `purchase_marked`
events commit atomically; undo records `purchase_unmarked`. Client-supplied time or
staff fields are ignored. Existing look saves preserve purchase fields. C14 should
use current `looks.purchasedAt` and handle undo events instead of counting every
mark as a separate sale. This tracks conversions per saved look, not order lines.

## Migration, verification and deployment

Startup adds `size_charts` and its lookup indexes transactionally and idempotently.
Existing look purchase fields were added in C1 and are now used. Customer
measurements remain in their existing validated JSON column. Original photos and
personal measurements are never put on public share pages. Customer erasure deletes
associated looks/purchase state; store size charts remain. Events retain their
non-contact look references under the existing analytics retention boundaries.

Tests cover formula/ease values, High/Medium/Low, zero-score ties, partial fields,
Low-only fallback for both body libraries, chart CRUD/import, profile validation,
store/role/origin isolation, purchase idempotency/undo/events, restart and erasure.
Browser tests exercise mobile chart editing/import, measured hints, purchase
persistence and successful generation/saving when no chart exists. AI output is
mocked in those tests; no paid provider requests are made. Real fit accuracy and
retailer chart quality remain unverified; calibrate against actual measurements.

No new environment variables or API keys are required. Preserve the account data
volume and rebuild on the existing Lightsail instance:

```bash
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Next priority in the implementation guide: C14 events and analytics.
