// Fit placed clothing layers to the avatar's actual pose. A layer is placed against the
// standard template (its expected body position); when a generated avatar's body has drifted,
// shrunk, grown or tilted, the layer is warped from the template's body landmarks to the
// avatar's own landmarks (MediaPipe BlazePose indices). Pure geometry: no DOM, no network.

const L_SHOULDER = 11,
  R_SHOULDER = 12,
  L_HIP = 23,
  R_HIP = 24,
  L_ANKLE = 27,
  R_ANKLE = 28;

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

/** Inverse bilinear (Newton's method); works outside the quad by extrapolation. */
function inverseBilinear(q, p) {
  let u = 0.5,
    v = 0.5;
  const [a, b, c, d] = q;
  for (let k = 0; k < 20; k++) {
    const f = bilinear(q, u, v);
    const ex = f.x - p.x,
      ey = f.y - p.y;
    if (Math.abs(ex) + Math.abs(ey) < 1e-9) break;
    // Partial derivatives.
    const dux = (1 - v) * (b.x - a.x) + v * (c.x - d.x),
      duy = (1 - v) * (b.y - a.y) + v * (c.y - d.y),
      dvx = (1 - u) * (d.x - a.x) + u * (c.x - b.x),
      dvy = (1 - u) * (d.y - a.y) + u * (c.y - b.y);
    const det = dux * dvy - dvx * duy;
    if (!det) break;
    u -= (ex * dvy - ey * dvx) / det;
    v -= (dux * ey - duy * ex) / det;
  }
  return { u, v };
}

const span = (q) => Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
const height = (q) =>
  Math.hypot((q[3].x + q[2].x - q[0].x - q[1].x) / 2, (q[3].y + q[2].y - q[0].y - q[1].y) / 2);

/**
 * Point mapping from the template's body to the avatar's body for one category, in
 * normalised image coordinates, or null when the pose is missing or the change is implausible
 * (then the layer is drawn at its plain placement).
 */
export function poseMapping(category, reference, actual) {
  const from = bodyQuad(category, reference),
    to = bodyQuad(category, actual);
  if (!from || !to) return null;
  const ratios = [span(to) / span(from), height(to) / height(from)];
  if (!ratios.every((r) => Number.isFinite(r) && r > 0.6 && r < 1.6)) return null;
  return (p) => {
    const { u, v } = inverseBilinear(from, p);
    return bilinear(to, u, v);
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
  n = 8,
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
