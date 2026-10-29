import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readProductLink, parseProductUrl, LinkError } from '../product-link.js';
import { readProductLinkWithFallback } from '../browser-reader.js';
import { digest, readJson, newReportDirectory, privateJson, options } from './files.js';

export function validateLinks(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.links) || !manifest.links.length || manifest.links.length > 20)
    throw new Error('Use a version 1 manifest with 1–20 product links.');
  const ids = new Set(), urls = new Set();
  return manifest.links.map(entry => {
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(entry?.id)) throw new Error('Each link needs a short unique id.');
    const url = parseProductUrl(entry.url).href;
    if (ids.has(entry.id) || urls.has(url)) throw new Error('Link ids and product URLs must be unique.');
    ids.add(entry.id); urls.add(url);
    return { id: entry.id, url };
  });
}

function outcome(result, error, elapsedMs) {
  const count = Array.isArray(result?.images) ? result.images.length : 0;
  return { ok: !error && count > 0, imageCount: error ? 0 : count,
    code: error ? (error instanceof LinkError ? error.code : 'unknown') : count ? null : 'no_images',
    elapsedMs: Math.round(elapsedMs) };
}

export async function benchmarkLinks(manifest, {
  compare = false, staticReader = readProductLink, fallbackReader = readProductLinkWithFallback,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => performance.now(),
  progress = () => {},
} = {}) {
  // Validate the entire set before making any outbound request.
  const links = validateLinks(manifest);
  const rows = [];
  for (const [index, link] of links.entries()) {
    if (index) await wait(2000);
    const started = now(); let result, failure;
    try { result = await staticReader(link.url); } catch (error) { failure = error; }
    const basic = outcome(result, failure, now() - started);
    const row = { id: link.id, host: new URL(link.url).hostname, static: basic };
    if (compare) {
      let combined, combinedError;
      try {
        // Reuse the first response; comparing must not re-fetch a successful page.
        combined = await fallbackReader(link.url, { enabled: true, staticReader: async () => {
          if (failure) throw failure;
          return result;
        } });
      } catch (error) { combinedError = error; }
      row.withBrowser = outcome(combined, combinedError, now() - started);
    }
    rows.push(row); progress(row);
  }
  const summarize = key => {
    const passed = rows.filter(row => row[key].ok).length;
    const times = rows.map(row => row[key].elapsedMs).sort((a, b) => a - b);
    return { passed, failed: rows.length - passed, successRate: passed / rows.length,
      medianMs: (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2,
      p95Ms: times[Math.ceil(times.length * .95) - 1] };
  };
  return { version: 1, kind: 'product-link-benchmark', createdAt: new Date().toISOString(),
    manifestHash: digest(JSON.stringify(links)), mode: compare ? 'compare' : 'static',
    measuredLinks: rows.length, requiredLinks: 20, benchmarkComplete: rows.length === 20,
    rolloutApproved: false,
    note: 'Measured extraction only. Staff must check photo correctness, retailer coverage and worker memory before rollout.',
    summary: { static: summarize('static'), ...(compare ? { withBrowser: summarize('withBrowser') } : {}) }, rows };
}

export async function main(args) {
  const opts = options(args, ['--manifest', '--out', '--mode', '--live']);
  // --live has a value deliberately: an explicit acknowledgement of external reads.
  if (!opts['--manifest'] || !opts['--out'] || opts['--live'] !== 'yes' || !['static', 'compare'].includes(opts['--mode']))
    throw new Error('Usage: node server/evaluation/link-benchmark.js --manifest links.json --out NEW_DIRECTORY --mode static|compare --live yes');
  if (opts['--mode'] === 'compare' && (!process.env.TRYON_READER_URL || (process.env.TRYON_READER_TOKEN?.length || 0) < 32))
    throw new Error('Comparison requires the isolated worker URL and token. Use static mode without a worker.');
  const manifest = await readJson(opts['--manifest']); validateLinks(manifest);
  await newReportDirectory(opts['--out']);
  const report = await benchmarkLinks(manifest, { compare: opts['--mode'] === 'compare',
    progress: row => console.log(JSON.stringify({ id: row.id, static: row.static, withBrowser: row.withBrowser })) });
  await privateJson(path.join(opts['--out'], 'links-report.json'), report);
  console.log(`Recorded ${report.measuredLinks}/20 links. No AI calls or product photos saved. Rollout still requires review.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(() => { console.error('Link benchmark could not start or save. Check arguments, manifest, worker configuration and output directory.'); process.exitCode = 1; });
