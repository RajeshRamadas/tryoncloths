/**
 * Deterministic preflight for personalized avatar generation.
 * Never infer exact measurements or identity from a single photograph.
 * This module does not store or transmit customer images.
 *
 * @typedef {object} AvatarReadinessInput
 * @property {boolean} [consent]
 * @property {string | null} [facePhoto]
 * @property {string | null} [bodyPhoto]
 * @property {{ status: string } | null} [bodyAnalysis]
 * @property {{ status: string, issues?: Array<{code:string,message:string}>, warnings?: Array<{code:string,message:string}> } | null} [faceClarity]
 * @property {{ status: string, issues?: Array<{code:string,message:string}>, warnings?: Array<{code:string,message:string}> } | null} [bodyClarity]
 * @property {number | null} [heightCm]
 * @property {string | null} [profileId]
 * @property {string | null} [templateTone]
 * @property {boolean} [additionalView]
 */

const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function validPhoto(photo) {
  return typeof photo === "string" && IMAGE_DATA_URL.test(photo);
}

/**
 * @param {AvatarReadinessInput} [input]
 */
export function assessAvatarReadiness(input = {}) {
  const issues = [];
  const warnings = [];
  const {
    consent = false,
    facePhoto = null,
    bodyPhoto = null,
    bodyAnalysis = null,
    faceClarity = null,
    bodyClarity = null,
    heightCm = null,
    profileId = null,
    templateTone = null,
  } = input;

  if (consent !== true) {
    issues.push({
      code: "CONSENT_REQUIRED",
      message: "Customer consent is required before personalization.",
    });
  }
  if (!validPhoto(facePhoto)) {
    issues.push({
      code: "FACE_PHOTO_REQUIRED",
      message: "Provide a valid JPEG, PNG or WebP face photo.",
    });
  }
  if (!validPhoto(bodyPhoto)) {
    issues.push({
      code: "BODY_PHOTO_REQUIRED",
      message: "Provide a valid JPEG, PNG or WebP full-body photo.",
    });
  }
  if (typeof profileId !== "string" || !profileId.trim()) {
    issues.push({
      code: "PROFILE_REQUIRED",
      message: "Select a body template.",
    });
  }
  if (typeof templateTone !== "string" || !templateTone.trim()) {
    issues.push({
      code: "TONE_REQUIRED",
      message: "Select a starting skin-tone template.",
    });
  }
  const invalidHeight =
    heightCm != null && (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 230);

  if (invalidHeight) {
    issues.push({
      code: "HEIGHT_INVALID",
      message: "Height must be between 100 and 230 cm when provided.",
    });
  }
  // Only obvious near-blank images block paid generation. Blur, low resolution,
  // shadows and uncertain analysis remain staff-reviewed warnings.
  for (const [kind, check] of [
    ["FACE", faceClarity],
    ["BODY", bodyClarity],
  ]) {
    if (!check) continue;
    if (check.status === "blocked") {
      for (const issue of check.issues || []) {
        issues.push({ code: `${kind}_${issue.code}`, message: issue.message });
      }
    } else {
      for (const warning of check.warnings || []) {
        warnings.push({ code: `${kind}_${warning.code}`, message: warning.message });
      }
    }
  }
  if (heightCm == null) {
    warnings.push({
      code: "HEIGHT_UNVERIFIED",
      message: "Exact body dimensions cannot be estimated without a confirmed height.",
    });
  }
  if (!bodyAnalysis || bodyAnalysis.status !== "valid") {
    warnings.push({
      code: "BODY_POSE_UNVERIFIED",
      message:
        "Full-body pose and visibility have not been verified; request a clear standing photo.",
    });
  }
  if (!input.additionalView) {
    warnings.push({
      code: "DEPTH_UNVERIFIED",
      message: "A front photo cannot establish side or back body geometry.",
    });
  }

  return {
    ready: issues.length === 0,
    issues,
    warnings,
    // Do not return photos, embeddings, or other personal data.
    quality: issues.length ? "blocked" : warnings.length ? "review" : "ready",
  };
}
