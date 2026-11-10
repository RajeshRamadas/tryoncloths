import test from "node:test";
import assert from "node:assert/strict";
import { BUILD_REFERENCES, measureBuild, suggestBuild } from "../src/body-build.js";

const W = 400,
  H = 800;

/** A front-facing figure: torso 240 px long, shoulders 170 px apart, arms hanging at `armX`. */
function figure({ waistHalf = 60, hipHalf = 80, armX = 75, armRadius = 12 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.1, visibility: 0.99 }));
  const set = (i, x, y) => (lm[i] = { x: x / W, y: y / H, visibility: 0.99 });
  set(11, 285, 200);
  set(12, 115, 200);
  set(23, 250, 440);
  set(24, 150, 440);
  // Elbows, wrists and fingers on each side.
  for (const [side, sign] of [
    [0, 1],
    [1, -1],
  ]) {
    const x = 200 + sign * (100 + armX - 75);
    set(13 + side, x, 320);
    set(15 + side, x, 440);
    for (const f of [17, 19, 21]) set(f + side, x, 470);
  }
  const person = new Uint8Array(W * H);
  const fill = (x, y) => {
    if (x >= 0 && y >= 0 && x < W && y < H) person[y * W + x] = 255;
  };
  // Torso: shoulders to waist narrows, waist to hips widens, then the legs.
  for (let y = 190; y <= 700; y++) {
    const half =
      y < 368
        ? 90 + ((waistHalf - 90) * (y - 190)) / 178
        : y < 440
          ? waistHalf + ((hipHalf - waistHalf) * (y - 368)) / 72
          : hipHalf;
    for (let x = Math.round(200 - half); x <= Math.round(200 + half); x++) fill(x, y);
  }
  // Arms as filled capsules from shoulder to fingers.
  for (const [s, e, w, f] of [
    [11, 13, 15, 19],
    [12, 14, 16, 20],
  ]) {
    const pts = [s, e, w, f].map((i) => ({ x: lm[i].x * W, y: lm[i].y * H }));
    for (let k = 0; k < 3; k++)
      for (let t = 0; t <= 1; t += 0.01) {
        const cx = pts[k].x + (pts[k + 1].x - pts[k].x) * t,
          cy = pts[k].y + (pts[k + 1].y - pts[k].y) * t;
        for (let dy = -armRadius; dy <= armRadius; dy++)
          for (let dx = -armRadius; dx <= armRadius; dx++)
            if (dx * dx + dy * dy <= armRadius * armRadius)
              fill(Math.round(cx + dx), Math.round(cy + dy));
      }
  }
  return { lm, person };
}

const close = (a, b, tolerance, message) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);

test("shoulder, waist and hip widths are measured relative to the torso length", () => {
  const { lm, person } = figure();
  const build = measureBuild(lm, person, W, H);
  close(build.shoulders, 170 / 240, 0.005, "shoulders");
  close(build.waist, 121 / 240, 0.02, "waist");
  close(build.hips, 161 / 240, 0.02, "hips");
});

test("arms hanging against the body are not counted as waist or hips", () => {
  const away = measureBuild(...Object.values(figure({ armX: 90 })), W, H);
  // Arms 15 px further in: the hands now touch the hips and the forearms the waist.
  const touching = measureBuild(...Object.values(figure({ armX: 55 })), W, H);
  assert.ok(touching.waist <= away.waist + 0.01, `waist ${touching.waist} vs ${away.waist}`);
  assert.ok(touching.hips <= away.hips + 0.01, `hips ${touching.hips} vs ${away.hips}`);
});

test("a fuller figure measures wider", () => {
  const slim = measureBuild(...Object.values(figure({ armX: 110 })), W, H);
  const full = measureBuild(
    ...Object.values(figure({ waistHalf: 80, hipHalf: 95, armX: 110 })),
    W,
    H,
  );
  assert.ok(full.waist > slim.waist + 0.06);
  assert.ok(full.hips > slim.hips + 0.08);
});

test("photos that cannot be measured give no build", () => {
  const { lm, person } = figure();
  assert.equal(measureBuild(null, person, W, H), null);
  assert.equal(measureBuild(lm, person.subarray(1), W, H), null);
  const hidden = lm.map((l, i) => (i === 23 ? { ...l, visibility: 0.1 } : l));
  assert.equal(measureBuild(hidden, person, W, H), null);
  // Turned side-on: the shoulders nearly overlap.
  const turned = lm.map((l, i) => (i === 11 || i === 12 ? { ...l, x: 0.5 + (i - 11.5) * 0.1 } : l));
  assert.equal(measureBuild(turned, person, W, H), null);
  // An outline that runs off the side of the frame was not measured.
  const noArms = lm.map((l, i) => (i >= 13 && i <= 22 ? { ...l, visibility: 0 } : l));
  assert.equal(measureBuild(noArms, new Uint8Array(W * H).fill(255), W, H), null);
});

test("each template's own measurements suggest that template", () => {
  for (const r of BUILD_REFERENCES)
    assert.equal(suggestBuild(r, /** @type {any} */ (r.body)).profileId, r.profileId);
});

test("suggestions stay within the chosen body library and name a close runner-up", () => {
  const broadish = { shoulders: 0.7, waist: 0.8, hips: 0.81 };
  assert.equal(suggestBuild(broadish, "male").profileId, "broad");
  assert.equal(suggestBuild(broadish, "female").profileId, "f-curvy");
  // Between Regular and Athletic: both are named.
  const between = { shoulders: 0.743, waist: 0.653, hips: 0.856 };
  const s = suggestBuild(between, "male");
  assert.deepEqual([s.profileId, s.closeTo].sort(), ["athletic", "regular"]);
  assert.equal(suggestBuild(BUILD_REFERENCES[0], "male").closeTo, null);
  assert.equal(suggestBuild(null, "male"), null);
});
