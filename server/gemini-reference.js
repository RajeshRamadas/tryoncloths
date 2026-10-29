import sharp from "sharp";
import { createHash } from "node:crypto";
import { customerFace, detectFaces, requireVisibleFace } from "./face-check.js";
import { ProviderError } from "./provider-errors.js";

const headCentres = { slim: 185, regular: 192, athletic: 190, broad: 186, "f-slim": 196, "f-regular": 191, "f-athletic": 190, "f-curvy": 191 };
const templateEyes = new Map();
const smoothstep = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

// Coordinates are local to the fixed head patch. The curved lower boundary
// follows the neck into the collar without a single horizontal cut line.
export function neckBlend(x, y) {
  const side = Math.min(1, Math.abs(x - 74) / 46);
  const finish = 182 - 20 * side * side;
  return 1 - smoothstep((y - (finish - 50)) / 50);
}

async function targetFace(avatar, profileId) {
  const key = `${profileId}:${createHash("sha256").update(avatar).digest("hex")}`;
  if (!templateEyes.has(key)) {
    if (templateEyes.size >= 48) templateEyes.clear();
    templateEyes.set(key, detectFaces(avatar, { landmarks: true, upper: true }).then(faces => {
      if (faces.length !== 1) throw new ProviderError("face_check");
      return faces[0];
    }).catch(error => { templateEyes.delete(key); throw error; }));
  }
  return templateEyes.get(key);
}

const midpoint = eyes => ({ x: (eyes.left.x + eyes.right.x) / 2, y: (eyes.left.y + eyes.right.y) / 2 });
const distance = eyes => Math.hypot(eyes.right.x - eyes.left.x, eyes.right.y - eyes.left.y);
const angle = eyes => Math.atan2(eyes.right.y - eyes.left.y, eyes.right.x - eyes.left.x);

export function facePlacement(source, target, image, rotated) {
  const scale = distance(target.eyes) / distance(source.eyes);
  const radians = angle(target.eyes) - angle(source.eyes);
  const point = midpoint(source.eyes);
  const destination = midpoint(target.eyes);
  const width = Math.max(1, Math.round(rotated.width * scale));
  const height = Math.max(1, Math.round(rotated.height * scale));
  const x = Math.cos(radians) * (point.x - image.width / 2) - Math.sin(radians) * (point.y - image.height / 2) + rotated.width / 2;
  const y = Math.sin(radians) * (point.x - image.width / 2) + Math.cos(radians) * (point.y - image.height / 2) + rotated.height / 2;
  return { width, height, left: Math.round(destination.x - x * width / rotated.width), top: Math.round(destination.y - y * height / rotated.height) };
}

export async function geminiBodyReference(avatar, profileId, face) {
  const { width, height } = await sharp(avatar).metadata();
  if (width !== 384 || height !== 942 || !Object.hasOwn(headCentres, profileId))
    throw new Error("Review the anatomy reference before changing the standard body library.");
  if (!face) throw new ProviderError("face_input");
  const source = await customerFace(face);
  const target = await targetFace(avatar, profileId);
  const rotation = (angle(target.eyes) - angle(source.eyes)) * 180 / Math.PI;
  const image = await sharp(face).metadata();
  const rotated = await sharp(face).ensureAlpha().rotate(rotation, { background: "#00000000" }).png().toBuffer();
  const placement = facePlacement(source, target, image, await sharp(rotated).metadata());
  if (placement.width > 2048 || placement.height > 2048) throw new ProviderError("face_input");
  const scaled = await sharp(rotated).resize(placement.width, placement.height, { fit: "fill" }).png().toBuffer();
  const sx = Math.max(0, -placement.left), sy = Math.max(0, -placement.top);
  const left = Math.max(0, placement.left), top = Math.max(0, placement.top);
  const sw = Math.min(placement.width - sx, width - left), sh = Math.min(placement.height - sy, height - top);
  if (sw <= 0 || sh <= 0) throw new ProviderError("face_input");
  const photo = await sharp(scaled).extract({ left: sx, top: sy, width: sw, height: sh }).png().toBuffer();
  const aligned = await sharp({ create: { width, height, channels: 4, background: "#00000000" } })
    .composite([{ input: photo, left, top }]).png().toBuffer();

  // Tone sheets preserve the pose but may vary by a few pixels. Use each
  // template's measured eye centre rather than a different sheet's constant.
  const centre = Math.round(midpoint(target.eyes).x);
  const patch = { left: centre - 74, top: 20, width: 148, height: 183 };
  const background = await sharp(avatar).extract({ left: 16, top: 20, width: 24, height: 183 })
    .resize(148, 183, { fit: "fill" }).png().toBuffer();
  // Fade the underlying template neck in too: a hard start at row 175
  // remained visible through the customer's translucent lower edge in v5.
  const neckTop = 150;
  const neckHeight = patch.top + patch.height - neckTop;
  const neckPixels = await sharp(avatar)
    .extract({ left: patch.left, top: neckTop, width: patch.width, height: neckHeight })
    .ensureAlpha().raw().toBuffer();
  for (let y = 0; y < neckHeight; y++) for (let x = 0; x < patch.width; x++) {
    neckPixels[(y * patch.width + x) * 4 + 3] *= smoothstep(y / 30);
  }
  const neck = await sharp(neckPixels, { raw: { width: patch.width, height: neckHeight, channels: 4 } }).png().toBuffer();
  const base = await sharp(background).composite([{ input: neck, left: 0, top: neckTop - patch.top }]).png().toBuffer();
  const { data } = await sharp(aligned).extract(patch).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Keep a real customer face in the reference. Soft edges are only guidance for
  // Gemini to blend hair/background and neck; this composite is never returned.
  for (let y = 0; y < patch.height; y++) for (let x = 0; x < patch.width; x++) {
    const radius = Math.hypot((x - 74) / 70, (y - 80) / 88);
    const head = smoothstep((1 - radius) / 0.18);
    const neckWidth = smoothstep((40 - Math.abs(x - 74)) / 14);
    const neckMask = smoothstep((y - 108) / 24) * neckWidth;
    const opacity = Math.max(head, neckMask) * neckBlend(x, y);
    data[(y * patch.width + x) * 4 + 3] *= opacity;
  }
  const customer = await sharp(data, { raw: { width: patch.width, height: patch.height, channels: 4 } }).png().toBuffer();
  const composite = await sharp(base).composite([{ input: customer }]).png().toBuffer();
  const merged = await sharp(avatar).composite([{ input: composite, left: patch.left, top: patch.top }]).png().toBuffer();
  const reference = await sharp(merged).extract({ left: 4, top: 0, width: 376, height: 942 })
    .extend({ top: 48, bottom: 48, left: 158, right: 158, background: "#c6c6c6" })
    .removeAlpha().png().toBuffer();
  // Abort before a paid call if alignment/cropping lost the customer's face.
  try {
    await requireVisibleFace(reference);
  } catch (error) {
    if (error.code === "missing_face") throw new ProviderError("face_input");
    throw error;
  }
  return reference;
}
