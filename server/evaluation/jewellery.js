import path from 'node:path';
import { realpath, stat, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import sharp from 'sharp';
import { descriptor } from '../identity-check.js';
import { requireVisibleFace } from '../face-check.js';
import { digest, newReportDirectory, privateJson } from './files.js';
import { jewelleryRubric, validateJewelleryManifest, onlyFields, evaluationId } from './jewellery-manifest.js';
import { ratingKey, validateJewelleryReview, identityStatistics } from './jewellery-review-data.js';
export { validateJewelleryManifest, jewelleryTemplate } from './jewellery-manifest.js';
export async function jewelleryIdentityDistance(reference, candidate, { describe = descriptor } = {}) {
    let a, b;
    try {
        a = await describe(reference);
        b = await describe(candidate);
        if ([a, b].some(v => !(v instanceof Float32Array) || v.length !== 128 || !v.every(Number.isFinite)))
            throw new Error('Identity check unavailable.');
        let squared = 0;
        for (let i = 0; i < 128; i++)
            squared += (a[i] - b[i]) ** 2;
        return Math.sqrt(squared);
    }
    finally {
        if (a instanceof Float32Array)
            a.fill(0);
        if (b instanceof Float32Array)
            b.fill(0);
    }
}
const inside = (root, file) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
async function image(root, file, kind) {
    const resolved = await realpath(path.resolve(root, file));
    if (!inside(root, resolved))
        throw new Error('Images must remain inside the manifest folder, including symlink targets.');
    const info = await stat(resolved);
    if (!info.isFile() || !info.size || info.size > 20 * 1024 * 1024)
        throw new Error('Use local images under 20 MB.');
    const source = await readFile(resolved), decoder = sharp(source, { limitInputPixels: 25000000, animated: false });
    try {
        const m = await decoder.metadata();
        if (!['png', 'jpeg', 'webp'].includes(m.format) || m.width < 128 || m.height < 128 || (m.pages || 1) > 1)
            throw new Error('Use still PNG/JPEG/WebP images at least 128 px per side.');
        const portrait = kind !== 'product';
        if (kind === 'reference' && (m.width < 1024 || m.height < 1365 || Math.abs(m.width / m.height - .75) > .01) || kind === 'output' && (m.width !== 1152 || m.height !== 1536 || m.orientation && m.orientation !== 1))
            throw new Error('Portrait references must be at least 1024 × 1365 and 3:4; outputs must be original 1152 × 1536 images.');
        return await decoder.rotate().resize(portrait ? 1152 : 1024, portrait ? 1536 : 1024, { fit: portrait ? 'contain' : 'inside', withoutEnlargement: !portrait, background: '#fff' }).flatten({ background: '#fff' }).toColourspace('srgb').png().toBuffer();
    }
    finally {
        source.fill(0);
    }
}
export function jewelleryReportId(report) { const { reportId, ...rest } = report; return digest(JSON.stringify(rest)); }
function validReport(report) { if (report?.version !== 1 || report.kind !== 'jewellery-quality-evaluation' || report.reportId !== jewelleryReportId(report))
    throw new Error('Use an unmodified jewellery report.'); }
export async function prepareJewelleryReport(input, rootDirectory, outputDirectory, { faceCheck = requireVisibleFace, identityDistance = jewelleryIdentityDistance, onProgress = () => { } } = {}) {
    const m = validateJewelleryManifest(input), root = await realpath(rootDirectory);
    await newReportDirectory(outputDirectory);
    const items = [], portraits = [], cases = [], itemHashes = new Set(), portraitHashes = new Set(), outputHashes = new Map();
    async function save(bytes, name) { await writeFile(path.join(outputDirectory, name), bytes, { mode: 0o600, flag: 'wx' }); return { image: name, hash: digest(bytes) }; }
    for (const [i, item] of m.items.entries()) {
        const bytes = await image(root, item.image, 'product');
        try {
            const hash = digest(bytes);
            if (itemHashes.has(hash))
                throw new Error('Repeated product images cannot count as independent jewellery items.');
            itemHashes.add(hash);
            const { image: _path, ...metadata } = item;
            items.push({ ...metadata, ...await save(bytes, `item-${i}.png`) });
        }
        finally {
            bytes.fill(0);
        }
    }
    for (const [i, portrait] of m.portraits.entries()) {
        const bytes = await image(root, portrait.image, 'reference');
        try {
            const hash = digest(bytes);
            if (portraitHashes.has(hash))
                throw new Error('Repeated portraits cannot count as independent customers.');
            portraitHashes.add(hash);
            await faceCheck(bytes);
            const { image: _path, ...metadata } = portrait;
            portraits.push({ ...metadata, ...await save(bytes, `portrait-${i}.png`) });
        }
        finally {
            bytes.fill(0);
        }
    }
    for (const [pi, p] of portraits.entries()) {
        const reference = await readFile(path.join(outputDirectory, p.image));
        try {
            for (const [ii, item] of items.entries()) {
                const c = { itemId: item.id, portraitId: p.id, inputHash: digest(JSON.stringify([item.hash, p.hash, item.type, item.attributes, item.side])), results: [] };
                for (const [vi, provider] of m.providers.entries()) {
                    const outcome = m.results.find(r => r.itemId === item.id && r.portraitId === p.id && r.providerId === provider.id), base = { providerId: provider.id, latencyMs: outcome?.latencyMs ?? null, costUsd: outcome?.costUsd ?? null };
                    if (!outcome) {
                        c.results.push({ ...base, status: 'not_run' });
                        continue;
                    }
                    if (!outcome.image) {
                        c.results.push({ ...base, status: 'failed', failureCode: outcome.failureCode });
                        continue;
                    }
                    let bytes;
                    try {
                        bytes = await image(root, outcome.image, 'output');
                    }
                    catch {
                        c.results.push({ ...base, status: 'failed', failureCode: 'invalid_image' });
                        continue;
                    }
                    try {
                        const file = await save(bytes, `result-${pi}-${ii}-${vi}.png`), result = { ...base, ...file, status: 'review_required', face: 'passed', identityDistance: null, identityCheck: 'unavailable', duplicateOutput: false };
                        try {
                            await faceCheck(bytes);
                        }
                        catch {
                            result.face = 'missing_or_unchecked';
                            result.status = 'rejected';
                        }
                        if (result.face === 'passed') {
                            try {
                                const distance = await identityDistance(reference, bytes);
                                if (!Number.isFinite(distance) || distance < 0 || distance > 100)
                                    throw new Error();
                                result.identityDistance = distance;
                                result.identityCheck = distance > m.identityThreshold ? 'flagged' : 'passed';
                            }
                            catch {
                                result.identityCheck = 'unavailable';
                            }
                        }
                        const key = provider.id + '/' + file.hash, previous = outputHashes.get(key);
                        if (previous && previous.inputHash !== c.inputHash) {
                            previous.result.duplicateOutput = true;
                            result.duplicateOutput = true;
                        }
                        else
                            outputHashes.set(key, { inputHash: c.inputHash, result });
                        c.results.push(result);
                    }
                    finally {
                        bytes.fill(0);
                    }
                }
                cases.push(c);
                onProgress({ completed: cases.length, total: items.length * portraits.length });
            }
        }
        finally {
            reference.fill(0);
        }
    }
    const report = { version: 1, kind: 'jewellery-quality-evaluation', identityThreshold: m.identityThreshold, collection: m.collection, rubric: jewelleryRubric, providers: m.providers, items, portraits, cases };
    report.reportId = jewelleryReportId(report);
    await privateJson(path.join(outputDirectory, 'report.json'), report);
    const json = JSON.stringify(report).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    await writeFile(path.join(outputDirectory, 'data.js'), `window.jewelleryEvaluationData = ${json};\n`, { mode: 0o600, flag: 'wx' });
    for (const [source, target] of [['jewellery-review.html', 'review.html'], ['jewellery-review.js', 'review.js'], ['jewellery-review.css', 'review.css'], ['jewellery-review-data.js', 'jewellery-review-data.js']]) {
        await copyFile(new URL('./' + source, import.meta.url), path.join(outputDirectory, target));
        await chmod(path.join(outputDirectory, target), 0o600);
    }
    return report;
}
export async function verifyJewelleryReportImages(report, directory) {
    validReport(report);
    const root = await realpath(directory);
    for (const asset of [...report.items, ...report.portraits, ...report.cases.flatMap(c => c.results.filter(r => r.image))]) {
        if (!/^(?:item-\d+|portrait-\d+|result-\d+-\d+-\d+)\.png$/.test(asset.image) || !/^[a-f0-9]{64}$/.test(asset.hash))
            throw new Error('Invalid report asset.');
        const file = await realpath(path.join(root, asset.image));
        if (path.dirname(file) !== root || (await stat(file)).size > 20 * 1024 * 1024 || digest(await readFile(file)) !== asset.hash)
            throw new Error('A jewellery report image changed. Prepare and review a new run.');
    }
}
const date = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('Use UTC dates YYYY-MM-DD.'); const parsed = Date.parse(value + 'T00:00:00Z'); if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value)
    throw new Error('Use valid UTC dates.'); return parsed; };
export function summarizeJewelleryPilot(input, { now = Date.now() } = {}) {
    if (input == null)
        return { provided: false, targetsMeasured: false, targetsMet: false, reason: 'No store pilot visit/share measurements were supplied.' };
    onlyFields(input, ['version', 'kind', 'evidence', 'baselineStart', 'baselineEnd', 'pilotStart', 'pilotEnd', 'stores']);
    if (input.version !== 1 || input.kind !== 'jewellery-pilot' || !['live', 'fixture'].includes(input.evidence) || !Array.isArray(input.stores) || input.stores.length > 100 || !input.stores.length)
        throw new Error('Use a bounded version-1 pilot record with live/fixture evidence.');
    const bs = date(input.baselineStart), be = date(input.baselineEnd), ps = date(input.pilotStart), pe = date(input.pilotEnd);
    if (bs > be || be >= ps || ps > pe || pe + 86400000 > now)
        throw new Error('Use completed, non-overlapping baseline and pilot dates.');
    const days = (pe - ps) / 86400000 + 1, seen = new Set();
    const stores = input.stores.map(s => { onlyFields(s, ['id', 'baselineVisits', 'baselinePieces', 'pilotVisits', 'pilotPieces', 'sharesCreated']); if (!evaluationId(s.id) || seen.has(s.id))
        throw new Error('Use unique anonymized store IDs.'); seen.add(s.id); for (const key of ['baselineVisits', 'baselinePieces', 'pilotVisits', 'pilotPieces', 'sharesCreated'])
        if (!Number.isSafeInteger(s[key]) || s[key] < 0 || s[key] > 1e9)
            throw new Error('Store pilot counters must be bounded nonnegative integers.'); const baseline = s.baselineVisits ? s.baselinePieces / s.baselineVisits : null, pilot = s.pilotVisits ? s.pilotPieces / s.pilotVisits : null, increase = baseline > 0 && pilot !== null ? pilot / baseline - 1 : null; return { ...s, baselinePiecesPerVisit: baseline, pilotPiecesPerVisit: pilot, piecesPerVisitIncrease: increase, sharesPerDay: s.sharesCreated / days, piecesTargetMet: increase !== null && increase >= .5, sharesTargetMet: s.sharesCreated / days >= 10 }; });
    const measured = input.evidence === 'live' && days >= 60 && stores.length >= 3 && stores.every(s => s.piecesPerVisitIncrease !== null);
    return { provided: true, evidence: input.evidence, operatorSupplied: true, days, storeCount: stores.length, targetsMeasured: measured, targetsMet: measured && stores.every(s => s.piecesTargetMet && s.sharesTargetMet), stores };
}
export function summarizeJewelleryReview(report, review, { pilot = null, threshold = report.identityThreshold } = {}) {
    validReport(report);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
        throw new Error('Use an identity threshold above 0 and at most 1.');
    const ratings = validateJewelleryReview(report, review), pilotSummary = summarizeJewelleryPilot(pilot), rows = [];
    for (const c of report.cases)
        for (const result of c.results) {
            const p = report.providers.find(p => p.id === result.providerId), r = ratings.get(ratingKey(c.itemId, c.portraitId, p.id));
            rows.push({ itemId: c.itemId, portraitId: c.portraitId, providerId: p.id, evidence: p.evidence, mode: p.mode, status: result.status, duplicateOutput: result.duplicateOutput || false, reviewed: Boolean(r), reviewerId: r?.reviewerId ?? null, scores: r?.scores ?? null, samePerson: r?.samePerson ?? null, identityDistance: result.identityDistance ?? null, identityCheck: result.identityCheck ?? 'unavailable', costUsd: result.costUsd ?? null, latencyMs: result.latencyMs ?? null });
        }
    const mean = a => a.length ? a.reduce((s, n) => s + n, 0) / a.length : null, providers = report.providers.map(p => {
        const data = rows.filter(r => r.providerId === p.id), reviewed = data.filter(r => r.reviewed), attempted = data.filter(r => r.status !== 'not_run'), placement = reviewed.length ? reviewed.filter(r => r.scores.placement >= 4).length / reviewed.length : null, fidelity = reviewed.length ? reviewed.filter(r => r.scores.fidelity >= 4).length / reviewed.length : null, identity = identityStatistics(data, threshold), complete = report.items.length === 30 && report.portraits.length === 10 && data.length === 300 && reviewed.length === 300 && data.every(r => !r.duplicateOutput);
        const distances = Array.from({ length: 13 }, (_, i) => Number((.2 + i * .05).toFixed(2))).map(value => { const s = identityStatistics(data, value); return { threshold: value, falseRejectRate: s.falseRejectRate, falseAcceptRate: s.falseAcceptRate }; });
        const live = p.evidence === 'live' && p.mode === 'ai', measured = live && report.collection === 'all-candidates' && complete && identity.unavailable === 0 && identity.calibrationMeasured, qualityMet = measured && placement >= .85 && fidelity >= .8 && identity.falseRejectRate <= .05;
        return { ...p, total: data.length, attempted: attempted.length, failed: data.filter(r => ['failed', 'rejected'].includes(r.status)).length, notRun: data.filter(r => r.status === 'not_run').length, reviewed: reviewed.length, duplicateOutputs: data.filter(r => r.duplicateOutput).length, completeMatrix: complete, placementCorrectRate: placement, designFaithfulRate: fidelity, meanScores: Object.fromEntries(Object.keys(report.rubric).map(k => [k, mean(reviewed.map(r => r.scores[k]))])), identity, identityThresholdCurve: distances, measuredCostCount: data.filter(r => r.costUsd !== null).length, meanCostUsd: mean(data.filter(r => r.costUsd !== null).map(r => r.costUsd)), measuredLatencyCount: data.filter(r => r.latencyMs !== null).length, meanLatencyMs: mean(data.filter(r => r.latencyMs !== null).map(r => r.latencyMs)), qualityTargetsMeasured: measured, qualityTargetsMet: qualityMet, pilotTargetsMeasured: measured && pilotSummary.targetsMeasured, pilotTargetsMet: qualityMet && pilotSummary.targetsMet };
    });
    return { version: 1, kind: 'jewellery-evaluation-summary', reportId: report.reportId, collection: report.collection, requiredItems: 30, requiredPortraits: 10, requiredCellsPerProvider: 300, scoreThreshold: 4, targets: { placement: .85, fidelity: .8, falseRejectRate: .05, identitySamePersonExamples: 50, pilotStores: 3, pilotDays: 60, piecesPerVisitIncrease: .5, sharesPerStoreDay: 10 }, rolloutApproved: false, thresholdChanged: false, pilotTargetsMeasured: providers.some(p => p.pilotTargetsMeasured), pilotTargetsMet: providers.some(p => p.pilotTargetsMet), pilot: pilotSummary, providers, rows, note: 'Accepted-only samples, fixtures, incomplete matrices and repeated outputs do not qualify as live pilot evidence. Threshold analysis and operator-supplied business counters never approve rollout or alter server configuration.' };
}
