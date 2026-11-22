import { blobData } from "./jewellery-api";
import { removeBackground, transparentShare, cutoutSize } from "./jewellery-cutout";

export type Source = { rgba: Uint8ClampedArray; width: number; height: number };
const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function decodeCutoutPhoto(file: File, minDimension = 200): Promise<Source> {
  if (!PHOTO_TYPES.includes(file.type) || file.size > 10 * 1024 * 1024 || !file.size)
    throw new Error("Choose a PNG, JPEG or WebP photo under 10 MB.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("The image could not be opened.");
  });
  try {
    if (bitmap.width < minDimension || bitmap.height < minDimension)
      throw new Error(`Use a photo at least ${minDimension} × ${minDimension} px.`);
    const { width, height } = cutoutSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("The image could not be opened.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
  } finally {
    bitmap.close();
  }
}

export async function encodeCutoutPng({ rgba, width, height }: Source): Promise<string> {
  // Stay under the 2 MB catalogue limit by shrinking large, detailed cut-outs.
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  full
    .getContext("2d")!
    .putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const limits = cutoutSize(width, height);
  let scale = Math.min(limits.width / width, limits.height / height);
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(200, w);
    canvas.height = Math.max(200, h);
    canvas.getContext("2d")!.drawImage(full, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) break;
    if (blob.size <= 2 * 1024 * 1024) return blobData(blob);
    scale *= 0.8;
  }
  throw new Error("The cut-out is too large. Crop the photo closer to the piece.");
}

/** Prepare the same uploaded product as a local, bounded PNG overlay. */
export async function automaticJewelleryCutout(photo: File): Promise<string> {
  const source = await decodeCutoutPhoto(photo);
  if (transparentShare(source.rgba) >= 0.01) return encodeCutoutPng(source);
  const { rgba } = removeBackground(source.rgba, source.width, source.height);
  return encodeCutoutPng({ ...source, rgba });
}
