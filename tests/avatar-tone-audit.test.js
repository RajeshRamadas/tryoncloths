import test from "node:test";
import assert from "node:assert/strict";
import { assessAvatarTone, TONE_DIFFERENCE_LIMIT } from "../src/avatar-tone-audit.js";

const WIDTH = 128;
const HEIGHT = 256;

function fixture() {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 173;
    pixels[i + 1] = 119;
    pixels[i + 2] = 91;
    pixels[i + 3] = 255;
  }
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.98,
  }));
  const set = (index, x, y) => {
    landmarks[index] = { x, y, visibility: 0.98 };
  };
  set(0, 0.5, 0.2);
  set(7, 0.35, 0.18);
  set(8, 0.65, 0.18);
  set(11, 0.36, 0.35);
  set(12, 0.64, 0.35);
  set(13, 0.23, 0.44);
  set(15, 0.25, 0.7);
  set(14, 0.77, 0.44);
  set(16, 0.75, 0.7);
  return { pixels, width: WIDTH, height: HEIGHT, landmarks };
}

function recolour(input, x, y, colour, radius = 5) {
  const cx = Math.round(x * (input.width - 1));
  const cy = Math.round(y * (input.height - 1));
  for (let py = cy - radius; py <= cy + radius; py++) {
    for (let px = cx - radius; px <= cx + radius; px++) {
      if (px < 0 || py < 0 || px >= input.width || py >= input.height) continue;
      const index = (py * input.width + px) * 4;
      input.pixels.set([...colour, 255], index);
    }
  }
}

test("uniform generated complexion gives an advisory clear result, with no pixels returned", () => {
  const input = fixture();
  const result = assessAvatarTone(input);
  assert.deepEqual(result, { status: "clear", findings: [], checkedRegions: 3 });
  assert.equal("pixels" in result, false);
  assert.ok(TONE_DIFFERENCE_LIMIT > 0);
});

test("neck and one forearm colour deviations are reported individually", () => {
  const input = fixture();
  recolour(input, 0.5, 0.305, [45, 70, 185]);
  recolour(input, 0.2464, 0.6532, [55, 120, 220]);
  const result = assessAvatarTone(input);
  assert.equal(result.status, "review");
  assert.equal(result.checkedRegions, 3);
  assert.deepEqual(
    result.findings.map((item) => item.code),
    ["neck-colour-difference", "left-arm-colour-difference"],
  );
  assert.ok(result.findings.every((item) => item.message.includes("clothing")));
});

test("covered, low-visibility or transparent regions do not pretend to be clear", () => {
  const input = fixture();
  for (const index of [11, 12, 13, 14, 15, 16]) {
    input.landmarks[index].visibility = 0.1;
  }
  const missingRegions = assessAvatarTone(input);
  assert.equal(missingRegions.status, "unverified");
  assert.equal(missingRegions.checkedRegions, 0);

  const transparent = fixture();
  for (let i = 3; i < transparent.pixels.length; i += 4) {
    transparent.pixels[i] = 0;
  }
  assert.equal(assessAvatarTone(transparent).status, "unverified");
});

test("missing and malformed source buffers are unverified, never approved", () => {
  assert.equal(assessAvatarTone().status, "unverified");
  const invalidPixels = fixture();
  invalidPixels.pixels = new Uint8ClampedArray(12);
  assert.equal(assessAvatarTone(invalidPixels).status, "unverified");
  const invalidPose = fixture();
  invalidPose.landmarks[0].x = Number.NaN;
  invalidPose.landmarks[7].visibility = 0;
  invalidPose.landmarks[8].visibility = 0;
  assert.equal(assessAvatarTone(invalidPose).status, "unverified");
});

test("person mask is respected without leaking measured colours", () => {
  const input = fixture();
  const personWidth = 32;
  const personHeight = 64;
  const person = new Uint8Array(personWidth * personHeight).fill(255);
  // Make all lower samples unavailable, while keeping the facial pixels visible.
  for (let y = 16; y < personHeight; y++) {
    person.fill(0, y * personWidth, (y + 1) * personWidth);
  }
  const result = assessAvatarTone({ ...input, person, personWidth, personHeight });
  assert.equal(result.status, "unverified");
  assert.deepEqual(Object.keys(result).sort(), ["checkedRegions", "findings", "status"]);
});
