import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { options, readJson, privateJson } from './files.js';
import { prepareQualityReport, summarizeReview, verifyReportImages } from './quality.js';

export async function main(args) {
  const [command, ...rest] = args;
  if (command === 'prepare') {
    const opts = options(rest, ['--manifest', '--out']);
    if (!opts['--manifest'] || !opts['--out']) throw new Error('Missing manifest/output.');
    const report = await prepareQualityReport(await readJson(opts['--manifest']), path.dirname(path.resolve(opts['--manifest'])), opts['--out']);
    console.log(`Prepared ${report.cases.length} cases. Open review.html in the private output directory. No provider requests made.`);
  } else if (command === 'summarize') {
    const opts = options(rest, ['--report', '--review', '--out']);
    if (!opts['--report'] || !opts['--review'] || !opts['--out']) throw new Error('Missing report/review/output.');
    const report = await readJson(opts['--report']);
    await verifyReportImages(report, path.dirname(path.resolve(opts['--report'])));
    const summary = summarizeReview(report, await readJson(opts['--review']));
    await privateJson(opts['--out'], summary);
    console.log(JSON.stringify({ providers: summary.providers, comparisons: summary.comparisons, rolloutApproved: false }, null, 2));
  } else throw new Error('Use prepare or summarize.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(() => {
    console.error('Quality evaluation could not complete. Check the documented command, consent, unique cases, local image paths, matching review and new output destination.');
    process.exitCode = 1;
  });
