// Fit placed clothing layers to the avatar's actual pose. A layer is placed against the
// standard template (its expected body position); when a generated avatar's body has drifted,
// shrunk, grown or tilted, the layer is warped from the template's body landmarks to the
// avatar's own landmarks (MediaPipe BlazePose indices). Sleeves and trouser legs then bend
// further to follow the elbows, wrists and knees. Pure geometry: no DOM, no network.
//
// The warp is the best affine fit of the body quad plus smooth corrections that pull each body
// point and joint exactly onto the avatar's. Away from the body the corrections fade to an
// average, so the warp never folds over the way extrapolating a bilinear quad does.

const L_SHOULDER = 11,
  R_SHOULDER = 12,
  L_ELBOW = 13,
  R_ELBOW = 14,
  L_WRIST = 15,
  R_WRIST = 16,
  L_HIP = 23,
  R_HIP = 24,
  L_KNEE = 25,
  R_KNEE = 26,
  L_ANKLE = 27,
  R_ANKLE = 28;

// Points of the body quad (u, v) that land exactly on the avatar's body: the corners and the
// centre line, so a moving elbow or knee does not drag the middle of the garment.
const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const BODY_POINTS = {
  shirt: [...CORNERS, [0.5, 0], [0.5, 0.5], [0.5, 1]],
  trousers: [...CORNERS, [0.5, 0], [0.5, 1]],
  shoes: CORNERS,
};
// Bones that bend a layer beyond its body quad: [from joint, to joint]. Each bone carries
// the garment around it the way the avatar's limb moved.
const BONES = {
  shirt: [
    [L_SHOULDER, L_ELBOW],
    [L_ELBOW, L_WRIST],
    [R_SHOULDER, R_ELBOW],
    [R_ELBOW, R_WRIST],
  ],
  trousers: [
    [L_HIP, L_KNEE],
    [L_KNEE, L_ANKLE],
    [R_HIP, R_KNEE],
    [R_KNEE, R_ANKLE],
  ],
  shoes: [],
};
// A joint further than this share of the body quad's width from where the body fit puts it
// is a misread landmark.
const MAX_JOINT_SHIFT = 0.5;
// How softly a bone hands over to its neighbours, as a share of the body quad's width.
const BLEND = 0.05;

const visible = (l) => (l?.visibility ?? 1) >= 0.5;

/** Body quad for a category: [a, b, c, d] around the body part the layer covers. */
function bodyQuad(category, lm) {
  const pick = (...indices) =>
    indices.every((i) => lm?.[i] && visible(lm[i])) ? indices.map((i) => lm[i]) : null;
  if (category === "shirt") return pick(L_SHOULDER, R_SHOULDER, R_HIP, L_HIP);
  if (category === "trousers") return pick(L_HIP, R_HIP, R_ANKLE, L_ANKLE);
  // Shoes: a square standing on the ankle line, so the pair moves and scales with the feet.
  const ankles = pick(L_ANKLE, R_ANKLE);
  if (!ankles) return null;
  const [a, b] = ankles,
    dx = b.x - a.x,
    dy = b.y - a.y;
  return [a, b, { x: b.x - dy, y: b.y + dx }, { x: a.x - dy, y: a.y + dx }];
}

/** Bilinear point inside quad q at (u, v). */
function bilinear(q, u, v) {
  const [a, b, c, d] = q;
  return {
    x: (1 - v) * ((1 - u) * a.x + u * b.x) + v * ((1 - u) * d.x + u * c.x),
    y: (1 - v) * ((1 - u) * a.y + u * b.y) + v * ((1 - u) * d.y + u * c.y),
  };
}

/** Least-squares affine map taking points `from` onto points `to`, or null if degenerate. */
function affineFit(from, to) {
  // Normal equations for [x y 1]·[a c e]ᵀ ≈ x′ (and likewise for y′).
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const bx = [0, 0, 0],
    by = [0, 0, 0];
  from.forEach((p, k) => {
    const row = [p.x, p.y, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += row[i] * row[j];
      bx[i] += row[i] * to[k].x;
      by[i] += row[i] * to[k].y;
    }
  });
  const det3 = (r) =>
    r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) -
    r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) +
    r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  const det = det3(m);
  if (!(Math.abs(det) > 1e-18)) return null;
  // Cramer's rule.
  const solve = (b) =>
    [0, 1, 2].map((k) => det3(m.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / det);
  const [a, c, e] = solve(bx),
    [b, d, f] = solve(by);
  return (p) => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });
}

/**
 * Smooth blend of the anchors' shifts at p, weighted by inverse distance to the fourth power
 * so each anchor moves exactly by its own shift. `aspect` is width / height of the image.
 */
function blendShift(anchors, p, aspect) {
  let wx = 0,
    wy = 0,
    total = 0;
  for (const { at, shift } of anchors) {
    const d2 = ((p.x - at.x) * aspect) ** 2 + (p.y - at.y) ** 2;
    if (d2 < 1e-14) return shift;
    const w = 1 / (d2 * d2);
    total += w;
    wx += w * shift.x;
    wy += w * shift.y;
  }
  return { x: wx / total, y: wy / total };
}

const span = (q) => Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
const height = (q) =>
  Math.hypot((q[3].x + q[2].x - q[0].x - q[1].x) / 2, (q[3].y + q[2].y - q[0].y - q[1].y) / 2);

/** Distance from p to segment a–b. */
function segmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Distance from p to a convex quad (0 inside). */
function quadDistance(p, q) {
  const side = (a, b) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const sides = q.map((a, i) => side(a, q[(i + 1) % 4]));
  if (sides.every((s) => s >= 0) || sides.every((s) => s <= 0)) return 0;
  return Math.min(...q.map((a, i) => segmentDistance(p, a, q[(i + 1) % 4])));
}

/**
 * Rotation, scale and shift carrying segment r0–r1 onto a0–a1, in square (aspect-corrected)
 * coordinates.
 */
function boneTransform(r0, r1, a0, a1) {
  const rx = r1.x - r0.x,
    ry = r1.y - r0.y,
    ax = a1.x - a0.x,
    ay = a1.y - a0.y,
    rr = rx * rx + ry * ry;
  // (a / r) as complex numbers: rotation and scale.
  const c = (ax * rx + ay * ry) / rr,
    s = (ay * rx - ax * ry) / rr;
  return (p) => {
    const x = p.x - r0.x,
      y = p.y - r0.y;
    return { x: a0.x + c * x - s * y, y: a0.y + s * x + c * y };
  };
}

/**
 * Point mapping from the template's body to the avatar's body for one category, in
 * normalised image coordinates, or null when the pose is missing or the change is implausible
 * (then the layer is drawn at its plain placement). Sleeves follow the elbows and wrists and
 * trouser legs the knees when those are visible; `aspect` (image width / height) keeps that
 * bend round rather than stretched.
 */
export function poseMapping(category, reference, actual, aspect = 1) {
  const from = bodyQuad(category, reference),
    to = bodyQuad(category, actual);
  if (!from || !to) return null;
  const ratios = [span(to) / span(from), height(to) / height(from)];
  if (!ratios.every((r) => Number.isFinite(r) && r > 0.6 && r < 1.6)) return null;
  const affine = affineFit(from, to);
  if (!affine) return null;
  const anchors = BODY_POINTS[category].map(([u, v]) => {
    const at = bilinear(from, u, v),
      target = bilinear(to, u, v),
      q = affine(at);
    return { at, shift: { x: target.x - q.x, y: target.y - q.y } };
  });
  const body = (p) => {
    const q = affine(p),
      shift = blendShift(anchors, p, aspect);
    return { x: q.x + shift.x, y: q.y + shift.y };
  };
  // Limb bones work in square coordinates so a rotation stays a rotation on screen.
  const square = (p) => ({ x: p.x * aspect, y: p.y });
  const limit = span(to) * MAX_JOINT_SHIFT;
  const joint = (i) => {
    const r = reference[i],
      a = actual[i];
    if (!r || !a || !visible(r) || !visible(a)) return null;
    const expected = body(r);
    return Math.hypot(a.x - expected.x, a.y - expected.y) <= limit ? { r, a } : null;
  };
  const bones = [];
  for (const [i, k] of BONES[category]) {
    const j0 = joint(i),
      j1 = joint(k);
    if (!j0 || !j1) continue;
    const r0 = square(j0.r),
      r1 = square(j1.r),
      a0 = square(j0.a),
      a1 = square(j1.a);
    const stretch = Math.hypot(a1.x - a0.x, a1.y - a0.y) / Math.hypot(r1.x - r0.x, r1.y - r0.y);
    if (!(stretch > 0.6 && stretch < 1.6)) continue;
    bones.push({ r0, r1, move: boneTransform(r0, r1, a0, a1) });
  }
  if (!bones.length) return body;
  // The body fit owns the torso (shirt) or the waistband (trousers); limbs take over outside.
  const core =
    category === "shirt" ? from.map(square) : [square(reference[L_HIP]), square(reference[R_HIP])];
  const coreDistance = (p) =>
    core.length === 4 ? quadDistance(p, core) : segmentDistance(p, core[0], core[1]);
  const soft = (BLEND * Math.hypot((from[1].x - from[0].x) * aspect, from[1].y - from[0].y)) ** 2;
  const weight = (d) => 1 / (d * d + soft) ** 2;
  return (p) => {
    const ps = square(p);
    const w0 = weight(coreDistance(ps)),
      q0 = body(p);
    let x = w0 * q0.x * aspect,
      y = w0 * q0.y,
      total = w0;
    for (const bone of bones) {
      const w = weight(segmentDistance(ps, bone.r0, bone.r1)),
        q = bone.move(ps);
      x += w * q.x;
      y += w * q.y;
      total += w;
    }
    return { x: x / total / aspect, y: y / total };
  };
}

/**
 * Triangles that warp a layer drawn in `rect` (canvas pixels) through `map`.
 * Returns [{ src: [p,p,p] in layer pixels, dst: [p,p,p] in canvas pixels }].
 */
export function warpTriangles(
  rect,
  layerWidth,
  layerHeight,
  map,
  canvasWidth,
  canvasHeight,
  n = 16,
) {
  const grid = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const sx = (i / n) * layerWidth,
        sy = (j / n) * layerHeight;
      const q = map({
        x: (rect.x + (i / n) * rect.width) / canvasWidth,
        y: (rect.y + (j / n) * rect.height) / canvasHeight,
      });
      grid.push({ src: { x: sx, y: sy }, dst: { x: q.x * canvasWidth, y: q.y * canvasHeight } });
    }
  const at = (i, j) => grid[j * (n + 1) + i];
  const triangles = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = at(i, j),
        b = at(i + 1, j),
        c = at(i + 1, j + 1),
        d = at(i, j + 1);
      triangles.push({ src: [a.src, b.src, c.src], dst: [a.dst, b.dst, c.dst] });
      triangles.push({ src: [a.src, c.src, d.src], dst: [a.dst, c.dst, d.dst] });
    }
  return triangles;
}

/** Affine [a, b, c, d, e, f] (canvas setTransform order) mapping triangle s onto triangle d. */
export function triangleAffine(s, d) {
  const [s0, s1, s2] = s,
    [d0, d1, d2] = d;
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (!det) return null;
  const solve = (k0, k1, k2) => {
    const p = ((k1 - k0) * (s2.y - s0.y) - (k2 - k0) * (s1.y - s0.y)) / det,
      q = ((k2 - k0) * (s1.x - s0.x) - (k1 - k0) * (s2.x - s0.x)) / det;
    return [p, q, k0 - p * s0.x - q * s0.y];
  };
  const [a, c, e] = solve(d0.x, d1.x, d2.x),
    [b, dd, f] = solve(d0.y, d1.y, d2.y);
  return [a, b, c, dd, e, f];
}

/** Template landmarks expressed in the frame the placements use (padded for portraits). */
export function referenceLandmarks(template, personalized) {
  if (!personalized) return template;
  // The standard 384 × 942 pose sits at (154, 48) inside the 692 × 1038 generated frame.
  return template.map((l) => ({
    ...l,
    x: (154 + l.x * 384) / 692,
    y: (48 + l.y * 942) / 1038,
  }));
}
