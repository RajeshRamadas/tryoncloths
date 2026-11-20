/**
 * Deterministic preflight for personalized avatar generation.
 * Never infer exact measurements or identity from a single photograph.
 * This module does not store or transmit customer images.
 */
export function assessAvatarReadiness(input = {}) {
  const issues = [];
  const warnings = [];
  const { consent = false, facePhoto = null, bodyPhoto = null, bodyAnalysis = null, heightCm = null, profileId = null, templateTone = null } = input;
  if (consent !== true) issues.push({ code: "CONSENT_REQUIRED", message: "Customer consent is required before personalization." });
  if (typeof facePhoto !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(facePhoto))
    issues.push({ code: "FACE_PHOTO_REQUIRED", message: "Provide a valid JPEG, PNG or WebP face photo." });
  if (typeof bodyPhoto !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(bodyPhoto))
    issues.push({ code: "BODY_PHOTO_REQUIRED", message: "Provide a valid JPEG, PNG or WebP full-body photo." });
  if (typeof profileId !== "string" || !profileId.trim()) issues.push({ code: "PROFILE_REQUIRED", message: "Select a body template." });
  if (typeof templateTone !== "string" || !templateTone.trim()) issues.push({ code: "TONE_REQUIRED", message: "Select a starting skin-tone template." });
  if (heightCm != null && (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 230))
    issues.push({ code: "HEIGHT_INVALID", message: "Height must be between 100 and 230 cm when provided." });
  if (heightCm == null) warnings.push({ code: "HEIGHT_UNVERIFIED", message: "Exact body dimensions cannot be estimated without a confirmed height." });
  if (!bodyAnalysis || bodyAnalysis.status !== "valid")
    warnings.push({ code: "BODY_POSE_UNVERIFIED", message: "Full-body pose and visibility have not been verified; request a clear standing photo." });
  if (!input.additionalView) warnings.push({ code: "DEPTH_UNVERIFIED", message: "A front photo cannot establish side or back body geometry." });
  return {
    ready: issues.length === 0,
    issues,
    warnings,
    // Do not return photos, embeddings, or other personal data.
    quality: issues.length ? "blocked" : warnings.length ? "review" : "ready",
  };
}
