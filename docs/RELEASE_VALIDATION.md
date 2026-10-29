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

## Current evidence

The local test suite uses injected readers and makes no retailer requests. Live
retailer benchmarking remains outstanding while the execution environment's
network policy blocks the studio and retail sites. Female visual review and any
provider-switch decision also require actual, consented image results.
