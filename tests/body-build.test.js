import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILD_REFERENCES,
  GIRTH_FACTORS,
  measureBodyCm,
  measureBuild,
  suggestBuild,
} from "../src/body-build.js";

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
  // Head from y = 40, then the torso: shoulders to waist narrows, waist to hips widens, then the
  // legs down to the soles at y = 780.
  for (let y = 40; y < 190; y++)
    for (let x = 140; x <= 260; x++) if ((x - 200) ** 2 + (y - 110) ** 2 <= 70 * 70) fill(x, y);
  for (let y = 190; y <= 780; y++) {
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

test("girths in centimetres scale the outline by the customer's height", () => {
  const { lm, person } = figure();
  const girths = measureBodyCm(lm, person, W, H, 175, "male");
  // 741 px from crown to sole.
  const cm = 175 / 741,
    f = GIRTH_FACTORS.male;
  close(girths.waistCm, 121 * cm * f.waist, 1, "waist");
  close(girths.hipCm, 161 * cm * f.hip, 1, "hip");
  // The chest is measured just below the armpits. The upper arms overlap the outline there, so
  // about 151 px of the 165 px torso counts.
  close(girths.chestCm, 151 * cm * f.chest, 2, "chest");
  assert.ok(girths.chestCm > girths.waistCm);
  // A taller customer with the same photo has proportionally larger girths.
  const taller = measureBodyCm(lm, person, W, H, 192.5, "male");
  close(taller.waistCm, girths.waistCm * 1.1, 1, "scales with height");
  const female = measureBodyCm(lm, person, W, H, 175, "female");
  assert.ok(female.chestCm > girths.chestCm, "female chest factor is larger");
});

test("girths need a valid height and the whole body in the frame", () => {
  const { lm, person } = figure();
  assert.equal(measureBodyCm(lm, person, W, H, 0, "male"), null);
  assert.equal(measureBodyCm(lm, person, W, H, 175, "other"), null);
  // The head touches the top of the frame.
  const cropped = person.slice();
  for (let x = 180; x < 220; x++) for (let y = 0; y < 40; y++) cropped[y * W + x] = 255;
  assert.equal(measureBodyCm(lm, cropped, W, H, 175, "male"), null);
  // Only the torso is visible: far too short for a standing body.
  const torsoOnly = person.slice();
  torsoOnly.fill(0, 0, 150 * W);
  torsoOnly.fill(0, 520 * W);
  assert.equal(measureBodyCm(lm, torsoOnly, W, H, 175, "male"), null);
});
