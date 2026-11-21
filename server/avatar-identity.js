import sharp from "sharp";
import { detectFaces } from "./face-check.js";
import { createIdentityChecker } from "./identity-check.js";
import { ProviderError } from "./provider-errors.js";

const compareAvatarFaces = createIdentityChecker({ roundDistance: false });

export function parseAvatarIdentityMode(mode) {
  if (!["off", "review", "enforce"].includes(mode))
    throw new Error("TRYON_AVATAR_IDENTITY_MODE must be off, review or enforce.");
  return mode;
}

export function parseAvatarIdentityMax(value) {
  const max = Number(value);
  if (!Number.isFinite(max) || max <= 0 || max > 1)
    throw new Error("TRYON_AVATAR_IDENTITY_MAX must be a number greater than zero and at most 1.");
  return max;
}

/**
 * Return a face-centered crop, enlarged enough to retain hair and jaw.
 * The matcher works on the face rather than the tiny head in a full-body PNG.
 */
export function avatarFaceCrop(box, { width, height }) {
  if (
    !box ||
    ![box.x, box.y, box.width, box.height, width, height].every(Number.isFinite) ||
    box.width < 30 ||
    box.height < 30 ||
    width < 128 ||
    height < 128 ||
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > width + 1 ||
    box.y + box.height > height + 1
  ) {
    throw new ProviderError("missing_face");
  }
  const left = Math.max(0, Math.floor(box.x - box.width * 0.65));
  const top = Math.max(0, Math.floor(box.y - box.height * 0.55));
  const right = Math.min(width, Math.ceil(box.x + box.width * 1.65));
  const bottom = Math.min(height, Math.ceil(box.y + box.height * 1.65));
  if (right - left < 48 || bottom - top < 48) throw new ProviderError("missing_face");
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Optional, server-only biometric screening of a generated avatar.
 *
 * The generated image is never returned from this function, and neither images
 * nor face descriptors are persisted or logged. This is not identity proof;
 * staff/customer quality review remains mandatory.
 *
 * Dependency injection permits safe tests without loading recognition models.
 */
export async function screenAvatarIdentity({
  face,
  image,
  locate = detectFaces,
  compare = compareAvatarFaces,
  maxDistance = Number(process.env.TRYON_AVATAR_IDENTITY_MAX || 0.45),
} = {}) {
  if (!Number.isFinite(maxDistance) || maxDistance <= 0 || maxDistance > 1)
    throw new ProviderError("face_check");
  if (!Buffer.isBuffer(face) || face.length === 0 || face.length > 5 * 1024 * 1024)
    throw new ProviderError("face_input");
  const matched =
    typeof image === "string" &&
    image.length < 28_000_000 &&
    /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!matched) throw new ProviderError("invalid_image");
  const output = Buffer.from(matched[1], "base64");
  let reference;
  let candidate;
  try {
    if (!output.length || output.length > 20 * 1024 * 1024)
      throw new ProviderError("invalid_image");
    const metadata = await sharp(output, { limitInputPixels: 25_000_000, animated: false })
      .metadata()
      .catch(() => {
        throw new ProviderError("invalid_image");
      });
    if (metadata.format !== "png" || metadata.pages > 1 || !metadata.width || !metadata.height) {
      throw new ProviderError("invalid_image");
    }
    const faces = await locate(output, { upper: true });
    if (!Array.isArray(faces) || faces.length !== 1) throw new ProviderError("missing_face");
    const region = avatarFaceCrop(faces[0].box, metadata);
    // prepare only the identity areas; the original full-body output is unchanged.
    reference = await sharp(face, { limitInputPixels: 25_000_000, animated: false })
      .rotate()
      .png()
      .toBuffer();
    candidate = await sharp(output, { limitInputPixels: 25_000_000, animated: false })
      .extract(region)
      .resize({ width: 512, height: 512, fit: "inside" })
      .png()
      .toBuffer();
    const distance = await compare(reference, candidate, maxDistance);
    if (!Number.isFinite(distance) || distance < 0 || distance > maxDistance)
      throw new ProviderError("face_check");
    return true;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("face_check");
  } finally {
    reference?.fill(0);
    candidate?.fill(0);
    output.fill(0);
  }
}
