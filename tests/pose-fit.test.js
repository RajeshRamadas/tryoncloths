import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { poseMapping, referenceLandmarks, triangleAffine, warpTriangles } from "../src/pose-fit.js";

const { poses } = JSON.parse(
  readFileSync(new URL("./fixtures/customers/body-poses.json", import.meta.url)),
);
const template = poses["red-plaid"].landmarks;
const move = (lm, f) => lm.map((l) => ({ ...l, ...f(l) }));
const close = (a, b, tolerance, message) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);

test("an unchanged pose maps every point to itself", () => {
  for (const category of ["shirt", "trousers", "shoes"]) {
    const map = poseMapping(category, template, template);
    for (const p of [
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.95 },
      // Far outside the body quad, where an extrapolated bilinear quad folds over.
      { x: 0.06, y: 0.95 },
    ]) {
      const q = map(p);
      close(q.x, p.x, 1e-6, `${category} x`);
      close(q.y, p.y, 1e-6, `${category} y`);
    }
  }
});

test("a body that drifted and grew carries the layer with it, including sleeves outside the torso", () => {
  // 10% larger around the image centre, then 5% to the right.
  const actual = move(template, (l) => ({
    x: 0.5 + (l.x - 0.5) * 1.1 + 0.05,
    y: 0.5 + (l.y - 0.5) * 1.1,
  }));
  for (const category of ["shirt", "trousers", "shoes"]) {
    const map = poseMapping(category, template, actual);
    for (const p of [
      { x: 0.05, y: 0.25 },
      { x: 0.5, y: 0.4 },
      { x: 0.7, y: 0.9 },
    ]) {
      const q = map(p);
      close(q.x, 0.5 + (p.x - 0.5) * 1.1 + 0.05, 1e-6, `${category} x`);
      close(q.y, 0.5 + (p.y - 0.5) * 1.1, 1e-6, `${category} y`);
    }
  }
});

test("missing, hidden or implausible poses leave the layer unwarped", () => {
  assert.equal(poseMapping("shirt", template, []), null);
  assert.equal(poseMapping("shirt", null, template), null);
  const hidden = template.map((l, i) => (i === 23 ? { ...l, visibility: 0.1 } : l));
  assert.equal(poseMapping("shirt", template, hidden), null);
  assert.ok(poseMapping("shoes", template, hidden), "shoes only need the ankles");
  const tiny = move(template, (l) => ({ x: 0.5 + (l.x - 0.5) * 0.4, y: 0.5 + (l.y - 0.5) * 0.4 }));
  assert.equal(poseMapping("trousers", template, tiny), null);
});

test("warp triangles tile the layer and their affines map source corners onto targets", () => {
  const shift = (p) => ({ x: p.x + 0.1, y: p.y * 0.9 });
  const triangles = warpTriangles(
    { x: 100, y: 200, width: 300, height: 400 },
    600,
    800,
    shift,
    1000,
    1000,
    4,
  );
  assert.equal(triangles.length, 32);
  assert.deepEqual(triangles[0].src, [
    { x: 0, y: 0 },
    { x: 150, y: 0 },
    { x: 150, y: 200 },
  ]);
  close(triangles[0].dst[0].x, 200, 1e-9, "first corner x");
  close(triangles[0].dst[0].y, 180, 1e-9, "first corner y");
  for (const t of triangles) {
    const [a, b, c, d, e, f] = triangleAffine(t.src, t.dst);
    t.src.forEach((s, i) => {
      close(a * s.x + c * s.y + e, t.dst[i].x, 1e-6, "affine x");
      close(b * s.x + d * s.y + f, t.dst[i].y, 1e-6, "affine y");
    });
  }
  assert.equal(
    triangleAffine(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      triangles[0].dst,
    ),
    null,
  );
});

test("template landmarks are moved into the padded frame used for generated avatars", () => {
  const [nose] = referenceLandmarks([{ x: 0.5, y: 0.1 }], true);
  close(nose.x, (154 + 192) / 692, 1e-12, "x");
  close(nose.y, (48 + 94.2) / 1038, 1e-12, "y");
  assert.equal(referenceLandmarks(template, false), template);
});

test("sleeves follow the elbows and wrists while the middle of the shirt stays put", () => {
  // The left arm swings 6% further out; the body itself does not move.
  const actual = move(template, () => ({}));
  for (const i of [13, 15]) actual[i] = { ...actual[i], x: actual[i].x + 0.06 };
  const map = poseMapping("shirt", template, actual, 496 / 1024);
  for (const i of [13, 15]) {
    const q = map(template[i]);
    close(q.x, actual[i].x, 0.002, `joint ${i} x`);
    close(q.y, actual[i].y, 0.002, `joint ${i} y`);
  }
  // Halfway down the forearm moves with the arm.
  const forearm = map({
    x: (template[13].x + template[15].x) / 2,
    y: (template[13].y + template[15].y) / 2,
  });
  assert.ok(forearm.x - (template[13].x + template[15].x) / 2 > 0.045, "forearm follows");
  // The chest centre and the other sleeve barely move.
  const chest = { x: (template[11].x + template[12].x) / 2, y: 0.35 };
  close(map(chest).x, chest.x, 0.002, "chest x");
  const other = map(template[14]);
  close(other.x, template[14].x, 0.002, "right elbow x");
  // Partway between shoulder and elbow the sleeve bends only partly.
  const upper = map({
    x: (template[11].x + template[13].x) / 2,
    y: (template[11].y + template[13].y) / 2,
  });
  const shift = upper.x - (template[11].x + template[13].x) / 2;
  assert.ok(shift > 0.005 && shift < 0.055, `upper arm bends partly: ${shift}`);
});

test("trouser legs follow the knees", () => {
  const actual = move(template, () => ({}));
  actual[26] = { ...actual[26], x: actual[26].x - 0.04 };
  const map = poseMapping("trousers", template, actual, 496 / 1024);
  const q = map(template[26]);
  close(q.x, actual[26].x, 0.002, "knee x");
  close(map(template[25]).x, template[25].x, 0.004, "other knee x");
  close(map(template[24]).x, template[24].x, 0.002, "hip stays");
  close(map(template[28]).x, template[28].x, 0.002, "ankle stays");
});

test("a bent limb keeps the warp mesh from folding over", () => {
  const actual = move(template, () => ({}));
  actual[13] = { ...actual[13], x: actual[13].x + 0.06, y: actual[13].y - 0.03 };
  actual[15] = { ...actual[15], x: actual[15].x + 0.1 };
  actual[25] = { ...actual[25], x: actual[25].x + 0.05 };
  // Layer boxes around the sleeves and torso, and around the legs.
  const boxes = {
    shirt: { x: 50, y: 180, width: 420, height: 440 },
    trousers: { x: 150, y: 490, width: 230, height: 420 },
  };
  for (const category of ["shirt", "trousers"]) {
    const map = poseMapping(category, template, actual, 496 / 1024);
    const triangles = warpTriangles(boxes[category], 496, 1024, map, 496, 1024);
    const area = ([a, b, c]) => (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    for (const t of triangles)
      assert.ok(Math.sign(area(t.dst)) === Math.sign(area(t.src)), `${category} triangle flipped`);
  }
});

test("hidden or misread elbows and knees fall back to the body fit", () => {
  const body = poseMapping("shirt", template, template);
  const hidden = move(template, () => ({}));
  hidden[13] = { ...hidden[13], x: hidden[13].x + 0.06, visibility: 0.1 };
  const p = { x: template[13].x, y: template[13].y };
  close(poseMapping("shirt", template, hidden)(p).x, body(p).x, 1e-12, "hidden elbow");
  const misread = move(template, () => ({}));
  misread[25] = { ...misread[25], x: 0.02 };
  const legs = poseMapping("trousers", template, misread);
  close(legs(template[25]).x, template[25].x, 1e-12, "misread knee");
});
