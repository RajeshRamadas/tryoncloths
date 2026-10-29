# Release validation tools

The saved-look feature is implemented. Female profiles and the optional isolated
browser reader remain pilots until live checks are recorded. Automated fixtures
prove behavior, not customer likeness, garment fidelity or retailer availability.

## Task 13 — product-link benchmark

The CLI measures the actual production link reader against a fixed manifest.
It records each failure code, success rate, image count, median and p95 time.
Comparison mode runs the same static attempt through the existing isolated-worker
fallback, avoiding a second static request. Results contain no product photos,
page text, credentials or raw exception messages. No AI calls are made.

1. Copy `docs/evaluation/links.example.json` to a private directory, replacing the
   example with **20 distinct real product URLs** and unique ids. Include Myntra,
   Ajio, Amazon and an independent shop, plus different garment categories. Keep
   the same manifest for comparisons. The example is a schema, not a tested shop.
2. Run from the repository on a machine with authorized access to those shops:

   ```sh
   mkdir -p .forme-evaluation
   npm run benchmark:links -- --manifest /path/to/links.json --out .forme-evaluation/static-01 --mode static --live yes
   ```

3. On a sufficiently sized server with the isolated reader already running, load
   `TRYON_READER_URL` and `TRYON_READER_TOKEN` through the existing private `.env`
   and repeat with `--mode compare` and a new output directory. Do not run Chromium
   directly on the host. See [worker setup](BROWSER_LINK_READER.md).
4. Inspect `links-report.json`. Fewer than 20 links is a diagnostic run and sets
   `benchmarkComplete: false`. A completed measurement is **not** rollout approval:
   failed sites still need the upload fallback. Check returned photos in the app
   for correctness, record retailer coverage, and measure worker peak memory with
   `docker stats` before enabling it for staff.

The CLI is also shipped in the runtime image at
`/app/server/evaluation/link-benchmark.js`. Supply the private input through a
temporary read-only mount or copy; use a private output directory and copy the
JSON report out before recreating a container. Do not put reports in `dist/` or
`public/`. Output directories must be new; previous reports are never overwritten.

Each site is read once, sequentially, with at least two seconds between products.
The existing DNS, redirect, image, page and worker limits still apply. No automatic
retry is added. The CLI exits successfully when it records results, even if some
shops refuse access; inspect the counts, not just the exit code.

## Task 14 — avatar and provider quality review

This is an **operator tool**, separate from the customer flow. It imports actual
results from the studio or a candidate provider and builds a private review page.
It does not generate images, upload photos or silently switch the active provider.
Gemini remains the production try-on provider. A dedicated-provider API adapter is
conditional on choosing a service after reviewing fidelity, supported garment
types, data handling, billing, latency and failure rate. No candidate has yet been
validated or selected.

### Prepare evidence

1. In a private directory outside `public/` and `dist/`, copy the example
   `docs/evaluation/quality.example.json` as `quality.json`. Store images underneath
   that same directory; paths and symlinks outside it are rejected.
2. Use consented or synthetic adult inputs. Run the existing studio flow, review
   and download the output. Retain the exact input references for comparison.
   Any paid attempt still requires the normal consent and limits. The evaluation
   tools introduce no paid calls and no automatic retries.
3. To compare a dedicated try-on provider, generate a separate result using
   **exactly the same approved avatar and garment** through that provider's own
   authorized interface. Record its actual provider name and exact model version.
   This tool does not send data to an unconfigured third-party service.
4. Record every attempted result, including failures. Each provider declares
   `kind: "general"` or `"dedicated"` and `evidence: "live"` or `"fixture"`.
   Evidence is an operator declaration, not independently verified provenance.
   Fixtures cannot satisfy live review targets. Omit unattempted provider results;
   they appear as `not_run`, not successful or failed calls.
5. Give each case a unique id, a `profileId`, a task and `storageConsent: true`
   **only if permission covers retaining these private review images**. The report
   deliberately copies normalized reference images, unlike the normal app's
   ephemeral photo flow. Keep the folder private and delete it after evaluation.

For `task: "tryon"`, references are `avatar` and `garment`. For `task: "avatar"`,
references are `face`, `body` and `template` (the selected standard body). Include
at least ten independent female cases for each task to validate both stages.
Duplicate input sets cannot inflate the case count. For provider comparisons,
include at least ten paired try-on cases, representative of real store garments.

A result has `providerId` and either `image` or `failureCode`. Allowed failure
codes: `quota`, `timeout`, `network`, `blocked`, `no_image`, `invalid_image`,
`missing_face`, `credentials`, `model`, `unavailable`, `unknown`. Use numbers for
measured `latencyMs` and actual billed `costUsd`, or `null` when unknown. Do not
enter estimated costs as measured costs; no provider pricing is assumed here.

### Review and summarize

```sh
mkdir -p .forme-evaluation
npm run evaluate:quality -- prepare --manifest /private/dataset/quality.json --out .forme-evaluation/quality-01
```

Open `review.html` in the new directory in your browser. If local file browsing
is restricted, serve the report **on your own computer's loopback address only**:

```sh
python3 -m http.server 5179 --bind 127.0.0.1 --directory .forme-evaluation/quality-01
```

Then open `http://127.0.0.1:5179/review.html` on that computer. Stop the temporary
server when finished. Do not expose the folder through the public studio or Caddy.
For a report prepared on Lightsail, copy the private report folder to your own
computer before reviewing it.

The page displays references beside outputs, with checks for a detectable face and
portrait framing. These checks **cannot prove likeness, a smooth join or correct
clothing**. A failed local face check or invalid image blocks approval. Score face
likeness, complexion, proportions, neck join and framing; try-ons additionally
score garment fidelity. Use the visible 1–5 rubric. Notes are optional; avoid names.

Download complete scores before closing; unsaved scores clear on reload. A partial
review can be downloaded and loaded later. Partially scored individual outputs
are not exported until all their criteria are complete. The page makes no external
requests, stores no browser data and rejects imports for another report.

```sh
npm run evaluate:quality -- summarize --report .forme-evaluation/quality-01/report.json --review /private/review-scores.json --out .forme-evaluation/quality-01/summary.json
```

The summarizer verifies the report and image hashes before accepting a review. It
counts unrun, failed, rejected and reviewed outputs separately; shows costs and
timings only when recorded; and compares dedicated providers on matched live
try-on pairs. Never judge only the score averages: failed and unreviewed outputs
are excluded from those averages and remain visible in provider totals.

The pilot's conservative review target is a score of **4 or higher on every
criterion**, with ten independent accepted live female avatars **and** ten female
try-ons per provider. The minimum comparison is ten reviewed live try-on pairs.
These are operator review targets, not calibrated identity, sizing or fit metrics.
`rolloutApproved` always stays false: scores supply evidence for an explicit
deployment decision; they do not change feature flags or provider configuration.

## Current evidence

The local test suite uses injected readers and makes no retailer requests. Live
retailer benchmarking remains outstanding while the execution environment's
network policy blocks the studio and retail sites. Female visual review and any
provider-switch decision also require actual, consented image results.

Validation on 2026-10-29: 66 backend tests and 50 browser tests passed, plus the
production build. The private review test uses actual local face detection but
fixture provider output, exercises scoring/download/reload and a 390 px viewport,
and observes zero external browser requests. A CLI smoke run prepared a fixture
report and summarized an empty review without counting any accepted live outputs.
No paid image-generation calls, live retailer benchmark or APK build was performed.
