import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkLinks, validateLinks } from '../server/evaluation/link-benchmark.js';
import { LinkError } from '../server/product-link.js';

const manifest = { version: 1, links: Array.from({ length: 20 }, (_, i) => ({ id: `product-${i}`, url: `https://shop.example/product/${i}` })) };
test('benchmark validates every URL and duplicate before any network call', async () => {
  let calls = 0;
  await assert.rejects(benchmarkLinks({ ...manifest, links: [...manifest.links.slice(0, 19), { id: 'private', url: 'http://169.254.169.254' }] }, { staticReader: async () => { calls++; } }));
  assert.equal(calls, 0);
  assert.throws(() => validateLinks({ version: 1, links: [manifest.links[0], manifest.links[0]] }));
});
test('benchmark measures all twenty successes and failures without storing images or raw errors', async () => {
  let reads = 0, waits = 0;
  const report = await benchmarkLinks(manifest, { wait: async ms => { assert.equal(ms, 2000); waits++; }, staticReader: async () => {
    reads++; if (reads === 1) throw new Error('SECRET provider details');
    if (reads === 2) throw new LinkError('no_images');
    return { images: [{ image: 'private image data' }] };
  } });
  assert.equal(reads, 20); assert.equal(waits, 19); assert.equal(report.benchmarkComplete, true);
  assert.equal(report.rolloutApproved, false); assert.equal(report.summary.static.passed, 18);
  assert.equal(report.rows[0].static.code, 'unknown');
  assert.ok(!JSON.stringify(report).includes('SECRET')); assert.ok(!JSON.stringify(report).includes('private image data'));
});
test('comparison reuses static responses and reports browser improvement separately', async () => {
  let reads = 0;
  const report = await benchmarkLinks({ version: 1, links: manifest.links.slice(0, 2) }, { compare: true, wait: async () => {},
    staticReader: async () => { if (++reads === 1) throw new LinkError('no_images'); return { images: [{}] }; },
    fallbackReader: async (_url, { staticReader, enabled }) => { assert.equal(enabled, true); try { return await staticReader(); } catch { return { images: [{}, {}] }; } },
  });
  assert.equal(reads, 2); assert.equal(report.summary.static.passed, 1); assert.equal(report.summary.withBrowser.passed, 2);
  assert.equal(report.benchmarkComplete, false);
});
