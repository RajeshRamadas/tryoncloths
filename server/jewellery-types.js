import {
  jewelleryTypes,
  jewelleryMetals,
  bangleSizes,
  jewelleryView,
} from "../src/jewellery-definitions.js";
export { jewelleryTypes, jewelleryMetals, bangleSizes };
const fail = (message) => Object.assign(new Error(message), { status: 400 });
export function catalogueCategory(
  value = "garment",
  { jewelleryEnabled = process.env.TRYON_JEWELLERY === "1" } = {},
) {
  if (!["garment", "jewellery"].includes(value))
    throw fail("Choose garment or jewellery as the catalogue category.");
  if (value === "jewellery" && !jewelleryEnabled)
    throw Object.assign(new Error("Jewellery catalogue is not enabled."), { status: 404 });
  return value;
}
export function validateAttributes(type, input) {
  if (!Object.hasOwn(jewelleryTypes, type)) throw fail("Choose a supported jewellery type.");
  const keys = [
    "metal",
    "purity",
    "stones",
    "weightG",
    "lengthCm",
    "dropMm",
    "pendantMm",
    "ringSizeIn",
    "bangleSize",
    "count",
    "pair",
    "huid",
    "variantOf",
  ];
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    throw fail("Use only the supported jewellery attributes.");
  if (!jewelleryMetals.some(([id]) => id === input.metal))
    throw fail("Choose a supported jewellery metal.");
  const result = { metal: input.metal };
  for (const [key, max] of [
    ["purity", 10],
    ["stones", 80],
    ["huid", 12],
  ])
    if (input[key] !== undefined) {
      if (
        typeof input[key] !== "string" ||
        input[key].length > max ||
        /[\x00-\x1f\x7f]/.test(input[key])
      )
        throw fail(`Use ${key} up to ${max} characters without line breaks.`);
      if (input[key].trim()) result[key] = input[key].trim();
    }
  for (const [key, min, max, integer] of [
    ["weightG", 0, 2000, false],
    ["lengthCm", 20, 120, false],
    ["dropMm", 2, 150, false],
    ["pendantMm", 5, 150, false],
    ["ringSizeIn", 1, 30, true],
    ["count", 1, 24, true],
  ])
    if (input[key] !== undefined) {
      const value = input[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (integer && !Number.isInteger(value))
      )
        throw fail(`Use ${key} from ${min} to ${max}${integer ? " as a whole number" : ""}.`);
      result[key] = value;
    }
  if (input.bangleSize !== undefined) {
    if (!bangleSizes.includes(input.bangleSize))
      throw fail("Choose an Indian bangle size from 2.2 to 2.12.");
    result.bangleSize = input.bangleSize;
  }
  if (input.pair !== undefined && typeof input.pair !== "boolean")
    throw fail("Pair must be true or false.");
  result.pair = input.pair ?? jewelleryTypes[type].pair;
  if (input.variantOf !== undefined) {
    if (
      typeof input.variantOf !== "string" ||
      !input.variantOf.trim() ||
      input.variantOf.length > 200 ||
      /[\x00-\x1f\x7f]/.test(input.variantOf)
    )
      throw fail("Choose a saved original jewellery item.");
    result.variantOf = input.variantOf;
  }
  return result;
}
export function chooseView(type, attributes = {}) {
  if (!Object.hasOwn(jewelleryTypes, type)) throw fail("Choose a supported jewellery type.");
  if (
    attributes.lengthCm !== undefined &&
    (typeof attributes.lengthCm !== "number" ||
      !Number.isFinite(attributes.lengthCm) ||
      attributes.lengthCm < 20 ||
      attributes.lengthCm > 120)
  )
    throw fail("Use lengthCm from 20 to 120.");
  return jewelleryView(type, attributes.lengthCm);
}

// Catalogue grouping is administrative; it must not invalidate a paid visual adaptation.
export function visualAttributes(attributes) {
  const { variantOf, ...visual } = attributes;
  return visual;
}
