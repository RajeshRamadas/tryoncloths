// Advisory checks on a customer's full-body photo from on-device pose landmarks
// (MediaPipe BlazePose, 33 points, coordinates normalised to the image). Staff decide;
// nothing here blocks generation. No customer photo leaves the device for this check.

const NOSE = 0,
  L_EYE = 2,
  R_EYE = 5,
  L_EAR = 7,
  R_EAR = 8,
  L_SHOULDER = 11,
  R_SHOULDER = 12,
  L_WRIST = 15,
  R_WRIST = 16,
  L_HIP = 23,
  R_HIP = 24,
  L_ANKLE = 27,
  R_ANKLE = 28,
  L_HEEL = 29,
  R_HEEL = 30,
  L_FOOT = 31,
  R_FOOT = 32;

export const POSE_HINTS = {
  "no-person": "No person was found. Use a well-lit photo of the customer standing, head to toe.",
  "several-people": "More than one person is in the photo. Photograph the customer alone.",
  landscape: "This is a landscape photo. A portrait photo keeps the customer larger in the frame.",
  "head-cropped": "The top of the head may be cut off. Leave a little space above the head.",
  "feet-cropped": "The feet may be cut off or hidden. Include the whole body down to the shoes.",
  "too-far":
    "The customer is small in the frame. Step closer so the body fills most of the height.",
  "off-centre": "The customer is off-centre. Centre them in the frame.",
  turned: "The customer seems turned to the side. Ask them to face the camera.",
  leaning:
    "The body or camera is tilted. Hold the camera upright and ask the customer to stand straight.",
  "arms-raised": "An arm is raised. Ask the customer to relax their arms at their sides.",
  "arms-out":
    "The arms are held away from the body. Ask the customer to relax them at their sides.",
  "arms-covering":
    "The arms are in front of the body. Ask the customer to keep them at their sides.",
};

const hint = (code) => ({ code, message: POSE_HINTS[code] });

/**
 * @param {Array<Array<{x:number,y:number,visibility?:number}>>} poses landmarks per person
 * @param {number} width image width in pixels
 * @param {number} height image height in pixels
 * @returns {{code:string,message:string}[]} hints, most important first; empty when the photo looks right
 */
export function assessBodyPose(poses, width, height) {
  if (!poses?.length || poses[0].length < 33) return [hint("no-person")];
  const hints = [];
  if (poses.length > 1) hints.push(hint("several-people"));
  if (width > height * 1.1) hints.push(hint("landscape"));
  // Work in pixels so the aspect ratio does not distort angles and widths.
  const p = poses[0].map((l) => ({ x: l.x * width, y: l.y * height, v: l.visibility ?? 1 }));
  const mid = (a, b) => ({ x: (p[a].x + p[b].x) / 2, y: (p[a].y + p[b].y) / 2 });
  const shoulders = mid(L_SHOULDER, R_SHOULDER),
    hips = mid(L_HIP, R_HIP),
    ankles = mid(L_ANKLE, R_ANKLE);
  const torso = Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y);
  if (!(torso > height * 0.03)) return [hint("no-person")];
  // The crown sits about 0.9 ear-spans above the eyes (half the nose-to-shoulder drop
  // when the head is turned and the ears overlap).
  const eyes = mid(L_EYE, R_EYE),
    earSpan = Math.abs(p[L_EAR].x - p[R_EAR].x);
  const crown = eyes.y - Math.max(earSpan * 0.9, (shoulders.y - p[NOSE].y) * 0.45);
  const feet = [L_HEEL, R_HEEL, L_FOOT, R_FOOT];
  const sole = Math.max(...feet.map((i) => p[i].y));
  if (crown < height * 0.005) hints.push(hint("head-cropped"));
  if (sole > height * 0.995 || feet.some((i) => p[i].v < 0.3)) hints.push(hint("feet-cropped"));
  else if (sole - Math.max(0, crown) < height * 0.55) hints.push(hint("too-far"));
  if (hips.x < width * 0.3 || hips.x > width * 0.7) hints.push(hint("off-centre"));
  const shoulderWidth = Math.abs(p[L_SHOULDER].x - p[R_SHOULDER].x);
  if (shoulderWidth < torso * 0.45) hints.push(hint("turned"));
  const lean =
    Math.abs(Math.atan2(ankles.x - shoulders.x, ankles.y - shoulders.y)) * (180 / Math.PI);
  if (lean > 10) hints.push(hint("leaning"));
  const wrists = [
    [L_WRIST, L_SHOULDER, L_HIP],
    [R_WRIST, R_SHOULDER, R_HIP],
  ].filter(([w]) => p[w].v >= 0.3);
  const left = Math.min(p[L_SHOULDER].x, p[R_SHOULDER].x),
    right = Math.max(p[L_SHOULDER].x, p[R_SHOULDER].x);
  if (wrists.some(([w, s]) => p[w].y < p[s].y)) hints.push(hint("arms-raised"));
  else if (wrists.some(([w, , h]) => Math.abs(p[w].x - p[h].x) > torso * 0.55))
    hints.push(hint("arms-out"));
  else if (
    !hints.some((h) => h.code === "turned") &&
    wrists.some(
      ([w]) =>
        p[w].y < hips.y &&
        p[w].x > left + shoulderWidth * 0.15 &&
        p[w].x < right - shoulderWidth * 0.15,
    )
  )
    hints.push(hint("arms-covering"));
  return hints;
}
