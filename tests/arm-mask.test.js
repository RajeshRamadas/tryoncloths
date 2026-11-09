import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armMask } from "../src/arm-mask.js";

// Real landmarks for a standing customer (the body-pose-check test fixtures).
const { poses } = JSON.parse(
  readFileSync(new URL("./fixtures/customers/body-poses.json", import.meta.url)),
);
const { width, height, landmarks } = poses["red-plaid"];
const at = (mask, i, t) => {
  // Point a fraction t of the way from landmark a to landmark b.
  const [a, b] = i;
  const x = Math.round((landmarks[a].x + (landmarks[b].x - landmarks[a].x) * t) * width),
    y = Math.round((landmarks[a].y + (landmarks[b].y - landmarks[a].y) * t) * height);
  return mask[y * width + x];
};

test("forearms and hands are masked, fading in below the elbow", () => {
  const mask = armMask(landmarks, null, width, height);
  for (const forearm of [
    [13, 15],
    [14, 16],
  ]) {
    assert.equal(at(mask, forearm, 0.6), 255, "mid-forearm is fully in front");
    assert.ok(at(mask, forearm, 0) < 20, "the elbow itself stays under the sleeve");
  }
  assert.equal(at(mask, [15, 19], 0.5), 255, "hand towards the index finger");
  // The torso centre and the face are untouched.
  const centre = (y) => mask[Math.round(y * height) * width + Math.round(0.5 * width)];
  assert.equal(centre(0.35), 0);
  assert.equal(centre(0.1), 0);
  let covered = 0;
  for (const v of mask) if (v > 127) covered++;
  assert.ok(covered / mask.length < 0.05, "only a small share of the image is arm");
});

test("the person outline and the arm's colour limit the mask", () => {
  // Outline confidence: only the left half of the image is person.
  const person = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) person.fill(255, y * width, y * width + (width >> 1));
  const outlined = armMask(landmarks, person, width, height);
  assert.equal(at(outlined, [13, 15], 0.6) > 0, landmarks[15].x < 0.5);
  assert.equal(at(outlined, [14, 16], 0.6) > 0, landmarks[16].x < 0.5);
  // Skin-toned image with a dark band across the left forearm: the band is dropped.
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([196, 150, 120, 255], i);
  const bandY = Math.round((landmarks[13].y + (landmarks[15].y - landmarks[13].y) * 0.7) * height);
  for (let y = bandY - 3; y <= bandY + 3; y++)
    for (let x = 0; x < width; x++) rgba.set([40, 40, 45, 255], (y * width + x) * 4);
  const coloured = armMask(landmarks, null, width, height, rgba);
  assert.equal(at(coloured, [13, 15], 0.7), 0, "dark clothing pixel is not drawn in front");
  assert.equal(at(coloured, [13, 15], 0.5), 255, "skin pixel is");
});

test("no mask without a pose or visible wrists", () => {
  assert.equal(armMask([], null, width, height), null);
  assert.equal(armMask(undefined, null, width, height), null);
  const hidden = landmarks.map((l, i) => (i === 15 || i === 16 ? { ...l, visibility: 0.1 } : l));
  assert.equal(armMask(hidden, null, width, height), null);
});
