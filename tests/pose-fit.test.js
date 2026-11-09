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
