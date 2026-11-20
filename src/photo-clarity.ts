import { loadImage } from "./images";
import { assessPhotoClarity } from "./photo-clarity.js";

export type PhotoClarityAssessment = {
  status: "clear" | "review" | "blocked" | "unverified";
  issues: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
};

/**
 * Analyse only the active, consented image in a small browser canvas.
 * No photo is transmitted or persisted; the temporary pixel buffer is cleared.
 */
export async function checkPhotoClarity(photo: string): Promise<PhotoClarityAssessment> {
  let canvas: HTMLCanvasElement | null = null;
  try {
    const image = await loadImage(photo);
    const scale = Math.min(1, 192 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return assessPhotoClarity();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    try {
      return assessPhotoClarity({
        data: pixels.data,
        width: canvas.width,
        height: canvas.height,
        originalWidth: image.naturalWidth,
        originalHeight: image.naturalHeight,
      });
    } finally {
      pixels.data.fill(0);
    }
  } catch {
    return assessPhotoClarity();
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
