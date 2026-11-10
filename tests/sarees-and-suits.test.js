import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { femaleOnlyGarments, garmentTypes, tryOnPrompt } from "../server/gemini-tryon.js";
import { guessShopType } from "../server/shop-catalogue.js";
import { freeSizeSaree, recommendSize } from "../server/size.js";
import {
  alignedPlacement,
  defaultGarmentPlacement,
  layerAnchors,
  OUTER_EASE,
  prepareGarmentLayer,
  TORSO_WIDTH,
} from "../src/garment-layer.js";
import { poseMapping } from "../src/pose-fit.js";

const near = (actual, expected, tolerance, message) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual.toFixed(4)} vs ${expected.toFixed(4)}`,
  );

test("blazer and suit are try-on types for every body; sarees stay in the female library", () => {
  for (const type of ["saree", "blazer", "suit"]) assert.ok(Object.hasOwn(garmentTypes, type));
  assert.ok(femaleOnlyGarments.includes("saree"));
  assert.ok(!femaleOnlyGarments.includes("blazer"));
  assert.ok(!femaleOnlyGarments.includes("suit"));
});

test("try-on prompts describe the saree drape and layer blazers and suits over the shirt", () => {
  const saree = tryOnPrompt("saree", "Kanjivaram silk saree");
  assert.match(saree, /pleats/);
  assert.match(saree, /pallu .*left shoulder/);
  assert.match(saree, /blouse/);
  const blazer = tryOnPrompt("blazer");
  assert.match(blazer, /outer layer over the current shirt or top/);
  assert.match(blazer, /shirt collar shows inside the lapels/);
  const suit = tryOnPrompt("suit", "Navy two-piece suit");
  assert.match(suit, /suit trousers at full length/);
  assert.match(suit, /same fabric, colour and pattern/);
  assert.match(suit, /waistcoat only if Image 2 shows one/);
  // Types without drape notes keep the original prompt shape.
  assert.doesNotMatch(tryOnPrompt("shirt"), /undefined/);
});

test("product names are sorted into sarees, blazers and suits", async () => {
  const { guessGarmentType } = await import("../src/garment-types.ts");
  for (const guess of [guessShopType, guessGarmentType])
    for (const [title, type] of [
      ["Banarasi silk saree with blouse piece", "saree"],
      ["Slim fit navy blazer", "blazer"],
      ["Wool suit jacket", "blazer"],
      ["Charcoal two-piece suit", "suit"],
      ["Three piece suit with waistcoat", "suit"],
      ["Black tuxedo", "suit"],
      ["Dress suit for weddings", "suit"],
      ["Suit trousers, grey", "trousers"],
      ["Cotton salwar suit", "outfit"],
      ["Anarkali suit set", "outfit"],
      ["Grey track suit", "outfit"],
      ["Denim jacket", "jacket"],
      ["Floral summer dress", "dress"],
    ])
      assert.equal(guess(title), type, title);
});

const chart = (size, chestCm, waistCm, sortOrder) => ({
  size,
  measurements: { chestCm, waistCm },
  sortOrder,
});

test("blazers are sized by chest, with the waist counting for half", () => {
  const rows = [chart("38", 96, 84, 10), chart("40", 101, 89, 20)];
  // Chest says 40; the waist leans to 38 but counts for half.
  const measured = { chestCm: 101, waistCm: 84 };
  assert.equal(recommendSize(rows, measured).size, "38", "plain shirt rules tie-break to 38");
  const blazer = recommendSize(rows, measured, { garmentType: "blazer" });
  assert.equal(blazer.size, "40");
  assert.match(blazer.reason, /Blazers are sized by chest/);
});

test("a suit whose jacket and trousers fit different sizes says so and is not High", () => {
  const rows = [chart("38R", 96, 82, 10), chart("40R", 101, 87, 20), chart("42R", 106, 92, 30)];
  const matched = recommendSize(rows, { chestCm: 101, waistCm: 87 }, { garmentType: "suit" });
  assert.equal(matched.size, "40R");
  assert.equal(matched.confidence, "High");
  assert.doesNotMatch(matched.reason, /separates/);
  const split = recommendSize(rows, { chestCm: 106, waistCm: 82 }, { garmentType: "suit" });
  assert.equal(split.confidence, "Medium");
  assert.match(split.reason, /jacket fits 42R by chest but the trousers fit 38R by waist/);
});

test("sarees without a chart are free size; the blouse is what gets measured", () => {
  assert.equal(freeSizeSaree.size, "Free size");
  assert.equal(freeSizeSaree.source, "rule");
  assert.match(freeSizeSaree.reason, /blouse/);
  const blouse = recommendSize(
    [chart("BLOUSE 34", 86, 72, 10), chart("BLOUSE 36", 91, 76, 20)],
    { chestCm: 91, waistCm: 77 },
    { garmentType: "saree" },
  );
  assert.equal(blouse.size, "BLOUSE 36");
  assert.match(blouse.reason, /saree drape itself is free size/);
});

/** A blazer front view: two front panels with an open front, and sleeves at the sides. */
function blazerLayer() {
  const width = 320,
    height = 360,
    rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const panel = (x >= 90 && x < 152) || (x >= 168 && x < 230);
      const shoulders = y < 60 && x >= 90 && x < 230;
      const sleeve = y < 300 && ((x >= 40 && x < 80) || (x >= 240 && x < 280));
      if (panel || shoulders || sleeve) rgba[(y * width + x) * 4 + 3] = 255;
    }
  return { rgba, width, height };
}

test("blazers are measured across the open front and sit a little wider than a top", () => {
  const { rgba, width, height } = blazerLayer();
  const anchors = layerAnchors(rgba, width, height, "outer");
  assert.equal(anchors.width, 140, "both front panels and the gap, not one panel");
  assert.equal(anchors.centre, 160);
  // A top would measure only one panel across the same gap.
  assert.equal(layerAnchors(rgba, width, height, "shirt").width, 62);
  const p = alignedPlacement("outer", "regular", false, { width, height }, anchors);
  near((p.width * 384 * anchors.width) / width, TORSO_WIDTH * OUTER_EASE, 0.5, "torso width");
  near(p.x + p.width / 2, 186 / 384, 0.001, "centred on the body");
  const box = defaultGarmentPlacement("outer", "regular", false),
    top = defaultGarmentPlacement("shirt", "regular", false);
  assert.ok(box.width > top.width && box.y <= top.y, "the blazer box covers the top's");
});

test("a saree hangs from the shoulders to the floor, centred on the pleats", () => {
  // Draped saree: a narrow pleated column with the pallu falling wide to one side.
  const width = 300,
    height = 900,
    rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const column = x >= 60 && x < 200;
      // The pallu hangs at the side down to the knees, touching the pleats.
      const pallu = y < 560 && x >= 200 && x < 290;
      if (column || pallu) rgba[(y * width + x) * 4 + 3] = 255;
    }
  const regular = prepareGarmentLayer(rgba, width, height, "drape", "f-regular", false);
  const p = regular.placement;
  near(p.y * 942, 170, 0.5, "top at the blouse shoulders");
  near((p.y + p.height) * 942, 919, 0.5, "hem on the floor line");
  // The pleated column (60–200 of 230 px after trimming at x = 60) is centred on the body,
  // even though the pallu makes the layer lopsided.
  const columnCentre = p.x + ((130 - 60) / regular.width) * p.width;
  near(columnCentre, 186 / 384, 0.002, "pleats centred");
  const curvy = prepareGarmentLayer(rgba, width, height, "drape", "f-curvy", false).placement;
  assert.ok(curvy.width > p.width, "fuller profiles get a wider drape");
  near(curvy.height, p.height, 1e-9, "same length");
});

test("blazer sleeves follow the arms; a saree follows the body but not the knees", () => {
  const { poses } = JSON.parse(
    readFileSync(new URL("./fixtures/customers/body-poses.json", import.meta.url)),
  );
  const template = poses["red-plaid"].landmarks;
  // Raise the left wrist and bend the left knee outward.
  const actual = template.map((l, i) =>
    i === 15 ? { ...l, y: l.y - 0.05 } : i === 25 ? { ...l, x: l.x + 0.04 } : l,
  );
  const outer = poseMapping("outer", template, actual),
    shirt = poseMapping("shirt", template, actual);
  const wrist = template[15];
  assert.deepEqual(outer(wrist), shirt(wrist), "blazer sleeves bend like a shirt's");
  assert.ok(outer(wrist).y < wrist.y - 0.03, "the sleeve end follows the raised wrist");
  const drape = poseMapping("drape", template, actual);
  const knee = template[25];
  near(drape(knee).x, knee.x, 1e-6, "the drape does not follow the knee");
  for (const p of [template[11], template[12], template[27], template[28]]) {
    const q = drape(p);
    near(q.x, p.x, 1e-6, "shoulders and ankles stay put");
    near(q.y, p.y, 1e-6, "shoulders and ankles stay put");
  }
});
