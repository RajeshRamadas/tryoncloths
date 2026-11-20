/**
 * Conservative exposure and sharpness heuristics for a *downsampled* photo.
 * These are visual-capture hints, not calibrated image-quality or identity scores.
 * The input pixels and any numerical colour/texture measurements are never returned.
 */
const DARK_LIMIT = 14;
const BRIGHT_LIMIT = 244;

/**
 * @param {{data?: Uint8Array | Uint8ClampedArray, width?: number,
 * height?: number, originalWidth?: number, originalHeight?: number}} [input]
 * @returns {{status:"clear"|"review"|"blocked"|"unverified",
 * issues:Array<{code:string,message:string}>,
 * warnings:Array<{code:string,message:string}>}}
 */
export function assessPhotoClarity(input = {}) {
  const { data, width, height, originalWidth, originalHeight } = input;
  const issues = [];
  const warnings = [];
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > 256 ||
    height > 256 ||
    !data ||
    data.length !== width * height * 4
  ) {
    return {
      status: "unverified",
      issues,
      warnings: [{
        code: "PHOTO_ANALYSIS_UNAVAILABLE",
        message: "This device could not check exposure or sharpness. Inspect the photo manually.",
      }],
    };
  }
  if (
    Number.isFinite(originalWidth) &&
    Number.isFinite(originalHeight) &&
    (originalWidth < 320 || originalHeight < 320)
  ) {
    warnings.push({
      code: "PHOTO_SMALL",
      message: "The photo has low resolution. A higher-resolution retake may preserve more detail.",
    });
  }

  const luminance = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  let total = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < luminance.length; i++) {
    const offset = 4 * i;
    const luma = Math.round(
      0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2],
    );
    luminance[i] = luma;
    histogram[luma]++;
    total += luma;
    if (luma <= DARK_LIMIT) dark++;
    if (luma >= BRIGHT_LIMIT) bright++;
  }
  const count = luminance.length;
  const mean = total / count;
  const quantile = (fraction) => {
    let seen = 0;
    for (let i = 0; i < 256; i++) {
      seen += histogram[i];
      if (seen >= count * fraction) return i;
    }
    return 255;
  };
  const spread = quantile(0.9) - quantile(0.1);
  // Only near-uniform, nearly black/white inputs are hard blockers. Shadows
  // and bright backgrounds on otherwise readable photos are advisory.
  if (dark / count > 0.985 && spread < 18) {
    issues.push({
      code: "PHOTO_UNREADABLY_DARK",
      message: "This photo is almost completely dark. Retake it in even light before generating.",
    });
  } else if (bright / count > 0.985 && spread < 18) {
    issues.push({
      code: "PHOTO_UNREADABLY_BRIGHT",
      message: "This photo is almost completely white. Retake it without overexposure.",
    });
  } else if (mean < 58 || dark / count > 0.48) {
    warnings.push({
      code: "PHOTO_DARK",
      message: "The photo looks underexposed. Retake in brighter, even light if possible.",
    });
  } else if (mean > 208 || bright / count > 0.48) {
    warnings.push({
      code: "PHOTO_BRIGHT",
      message: "The photo has strong highlights. Avoid backlighting and blown-out areas.",
    });
  }
  if (spread < 28 && !issues.length) {
    warnings.push({
      code: "PHOTO_LOW_CONTRAST",
      message: "The photo has little tonal separation. Use even lighting and a clear background.",
    });
  }

  // High-frequency energy: useful as an *advisory* only. A naturally smooth
  // background or complexion is not evidence that the face is blurred.
  // Restrict to the central area to reduce the influence of busy backgrounds.
  let energy = 0;
  let samples = 0;
  for (let y = Math.floor(height * 0.15) + 1; y < Math.ceil(height * 0.85) - 1; y++) {
    for (let x = Math.floor(width * 0.15) + 1; x < Math.ceil(width * 0.85) - 1; x++) {
      const center = y * width + x;
      const laplace =
        luminance[center - 1] +
        luminance[center + 1] +
        luminance[center - width] +
        luminance[center + width] -
        4 * luminance[center];
      energy += laplace * laplace;
      samples++;
    }
  }
  if (samples && energy / samples < 22 && !issues.length) {
    warnings.push({
      code: "PHOTO_LOW_DETAIL",
      message: "Fine detail may be soft or hidden. Check that the face and body edges are sharp.",
    });
  }
  return {
    status: issues.length ? "blocked" : warnings.length ? "review" : "clear",
    issues,
    warnings,
  };
}
