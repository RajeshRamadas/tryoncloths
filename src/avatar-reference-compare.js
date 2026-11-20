// Only consented, session-local image data is eligible for reference display.
// Do not turn a profile URL or a remote link into a hidden network request.
const SESSION_PHOTO = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isSessionReferencePhoto(value) {
  return typeof value === "string" && value.length <= 20_000_000 && SESSION_PHOTO.test(value);
}

/**
 * Intentionally returns only availability booleans: neither input photo nor
 * generated avatar data is persisted or passed into analytics/approval metadata.
 */
export function availableAvatarReferences({ facePhoto, bodyPhoto } = {}) {
  return {
    face: isSessionReferencePhoto(facePhoto),
    body: isSessionReferencePhoto(bodyPhoto),
  };
}
