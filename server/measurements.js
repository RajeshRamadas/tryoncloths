import { jewelleryMeasurementFields, validJewelleryMeasurement } from "../src/jewellery-sizing.js";
import { profiles } from "../src/profiles.js";
const fail = (message) => Object.assign(new Error(message), { status: 400 });
export const measurementRanges = {
  heightCm: [140, 210],
  weightKg: [35, 200],
  chestCm: [60, 200],
  waistCm: [40, 220],
  hipCm: [50, 240],
};
export const fitFields = ["chestCm", "waistCm", "hipCm"];
// Where chest, waist and hip came from: a tape measure, or the on-device photo estimate.
export const fitSources = ["tape", "photo"];
export function validateMeasurements(value, { chart = false } = {}) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw fail("Use an object of measurements in centimetres (weight in kg).");
  const allowed = chart
    ? fitFields
    : [
        ...Object.keys(measurementRanges),
        "bodyProfileId",
        "fitSource",
        ...jewelleryMeasurementFields.map((f) => f.key),
      ];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw fail("Use supported measurement fields only.");
  const result = {};
  for (const [field, item] of Object.entries(value)) {
    if (item == null) continue;
    if (field === "fitSource") {
      if (!fitSources.includes(item))
        throw fail("Record chest, waist and hip as taped or estimated from the photo.");
      result[field] = item;
      continue;
    }
    if (field === "bodyProfileId") {
      if (!profiles.some((p) => p.id === item)) throw fail("Choose an available body profile.");
      result[field] = item;
      continue;
    }
    if (jewelleryMeasurementFields.some((f) => f.key === field)) {
      if (!validJewelleryMeasurement(field, item))
        throw fail(
          "Use a valid jewellery measurement in millimetres, Indian ring size 1–30, or a listed bangle size.",
        );
      result[field] = item;
      continue;
    }
    const [min, max] = measurementRanges[field];
    if (!Number.isFinite(item) || item < min || item > max)
      throw fail(
        `${field} must be a number from ${min} to ${max}${field === "weightKg" ? " kg" : " cm"}.`,
      );
    result[field] = item;
  }
  if (chart && !Object.keys(result).length)
    throw fail("Record at least one chart measurement: chest, waist or hip.");
  return Object.keys(result).length ? result : null;
}
