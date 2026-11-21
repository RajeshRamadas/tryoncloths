import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBodyGirth } from "../server/evaluation/body-girth.js";

const measurements = (value) => ({ chest: value, waist: value, hip: value });
const sample = (body, split, photo, tape) => ({
  body,
  split,
  photoCm: measurements(photo),
  tapeCm: measurements(tape),
});

test("fits median adjustments per library and scores only held-out pilot samples", () => {
  const report = evaluateBodyGirth([
    sample("male", "calibration", 100, 100),
    sample("male", "calibration", 100, 120),
    sample("male", "validation", 90, 100),
    sample("male", "validation", 110, 120),
    sample("female", "calibration", 100, 90),
    sample("female", "validation", 90, 80),
  ]);

  assert.deepEqual(report.male.counts, { calibration: 2, validation: 2 });
  assert.deepEqual(report.male.measurements.chest, {
    currentFactor: 2.75,
    candidateFactor: 3.025,
    current: { meanErrorCm: -10, meanAbsoluteErrorCm: 10 },
    candidate: { meanErrorCm: 0, meanAbsoluteErrorCm: 1 },
  });
  assert.equal(report.female.measurements.chest.candidateFactor, 2.61);
});

test("reports when a candidate performs worse on held-out customers", () => {
  const report = evaluateBodyGirth([
    sample("male", "calibration", 100, 120),
    sample("male", "validation", 100, 100),
  ]);

  const { current, candidate } = report.male.measurements.chest;
  assert.equal(current.meanAbsoluteErrorCm, 0);
  assert.equal(candidate.meanAbsoluteErrorCm, 20);
});

test("rejects missing validation samples and invalid measurements", () => {
  assert.throws(
    () => evaluateBodyGirth([sample("male", "calibration", 100, 100)]),
    /needs both calibration and validation samples/,
  );
  assert.throws(
    () => evaluateBodyGirth([sample("male", "validation", 0, 100)]),
    /Invalid pilot sample at row 1/,
  );
});
