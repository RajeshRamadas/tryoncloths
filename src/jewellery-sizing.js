import { bangleSizes } from "./jewellery-definitions.js";
// Pilot reference chart: Indian ring labels 1–30, nominal circumference in mm.
// Retailer charts and actual fit vary; these values never certify a fit.
export const ringSizeTable = [
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
  65, 66, 67, 68, 69, 70,
].map((circumferenceMm, i) => ({
  size: i + 1,
  circumferenceMm,
  diameterMm: Math.round((circumferenceMm / Math.PI) * 100) / 100,
}));
// 2.10 means 2 + 10/16 inches, not the decimal number 2.1.
export const bangleSizeTable = bangleSizes.map((size) => {
  const [inch, sixteenth] = size.split(".").map(Number),
    diameterMm = (inch + sixteenth / 16) * 25.4;
  return { size, diameterMm, circumferenceMm: Math.round(diameterMm * Math.PI * 10) / 10 };
});
export const jewelleryMeasurementFields = [
  {
    key: "fingerCircumferenceMm",
    label: "Finger circumference (mm)",
    min: 35,
    max: 85,
    step: "any",
  },
  {
    key: "ringInnerDiameterMm",
    label: "Existing ring inner diameter (mm)",
    min: 11,
    max: 27,
    step: "any",
  },
  {
    key: "handCircumferenceMm",
    label: "Hand circumference at widest knuckles (mm)",
    min: 140,
    max: 300,
    step: "any",
  },
  { key: "ringSizeIn", label: "Known Indian ring size", min: 1, max: 30, step: "1" },
  { key: "bangleSizeIn", label: "Known Indian bangle size", options: bangleSizes },
];
const finite = (n) => typeof n === "number" && Number.isFinite(n);
export function validJewelleryMeasurement(key, value) {
  const f = jewelleryMeasurementFields.find((f) => f.key === key);
  return Boolean(
    f &&
    (f.options
      ? f.options.includes(value)
      : finite(value) &&
        value >= f.min &&
        value <= f.max &&
        (key !== "ringSizeIn" || Number.isInteger(value))),
  );
}
export function jewelleryMeasurementsForm(value = {}) {
  return Object.fromEntries(
    jewelleryMeasurementFields.map((f) => [
      f.key,
      value?.[f.key] == null ? "" : String(value[f.key]),
    ]),
  );
}
export function jewelleryMeasurementsInput(form) {
  return Object.fromEntries(
    jewelleryMeasurementFields.map((f) => [
      f.key,
      form[f.key] === "" ? null : f.options ? form[f.key] : Number(form[f.key]),
    ]),
  );
}
const unavailable = (reason) => ({
  size: null,
  confidence: "Low",
  source: "unavailable",
  alternatives: [],
  reason,
});
const known = (key, m) => (validJewelleryMeasurement(key, m?.[key]) ? m[key] : null);
export function ringSuggestion(m = {}) {
  const recorded = known("ringSizeIn", m),
    circ = known("fingerCircumferenceMm", m),
    diam = known("ringInnerDiameterMm", m),
    fromDiameter = diam === null ? null : diam * Math.PI;
  if (circ !== null && fromDiameter !== null && Math.abs(circ - fromDiameter) > 1) {
    return recorded !== null
      ? {
          size: recorded,
          confidence: "Low",
          source: "known",
          alternatives: [],
          reason:
            "The finger circumference and ring diameter disagree. The recorded size is shown; check the measurements for this hand and finger.",
        }
      : unavailable(
          "Finger circumference and ring diameter disagree by more than 1 mm of circumference. Recheck both before using a suggested size.",
        );
  }
  let mm = circ ?? fromDiameter;
  // A displayed diameter is rounded to 0.01 mm; allow only that conversion rounding at chart edges.
  if (circ === null && mm !== null) {
    if (mm >= 41 - 0.02 && mm < 41) mm = 41;
    if (mm <= 70 + 0.02 && mm > 70) mm = 70;
  }
  if (mm === null)
    return recorded !== null
      ? {
          size: recorded,
          confidence: "Medium",
          source: "known",
          alternatives: [],
          reason:
            "Recorded customer size; confirm the same hand, finger and retailer chart. It is not a new fit measurement.",
        }
      : unavailable(
          "Record this finger’s circumference, an existing ring’s inner diameter, or a known Indian ring size. No size is inferred from photos, height or weight.",
        );
  if (mm < ringSizeTable[0].circumferenceMm || mm > ringSizeTable.at(-1).circumferenceMm)
    return recorded !== null
      ? {
          size: recorded,
          confidence: "Low",
          source: "known",
          alternatives: [],
          reason:
            "The measurement is outside the pilot chart (41–70 mm circumference). Check it against the recorded size and the jeweller’s chart.",
        }
      : unavailable(
          "Outside the pilot ring chart (41–70 mm circumference). Use the jeweller’s chart and a physical size check.",
        );
  const ranked = [...ringSizeTable].sort(
      (a, b) =>
        Math.abs(a.circumferenceMm - mm) - Math.abs(b.circumferenceMm - mm) || b.size - a.size,
    ),
    converted = ranked[0].size,
    size = recorded ?? converted,
    conflict = recorded !== null && recorded !== converted;
  return {
    size,
    confidence: recorded !== null && !conflict ? "Medium" : "Low",
    source: recorded !== null ? "known" : "measured",
    alternatives: [...new Set([converted, ...ranked.slice(0, 3).map((r) => r.size)])]
      .filter((s) => s !== size)
      .slice(0, 2),
    reason: conflict
      ? `Recorded size ${recorded} differs from the reference-table estimate ${converted}. Confirm the selected finger and the retailer’s chart before choosing.`
      : `${Math.round(mm * 10) / 10} mm circumference${circ === null ? " calculated from inner diameter" : ""} → approximate Indian size ${converted}. Nearest reference size; exact ties favour the larger label. Confirm the retailer’s chart and physical fit.`,
  };
}
export function bangleSuggestion(m = {}) {
  const recorded = known("bangleSizeIn", m),
    mm = known("handCircumferenceMm", m);
  if (mm === null)
    return recorded !== null
      ? {
          size: recorded,
          confidence: "Medium",
          source: "known",
          alternatives: [],
          reason:
            "Recorded Indian bangle size; confirm the selected hand and the retailer’s chart.",
        }
      : unavailable(
          "Measure around the widest knuckles with the thumb tucked in, or record a known bangle size. Wrist circumference is not a substitute.",
        );
  if (mm < bangleSizeTable[0].circumferenceMm || mm > bangleSizeTable.at(-1).circumferenceMm)
    return recorded !== null
      ? {
          size: recorded,
          confidence: "Low",
          source: "known",
          alternatives: [],
          reason:
            "Hand circumference is outside this pilot chart (169.6–219.4 mm). Check the recorded size in store.",
        }
      : unavailable(
          "Outside the pilot bangle chart (169.6–219.4 mm hand circumference). Check an actual bangle and the jeweller’s chart.",
        );
  const index = bangleSizeTable.findIndex((r) => r.circumferenceMm >= mm),
    converted = bangleSizeTable[index].size,
    size = recorded ?? converted,
    conflict = recorded !== null && recorded !== converted;
  return {
    size,
    confidence: recorded !== null && !conflict ? "Medium" : "Low",
    source: recorded !== null ? "known" : "measured",
    alternatives: [converted, bangleSizeTable[index - 1]?.size, bangleSizeTable[index + 1]?.size]
      .filter((s, i, a) => s && s !== size && a.indexOf(s) === i)
      .slice(0, 2),
    reason: conflict
      ? `Recorded size ${recorded} differs from the table estimate ${converted}. Check knuckle measurement and physical passage over the selected hand.`
      : `${mm} mm hand circumference → approximate size ${converted}. Uses the next listed inner circumference that is not smaller; hand shape, compression and bangle width affect passage. Try it in store.`,
  };
}
export const necklaceLengths = [
  { id: "choker", label: "Choker", lengthCm: 40, colour: "#a66a18" },
  { id: "princess", label: "Princess", lengthCm: 45, colour: "#2f7993" },
  { id: "matinee", label: "Matinee", lengthCm: 60, colour: "#96548b" },
  { id: "opera", label: "Opera", lengthCm: 80, colour: "#346b4d" },
];
export function necklaceGuides(packet, lengths = necklaceLengths) {
  const { width, height, pxPerMm, anchors } = packet || {},
    p = anchors?.neckBase;
  if (
    ![width, height, pxPerMm, p?.x, p?.y].every(finite) ||
    width <= 0 ||
    height <= 0 ||
    pxPerMm <= 0 ||
    p.x < 0 ||
    p.x > width ||
    p.y < 0 ||
    p.y > height
  )
    throw new Error("Necklace anchors are unavailable for this view.");
  if (packet.angle !== undefined && !finite(packet.angle))
    throw new Error("Use a valid necklace guide angle.");
  const radius = Math.min(65 * pxPerMm, width * 0.35),
    angle = packet.angle || 0;
  return lengths.map((l) => {
    if (!finite(l.lengthCm) || l.lengthCm < 20 || l.lengthCm > 120)
      throw new Error("Use a necklace length from 20 to 120 cm.");
    const drop = Math.max(4, 20 + (l.lengthCm - 40) * 5) * pxPerMm;
    return {
      ...l,
      neck: { ...p },
      radius,
      drop,
      angle,
      path: `M ${-radius} 0 C ${-radius} ${(drop * 4) / 3} ${radius} ${(drop * 4) / 3} ${radius} 0`,
      bottom: {
        x: p.x - Math.sin((angle * Math.PI) / 180) * drop,
        y: p.y + Math.cos((angle * Math.PI) / 180) * drop,
      },
      belowView: p.y + Math.cos((angle * Math.PI) / 180) * drop > height,
    };
  });
}
