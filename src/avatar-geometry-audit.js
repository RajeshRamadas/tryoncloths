import { BUILD_REFERENCES } from "./body-build.js";

// Broad advisory limits, not calibrated fit tolerances. Pose and silhouette
// vary with clothes, camera, lighting and segmentation quality.
export const BUILD_DRIFT_LIMIT = 0.18;
const parts = [
  ["shoulders", "Shoulder breadth may have drifted from the selected body frame."],
  ["waist", "Waist breadth may have drifted from the selected body frame."],
  ["hips", "Hip breadth may have drifted from the selected body frame."],
];

const poseFeedback = {
  "no-person": "The image could not be confirmed as a complete standing person.",
  "several-people": "The image may show more than one person.",
  landscape: "The image is not portrait-framed for the reusable avatar.",
  "head-cropped": "The head may be cropped or too close to the top edge.",
  "feet-cropped": "The feet or shoes may be cropped or hidden.",
  "too-far": "The avatar may be too small in its frame.",
  "off-centre": "The person may be off-centre.",
  turned: "The person may be turned away from the standard front-facing pose.",
  leaning: "The body may be tilted relative to the selected template.",
  "arms-raised": "An arm may be raised instead of resting at the side.",
  "arms-out": "The arms may be too far from the torso for reusable try-on.",
  "arms-covering": "An arm may obscure the torso and hinder clothing try-on.",
};

/**
 * @param {{ profileId?: string, build?: Record<string, number> | null, poseHints?: Array<{code?: string}> | null }} [input]
 * @returns {{status: "clear" | "review" | "unverified", findings: Array<{code: string, message: string}>}}
 */
export function assessAvatarGeometry({ profileId, build, poseHints } = {}) {
  if (!Array.isArray(poseHints)) {
    return {
      status: "unverified",
      findings: [
        {
          code: "pose-unavailable",
          message: "Local image analysis is unavailable. Review the complete body manually.",
        },
      ],
    };
  }

  const findings = [];
  for (const hint of poseHints) {
    if (Object.hasOwn(poseFeedback, hint?.code)) {
      findings.push({ code: hint.code, message: poseFeedback[hint.code] });
    }
  }

  const reference = BUILD_REFERENCES.find((profile) => profile.profileId === profileId);
  if (!reference) {
    findings.push({
      code: "profile-unavailable",
      message: "The selected body frame could not be evaluated.",
    });
  } else if (!build || parts.some(([key]) => !Number.isFinite(build[key]) || build[key] <= 0)) {
    findings.push({
      code: "silhouette-unavailable",
      message: "The shoulder, waist and hip silhouette could not be checked automatically.",
    });
  } else {
    for (const [key, message] of parts) {
      if (Math.abs(build[key] - reference[key]) / reference[key] > BUILD_DRIFT_LIMIT) {
        findings.push({ code: `${key}-drift`, message });
      }
    }
  }

  return { status: findings.length ? "review" : "clear", findings };
}
