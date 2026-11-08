# Jewellery release candidate — 0.21.0-rc.1

J1–J11 studio features are implemented. J12 adds private evaluation and release
preparation. This is a release candidate, not approval for general availability.

## Automated verification

Verification date: 2026-11-08, Node 24 and managed Chromium.

| Check | Result |
| --- | --- |
| `npm test` | Passed: 423 backend tests on the final code |
| `npm run build` | Passed; existing >500 kB main-chunk advisory |
| `npm run test:e2e` | Passed: 135 browser tests; private review test passed again after the final statistics changes |
| Focused evaluator | Passed, including real bundled face models and different-face fixtures |
| Runtime staging | Passed production health, built web page and evaluator imports with the Dockerfile's selected source files |
| Real Docker image / Lightsail deployment | Not performed |
| APK / Apple build | Not performed; web-only change |
| Live paid generation / real customer pilot | Not performed |

The evaluator tests exercise actual 30 × 10 matrix expansion, explicit storage
consent, unique source hashes, missing/failing/repeated candidates, strict
review imports, exact image binding, private file permissions, descriptor
cleanup, inclusive rate boundaries and store pilot counters. A full perfect
fixture, accepted-only download set or overlay run cannot claim measured AI
quality targets. Missing distances and negative samples stay visible/unknown.

Runtime route tests cover owner/manager/staff rights, tenant/origin isolation,
consent and ownership, exact free reuse and refunds. All 17 post-request check
and provider failure codes are tested for a single refund, one attempt, no
reusable output/receipt, no raw provider/key exposure and no automatic retry.
Browser coverage includes portraits, paid jewellery, free overlays, stacking,
compare/complete looks, sizing and local evaluator import/export, filters,
mobile layout, memory-only drafts and zero outbound review requests.

## Pilot evidence still required

| Evidence | Status |
| --- | --- |
| 30 distinct items × 10 consented portraits, all-candidate live outputs and staff scoring | Pending collection |
| Correct placement ≥85%, recognizable jewellery ≥80% | Not measured |
| Same-person identity false rejects ≤5% | Not measured |
| Independent 50+ portrait calibration cohort with subgroup and negative-pair review | Pending |
| Model/provider cost, latency, failures and fine-design quality | Not measured live |
| Three jewellers over ≥60 days, pieces/visit +50% and ≥10 shares/day/store | Not measured |
| Separate commercial C16.5 service/legal/cost and pilot evidence | Still pending |
| Pilot-only deployment and production threshold review | Not performed |
| General availability | Not approved |

The [evaluation guide](JEWELLERY_EVALUATION.md) provides manifest, review and
summary commands. Generated runs are private local artifacts, never committed
customer evidence. Fixture screenshots show controls only and are labelled as
fixtures; they do not demonstrate live jewellery quality. See the
[desktop](testing/jewellery-evaluation/desktop.png) and
[mobile](testing/jewellery-evaluation/mobile.png) review screens.

`TRYON_JEWELLERY` defaults off. It is deployment-wide: an operator must isolate
pilot stores rather than assume a per-store allowlist. Neither the evaluator nor
this release changes the flag, provider, price/credits, identity threshold,
acceptance checks, storage permissions or retry behaviour. Summary reports
always leave `rolloutApproved: false` and `thresholdChanged: false`.
