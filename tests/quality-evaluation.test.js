import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { prepareQualityReport, summarizeReview, validateQualityManifest, metricKeys, reportId, rubric, verifyReportImages } from '../server/evaluation/quality.js';
import { ProviderError } from '../server/provider-errors.js';

const provider = (id, kind = 'general', evidence = 'fixture') => ({ id, label: id, model: 'model-v1', kind, evidence });
const manifest = () => ({ version: 1, providers: [provider('gemini'), provider('candidate', 'dedicated')], cases: [{
  id: 'female-shirt', task: 'tryon', profileId: 'f-regular', storageConsent: true,
  references: { avatar: 'person.png', garment: 'shirt.png' },
  results: [{ providerId: 'gemini', image: 'person.png', latencyMs: 5000, costUsd: .04 }, { providerId: 'candidate', failureCode: 'quota' }],
}] });
async function fixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forme-quality-'));
  try {
    await writeFile(path.join(root, 'person.png'), await sharp({ create: { width: 160, height: 320, channels: 3, background: '#285' } }).png().toBuffer());
    await writeFile(path.join(root, 'shirt.png'), await sharp({ create: { width: 160, height: 160, channels: 3, background: '#28f' } }).png().toBuffer());
    await work(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const scores = task => Object.fromEntries(metricKeys(task).map(k => [k, 4]));

test('quality manifest requires storage consent, known profiles and unique provider outcomes', () => {
  const m = manifest(); m.cases[0].storageConsent = false; assert.throws(() => validateQualityManifest(m));
  m.cases[0].storageConsent = true; m.cases[0].results.push(m.cases[0].results[0]); assert.throws(() => validateQualityManifest(m));
  const other = manifest(); other.cases[0].results[0].costUsd = -1; assert.throws(() => validateQualityManifest(other));
  other.cases[0].results[0].costUsd = 0; other.cases[0].profileId = 'unknown'; assert.throws(() => validateQualityManifest(other));
});
test('private report strips paths, retains failures and binds scores to exact images', async () => fixture(async root => {
  const report = await prepareQualityReport(manifest(), root, path.join(root, 'out'), { faceCheck: async () => {} });
  assert.equal(report.cases[0].results[1].status, 'failed');
  assert.equal(report.cases[0].results[0].face, 'passed');
  assert.ok(!JSON.stringify(report).includes(root));
  assert.equal((await stat(path.join(root, 'out'))).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(root, 'out', 'report.json'))).mode & 0o777, 0o600);
  const review = { version: 1, reportId: report.reportId, ratings: [{ caseId: 'female-shirt', providerId: 'gemini', scores: scores('tryon'), notes: '' }] };
  const summary = summarizeReview(report, review);
  assert.equal(summary.providers[0].accepted, 1); assert.equal(summary.providers[0].femaleTryOnAccepted, 0);
  assert.equal(summary.providers[1].failed, 1); assert.equal(summary.providers[1].meanCostUsd, null);
  assert.equal(summary.comparisons[0].reviewedPairs, 0); assert.equal(summary.rolloutApproved, false);
  const changed = structuredClone(report); changed.cases[0].results[0].hash = 'changed';
  assert.throws(() => summarizeReview(changed, review));
  review.reportId = 'wrong'; assert.throws(() => summarizeReview(report, review));
  await assert.rejects(prepareQualityReport(manifest(), root, path.join(root, 'out')));
  await verifyReportImages(report, path.join(root, 'out'));
  await writeFile(path.join(root, 'out', report.cases[0].results[0].image), 'changed image');
  await assert.rejects(verifyReportImages(report, path.join(root, 'out')), /changed/);
}));
test('rejected and missing outputs cannot be manually approved', async () => fixture(async root => {
  const m = manifest(); m.cases[0].results = [m.cases[0].results[0]];
  const report = await prepareQualityReport(m, root, path.join(root, 'out'), { faceCheck: async () => { throw new ProviderError('missing_face'); } });
  assert.equal(report.cases[0].results[0].status, 'rejected'); assert.equal(report.cases[0].results[1].status, 'not_run');
  const review = { version: 1, reportId: report.reportId, ratings: [{ caseId: 'female-shirt', providerId: 'gemini', scores: scores('tryon'), notes: '' }] };
  assert.throws(() => summarizeReview(report, review));
  const summary = summarizeReview(report, { ...review, ratings: [] });
  assert.equal(summary.providers[0].failed, 1); assert.equal(summary.providers[1].attempted, 0);
}));
test('evaluation refuses path escapes, symlinks outside dataset and duplicate input cases', async () => fixture(async root => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'forme-outside-'));
  try {
    await writeFile(path.join(outside, 'outside.png'), await readFile(path.join(root, 'person.png')));
    await symlink(path.join(outside, 'outside.png'), path.join(root, 'escape.png'));
    const m = manifest(); m.cases[0].references.avatar = 'escape.png';
    await assert.rejects(prepareQualityReport(m, root, path.join(root, 'out')), /inside the manifest/);
    const dup = manifest(); dup.cases.push({ ...dup.cases[0], id: 'different-id' });
    await assert.rejects(prepareQualityReport(dup, root, path.join(root, 'duplicate'), { faceCheck: async () => {} }), /independent/);
  } finally { await rm(outside, { recursive: true, force: true }); }
}));
test('live targets require ten independent accepted cases per female task and paired candidate review', () => {
  const providers = [provider('gemini', 'general', 'live'), provider('candidate', 'dedicated', 'live')];
  const cases = Array.from({ length: 20 }, (_, i) => ({ id: `case-${i}`, task: i < 10 ? 'avatar' : 'tryon', body: 'female',
    results: providers.map(p => ({ providerId: p.id, status: 'review_required', latencyMs: 1000, costUsd: i === 19 ? null : .03 })) }));
  const report = { version: 1, kind: 'image-quality-evaluation', rubric, providers, cases }; report.reportId = reportId(report);
  const review = { version: 1, reportId: report.reportId, ratings: cases.flatMap(c => providers.map(p => ({ caseId: c.id, providerId: p.id, scores: scores(c.task), notes: '' }))) };
  let summary = summarizeReview(report, review);
  assert.equal(summary.providers[0].femaleReviewTargetMet, true); assert.equal(summary.providers[0].measuredCostCount, 19);
  assert.equal(summary.comparisons[0].comparisonTargetMet, true); assert.equal(summary.rolloutApproved, false);
  review.ratings.pop(); summary = summarizeReview(report, review);
  assert.equal(summary.providers[1].femaleReviewTargetMet, false); assert.equal(summary.comparisons[0].comparisonTargetMet, false);
  review.ratings[0].scores.neck = 1; summary = summarizeReview(report, review);
  assert.equal(summary.providers[0].femaleReviewTargetMet, false);
  review.ratings[0].scores.neck = 9; assert.throws(() => summarizeReview(report, review));
});
test('report labels are inert text and data cannot close a script tag', async () => fixture(async root => {
  const m = manifest(); m.providers[0].label = '</script><script>alert(1)</script>';
  await prepareQualityReport(m, root, path.join(root, 'out'), { faceCheck: async () => {} });
  const script = await readFile(path.join(root, 'out', 'data.js'), 'utf8');
  assert.ok(!script.includes('</script>')); assert.ok(script.includes('\\u003c'));
}));
