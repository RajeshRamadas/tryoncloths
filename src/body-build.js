// Body build from a full-body photo: shoulder, waist and hip widths measured from on-device
// pose landmarks (MediaPipe BlazePose indices) and the person outline, compared with the same
// measurements of the standard body templates. Advisory only: staff choose the profile, and
// clothing, posture and camera angle all change the widths. Pure geometry: no DOM, no network.

const L_SHOULDER = 11,
  R_SHOULDER = 12,
  L_HIP = 23,
  R_HIP = 24;
// Arm and hand segments that can touch the torso outline: [from, to].
const ARM_SEGMENTS = [
  [11, 13],
  [13, 15],
  [15, 19],
  [15, 17],
  [12, 14],
  [14, 16],
  [16, 20],
  [16, 18],
];

/**
 * The standard templates measured with `measureBuild` (mean over the six template skin tones;
 * the tones differ by under 0.03). Re-measure if the template images change: the browser test
 * "each standard template's build suggests its own profile" checks they still agree.
 */
export const BUILD_REFERENCES = [
  { profileId: "slim", body: "male", shoulders: 0.696, waist: 0.585, hips: 0.741 },
  { profileId: "regular", body: "male", shoulders: 0.734, waist: 0.669, hips: 0.859 },
  { profileId: "athletic", body: "male", shoulders: 0.752, waist: 0.637, hips: 0.854 },
  { profileId: "broad", body: "male", shoulders: 0.751, waist: 0.769, hips: 0.921 },
  { profileId: "f-slim", body: "female", shoulders: 0.708, waist: 0.544, hips: 0.804 },
  { profileId: "f-regular", body: "female", shoulders: 0.724, waist: 0.658, hips: 0.876 },
  { profileId: "f-athletic", body: "female", shoulders: 0.737, waist: 0.6, hips: 0.866 },
  { profileId: "f-curvy", body: "female", shoulders: 0.753, waist: 0.864, hips: 1.075 },
];

/** Distance from (px, py) to segment a–b. */
function segmentDistance(px, py, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length)) : 0;
  return Math.hypot(px - a.x - t * dx, py - a.y - t * dy);
}

/**
 * Widths of the body relative to the torso length (shoulder centre to hip centre), or null when
 * the photo cannot be measured (person missing, joints hidden, arms not by the sides).
 * @param {{x:number,y:number,visibility?:number}[]} landmarks normalised to the image
 * @param {Uint8Array|Uint8ClampedArray} person person confidence 0–255 per pixel
 * @returns {{shoulders:number, waist:number, hips:number}|null}
 */
export function measureBuild(landmarks, person, width, height) {
  if (!landmarks || landmarks.length < 33 || !person || person.length !== width * height)
    return null;
  const p = landmarks.map((l) => ({ x: l.x * width, y: l.y * height, v: l.visibility ?? 1 }));
  if ([L_SHOULDER, R_SHOULDER, L_HIP, R_HIP].some((i) => p[i].v < 0.5)) return null;
  const mid = (a, b) => ({ x: (p[a].x + p[b].x) / 2, y: (p[a].y + p[b].y) / 2 });
  const shoulders = mid(L_SHOULDER, R_SHOULDER),
    hips = mid(L_HIP, R_HIP);
  const torso = Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y);
  if (!(torso > 20)) return null;
  // Arms are about 12% of the torso length across; pixels this close to an arm belong to it.
  const armRadius = torso * 0.07;
  const arms = ARM_SEGMENTS.filter(([a, b]) => p[a].v >= 0.5 && p[b].v >= 0.5);
  /** Outline width across the body at a share of the way from shoulders (0) to hips (1). */
  const widthAt = (share) => {
    const y = Math.round(shoulders.y + (hips.y - shoulders.y) * share);
    if (y < 0 || y >= height) return null;
    const centre = Math.round(shoulders.x + (hips.x - shoulders.x) * share);
    const inside = (x) =>
      x >= 0 &&
      x < width &&
      person[y * width + x] >= 128 &&
      arms.every(([a, b]) => segmentDistance(x + 0.5, y + 0.5, p[a], p[b]) > armRadius);
    if (!inside(centre)) return null;
    let left = centre,
      right = centre;
    while (inside(left - 1)) left--;
    while (inside(right + 1)) right++;
    // An outline that runs to the frame edge was not measured.
    if (left === 0 || right === width - 1) return null;
    return right - left + 1;
  };
  // The narrowest point between the lower ribs and the hips, and the widest around the hips.
  const waists = [0.6, 0.65, 0.7, 0.75, 0.8].map(widthAt).filter((w) => w),
    hipWidths = [0.95, 1, 1.05, 1.1].map(widthAt).filter((w) => w);
  if (waists.length < 3 || hipWidths.length < 2) return null;
  const shoulderSpan = Math.abs(p[L_SHOULDER].x - p[R_SHOULDER].x) / torso;
  // Turned side-on (the photo check's "turned" hint): widths say nothing about the build.
  if (shoulderSpan < 0.45) return null;
  return {
    shoulders: shoulderSpan,
    waist: Math.min(...waists) / torso,
    hips: Math.max(...hipWidths) / torso,
  };
}

/**
 * The template whose build is closest to `build`, with the runner-up when the two are nearly as
 * close, or null without a measurement.
 * @param {{shoulders:number, waist:number, hips:number}|null} build
 * @param {"male"|"female"} body
 * @param {{profileId:string, body:string, shoulders:number, waist:number, hips:number}[]} [references]
 * @returns {{profileId:string, closeTo:string|null}|null}
 */
export function suggestBuild(build, body, references = BUILD_REFERENCES) {
  if (!build) return null;
  const candidates = references
    .filter((r) => r.body === body)
    .map((r) => ({
      profileId: r.profileId,
      // Compare proportions on a log scale so a 10% difference counts the same at any size.
      // Hips count half: trousers and skirts change the outline there more than a top does.
      distance: Math.hypot(
        Math.log(build.shoulders / r.shoulders),
        Math.log(build.waist / r.waist),
        0.5 * Math.log(build.hips / r.hips),
      ),
    }))
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length || !Number.isFinite(candidates[0].distance)) return null;
  const [best, next] = candidates;
  return {
    profileId: best.profileId,
    closeTo: next && next.distance - best.distance < 0.03 ? next.profileId : null,
  };
}
