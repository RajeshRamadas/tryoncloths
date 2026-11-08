# J12 — Private jewellery evaluation and pilot release

Web `0.21.0-rc.1` adds offline evaluation tools and release checks for J12.
J1–J11 implement the studio. **Live pilot execution, threshold calibration,
provider quality/cost validation and general release remain pending.** This
release does not deploy the studio, enable a flag or make paid provider calls.

## Prepare a review set

Use Node 24 and `npm ci` in a private checkout on a trusted workstation. The CLI
uses bundled face models; no API key, provider connection or application account
is needed to import and review existing results. Keep real photos and reports
under the ignored `.forme-evaluation/` directory, outside public assets and Git.
On systems without POSIX permissions, use a private encrypted directory with
appropriate local access controls.

```bash
mkdir -m 700 -p .forme-evaluation/jewellery
npm run evaluate:jewellery -- template --out .forme-evaluation/jewellery/manifest.json
```

Set `identityThreshold` to the server threshold used during collection (the
template defaults to 0.45). The [template](evaluation/jewellery.example.json) contains **30 items × 10
portraits**, with no output results, `storageConsent: false` on every source,
and `evidence: fixture` on the provider. It cannot be prepared until the sources
have permission and valid image paths. Set evidence to `live` only for genuine
provider outputs with documented customer/product permission. Evidence, model,
latency and cost labels are operator supplied, not verified provider receipts.
Never relabel a fixture as live. Use anonymous IDs and avoid personal details
in item names, notes and reviewer IDs.

1. Select 30 distinct portrait pieces and 10 distinct consented customer
   portraits, including varied complexion, gender, hair, glasses and face shape.
   Include small/large pieces and different metals. Reusing the same photo under
   another ID is rejected. Distinct hashes do not prove distinct people; staff
   must verify the cohort. Include an additional independent portrait cohort
   before drawing conclusions about identity thresholds.
2. Place sources and outcomes **inside the manifest's directory**. Supported
   sources are still PNG/JPEG/WebP, at least 128 px per side, under 20 MiB and
   25 MP. Approved portrait references must be 3:4, at least 1024 × 1365. Import
   original studio output images at **1152 × 1536**, without rotation metadata,
   labels or screenshots. Images are normalized, flattened and stripped of
   metadata into private PNGs. Input buffers and face descriptors are cleared;
   only scalar identity distances are recorded.
3. Use canonical portrait types: studs, drops, jhumka, nose pin/ring, tikka,
   matha patti, choker, necklace, pendant or mangalsutra (length ≤50 cm). Confirm
   side/pair and physical dimensions. Hands/full-body behaviour stays covered
   by runtime regression tests and needs its own live pilot review.
4. Generate each piece/portrait result through the studio with explicit
   customer/provider consent and the normal app checks/credit controls. This
   CLI **does not generate or retry images**, bypass the API, or accept failed
   outputs into the studio. Pilot collection can incur 300 provider requests
   per provider; agree a budget before collecting. Keep the original private
   operator record separately from the sanitized report.
5. Add one result per item/portrait/provider. Omitted cells become `not_run`.
   Record a fixed `failureCode` instead of an image for failed attempts. Use a
   separate manifest/run for a retry, rather than overwriting a failed attempt.
   Latency/cost are optional measured values; absent values remain unknown.

Example result (inside `results`):

```json
{
  "itemId": "item-01",
  "portraitId": "portrait-01",
  "providerId": "gemini",
  "image": "outputs/item-01-portrait-01.png",
  "latencyMs": 14000,
  "costUsd": null
}
```

Failure codes: `quota`, `timeout`, `network`, `blocked`, `no_image`,
`invalid_image`, `missing_face`, `identity_mismatch`, `framing_changed`,
`hands_changed`, `face_check`, `credentials`, `model`, `unavailable`, `request`,
`response`, `unknown`. Never paste a raw provider response or a key into reports.
A failure row uses `failureCode` and omits `image`.

The template uses `collection: accepted-only`. Studio downloads have already
passed the local identity check: scoring only these survivors cannot estimate
the false-reject rate. Such runs never qualify as measured quality targets,
even if labelled live. For identity calibration, separately authorize a private
provider evaluation that records **all candidates before acceptance**, including
flagged candidates and failed attempts, with a budget and explicit consent.
Import that complete dataset as `collection: all-candidates`. This CLI does not
provide a paid collector, retrieve rejected studio images, or change application
acceptance checks. A rejected candidate may be reviewed only in this private
evaluation, never approved into customer storage through the evaluator.
Collection labels are operator attestations and require an external audit trail.

```bash
npm run evaluate:jewellery -- prepare \
  --manifest .forme-evaluation/jewellery/manifest.json \
  --out .forme-evaluation/jewellery/review-01
```

Preparation makes a **new** directory (0700), with files 0600. It refuses
existing output directories, repeated source images, unknown fields, path
escapes and external symlink targets. A rejected preparation can leave a partial
private directory; inspect/delete that run and choose a new destination. Do not
publish the generated directory. It includes copies of all references/results.
Failed output decoding is recorded as `invalid_image`; a missing face makes an
output unreviewable. Unavailable identity checks remain explicitly unknown.
Repeated output images for different inputs are flagged on all copies and
cannot qualify as a complete pilot matrix.

## Staff scoring

Serve only the prepared folder on loopback on your trusted workstation:

```bash
python3 -m http.server 8787 --bind 127.0.0.1 \
  --directory .forme-evaluation/jewellery/review-01
```

Open `http://127.0.0.1:8787/review.html` on that workstation. Do not expose this
port on Lightsail or use a public web host. The page has no upload/network API,
analytics, persistent browser storage or external assets; CSP blocks outbound
connections. An ordinary `file://` page may block its JavaScript module, so use
the loopback server. Close the server after review.

Enter an anonymous reviewer ID, then score each output **1–5** for placement,
design fidelity, and identity/complexion. A score ≥4 counts as good. Compare
stone count, motifs, proportions, pair/side, scale, skin contact and shadows
with the source. Independently label whether the customer is the **same person,
different, or unsure**. Do not infer that label from the automatic distance.
A different-person label cannot also receive an identity score ≥4.

Flagged identity outputs stay reviewable so genuine false rejects can be
measured. Missing-face/invalid images and unrun cells cannot be scored. Filters
select provider, item, portrait and pending reviews. Download scores before
closing/reloading; only complete ratings are exported. Import must match the
exact report ID, cells, score bounds and reviewer rules; invalid imports keep
the current draft. Imports replace the current review rather than silently
combining multiple raters. Preserve separate exports for independent raters.

## Summarize quality and identity

```bash
npm run evaluate:jewellery -- summarize \
  --report .forme-evaluation/jewellery/review-01/report.json \
  --review .forme-evaluation/jewellery/review-01/jewellery-review.json \
  --out .forme-evaluation/jewellery/summary-01.json
```

Use the actual downloaded review path. The summary rechecks report/image hashes
and refuses overwrite. It reports failure/unrun/review counts; placement/fidelity
good-score rates; mean scores; known latency/cost counts; identity distances
(minimum, p05, median, p95, p99, maximum for human-same/different, with
linearly interpolated quantiles); false rejects
and false accepts; and a sensitivity curve over thresholds 0.20–0.80. Unknown
costs and missing negative identity examples stay unknown. Report hashes detect
accidental edits and bind a review to exact files; they are not signed evidence.

A diagnostic `--threshold 0.50` recomputes rates without changing the report,
`TRYON_IDENTITY_MAX`, or app checks. The page slider is diagnostic too. There is
no automatic threshold recommendation. Same-person distance **greater than**
the threshold is a false reject; equality passes. Calibrate against at least
50 independently collected pilot portraits with consent and human labels,
including negative pairs, and review complexion/subgroup outcomes. The 300-cell
matrix uses ten people repeatedly and cannot establish population calibration.
A summary's minimum 50 human-same **pairs** is a data-completeness check, not
proof of 50 independent people or a safe production threshold.

Per provider, a measured quality set requires live AI evidence, `all-candidates` collection, all **300**
cells reviewed, no repeated outputs, known identity distances for every output, and ≥50
human-same distances. Passing
requires placement ≥85%, recognizable design ≥80%, and false rejects ≤5% on
labelled same-person pairs with a measured distance. Check unavailable-distance
counts as well; do not treat exclusions as successes. Fixture and overlay sets,
partial reviews and failed cells never qualify. The tool always reports
`rolloutApproved: false` and `thresholdChanged: false`.

## Store pilot and release gate

Optionally add `--pilot path/to/pilot.json` to summarize. Copy the
[fixture pilot record](evaluation/jewellery-pilot.example.json), replace it
with measured counters, and label it `live` only for real evidence. Use
completed, nonoverlapping UTC baseline/pilot dates, ≥60 pilot days and ≥3
anonymous stores. For every store, record baseline and pilot customer visits,
pieces shown and pilot shares created. The summary computes pieces/visit
increase and shares/store/day; targets are **+50%** and **≥10/day** per store.
Zero/missing visit baselines do not establish an increase. These counters are
operator supplied and need an audit trail; the CLI does not infer them from
application analytics or count pageviews as shares.

Release checklist:

- Automated backend, production build and browser checks pass; see the
  [release verification](JEWELLERY_RELEASE.md).
- Owner/manager inventory rights, staff generation/review, tenant/origin
  isolation, consent, free reuse, exact refunds and no automatic retry are
  covered by the regression suites.
- Real pilot metrics and provider quality, costs, failures and subgroup review
  meet [requirements §8](jewellery/REQUIREMENTS.md). Keep missing evidence pending.
- An operator separately reviews the independent identity cohort and any
  proposed server threshold. No automatic threshold changes are made.
- Enable `TRYON_JEWELLERY=1` only in isolated pilot-store deployments after
  approval. The flag is deployment-wide, **not a per-store allowlist**. Leave
  the default off for general stores; use separate storage/deployment for the
  pilot. Existing female-generation gating also applies.
- Reuse the existing deployment process after approval; this commit does not
  deploy anything or build a mobile binary. General availability remains blocked
  by the unmeasured live pilot and separate commercial C16.5 evidence.

Retain photos, result copies, scalar identity distances and ratings only for
the agreed pilot retention period. Delete the private run directories and
exports when permission expires. None of this customer evidence belongs in Git.
