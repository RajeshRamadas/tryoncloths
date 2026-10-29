import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import sharp from 'sharp';
import { standardAvatar } from '../../server/app.js';
import { prepareQualityReport, summarizeReview } from '../../server/evaluation/quality.js';

test('private quality review exports matched scores, rejects wrong imports and fits a phone', async ({ page }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forme-review-browser-'));
  let server;
  try {
    const avatar = await standardAvatar('regular');
    await writeFile(path.join(root, 'avatar.png'), avatar);
    await writeFile(path.join(root, 'garment.png'), await sharp({ create: { width: 160, height: 200, channels: 3, background: '#24a' } }).png().toBuffer());
    const manifest = { version: 1, providers: [{ id: 'gemini', label: 'Gemini fixture', model: 'test', kind: 'general', evidence: 'fixture' }], cases: [{
      id: 'test-shirt', task: 'tryon', profileId: 'regular', storageConsent: true,
      references: { avatar: 'avatar.png', garment: 'garment.png' }, results: [{ providerId: 'gemini', image: 'avatar.png' }],
    }] };
    const out = path.join(root, 'out');
    // Real local face detection; this fixture is not a generated try-on.
    const report = await prepareQualityReport(manifest, root, out);
    // Managed Chromium blocks file:// navigation. Serve this private fixture on
    // loopback; don't relax browser policy or expose customer reports publicly.
    server = http.createServer(async (req, res) => {
      const name = req.url.slice(1);
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) { res.writeHead(404).end(); return; }
      try {
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(name)];
        res.writeHead(200, { 'Content-Type': type || 'application/json' }); res.end(await readFile(path.join(out, name)));
      } catch { res.end(); }
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let networkCalls = 0; page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== origin) networkCalls++; });
    await page.goto(origin + '/review.html');
    await expect(page.getByRole('heading', { name: 'Review avatar and outfit quality' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('0 of 1');
    for (const control of await page.getByRole('combobox').all()) await control.selectOption('4');
    await expect(page.getByRole('status')).toContainText('1 of 1');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download review scores' }).click();
    const download = await downloaded;
    const review = JSON.parse(await readFile(await download.path(), 'utf8'));
    const summary = summarizeReview(report, review);
    expect(summary.providers[0].accepted).toBe(1); expect(summary.providers[0].femaleReviewTargetMet).toBe(false);
    await page.reload(); await expect(page.getByRole('status')).toContainText('0 of 1');
    await page.getByLabel('Load previous review').setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...review, reportId: 'wrong' })) });
    await expect(page.getByRole('alert')).toContainText('Cannot load');
    await page.getByLabel('Load previous review').setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(review)) });
    await expect(page.getByRole('status')).toContainText('1 of 1');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/quality-review-mobile.png', fullPage: true });
    expect(networkCalls).toBe(0);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
