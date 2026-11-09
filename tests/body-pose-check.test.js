import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessBodyPose, POSE_HINTS } from "../src/body-pose-check.js";

// Landmarks the real model produced for the three synthetic customer fixtures.
const { poses } = JSON.parse(
  readFileSync(new URL("./fixtures/customers/body-poses.json", import.meta.url)),
);
const codes = (hints) => hints.map((h) => h.code);
const clone = (pose) => structuredClone(pose.landmarks);
const red = poses["red-plaid"];

test("the customer fixture photos pass with no hints", () => {
  for (const [id, pose] of Object.entries(poses))
    assert.deepEqual(codes(assessBodyPose([pose.landmarks], pose.width, pose.height)), [], id);
});

test("missing people, several people and landscape photos are flagged", () => {
  assert.deepEqual(codes(assessBodyPose([], 500, 1000)), ["no-person"]);
  assert.deepEqual(codes(assessBodyPose(undefined, 500, 1000)), ["no-person"]);
  const two = assessBodyPose([red.landmarks, red.landmarks], red.width, red.height);
  assert.ok(codes(two).includes("several-people"));
  // The same body squeezed into a wide frame also reads as turned, so check only the new code.
  assert.ok(codes(assessBodyPose([red.landmarks], 1600, 1000)).includes("landscape"));
});

test("a photo cropped at the knees or above the hair is flagged", () => {
  // Re-express the landmarks in a frame that keeps only the top 75% of the image.
  const knees = clone(red).map((l) => ({ ...l, y: l.y / 0.75 }));
  assert.deepEqual(codes(assessBodyPose([knees], red.width, red.height * 0.75)), ["feet-cropped"]);
  const hidden = clone(red);
  for (const i of [29, 30, 31, 32]) hidden[i].visibility = 0.1;
  assert.deepEqual(codes(assessBodyPose([hidden], red.width, red.height)), ["feet-cropped"]);
  // Crop 60 px from the top: the hair no longer fits.
  const top = clone(red).map((l) => ({ ...l, y: (l.y * red.height - 60) / (red.height - 60) }));
  assert.deepEqual(codes(assessBodyPose([top], red.width, red.height - 60)), ["head-cropped"]);
});

test("a small or off-centre customer is flagged", () => {
  // Shrink the person to half size in the middle of the frame.
  const small = clone(red).map((l) => ({ ...l, x: 0.25 + l.x / 2, y: 0.25 + l.y / 2 }));
  assert.deepEqual(codes(assessBodyPose([small], red.width, red.height)), ["too-far"]);
  const side = clone(red).map((l) => ({ ...l, x: l.x * 0.5 }));
  assert.ok(codes(assessBodyPose([side], red.width, red.height)).includes("off-centre"));
});

test("a turned or tilted body is flagged", () => {
  // Squash horizontally around the centre line: shoulders narrow as when turned side-on.
  const turned = clone(red).map((l) => ({ ...l, x: 0.5 + (l.x - 0.5) * 0.3 }));
  assert.deepEqual(codes(assessBodyPose([turned], red.width, red.height)), ["turned"]);
  // Shear the body so the feet drift sideways: a tilt of about 15°.
  const tilted = clone(red).map((l) => ({ ...l, x: l.x + ((l.y - 0.2) * 0.27 * 1024) / 496 }));
  assert.ok(codes(assessBodyPose([tilted], red.width, red.height)).includes("leaning"));
});

test("raised, outstretched and crossed arms are flagged", () => {
  const raised = clone(red);
  raised[15].y = raised[11].y - 0.05;
  assert.deepEqual(codes(assessBodyPose([raised], red.width, red.height)), ["arms-raised"]);
  const out = clone(red);
  out[16].x = 0.02;
  assert.deepEqual(codes(assessBodyPose([out], red.width, red.height)), ["arms-out"]);
  const crossed = clone(red);
  crossed[15] = { ...crossed[15], x: 0.5, y: 0.4 };
  assert.deepEqual(codes(assessBodyPose([crossed], red.width, red.height)), ["arms-covering"]);
  // A wrist the model cannot see is not judged.
  const unseen = clone(red);
  unseen[15] = { ...unseen[15], y: 0.01, visibility: 0.1 };
  assert.deepEqual(codes(assessBodyPose([unseen], red.width, red.height)), []);
});

test("every hint has staff-facing advice", () => {
  for (const [code, message] of Object.entries(POSE_HINTS)) {
    assert.match(code, /^[a-z-]+$/);
    assert.ok(message.length > 30 && message.endsWith("."), code);
  }
});
