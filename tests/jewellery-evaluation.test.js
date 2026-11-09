import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, stat, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  jewelleryTemplate,
  validateJewelleryManifest,
  jewelleryRubric,
} from "../server/evaluation/jewellery-manifest.js";
import {
  prepareJewelleryReport,
  verifyJewelleryReportImages,
  jewelleryReportId,
  jewelleryIdentityDistance,
  summarizeJewelleryReview,
  summarizeJewelleryPilot,
} from "../server/evaluation/jewellery.js";
import {
  validateJewelleryReview,
  identityStatistics,
} from "../server/evaluation/jewellery-review-data.js";
const run = promisify(execFile);
const png = (colour, width = 1152, height = 1536) =>
  sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer();
const manifest = () => ({
  version: 1,
  kind: "jewellery-evaluation",
  providers: [
    { id: "gemini", label: "Gemini fixture", model: "test", mode: "ai", evidence: "fixture" },
  ],
  items: [
    {
      id: "earrings",
      name: "Silver studs",
      type: "stud_earrings",
      attributes: { metal: "silver", pair: true },
      side: "both",
      image: "piece.png",
      storageConsent: true,
    },
  ],
  portraits: [
    { id: "customer-01", profileId: "regular", image: "portrait.png", storageConsent: true },
  ],
  results: [
    {
      itemId: "earrings",
      portraitId: "customer-01",
      providerId: "gemini",
      image: "output.png",
      latencyMs: 1000,
      costUsd: 0.04,
    },
  ],
});
const review = (report) => ({
  version: 1,
  kind: "jewellery-review",
  reportId: report.reportId,
  ratings: report.cases.flatMap((c) =>
    c.results
      .filter((r) => r.status === "review_required")
      .map((r) => ({
        itemId: c.itemId,
        portraitId: c.portraitId,
        providerId: r.providerId,
        reviewerId: "staff-01",
        samePerson: "same",
        scores: { placement: 4, fidelity: 4, identity: 4 },
        notes: "",
      })),
  ),
});
const local = { faceCheck: async () => {}, identityDistance: async () => 0.5 };
async function fixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forme-jewellery-eval-"));
  try {
    await writeFile(path.join(root, "piece.png"), await png("#b89832", 220, 240));
    await writeFile(path.join(root, "portrait.png"), await png("#cabdab"));
    await writeFile(path.join(root, "output.png"), await png("#abcabd"));
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function fullReport(evidence = "fixture", mode = "ai") {
  const report = {
    version: 1,
    kind: "jewellery-quality-evaluation",
    identityThreshold: 0.45,
    collection: "all-candidates",
    rubric: jewelleryRubric,
    providers: [{ id: "gemini", label: "Gemini", model: "test", evidence, mode }],
    items: Array.from({ length: 30 }, (_, i) => ({ id: "item-" + i })),
    portraits: Array.from({ length: 10 }, (_, i) => ({ id: "portrait-" + i })),
    cases: [],
  };
  for (const item of report.items)
    for (const portrait of report.portraits)
      report.cases.push({
        itemId: item.id,
        portraitId: portrait.id,
        results: [
          {
            providerId: "gemini",
            status: "review_required",
            identityDistance: 0.3,
            duplicateOutput: false,
            latencyMs: 1000,
            costUsd: null,
          },
        ],
      });
  report.reportId = jewelleryReportId(report);
  return report;
}
const resign = (report) => {
  report.reportId = jewelleryReportId(report);
  return report;
};
const pilot = () => ({
  version: 1,
  kind: "jewellery-pilot",
  evidence: "live",
  baselineStart: "2026-06-01",
  baselineEnd: "2026-06-30",
  pilotStart: "2026-07-01",
  pilotEnd: "2026-08-29",
  stores: Array.from({ length: 3 }, (_, i) => ({
    id: "store-" + i,
    baselineVisits: 100,
    baselinePieces: 200,
    pilotVisits: 120,
    pilotPieces: 360,
    sharesCreated: 600,
  })),
});
test("30 × 10 template defaults to fixtures and requires explicit product/customer storage permission", () => {
  const t = jewelleryTemplate();
  assert.equal(t.items.length * t.portraits.length, 300);
  assert.equal(t.providers[0].evidence, "fixture");
  assert.throws(() => validateJewelleryManifest(t));
  for (const row of [...t.items, ...t.portraits]) row.storageConsent = true;
  const valid = validateJewelleryManifest(t);
  assert.equal(valid.items.length, 30);
  assert.equal(valid.portraits.length, 10);
  for (const change of [
    (m) => (m.portraits[0].storageConsent = false),
    (m) => (m.providers[0].evidence = "mock-live"),
    (m) => (m.items[0].type = "ring"),
    (m) => (m.items[0].side = "left"),
    (m) => m.results.push(m.results[0]),
    (m) => (m.results[0].costUsd = -1),
    (m) => (m.portraits[0].profileId = "bad"),
    (m) => (m.results[0].failureCode = "quota"),
    (m) => (m.items[0].image = "https://example.test/photo"),
  ]) {
    const m = manifest();
    change(m);
    assert.throws(() => validateJewelleryManifest(m));
  }
});
test("identity distances use the exact boundary and wipe ephemeral descriptors even after partial failure", async () => {
  const a = new Float32Array(128),
    b = new Float32Array(128);
  b[0] = 0.45;
  let n = 0;
  const expected = b[0];
  assert.equal(
    await jewelleryIdentityDistance("a", "b", { describe: async () => (n++ ? b : a) }),
    expected,
  );
  assert.ok(a.every((v) => v === 0) && b.every((v) => v === 0));
  a[0] = 1;
  n = 0;
  await assert.rejects(
    jewelleryIdentityDistance("a", "b", {
      describe: async () => {
        if (n++) throw new Error("failed");
        return a;
      },
    }),
  );
  assert.ok(a.every((v) => v === 0));
  const stats = identityStatistics(
    [
      { identityDistance: 0.45, samePerson: "same" },
      { identityDistance: 0.45001, samePerson: "same" },
      { identityDistance: 0.4, samePerson: "different" },
      { identityDistance: null, samePerson: "same" },
    ],
    0.45,
  );
  assert.equal(stats.falseRejectRate, 0.5);
  assert.equal(stats.falseAcceptRate, 1);
  assert.equal(stats.same.count, 2);
  assert.equal(stats.thresholdChanged, false);
});
test("private report keeps flagged results reviewable, binds image hashes, strips source paths, and never overwrites", async () =>
  fixture(async (root) => {
    const out = path.join(root, "report"),
      m = manifest();
    m.providers[0].label = "</script><script>alert(1)</script>";
    const report = await prepareJewelleryReport(m, root, out, local),
      result = report.cases[0].results[0];
    assert.equal(result.identityCheck, "flagged");
    assert.equal(result.status, "review_required");
    assert.equal(result.identityDistance, 0.5);
    const scores = review(report),
      summary = summarizeJewelleryReview(report, scores);
    assert.equal(summary.providers[0].identity.falseRejectRate, 1);
    assert.equal(summary.providers[0].meanCostUsd, 0.04);
    assert.equal(summary.rolloutApproved, false);
    assert.ok(!JSON.stringify(report).includes(root));
    assert.doesNotMatch(JSON.stringify(report), /descriptor|storageConsent|piece\.png/);
    assert.equal((await stat(out)).mode & 0o777, 0o700);
    for (const name of [
      "report.json",
      "data.js",
      "review.html",
      "review.js",
      "review.css",
      "jewellery-review-data.js",
      result.image,
    ])
      assert.equal((await stat(path.join(out, name))).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(path.join(out, "data.js"), "utf8"), /<\/script>/);
    await verifyJewelleryReportImages(report, out);
    await assert.rejects(prepareJewelleryReport(m, root, out, local));
    const changed = structuredClone(report);
    changed.cases[0].results[0].identityDistance = 0;
    assert.throws(() => summarizeJewelleryReview(changed, scores));
    await writeFile(path.join(out, result.image), "changed");
    await assert.rejects(verifyJewelleryReportImages(report, out), /changed/);
  }));
test("matrix retains failed and missing cells, rejects headless outputs, and flags all repeated results", async () =>
  fixture(async (root) => {
    const m = manifest();
    m.items.push({ ...m.items[0], id: "other-piece", image: "other-piece.png" });
    m.portraits.push({ ...m.portraits[0], id: "customer-02", image: "other-person.png" });
    await writeFile(path.join(root, "other-piece.png"), await png("#cc2222", 220, 240));
    await writeFile(path.join(root, "other-person.png"), await png("#cccaad"));
    m.results.push(
      { ...m.results[0], itemId: "other-piece" },
      { ...m.results[0], portraitId: "customer-02", image: undefined, failureCode: "quota" },
    );
    const report = await prepareJewelleryReport(m, root, path.join(root, "matrix"), local);
    assert.equal(report.cases.length, 4);
    const all = report.cases.flatMap((c) => c.results);
    assert.equal(all.filter((r) => r.duplicateOutput).length, 2);
    assert.equal(all.filter((r) => r.status === "not_run").length, 1);
    assert.equal(all.filter((r) => r.failureCode === "quota").length, 1);
    const summary = summarizeJewelleryReview(report, review(report));
    assert.equal(summary.providers[0].completeMatrix, false);
    assert.equal(summary.providers[0].reviewed, 2);
    let faces = 0;
    const rejected = await prepareJewelleryReport(manifest(), root, path.join(root, "headless"), {
      ...local,
      faceCheck: async () => {
        if (faces++) throw new Error();
      },
    });
    assert.equal(rejected.cases[0].results[0].status, "rejected");
    const invalidReview = review(report);
    invalidReview.reportId = rejected.reportId;
    invalidReview.ratings = invalidReview.ratings.slice(0, 1);
    assert.throws(() => validateJewelleryReview(rejected, invalidReview));
    const small = manifest();
    small.results[0].image = "piece.png";
    const invalid = await prepareJewelleryReport(small, root, path.join(root, "wrong-size"), local);
    assert.equal(invalid.cases[0].results[0].failureCode, "invalid_image");
    const unchecked = await prepareJewelleryReport(manifest(), root, path.join(root, "unchecked"), {
      ...local,
      identityDistance: async () => {
        throw new Error();
      },
    });
    assert.equal(unchecked.cases[0].results[0].identityCheck, "unavailable");
    assert.equal(
      summarizeJewelleryReview(unchecked, review(unchecked)).providers[0].identity.falseRejectRate,
      null,
    );
  }));
test("dataset rejects duplicate references, malformed images, path traversal and symlinks outside its root", async () =>
  fixture(async (root) => {
    const repeated = manifest();
    repeated.items.push({ ...repeated.items[0], id: "duplicate" });
    await assert.rejects(
      prepareJewelleryReport(repeated, root, path.join(root, "dup"), local),
      /independent/,
    );
    const portraits = manifest();
    portraits.portraits.push({ ...portraits.portraits[0], id: "duplicate" });
    await assert.rejects(
      prepareJewelleryReport(portraits, root, path.join(root, "dup-portrait"), local),
      /independent/,
    );
    const outside = await mkdtemp(path.join(os.tmpdir(), "forme-outside-"));
    try {
      await writeFile(path.join(outside, "escape.png"), await png("#aba"));
      await symlink(path.join(outside, "escape.png"), path.join(root, "escape.png"));
      const m = manifest();
      m.portraits[0].image = "escape.png";
      await assert.rejects(
        prepareJewelleryReport(m, root, path.join(root, "symlink"), local),
        /inside/,
      );
      m.portraits[0].image = path.relative(root, path.join(outside, "escape.png"));
      await assert.rejects(
        prepareJewelleryReport(m, root, path.join(root, "traversal"), local),
        /inside/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    const invalid = manifest();
    invalid.items[0].image = "bad.png";
    await writeFile(path.join(root, "bad.png"), "private broken data");
    await assert.rejects(prepareJewelleryReport(invalid, root, path.join(root, "invalid"), local));
  }));
test("reviews require exact report, unique outcomes, human truth, bounded scores and an anonymized reviewer", () => {
  const r = fullReport(),
    valid = review(r);
  assert.equal(validateJewelleryReview(r, valid).size, 300);
  for (const change of [
    (v) => (v.reportId = "wrong"),
    (v) => v.ratings.push(v.ratings[0]),
    (v) => (v.ratings[0].reviewerId = "Staff Name"),
    (v) => (v.ratings[0].scores.identity = 6),
    (v) => (v.ratings[0].scores.placement = 0),
    (v) => (v.ratings[0].scores.extra = 4),
    (v) => (v.ratings[0].notes = "x".repeat(2001)),
    (v) => (v.ratings[0].samePerson = "different"),
    (v) => (v.ratings[0].samePerson = "yes"),
  ]) {
    const copy = structuredClone(valid);
    change(copy);
    assert.throws(() => validateJewelleryReview(r, copy));
  }
  valid.ratings[0].samePerson = "different";
  valid.ratings[0].scores.identity = 1;
  assert.equal(validateJewelleryReview(r, valid).size, 300);
});
test("full 300-cell quality targets require live AI, complete nonduplicate reviews and measured identity labels", () => {
  for (const [evidence, mode] of [
    ["fixture", "ai"],
    ["live", "overlay"],
  ]) {
    const r = fullReport(evidence, mode),
      s = summarizeJewelleryReview(r, review(r), { pilot: pilot() });
    assert.equal(s.providers[0].completeMatrix, true);
    assert.equal(s.pilotTargetsMeasured, false);
    assert.equal(s.rolloutApproved, false);
  }
  const r = fullReport("live"),
    scores = review(r);
  let s = summarizeJewelleryReview(r, scores, { pilot: pilot() });
  assert.equal(s.pilotTargetsMet, true);
  assert.equal(s.rolloutApproved, false);
  assert.equal(s.providers[0].identity.same.count, 300);
  assert.equal(s.providers[0].measuredCostCount, 0);
  assert.equal(s.providers[0].meanCostUsd, null);
  assert.equal(s.providers[0].identityThresholdCurve.length, 13);
  assert.equal(s.thresholdChanged, false);
  const partial = structuredClone(scores);
  partial.ratings.pop();
  assert.equal(summarizeJewelleryReview(r, partial).providers[0].qualityTargetsMeasured, false);
  for (let i = 0; i < 46; i++) scores.ratings[i].scores.placement = 3;
  s = summarizeJewelleryReview(r, scores);
  assert.equal(s.providers[0].qualityTargetsMeasured, true);
  assert.equal(s.providers[0].qualityTargetsMet, false);
  const repeat = structuredClone(r);
  repeat.cases[0].results[0].duplicateOutput = true;
  resign(repeat);
  const repeatedReview = review(repeat);
  assert.equal(summarizeJewelleryReview(repeat, repeatedReview).providers[0].completeMatrix, false);
  const few = review(r);
  for (let i = 49; i < 300; i++) few.ratings[i].samePerson = "unsure";
  assert.equal(summarizeJewelleryReview(r, few).providers[0].qualityTargetsMeasured, false);
  const drift = structuredClone(r);
  for (let i = 0; i < 16; i++) drift.cases[i].results[0].identityDistance = 0.6;
  resign(drift);
  assert.equal(
    summarizeJewelleryReview(drift, review(drift)).providers[0].qualityTargetsMet,
    false,
  );
  assert.equal(
    summarizeJewelleryReview(drift, review(drift), { threshold: 0.65 }).providers[0]
      .qualityTargetsMet,
    true,
  );
  assert.equal(drift.identityThreshold, 0.45);
});
test("business pilot needs completed nonoverlapping dates, three stores, sixty days and measured per-store improvements", () => {
  const p = pilot();
  assert.equal(summarizeJewelleryPilot(p).days, 60);
  assert.equal(summarizeJewelleryPilot(p).targetsMet, true);
  assert.equal(summarizeJewelleryPilot(null).targetsMeasured, false);
  for (const change of [
    (v) => (v.evidence = "fixture"),
    (v) => v.stores.pop(),
    (v) => (v.pilotEnd = "2026-08-28"),
    (v) => (v.stores[0].baselineVisits = 0),
  ]) {
    const c = structuredClone(p);
    change(c);
    assert.equal(summarizeJewelleryPilot(c).targetsMeasured, false);
  }
  for (const change of [
    (v) => (v.stores[0].pilotPieces = 359),
    (v) => (v.stores[0].sharesCreated = 599),
  ]) {
    const c = structuredClone(p);
    change(c);
    assert.equal(summarizeJewelleryPilot(c).targetsMeasured, true);
    assert.equal(summarizeJewelleryPilot(c).targetsMet, false);
  }
  for (const change of [
    (v) => (v.pilotStart = "2026-06-30"),
    (v) => (v.pilotEnd = "2026-02-30"),
    (v) => (v.pilotEnd = "2099-01-01"),
    (v) => (v.stores[0].sharesCreated = -1),
    (v) => v.stores.push(v.stores[0]),
  ]) {
    const c = structuredClone(p);
    change(c);
    assert.throws(() => summarizeJewelleryPilot(c));
  }
});
test("CLI templates default to consent off; strict offline summary verifies assets and never overwrites", async () =>
  fixture(async (root) => {
    const cli = path.resolve("server/evaluation/jewellery-cli.js"),
      template = path.join(root, "template.json");
    await run(process.execPath, [cli, "template", "--out", template]);
    assert.equal(JSON.parse(await readFile(template)).items.length, 30);
    await assert.rejects(run(process.execPath, [cli, "template", "--out", template]));
    // Inject only local face checks for this solid-colour unit fixture. Real face models are covered separately.
    const out = path.join(root, "out"),
      report = await prepareJewelleryReport(manifest(), root, out, local),
      ratings = path.join(root, "review.json"),
      summary = path.join(root, "summary.json");
    await writeFile(ratings, JSON.stringify(review(report)));
    const response = await run(process.execPath, [
      cli,
      "summarize",
      "--report",
      path.join(out, "report.json"),
      "--review",
      ratings,
      "--out",
      summary,
    ]);
    assert.match(response.stdout, /"rolloutApproved": false/);
    assert.equal(JSON.parse(await readFile(summary)).providers[0].identity.falseRejectRate, 1);
    await assert.rejects(
      run(process.execPath, [
        cli,
        "summarize",
        "--report",
        path.join(out, "report.json"),
        "--review",
        ratings,
        "--out",
        summary,
      ]),
    );
    const failed = await run(process.execPath, [cli, "unknown"]).catch((e) => e);
    assert.equal(failed.code, 1);
    assert.doesNotMatch(failed.stderr, new RegExp(root));
  }));
test("CLI preparation uses bundled real face models without provider calls and stores only scalar distances", async () =>
  fixture(async (root) => {
    const portrait = await sharp(
      await readFile(new URL("fixtures/customers/red-plaid-face.jpg", import.meta.url)),
    )
      .resize(1152, 1536, { fit: "contain", background: "#ddd" })
      .png()
      .toBuffer();
    await writeFile(path.join(root, "portrait.png"), portrait);
    await writeFile(path.join(root, "output.png"), portrait);
    const cli = path.resolve("server/evaluation/jewellery-cli.js"),
      file = path.join(root, "manifest.json"),
      out = path.join(root, "real");
    await writeFile(file, JSON.stringify(manifest()));
    const result = await run(process.execPath, [cli, "prepare", "--manifest", file, "--out", out]);
    assert.match(result.stdout, /No provider requests made/);
    const report = JSON.parse(await readFile(path.join(out, "report.json")));
    assert.equal(report.cases[0].results[0].face, "passed");
    assert.equal(report.cases[0].results[0].identityDistance, 0);
    assert.doesNotMatch(JSON.stringify(report), /descriptor/);
    const other = await sharp(
      await readFile(new URL("fixtures/customers/blue-polo-face.jpg", import.meta.url)),
    )
      .resize(1152, 1536, { fit: "contain", background: "#ddd" })
      .png()
      .toBuffer();
    assert.ok(
      (await jewelleryIdentityDistance(portrait, other)) > 0.45,
      "independent face fixture must have a larger distance",
    );
  }));
test("preparation expands all 30 distinct products × 10 portraits without silently dropping unrun cells", async () =>
  fixture(async (root) => {
    const m = jewelleryTemplate();
    for (const [i, item] of m.items.entries()) {
      item.image = "item-" + i + ".png";
      item.storageConsent = true;
      await writeFile(
        path.join(root, item.image),
        await png({ r: 30 + i * 5, g: 100, b: 200 }, 128, 128),
      );
    }
    for (const [i, portrait] of m.portraits.entries()) {
      portrait.image = "person-" + i + ".png";
      portrait.storageConsent = true;
      await writeFile(
        path.join(root, portrait.image),
        await png({ r: 100, g: 30 + i * 10, b: 150 }),
      );
    }
    const progress = [],
      report = await prepareJewelleryReport(m, root, path.join(root, "full-matrix"), {
        ...local,
        onProgress: (p) => progress.push(p),
      });
    assert.equal(report.cases.length, 300);
    assert.equal(new Set(report.cases.map((c) => c.inputHash)).size, 300);
    assert.deepEqual(progress.at(-1), { completed: 300, total: 300 });
    const summary = summarizeJewelleryReview(report, review(report));
    assert.equal(summary.providers[0].notRun, 300);
    assert.equal(summary.providers[0].qualityTargetsMeasured, false);
  }));
test("quality target boundaries are inclusive and never imply approval", () => {
  const r = fullReport("live"),
    scores = review(r);
  for (let i = 0; i < 45; i++) scores.ratings[i].scores.placement = 3;
  for (let i = 0; i < 60; i++) scores.ratings[i].scores.fidelity = 3;
  for (let i = 0; i < 15; i++) r.cases[i].results[0].identityDistance = 0.6;
  resign(r);
  scores.reportId = r.reportId;
  let s = summarizeJewelleryReview(r, scores);
  assert.equal(s.providers[0].placementCorrectRate, 0.85);
  assert.equal(s.providers[0].designFaithfulRate, 0.8);
  assert.equal(s.providers[0].identity.falseRejectRate, 0.05);
  assert.equal(s.providers[0].qualityTargetsMet, true);
  assert.equal(s.rolloutApproved, false);
  scores.ratings[60].scores.fidelity = 3;
  s = summarizeJewelleryReview(r, scores);
  assert.equal(s.providers[0].qualityTargetsMet, false);
});

test("accepted-only samples cannot claim false-reject targets even with 300 perfect reviews", () => {
  const report = fullReport("live");
  report.collection = "accepted-only";
  resign(report);
  assert.equal(
    summarizeJewelleryReview(report, review(report)).providers[0].qualityTargetsMeasured,
    false,
  );
  const p = pilot();
  assert.throws(() => summarizeJewelleryPilot(p, { now: Date.parse("2026-08-29T12:00:00Z") }));
  assert.equal(
    summarizeJewelleryPilot(p, { now: Date.parse("2026-08-30T00:00:00Z") }).targetsMeasured,
    true,
  );
});

test("identity quantiles interpolate even medians and keep unavailable or unlabelled data explicit", () => {
  const stats = identityStatistics(
    [
      { identityDistance: 0.2, samePerson: "same" },
      { identityDistance: 0.4, samePerson: "same" },
      { identityDistance: null, samePerson: "same" },
      { identityDistance: 0.5, samePerson: "unsure" },
    ],
    0.45,
  );
  assert.ok(Math.abs(stats.same.median - 0.3) < 1e-12);
  assert.ok(Math.abs(stats.same.p95 - 0.39) < 1e-12);
  assert.equal(stats.unavailable, 1);
  assert.equal(stats.unlabelled, 1);
  assert.equal(stats.different.median, null);
  assert.equal(stats.falseAcceptRate, null);
  assert.throws(() => identityStatistics([], NaN));
});

test("an unavailable identity distance prevents measured live quality targets despite complete staff scores", () => {
  const report = fullReport("live");
  report.cases[0].results[0].identityDistance = null;
  resign(report);
  const result = summarizeJewelleryReview(report, review(report)).providers[0];
  assert.equal(result.completeMatrix, true);
  assert.equal(result.identity.unavailable, 1);
  assert.equal(result.qualityTargetsMeasured, false);
  assert.equal(result.qualityTargetsMet, false);
});
