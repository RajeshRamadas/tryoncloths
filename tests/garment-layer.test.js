import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  alignedPlacement,
  cleanMask,
  defaultGarmentPlacement,
  layerAnchors,
  prepareGarmentLayer,
  trimLayer,
} from "../src/garment-layer.js";
import { removeBackground } from "../src/jewellery-cutout.js";

async function decode(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

const near = (actual, expected, tolerance, message) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual.toFixed(4)} vs ${expected.toFixed(4)}`,
  );

const samples = {
  shirt: ["navy-tee", "cream-tee", "blue-shirt"],
  trousers: ["blue-jeans", "charcoal-chinos", "sand-chinos"],
  shoes: ["white-sneakers", "black-sneakers", "brown-shoes"],
};

test("shipped sample layers imported as files line up where the samples are drawn", async () => {
  for (const [category, ids] of Object.entries(samples))
    for (const id of ids) {
      const img = await decode(`public/garments/${id}.webp`);
      for (const personalized of [false, true]) {
        const layer = prepareGarmentLayer(
          img.rgba,
          img.width,
          img.height,
          category,
          "regular",
          personalized,
        );
        const expected = defaultGarmentPlacement(category, "regular", personalized);
        const p = layer.placement;
        near(p.width, expected.width, expected.width * 0.08, `${id} width`);
        near(p.x + p.width / 2, expected.x + expected.width / 2, 0.015, `${id} centre`);
        if (category === "shoes")
          near(p.y + p.height, expected.y + expected.height, 0.002, `${id} feet`);
        else near(p.y, expected.y, 0.001, `${id} top`);
        near(p.height, expected.height, expected.height * 0.1, `${id} length`);
      }
    }
});

test("tops are sized by the torso, not by the spread of the sleeves", () => {
  // A flat-lay top: 120 px body with sleeves reaching out to 300 px in the top third.
  const width = 300,
    height = 240,
    rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const body = x >= 90 && x < 210,
        sleeve = y < 80 && (x < 70 || x >= 230 || body || y < 30);
      if (body || sleeve) rgba[(y * width + x) * 4 + 3] = 255;
    }
  const anchors = layerAnchors(rgba, width, height, "shirt");
  assert.equal(anchors.width, 120);
  assert.equal(anchors.centre, 150);
  const broad = alignedPlacement("shirt", "broad", false, { width, height }, anchors);
  const slim = alignedPlacement("shirt", "slim", false, { width, height }, anchors);
  assert.ok(broad.width > slim.width, "broader profiles get a wider layer");
  near(broad.x + broad.width / 2, 186 / 384, 0.001, "torso centred on the body");
});

test("an off-centre waistband is centred on the body and long trousers end above the feet", () => {
  const width = 200,
    height = 700,
    rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x >= 20 && x < 140 && (y < 300 || x < 70 || x >= 90)) rgba[(y * width + x) * 4 + 3] = 255;
  const layer = prepareGarmentLayer(rgba, width, height, "trousers", "regular", false);
  assert.equal(layer.width, 120, "trimmed to the garment");
  const p = layer.placement;
  near(p.x + p.width / 2, 186 / 384, 0.001, "waistband centred");
  near(p.y, 474 / 942, 0.0001, "waistband at the waist");
  assert.ok(p.y + p.height <= 880 / 942 + 1e-9, "hem stays above the feet");
});

test("mask clean-up drops specks but keeps both shoes of a pair", () => {
  const width = 200,
    height = 60,
    rgba = new Uint8ClampedArray(width * height * 4);
  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) rgba.set([40, 40, 40, 255], (y * width + x) * 4);
  };
  fill(10, 10, 90, 55);
  fill(110, 10, 190, 55);
  fill(100, 2, 102, 4); // dust speck
  rgba[(58 * width + 5) * 4 + 3] = 10; // faint haze
  const clean = cleanMask(rgba, width, height);
  assert.equal(clean[(3 * width + 100) * 4 + 3], 0, "speck removed");
  assert.equal(clean[(58 * width + 5) * 4 + 3], 0, "haze removed");
  assert.equal(clean[(30 * width + 50) * 4 + 3], 255, "left shoe kept");
  assert.equal(clean[(30 * width + 150) * 4 + 3], 255, "right shoe kept");
  const trimmed = trimLayer(clean, width, height);
  assert.deepEqual([trimmed.width, trimmed.height], [180, 45]);
  assert.equal(trimLayer(new Uint8ClampedArray(16), 2, 2), null);
});

test("a garment product photo on a plain backdrop becomes an aligned transparent layer", async () => {
  const svg =
    '<svg width="500" height="520" xmlns="http://www.w3.org/2000/svg"><rect width="500" height="520" fill="#f4f3ef"/><path d="M160 60 L210 40 Q250 70 290 40 L340 60 L440 150 L390 200 L350 160 L350 480 L150 480 L150 160 L110 200 L60 150 Z" fill="#2e5c8a"/></svg>';
  const img = await decode(await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer());
  const { rgba } = removeBackground(img.rgba, img.width, img.height, { subject: "clothing" });
  const layer = prepareGarmentLayer(rgba, img.width, img.height, "shirt", "regular", false);
  assert.ok(Math.abs(layer.width - 380) <= 4 && Math.abs(layer.height - 440) <= 4);
  near(layer.anchors.width, 200, 4, "torso measured below the sleeves");
  near(layer.placement.width, ((380 / 200) * 0.53 * 310) / 384, 0.02, "scaled by the torso");
  assert.equal(layer.rgba[3], 0, "trimmed corner outside the shoulder is transparent");
});

test("clothing photos with nothing left after removal name clothing in the message", () => {
  const blank = new Uint8ClampedArray(100 * 100 * 4).fill(250);
  assert.throws(
    () => removeBackground(blank, 100, 100, { subject: "clothing" }),
    /No clothing was found/,
  );
});
