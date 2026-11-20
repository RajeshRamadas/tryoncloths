import sharp from "sharp";
import { detectFaces } from "./face-check.js";
import { requireSameIdentity } from "./identity-check.js";
import { ProviderError } from "./provider-errors.js";

export const AVATAR_IDENTITY_MODES = Object.freeze(["off", "review", "enforce"]);

/**
 * Invalid settings must never silently disable an explicitly requested check.
 */
export function parseAvatarIdentityMode(mode) {
  if (!AVATAR_IDENTITY_MODES.includes(mode)) {
    throw new Error("TRYON_AVATAR_IDENTITY_MODE must be off, review or enforce.");
  }
  return mode;
}

function outputBytes(image) {
  const match =
    typeof image === "string"
      ? /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
      : null;
  if (!match || match[1].length > 28_000_000) throw new ProviderError("invalid_image");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
    throw new ProviderError("invalid_image");
  }
  return bytes;
}

/**
 * Crop a detected face to a square portrait before recognition. The generated
 * full-body image often contains too few face pixels for direct comparison.
 * The caller clears the returned temporary image buffer after checking.
 */
export async function avatarFaceCrop(bytes, { detect = detectFaces, upper = false } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 20 * 1024 * 1024) {
    throw new ProviderError("face_check");
  }
  try {
    const { width, height } = await sharp(bytes, {
      animated: false,
      limitInputPixels: 25_000_000,
    }).metadata();
    if (!width || !height || width < 64 || height < 64) {
      throw new ProviderError("face_check");
    }
    const faces = await detect(bytes, { upper });
    if (!Array.isArray(faces) || faces.length !== 1) {
      throw new ProviderError("missing_face");
    }
    const box = faces[0]?.box;
    if (
      !box ||
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.width < 24 ||
      box.height < 24 ||
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > width + 1 ||
      box.y + box.height > height + 1
    ) {
      throw new ProviderError("face_check");
    }
    const size = Math.min(
      width,
      height,
      Math.max(64, Math.ceil(Math.max(box.width, box.height) * 2.1)),
    );
    const left = Math.max(0, Math.min(width - size, Math.round(box.x + box.width / 2 - size / 2)));
    const top = Math.max(0, Math.min(height - size, Math.round(box.y + box.height / 2 - size / 2)));
    return await sharp(bytes, { animated: false, limitInputPixels: 25_000_000 })
      .extract({ left, top, width: size, height: size })
      .resize(512, 512)
      .png()
      .toBuffer();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("face_check");
  }
}

/**
 * An advisory screen, not a verified claim of identity. Review mode never
 * exposes face vectors, scores, or the source images. Enforce mode rejects
 * uncertain results; it must only be enabled after representative calibration.
 */
export async function screenAvatarIdentity({
  reference,
  output,
  mode = "off",
  detect = detectFaces,
  compare = requireSameIdentity,
} = {}) {
  parseAvatarIdentityMode(mode);
  if (mode === "off") return { status: "not_checked" };

  let sourceCrop;
  let resultCrop;
  let resultBytes;
  try {
    sourceCrop = await avatarFaceCrop(reference, { detect });
    resultBytes = outputBytes(output);
    resultCrop = await avatarFaceCrop(resultBytes, { detect, upper: true });
    await compare(sourceCrop, resultCrop);
    return { status: "screen_pass" };
  } catch (error) {
    const code =
      error instanceof ProviderError &&
      ["missing_face", "identity_mismatch", "face_check", "invalid_image"].includes(error.code)
        ? error.code
        : "face_check";
    if (mode === "enforce") throw new ProviderError(code);
    return {
      status: "needs_review",
      reason: code === "identity_mismatch" ? "possible_mismatch" : "check_unavailable",
    };
  } finally {
    if (sourceCrop) sourceCrop.fill(0);
    if (resultCrop) resultCrop.fill(0);
    if (resultBytes) resultBytes.fill(0);
  }
}
