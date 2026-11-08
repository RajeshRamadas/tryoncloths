import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import sharp from 'sharp';
import { prepareJewelleryReport, summarizeJewelleryReview } from '../../server/evaluation/jewellery.js';
test('private jewellery review keeps ratings local, handles flags/failures, exports exact reviews and fits mobile', async ({ page }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forme-jewellery-review-'));
    let server;
    try {
        const portrait = await sharp(await readFile(new URL('../fixtures/customers/red-plaid-face.jpg', import.meta.url))).resize(1152, 1536, { fit: 'contain', background: '#ddd' }).png().toBuffer();
        await writeFile(path.join(root, 'person.png'), portrait);
        const svg = '<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="300" fill="white"/><g fill="none" stroke="#b88a2d" stroke-width="12"><circle cx="100" cy="170" r="48"/><circle cx="220" cy="170" r="48"/></g><g fill="#e0b34d"><circle cx="100" cy="102" r="12"/><circle cx="220" cy="102" r="12"/></g></svg>';
        await writeFile(path.join(root, 'piece.png'), await sharp(Buffer.from(svg)).png().toBuffer());
        const manifest = { version: 1, kind: 'jewellery-evaluation', providers: [{ id: 'gemini', label: 'Gemini fixture', model: 'local-test', mode: 'ai', evidence: 'fixture' }, { id: 'other', label: 'Failed fixture', model: 'local-test', mode: 'ai', evidence: 'fixture' }], items: [{ id: 'hoops', name: 'Gold hoop earrings', type: 'drop_earrings', attributes: { metal: 'yellow_gold', pair: true, dropMm: 38 }, side: 'both', image: 'piece.png', storageConsent: true }], portraits: [{ id: 'customer-01', profileId: 'regular', image: 'person.png', storageConsent: true }], results: [{ itemId: 'hoops', portraitId: 'customer-01', providerId: 'gemini', image: 'person.png' }, { itemId: 'hoops', portraitId: 'customer-01', providerId: 'other', failureCode: 'quota' }] };
        const out = path.join(root, 'out');
        // Genuine local face detection. The distance is injected to exercise review
        // of a false reject; identical photos are explicitly fixture evidence.
        const report = await prepareJewelleryReport(manifest, root, out, { identityDistance: async () => .5 });
        server = http.createServer(async (req, res) => {
            const name = req.url.slice(1);
            if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
                res.writeHead(404).end();
                return;
            }
            try {
                const bytes = await readFile(path.join(out, name));
                res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(name)] || 'application/json' });
                res.end(bytes);
            }
            catch {
                res.writeHead(404).end();
            }
        }).listen(0, '127.0.0.1');
        await new Promise(r => server.once('listening', r));
        const origin = 'http://127.0.0.1:' + server.address().port;
        let outbound = 0;
        const errors = [];
        page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== origin)
            outbound++; });
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + '/review.html');
        await expect(page.getByRole('heading', { name: 'Review jewellery quality' })).toBeVisible();
        await expect(page.locator('#status')).toContainText('0 of 1');
        await expect(page.locator('#case')).toContainText('flagged');
        await page.getByLabel('Reviewer ID', { exact: true }).fill('staff-01');
        for (const score of await page.locator('[data-score]').all())
            await score.selectOption('4');
        await page.getByLabel('Is this the same customer?').selectOption('same');
        await expect(page.locator('#status')).toContainText('1 of 1');
        await expect(page.locator('#identity-summary')).toContainText('False rejects: 100.0%');
        await page.getByLabel('Review notes (no personal details)').fill('Fixture review only; no live quality claim.');
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download review scores' }).click();
        const review = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
        const summary = summarizeJewelleryReview(report, review);
        expect(summary.providers[0].reviewed).toBe(1);
        expect(summary.providers[0].identity.falseRejectRate).toBe(1);
        expect(summary.providers[1].failed).toBe(1);
        expect(summary.rolloutApproved).toBe(false);
        await page.getByRole('button', { name: 'Next output' }).click();
        await expect(page.locator('#case')).toContainText('quota');
        await expect(page.locator('[data-score]')).toHaveCount(0);
        await page.getByLabel('Provider', { exact: true }).selectOption('gemini');
        await expect(page.locator('[data-score]')).toHaveCount(3);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: 'test-results/jewellery-evaluation-desktop.png', fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: 'test-results/jewellery-evaluation-mobile.png', fullPage: true });
        await page.reload();
        await expect(page.locator('#status')).toContainText('0 of 1');
        const upload = async (data) => page.getByLabel('Load previous review').setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
        await upload({ ...review, reportId: 'wrong' });
        await expect(page.getByRole('alert')).toContainText('Cannot load');
        await expect(page.locator('#status')).toContainText('0 of 1');
        await upload(review);
        await expect(page.locator('#status')).toContainText('1 of 1');
        await upload({ ...review, ratings: [...review.ratings, ...review.ratings] });
        await expect(page.getByRole('alert')).toContainText('current scores were kept');
        await expect(page.locator('#status')).toContainText('1 of 1');
        await page.getByLabel('Review filter').selectOption('pending');
        await expect(page.locator('#case')).toContainText('No outputs match');
        expect(outbound).toBe(0);
        expect(errors).toEqual([]);
        expect(await page.evaluate(() => localStorage.length)).toBe(0);
    }
    finally {
        if (server)
            await new Promise(r => server.close(r));
        await rm(root, { recursive: true, force: true });
    }
});
