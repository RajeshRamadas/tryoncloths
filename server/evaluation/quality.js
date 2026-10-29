import path from 'node:path';
import { realpath, stat, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { profiles } from '../../src/profiles.js';
import sharp from 'sharp';
import { requireVisibleFace } from '../face-check.js';
import { ProviderError } from '../provider-errors.js';
import { digest, newReportDirectory, privateJson } from './files.js';

export const rubric = {
  face: 'Customer face and identity', complexion: 'Consistent customer skin tone',
  proportions: 'Natural head and body proportions', neck: 'Smooth head and neck join',
  framing: 'Full head, hands and feet; preserved pose', garment: 'Garment colour, pattern and shape',
};
export const metricKeys = task => Object.keys(rubric).filter(key => task === 'tryon' || key !== 'garment');
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(value);
const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
const failures = new Set(['quota', 'timeout', 'network', 'blocked', 'no_image', 'invalid_image', 'missing_face', 'credentials', 'model', 'unavailable', 'unknown']);

export function validateQualityManifest(input) {
  if (input?.version !== 1 || !Array.isArray(input.providers) || !input.providers.length || input.providers.length > 4 ||
      !Array.isArray(input.cases) || !input.cases.length || input.cases.length > 40)
    throw new Error('Use version 1, 1–4 providers and 1–40 evaluation cases.');
  const providerIds = new Set(), caseIds = new Set();
  const providers = input.providers.map(p => {
    if (!validId(p?.id) || providerIds.has(p.id) || !label(p.label) || !label(p.model) ||
        !['general', 'dedicated'].includes(p.kind) || !['live', 'fixture'].includes(p.evidence))
      throw new Error('Each provider needs unique id, label, model, kind and live/fixture evidence.');
    providerIds.add(p.id);
    return { id: p.id, label: p.label, model: p.model, kind: p.kind, evidence: p.evidence };
  });
  const cases = input.cases.map(c => {
    const profile = profiles.find(p => p.id === c?.profileId);
    if (!validId(c?.id) || caseIds.has(c.id) || !profile || !['avatar', 'tryon'].includes(c.task) || c.storageConsent !== true)
      throw new Error('Each case needs a unique id, supported profile/task and explicit permission to retain review photos.');
    caseIds.add(c.id);
    const keys = c.task === 'avatar' ? ['face', 'body', 'template'] : ['avatar', 'garment'];
    const references = {};
    for (const key of keys) {
      if (typeof c.references?.[key] !== 'string' || !c.references[key]) throw new Error('Required reference image is missing.');
      references[key] = c.references[key];
    }
    if (!Array.isArray(c.results) || c.results.length > providers.length) throw new Error('Use one result per provider.');
    const seen = new Set();
    const results = c.results.map(r => {
      if (!providerIds.has(r?.providerId) || seen.has(r.providerId) ||
          (typeof r.image === 'string' && r.image ? Boolean(r.failureCode) : !failures.has(r.failureCode)))
        throw new Error('Results need a known unique provider and either an image or a fixed failure code.');
      seen.add(r.providerId);
      for (const key of ['latencyMs', 'costUsd'])
        if (r[key] != null && (!Number.isFinite(r[key]) || r[key] < 0 || r[key] > (key === 'latencyMs' ? 3_600_000 : 1000)))
          throw new Error('Latency and billed USD cost must be nonnegative numbers or null.');
      return { providerId: r.providerId, ...(r.image ? { image: r.image } : { failureCode: r.failureCode }),
        latencyMs: r.latencyMs ?? null, costUsd: r.costUsd ?? null };
    });
    return { id: c.id, task: c.task, profileId: c.profileId, body: profile.body, references, results };
  });
  return { version: 1, providers, cases };
}

async function localImage(root, file) {
  const resolved = await realpath(path.resolve(root, file));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative))
    throw new Error('Images must stay inside the manifest directory, including symlink targets.');
  const info = await stat(resolved);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Image must be a file under 20 MB.');
  const image = sharp(await readFile(resolved), { limitInputPixels: 25_000_000, animated: false });
  const meta = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format) || meta.width < 128 || meta.height < 128 || (meta.pages || 1) > 1)
    throw new Error('Use a still JPEG, PNG or WebP image of at least 128 pixels.');
  // Strip EXIF and normalize orientation without geometrical stretching.
  return image.rotate().resize(1024, 1536, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

export async function prepareQualityReport(input, rootDirectory, outputDirectory, { faceCheck = requireVisibleFace } = {}) {
  const manifest = validateQualityManifest(input);
  const root = await realpath(rootDirectory);
  await newReportDirectory(outputDirectory);
  const records = [], inputs = new Set();
  for (const [index, c] of manifest.cases.entries()) {
    const references = {}, fingerprints = [];
    for (const [key, file] of Object.entries(c.references)) {
      const bytes = await localImage(root, file), imageHash = digest(bytes);
      const name = `${index}-${key}.png`;
      await writeFile(path.join(outputDirectory, name), bytes, { mode: 0o600, flag: 'wx' });
      references[key] = { image: name, hash: imageHash }; fingerprints.push(imageHash);
    }
    const inputHash = digest(JSON.stringify([c.task, ...fingerprints]));
    if (inputs.has(inputHash)) throw new Error('Repeated input images cannot count as independent evaluation cases.');
    inputs.add(inputHash);
    const results = [];
    for (const [pindex, provider] of manifest.providers.entries()) {
      const r = c.results.find(r => r.providerId === provider.id);
      if (!r) { results.push({ providerId: provider.id, status: 'not_run' }); continue; }
      if (!r.image) { results.push({ ...r, status: 'failed' }); continue; }
      let bytes;
      try { bytes = await localImage(root, r.image); }
      catch { results.push({ providerId: provider.id, status: 'failed', failureCode: 'invalid_image', latencyMs: r.latencyMs, costUsd: r.costUsd }); continue; }
      const name = `${index}-result-${pindex}.png`;
      await writeFile(path.join(outputDirectory, name), bytes, { mode: 0o600, flag: 'wx' });
      let face = 'passed';
      try { await faceCheck(bytes); } catch (error) { face = error instanceof ProviderError && error.code === 'missing_face' ? 'missing_face' : 'check_failed'; }
      const meta = await sharp(bytes).metadata();
      const portrait = meta.height > meta.width;
      results.push({ providerId: provider.id, status: face === 'passed' && portrait ? 'review_required' : 'rejected',
        face, portrait, image: name, hash: digest(bytes), latencyMs: r.latencyMs, costUsd: r.costUsd });
    }
    records.push({ id: c.id, task: c.task, body: c.body, profileId: c.profileId, inputHash, references, results });
  }
  const report = { version: 1, kind: 'image-quality-evaluation', rubric, providers: manifest.providers, cases: records };
  report.reportId = reportId(report);
  await privateJson(path.join(outputDirectory, 'report.json'), report);
  const json = JSON.stringify(report).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  await writeFile(path.join(outputDirectory, 'data.js'), `window.evaluationData = ${json};\n`, { flag: 'wx', mode: 0o600 });
  for (const name of ['review.html', 'review.js', 'review.css']) {
    await copyFile(new URL(`./${name}`, import.meta.url), path.join(outputDirectory, name));
    await chmod(path.join(outputDirectory, name), 0o600);
  }
  return report;
}

export function reportId(report) {
  const { reportId: _id, ...data } = report;
  return digest(JSON.stringify(data));
}

export async function verifyReportImages(report, directory) {
  if (report.reportId !== reportId(report)) throw new Error('Report contents have changed.');
  const root = await realpath(directory);
  for (const c of report.cases) {
    for (const item of [...Object.values(c.references), ...c.results.filter(r => r.image)]) {
      if (!/^\d+-(face|body|template|avatar|garment|result-\d+)\.png$/.test(item.image)) throw new Error('Invalid report image path.');
      const file = await realpath(path.join(root, item.image));
      if (path.dirname(file) !== root || (await stat(file)).size > 20 * 1024 * 1024 || digest(await readFile(file)) !== item.hash)
        throw new Error('A report image has changed or is missing. Prepare and review a new report.');
    }
  }
}

export function summarizeReview(report, review) {
  if (report?.version !== 1 || report.kind !== 'image-quality-evaluation' || report.reportId !== reportId(report) ||
      review?.version !== 1 || review.reportId !== report.reportId || !Array.isArray(review.ratings))
    throw new Error('Use the unmodified report and a review exported for that exact report.');
  const answers = new Map();
  for (const r of review.ratings) {
    const c = report.cases.find(c => c.id === r.caseId), result = c?.results.find(p => p.providerId === r.providerId);
    const key = `${r.caseId}/${r.providerId}`;
    if (!result || result.status !== 'review_required' || answers.has(key)) throw new Error('Unknown, rejected or duplicate rating.');
    if (typeof r.notes !== 'string' || r.notes.length > 2000 || metricKeys(c.task).some(k => !Number.isInteger(r.scores?.[k]) || r.scores[k] < 1 || r.scores[k] > 5))
      throw new Error('Complete all review scores using integers from 1 to 5.');
    answers.set(key, { ...r, scores: Object.fromEntries(metricKeys(c.task).map(k => [k, r.scores[k]])) });
  }
  const rows = [];
  for (const c of report.cases) for (const p of report.providers) {
    const result = c.results.find(r => r.providerId === p.id), rating = answers.get(`${c.id}/${p.id}`);
    const reviewed = Boolean(rating);
    rows.push({ caseId: c.id, providerId: p.id, task: c.task, body: c.body, evidence: p.evidence,
      status: result.status, reviewed, accepted: reviewed && metricKeys(c.task).every(k => rating.scores[k] >= 4),
      scores: rating?.scores ?? null, latencyMs: result.latencyMs ?? null, costUsd: result.costUsd ?? null });
  }
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const providers = report.providers.map(p => {
    const data = rows.filter(r => r.providerId === p.id), attempted = data.filter(r => r.status !== 'not_run');
    const costs = attempted.filter(r => r.costUsd !== null).map(r => r.costUsd);
    const timings = attempted.filter(r => r.latencyMs !== null).map(r => r.latencyMs);
    const completedLive = task => data.filter(r => r.task === task && r.body === 'female' && r.evidence === 'live' && r.accepted).length;
    return { ...p, totalCases: data.length, attempted: attempted.length,
      failed: data.filter(r => ['failed', 'rejected'].includes(r.status)).length,
      reviewed: data.filter(r => r.reviewed).length, accepted: data.filter(r => r.accepted).length,
      acceptanceRate: attempted.length ? data.filter(r => r.accepted).length / attempted.length : null,
      meanScores: Object.fromEntries(Object.keys(rubric).map(k => [k, mean(data.filter(r => r.scores?.[k]).map(r => r.scores[k]))])),
      measuredCostCount: costs.length, meanCostUsd: mean(costs), measuredLatencyCount: timings.length, meanLatencyMs: mean(timings),
      femaleAvatarAccepted: completedLive('avatar'), femaleTryOnAccepted: completedLive('tryon'),
      femaleReviewTargetMet: completedLive('avatar') >= 10 && completedLive('tryon') >= 10 };
  });
  const comparisons = [];
  for (const baseline of report.providers.filter(p => p.kind === 'general')) {
    for (const candidate of report.providers.filter(p => p.kind === 'dedicated')) {
      const pairs = report.cases.filter(c => c.task === 'tryon').map(c => [
        rows.find(r => r.caseId === c.id && r.providerId === baseline.id),
        rows.find(r => r.caseId === c.id && r.providerId === candidate.id),
      ]).filter(pair => pair.every(r => r.evidence === 'live' && r.reviewed));
      comparisons.push({ baseline: baseline.id, candidate: candidate.id, reviewedPairs: pairs.length,
        comparisonTargetMet: pairs.length >= 10,
        meanScoreDifference: Object.fromEntries(Object.keys(rubric).map(k => [k, mean(pairs.map(([a, b]) => b.scores[k] - a.scores[k]))])),
        note: 'Differences use paired reviewed outputs only. Also compare provider failures, unreviewed cases, known cost and latency. No automatic provider switch.' });
    }
  }
  return { version: 1, reportId: report.reportId, rubricThreshold: 4, requiredIndependentCases: 10,
    rolloutApproved: false, providers, comparisons, rows };
}
