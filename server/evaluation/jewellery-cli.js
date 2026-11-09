import path from "node:path";
import { pathToFileURL } from "node:url";
import { options, readJson, privateJson } from "./files.js";
import {
  jewelleryTemplate,
  prepareJewelleryReport,
  verifyJewelleryReportImages,
  summarizeJewelleryReview,
} from "./jewellery.js";

export async function main(args) {
  const [command, ...rest] = args;
  if (command === "template") {
    const opts = options(rest, ["--out"]);
    if (!opts["--out"]) throw new Error("Missing output.");
    await privateJson(opts["--out"], jewelleryTemplate());
    console.log(
      "Created a 30-item × 10-portrait template. Supply consented local images and outcomes; fixture evidence is the default.",
    );
  } else if (command === "prepare") {
    const opts = options(rest, ["--manifest", "--out"]);
    if (!opts["--manifest"] || !opts["--out"]) throw new Error("Missing manifest/output.");
    const report = await prepareJewelleryReport(
      await readJson(opts["--manifest"], { maxBytes: 2 * 1024 * 1024 }),
      path.dirname(path.resolve(opts["--manifest"])),
      opts["--out"],
    );
    console.log(
      `Prepared ${report.cases.length} item/portrait cases for ${report.providers.length} providers. Serve review.html privately on localhost. No provider requests made.`,
    );
  } else if (command === "summarize") {
    const opts = options(rest, ["--report", "--review", "--pilot", "--threshold", "--out"]);
    if (!opts["--report"] || !opts["--review"] || !opts["--out"])
      throw new Error("Missing report/review/output.");
    const report = await readJson(opts["--report"], { maxBytes: 4 * 1024 * 1024 });
    await verifyJewelleryReportImages(report, path.dirname(path.resolve(opts["--report"])));
    const review = await readJson(opts["--review"], { maxBytes: 8 * 1024 * 1024 });
    const pilot = opts["--pilot"] ? await readJson(opts["--pilot"]) : null;
    const threshold =
      opts["--threshold"] === undefined ? report.identityThreshold : Number(opts["--threshold"]);
    const summary = summarizeJewelleryReview(report, review, { pilot, threshold });
    await privateJson(opts["--out"], summary);
    console.log(
      JSON.stringify(
        {
          providers: summary.providers.map((p) => ({
            id: p.id,
            reviewed: p.reviewed,
            total: p.total,
            qualityTargetsMeasured: p.qualityTargetsMeasured,
            qualityTargetsMet: p.qualityTargetsMet,
          })),
          pilotTargetsMeasured: summary.pilotTargetsMeasured,
          pilotTargetsMet: summary.pilotTargetsMet,
          rolloutApproved: false,
        },
        null,
        2,
      ),
    );
  } else throw new Error("Use template, prepare or summarize.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(() => {
    // Do not echo customer file paths, JSON contents or provider messages.
    console.error(
      "Jewellery evaluation could not complete. Check the documented command, consent, unique local images, exact matching report/review, and a new output destination.",
    );
    process.exitCode = 1;
  });
