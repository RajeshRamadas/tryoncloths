// Forearm and hand mask for the outfit compositor: the avatar's own pixels inside this mask
// are drawn again over clothing layers, so hands and forearms sit in front of a top instead of
// behind it. Built from pose landmarks (MediaPipe BlazePose indices) and the person outline.

const L_SHOULDER = 11,
  R_SHOULDER = 12,
  L_HIP = 23,
  R_HIP = 24;
// [elbow, wrist, pinky, index, thumb] for each side.
const ARMS = [
  [13, 15, 17, 19, 21],
  [14, 16, 18, 20, 22],
];

/** Distance from (px,py) to the segment a–b, and how far along it the nearest point is. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

const median = (values) => {
  const sorted = Float64Array.from(values).sort();
  return sorted[sorted.length >> 1];
};

/** Median colour along the middle of the forearm (or around the wrist): the arm's skin tone. */
function armColour(rgba, width, height, capsules) {
  const r = [],
    g = [],
    b = [];
  for (const [a, c, , forearm] of capsules) {
    if (!forearm) continue;
    for (let t = 0.3; t <= 0.9; t += 0.02) {
      const x = Math.round(a.x + (c.x - a.x) * t),
        y = Math.round(a.y + (c.y - a.y) * t);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      r.push(rgba[i]);
      g.push(rgba[i + 1]);
      b.push(rgba[i + 2]);
    }
  }
  return r.length ? [median(r), median(g), median(b)] : null;
}

/**
 * @param {{x:number,y:number,visibility?:number}[]} landmarks normalised to the image
 * @param {Uint8Array|Uint8ClampedArray|null} person person confidence 0–255 per pixel, or null
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Uint8ClampedArray|null} [rgba] the image, to keep only arm-coloured pixels
 * @returns {Uint8ClampedArray|null} alpha 0–255 per pixel, or null when no arm is visible
 */
export function armMask(landmarks, person, width, height, rgba = null) {
  if (!landmarks || landmarks.length < 33) return null;
  const p = landmarks.map((l) => ({ x: l.x * width, y: l.y * height, v: l.visibility ?? 1 }));
  const mid = (a, b) => ({ x: (p[a].x + p[b].x) / 2, y: (p[a].y + p[b].y) / 2 });
  const shoulders = mid(L_SHOULDER, R_SHOULDER),
    hips = mid(L_HIP, R_HIP);
  const torso = Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y);
  if (!(torso > 8)) return null;
  // Forearms are about 14% of the shoulder-to-hip length across; hands a little wider.
  const forearm = torso * 0.075,
    hand = torso * 0.09,
    feather = Math.max(1.5, torso * 0.012);
  // [from, to, radius, isForearm]
  const capsules = [];
  for (const [elbow, wrist, ...fingers] of ARMS) {
    if (p[wrist].v < 0.5) continue;
    if (p[elbow].v >= 0.5) capsules.push([p[elbow], p[wrist], forearm, true]);
    for (const f of fingers) if (p[f].v >= 0.3) capsules.push([p[wrist], p[f], hand, false]);
  }
  if (!capsules.length) return null;
  const skin = rgba ? armColour(rgba, width, height, capsules) : null;
  // Colours this far from the arm's own tone (clothing behind a hand, backdrop) are dropped.
  const near = 70,
    far = 110;
  const mask = new Uint8ClampedArray(width * height);
  for (const [a, b, radius, isForearm] of capsules) {
    const reach = radius + feather;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - reach)),
      x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + reach)),
      y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - reach)),
      y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + reach));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const { d, t } = segmentDistance(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y);
        if (d >= reach) continue;
        let cover = d <= radius ? 1 : 1 - (d - radius) / feather;
        // Fade in below the elbow: the upper arm stays under the sleeve.
        if (isForearm) cover *= Math.min(1, t / 0.25);
        const i = y * width + x;
        if (skin) {
          const k = i * 4,
            dc = Math.hypot(rgba[k] - skin[0], rgba[k + 1] - skin[1], rgba[k + 2] - skin[2]);
          cover *= dc <= near ? 1 : dc >= far ? 0 : (far - dc) / (far - near);
        }
        const value = Math.round(cover * 255);
        if (value > mask[i]) mask[i] = value;
      }
  }
  if (person)
    for (let i = 0; i < mask.length; i++) {
      // A steep ramp on the outline confidence avoids a halo of backdrop around the arm.
      const confidence = Math.max(0, Math.min(1, (person[i] / 255 - 0.65) * 5));
      mask[i] = Math.round(mask[i] * confidence);
    }
  return mask;
}
