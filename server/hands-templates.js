import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { DEFAULT_TEMPLATE_TONE, validTemplateTone } from "../src/profiles.js";

const directory = fileURLToPath(new URL("../public/hands/", import.meta.url));
const sides = ["left", "right"];
export const handPositions = ["thumb", "index", "middle", "ring", "little", "wrist"];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const inside = (n) => Number.isFinite(n) && n >= 0 && n <= 1023;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
function inPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

/** Authored 1024px image coordinates; angle is clockwise from a horizontal
 * jewellery band. Sides are the wearer's anatomical left/right, not mirrored. */
export function validateHandAnchors(input) {
  if (
    !object(input) ||
    input.schemaVersion !== 1 ||
    input.width !== 1024 ||
    input.height !== 1024 ||
    Object.keys(input).some(
      (key) => !["schemaVersion", "width", "height", "left", "right", "handMask"].includes(key),
    )
  )
    throw fail("Use the supported 1024 × 1024 hands anchor format.");
  const result = { schemaVersion: 1, width: 1024, height: 1024 };
  for (const side of sides) {
    if (!object(input[side]) || Object.keys(input[side]).length !== handPositions.length)
      throw fail("Provide all five fingers and the wrist for each hand.");
    result[side] = {};
    for (const name of handPositions) {
      const point = input[side][name];
      if (
        !object(point) ||
        Object.keys(point).length !== 4 ||
        !["x", "y", "angle", "widthPx"].every((key) => Object.hasOwn(point, key)) ||
        !inside(point.x) ||
        !inside(point.y) ||
        !Number.isFinite(point.angle) ||
        Math.abs(point.angle) > 180 ||
        !Number.isFinite(point.widthPx) ||
        point.widthPx < (name === "wrist" ? 120 : 30) ||
        point.widthPx > (name === "wrist" ? 300 : 90)
      )
        throw fail("Use in-frame anchors with finger widths 30–90 px and wrist widths 120–300 px.");
      const radians = (point.angle * Math.PI) / 180;
      for (const sign of [-1, 1])
        if (
          !inside(point.x + (sign * Math.cos(radians) * point.widthPx) / 2) ||
          !inside(point.y + (sign * Math.sin(radians) * point.widthPx) / 2)
        )
          throw fail("Keep the complete jewellery band inside the hands image.");
      result[side][name] = { x: point.x, y: point.y, angle: point.angle, widthPx: point.widthPx };
    }
  }
  if (
    !Array.isArray(input.handMask) ||
    input.handMask.length < 6 ||
    input.handMask.length > 256 ||
    input.handMask.some(
      (point) => !Array.isArray(point) || point.length !== 2 || !point.every(inside),
    )
  )
    throw fail("Use an in-frame polygon for the hand mask.");
  let area = 0;
  for (let i = 0; i < input.handMask.length; i++) {
    const a = input.handMask[i],
      b = input.handMask[(i + 1) % input.handMask.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 1000) throw fail("Use a hand mask with a visible area.");
  for (const side of sides)
    for (const point of Object.values(result[side]))
      if (!inPolygon(point.x, point.y, input.handMask))
        throw fail("Place every finger and wrist anchor inside the hand mask.");
  result.handMask = input.handMask.map((point) => [...point]);
  return result;
}

// A configurable root is for local asset tests/tools only. Request data must
// never set it. No per-customer image, remote fetch or generation is involved.
export function createHandsTemplates({ root = directory } = {}) {
  return async function handsTemplate(body, tone) {
    if (!["male", "female"].includes(body)) throw fail("Choose the male or female hands library.");
    const missing = tone === undefined || tone === null || tone === "";
    if (!missing && !validTemplateTone(tone)) throw fail("Choose an available template skin tone.");
    const selected = missing ? DEFAULT_TEMPLATE_TONE : tone;
    const base = path.join(root, `${body}-${selected}`);
    try {
      const [png, json] = await Promise.all([
        readFile(base + ".png"),
        readFile(base + ".json", "utf8"),
      ]);
      const meta = await sharp(png, { limitInputPixels: 1024 * 1024 }).metadata();
      if (meta.format !== "png" || meta.width !== 1024 || meta.height !== 1024 || meta.pages > 1)
        throw new Error();
      const anchors = validateHandAnchors(JSON.parse(json));
      return {
        png,
        anchors,
        body,
        tone: selected,
        sourceKind: "template",
        warnings: missing
          ? [
              {
                code: "hands_tone_defaulted",
                message: "No template skin tone was provided. Using Medium hands.",
              },
            ]
          : [],
      };
    } catch {
      throw fail("The selected hands template is unavailable. Check the studio installation.", 503);
    }
  };
}

export const handsTemplate = createHandsTemplates();
