// Local, deterministic background removal for jewellery product photos.
// Runs in the browser (catalogue cut-out upload) and in Node tests; no AI request.
// It suits pieces photographed on a plain backdrop; busy backgrounds are rejected.

export const CUTOUT_DEFAULT_TOLERANCE = 32;
export const CUTOUT_MIN_TOLERANCE = 8;
export const CUTOUT_MAX_TOLERANCE = 96;

export class CutoutError extends Error {}

const dist2 = (data, i, bg) => {
  const r = data[i] - bg[0],
    g = data[i + 1] - bg[1],
    b = data[i + 2] - bg[2];
  return r * r + g * g + b * b;
};

const median = (values) => {
  const sorted = Float64Array.from(values).sort();
  return sorted[sorted.length >> 1];
};

/** Share of pixels whose alpha is clearly transparent (<16). */
export function transparentShare(rgba) {
  let clear = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 16) clear++;
  return clear / (rgba.length / 4);
}

/** Estimate the backdrop colour from the image border and check that it is plain. */
export function estimateBackground(rgba, width, height, tolerance = CUTOUT_DEFAULT_TOLERANCE) {
  const r = [],
    g = [],
    b = [],
    border = [];
  const add = (x, y) => {
    const i = (y * width + x) * 4;
    border.push(i);
    r.push(rgba[i]);
    g.push(rgba[i + 1]);
    b.push(rgba[i + 2]);
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }
  const bg = [median(r), median(g), median(b)],
    limit = tolerance * tolerance;
  let matching = 0;
  for (const i of border) if (dist2(rgba, i, bg) <= limit) matching++;
  return { colour: bg, plainShare: matching / border.length };
}

/**
 * Make the plain backdrop of an RGBA image transparent.
 * @param {Uint8Array|Uint8ClampedArray} rgba source pixels (not modified)
 * @returns {{ rgba: Uint8ClampedArray, background: number[], foregroundShare: number }}
 */
export function removeBackground(
  rgba,
  width,
  height,
  { tolerance = CUTOUT_DEFAULT_TOLERANCE, clearEnclosed = true } = {},
) {
  if (!(width > 0 && height > 0) || rgba.length !== width * height * 4)
    throw new CutoutError("The image could not be read.");
  const tol = Math.min(CUTOUT_MAX_TOLERANCE, Math.max(CUTOUT_MIN_TOLERANCE, Number(tolerance)));
  const { colour: bg, plainShare } = estimateBackground(rgba, width, height, tol);
  if (plainShare < 0.6)
    throw new CutoutError(
      "The background is too busy to remove automatically. Photograph the piece on a plain backdrop, or upload a transparent PNG.",
    );
  const n = width * height,
    limit = tol * tol,
    // 0 = foreground, 1 = background
    mask = new Uint8Array(n),
    queue = new Uint32Array(n);
  let head = 0,
    tail = 0;
  // Smooth backdrop gradients and soft shadows: a pixel joins the backdrop when it is close
  // to the backdrop colour, or close to the backdrop pixel it was reached from while still
  // within a wider colour bound.
  const step = (tol / 4) ** 2,
    wide = (tol * 2.5) ** 2;
  const seed = (p, from = -1) => {
    if (mask[p]) return;
    const d = dist2(rgba, p * 4, bg);
    if (
      d <= limit ||
      (from >= 0 &&
        d <= wide &&
        dist2(rgba, p * 4, [rgba[from * 4], rgba[from * 4 + 1], rgba[from * 4 + 2]]) <= step)
    ) {
      mask[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const p = queue[head++],
      x = p % width,
      y = (p - x) / width;
    if (x > 0) seed(p - 1, p);
    if (x < width - 1) seed(p + 1, p);
    if (y > 0) seed(p - width, p);
    if (y < height - 1) seed(p + width, p);
  }
  if (clearEnclosed) {
    // Enclosed backdrop (ring holes, chain loops): a tighter colour match and a minimum area
    // keep small light details such as pearls or highlights opaque.
    const tight = (tol * 0.6) ** 2,
      minArea = Math.max(24, Math.round(n * 0.0004)),
      seen = new Uint8Array(n);
    for (let start = 0; start < n; start++) {
      if (mask[start] || seen[start] || dist2(rgba, start * 4, bg) > tight) continue;
      head = 0;
      tail = 0;
      seen[start] = 1;
      queue[tail++] = start;
      while (head < tail) {
        const p = queue[head++],
          x = p % width,
          y = (p - x) / width;
        const visit = (q) => {
          if (!mask[q] && !seen[q] && dist2(rgba, q * 4, bg) <= tight) {
            seen[q] = 1;
            queue[tail++] = q;
          }
        };
        if (x > 0) visit(p - 1);
        if (x < width - 1) visit(p + 1);
        if (y > 0) visit(p - width);
        if (y < height - 1) visit(p + width);
      }
      if (tail >= minArea) for (let k = 0; k < tail; k++) mask[queue[k]] = 1;
    }
  }
  const out = new Uint8ClampedArray(rgba.length),
    soft = tol * 1.75;
  let foreground = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (mask[p]) continue; // fully transparent (zeroed)
    const x = p % width,
      y = (p - x) / width;
    const edge =
      (x > 0 && mask[p - 1]) ||
      (x < width - 1 && mask[p + 1]) ||
      (y > 0 && mask[p - width]) ||
      (y < height - 1 && mask[p + width]);
    let alpha = rgba[i + 3] / 255;
    if (edge) {
      // Feather anti-aliased edge pixels and remove the backdrop colour they blended with.
      const d = Math.sqrt(dist2(rgba, i, bg));
      const a = Math.min(1, Math.max(0, (d - tol) / (soft - tol)));
      const coverage = a > 0 ? a : 0.25;
      alpha *= coverage;
      for (let c = 0; c < 3; c++)
        out[i + c] = Math.round((rgba[i + c] - bg[c] * (1 - coverage)) / coverage);
    } else {
      out[i] = rgba[i];
      out[i + 1] = rgba[i + 1];
      out[i + 2] = rgba[i + 2];
    }
    out[i + 3] = Math.round(alpha * 255);
    if (out[i + 3] > 16) foreground++;
  }
  const foregroundShare = foreground / n;
  if (foregroundShare < 0.001)
    throw new CutoutError(
      "No jewellery was found after removing the background. Try a lower tolerance.",
    );
  if (foregroundShare > 0.95)
    throw new CutoutError(
      "The background could not be separated from the piece. Use a plainer backdrop or a higher tolerance.",
    );
  return { rgba: out, background: bg, foregroundShare };
}

/** Largest size within the overlay limits (≤2048 px per side, ≤4 MP), never upscaled. */
export function cutoutSize(width, height) {
  const scale = Math.min(1, 2048 / width, 2048 / height, Math.sqrt(4_000_000 / (width * height)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
