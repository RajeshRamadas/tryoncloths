import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { GIRTH_FACTORS } from "../../src/body-build.js";

const measures = ["chest", "waist", "hip"];
const splits = ["calibration", "validation"];
const round = (value) => Number(value.toFixed(4));

export function evaluateBodyGirth(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("Expected a non-empty array of pilot samples");
  }

  const groups = new Map();
  for (const [index, sample] of samples.entries()) {
    if (
      !sample ||
      typeof sample.body !== "string" ||
      !Object.hasOwn(GIRTH_FACTORS, sample.body) ||
      !splits.includes(sample.split) ||
      !["photoCm", "tapeCm"].every((source) =>
        measures.every((measure) => {
          const value = sample[source]?.[measure];
          return (
            Number.isFinite(value) &&
            value >= 1 &&
            value <= 1000 &&
            (source !== "photoCm" || Number.isInteger(value))
          );
        }),
      )
    ) {
      throw new Error(`Invalid pilot sample at row ${index + 1}`);
    }
    if (!groups.has(sample.body)) groups.set(sample.body, { calibration: [], validation: [] });
    groups.get(sample.body)[sample.split].push(sample);
  }

  return Object.fromEntries(
    Array.from(groups, ([body, { calibration, validation }]) => {
      if (!calibration.length || !validation.length) {
        throw new Error(`The ${body} library needs both calibration and validation samples`);
      }

      const measurements = Object.fromEntries(
        measures.map((measure) => {
          const currentFactor = GIRTH_FACTORS[body][measure];
          const ratios = calibration
            .map(({ photoCm, tapeCm }) => tapeCm[measure] / photoCm[measure])
            .sort((a, b) => a - b);
          const low = Math.floor((ratios.length - 1) / 2);
          const high = Math.floor(ratios.length / 2);
          const candidateFactor = round((currentFactor * (ratios[low] + ratios[high])) / 2);
          const errors = (factor) => {
            const residuals = validation.map(
              ({ photoCm, tapeCm }) =>
                Math.round((photoCm[measure] * factor) / currentFactor) - tapeCm[measure],
            );
            return {
              meanErrorCm: round(
                residuals.reduce((sum, error) => sum + error, 0) / residuals.length,
              ),
              meanAbsoluteErrorCm: round(
                residuals.reduce((sum, error) => sum + Math.abs(error), 0) / residuals.length,
              ),
            };
          };
          return [
            measure,
            {
              currentFactor,
              candidateFactor,
              current: errors(currentFactor),
              candidate: errors(candidateFactor),
            },
          ];
        }),
      );

      return [
        body,
        {
          counts: { calibration: calibration.length, validation: validation.length },
          measurements,
        },
      ];
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , input, ...extra] = process.argv;
    if (!input || extra.length)
      throw new Error("Usage: npm run evaluate:body-girth -- <samples.json>");
    const samples = JSON.parse(await readFile(input, "utf8"));
    console.log(JSON.stringify(evaluateBodyGirth(samples), null, 2));
  } catch (error) {
    console.error(error instanceof SyntaxError ? "Invalid pilot JSON" : error.message);
    process.exitCode = 1;
  }
}
