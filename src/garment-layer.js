// Prepare imported clothing layers for the local outfit compositor: clean the garment's
// alpha mask, trim it, and place it by measuring the mask instead of the bounding box.
// Pure pixel code; runs in the browser and in Node tests. No AI request.

/** Approximate horizontal breadth of each standard body profile. */
export function profileBreadth(profile) {
  return (
    {
      "f-curvy": 1.2,
      "f-athletic": 1.08,
      "f-slim": 0.92,
      broad: 1.17,
      athletic: 1.1,
      slim: 0.9,
    }[profile] ?? 1
  );
}

// Body landmarks in the original 384 × 942 standard pose.
const CENTRE_X = 186;
const TOP_Y = 176;
const WAIST_Y = 474;
const HEM_LIMIT_Y = 880;
const FEET_Y = 919;
// Torso and waist widths measured from the shipped sample layers (see tests): the T-shirt
// body is about 53% of its 310 px box and the trouser waistband about 71% of its 230 px box.
export const TORSO_WIDTH = 0.53 * 310;
export const WAIST_WIDTH = 0.71 * 230;
export const SHOES_WIDTH = 230;

/** Default category box in standard-pose pixels. */
export function garmentBox(category, profile) {
  const broad = profileBreadth(profile);
  return category === "shirt"
    ? { x: CENTRE_X - 155 * broad, y: TOP_Y, width: 310 * broad, height: 316 }
    : category === "trousers"
      ? { x: CENTRE_X - 115 * broad, y: WAIST_Y, width: 230 * broad, height: 400 }
      : { x: CENTRE_X - 115 * broad, y: 827, width: 230 * broad, height: FEET_Y - 827 };
}

/** Standard pose (384 × 942) or the padded 692 × 1038 generated-portrait reference. */
export function poseFrame(personalized) {
  return personalized
    ? { width: 692, height: 1038, x: 154, y: 48 }
    : { width: 384, height: 942, x: 0, y: 0 };
}

const normalise = (box, frame) => ({
  x: (box.x + frame.x) / frame.width,
  y: (box.y + frame.y) / frame.height,
  width: box.width / frame.width,
  height: box.height / frame.height,
});

export function defaultGarmentPlacement(category, profile, personalized) {
  return normalise(garmentBox(category, profile), poseFrame(personalized));
}

/**
 * Remove small disconnected specks (dust, backdrop noise) from the alpha mask.
 * Keeps every region of at least 1% of the visible area, so shoe pairs and
 * separated sleeves survive. Returns a new array.
 */
export function cleanMask(rgba, width, height) {
  const n = width * height,
    out = new Uint8ClampedArray(rgba),
    label = new Int32Array(n).fill(-1),
    queue = new Uint32Array(n),
    sizes = [];
  let visible = 0;
  for (let p = 0; p < n; p++) if (rgba[p * 4 + 3] > 16) visible++;
  for (let start = 0; start < n; start++) {
    if (label[start] >= 0 || rgba[start * 4 + 3] <= 16) continue;
    const id = sizes.length;
    let head = 0,
      tail = 0;
    label[start] = id;
    queue[tail++] = start;
    while (head < tail) {
      const p = queue[head++],
        x = p % width;
      for (const q of [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        p >= width ? p - width : -1,
        p + width < n ? p + width : -1,
      ])
        if (q >= 0 && label[q] < 0 && rgba[q * 4 + 3] > 16) {
          label[q] = id;
          queue[tail++] = q;
        }
    }
    sizes.push(tail);
  }
  const minimum = Math.max(16, visible * 0.01);
  for (let p = 0; p < n; p++)
    if (label[p] >= 0 && sizes[label[p]] < minimum) {
      const i = p * 4;
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    } else if (label[p] < 0 && rgba[p * 4 + 3] > 0) {
      // Faint (alpha ≤16) haze outside any region would show as a grey veil once scaled.
      out[p * 4 + 3] = 0;
    }
  return out;
}

/** Crop to the visible garment. Returns null when nothing is visible. */
export function trimLayer(rgba, width, height) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (rgba[(y * width + x) * 4 + 3] > 16) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < left) return null;
  const w = right - left + 1,
    h = bottom - top + 1,
    out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    out.set(
      rgba.subarray(((top + y) * width + left) * 4, ((top + y) * width + right + 1) * 4),
      y * w * 4,
    );
  return { rgba: out, width: w, height: h };
}

const median = (values) => {
  const sorted = Float64Array.from(values).sort();
  return sorted.length ? sorted[sorted.length >> 1] : NaN;
};

/**
 * Measure the opaque run that contains the layer's centre on each row of a band, so
 * sleeves separated from the body by a gap are left out. Returns medians in pixels.
 */
function centralRun(rgba, width, height, from, to) {
  const widths = [],
    centres = [],
    mid = width >> 1;
  for (let y = Math.floor(from * (height - 1)); y <= Math.ceil(to * (height - 1)); y++) {
    const row = y * width;
    const solid = (x) => rgba[(row + x) * 4 + 3] > 127;
    // Start from the nearest opaque pixel to the centre (a gap may sit at the centre line).
    let seed = -1;
    for (let d = 0; d < width && seed < 0; d++)
      if (mid - d >= 0 && solid(mid - d)) seed = mid - d;
      else if (mid + d < width && solid(mid + d)) seed = mid + d;
    if (seed < 0) continue;
    let l = seed,
      r = seed;
    while (l > 0 && solid(l - 1)) l--;
    while (r < width - 1 && solid(r + 1)) r++;
    widths.push(r - l + 1);
    centres.push((l + r + 1) / 2);
  }
  return { width: median(widths), centre: median(centres) };
}

/**
 * Anchor measurements from a trimmed layer's mask, in layer pixels.
 * Tops: the torso below the sleeves (60–85% of the height).
 * Trousers: the waistband (top 1–6%). Shoes: the whole pair.
 */
export function layerAnchors(rgba, width, height, category) {
  if (category === "shoes") return { width, centre: width / 2 };
  const band = category === "shirt" ? [0.6, 0.85] : [0.01, 0.06];
  const run = centralRun(rgba, width, height, band[0], band[1]);
  // A layer without a usable body measurement falls back to its full width.
  if (!(run.width >= width * 0.15)) return { width, centre: width / 2 };
  return run;
}

/**
 * Placement that lines the measured torso, waistband or shoe pair up with the body.
 * The layer keeps its aspect ratio, except that long trousers are shortened to end above the
 * feet, as the sample trousers do.
 */
export function alignedPlacement(category, profile, personalized, layer, anchors) {
  const broad = profileBreadth(profile),
    frame = poseFrame(personalized);
  const target =
    (category === "shirt" ? TORSO_WIDTH : category === "trousers" ? WAIST_WIDTH : SHOES_WIDTH) *
    broad;
  const scale = target / anchors.width;
  const width = layer.width * scale;
  let height = layer.height * scale;
  const x = CENTRE_X - anchors.centre * scale;
  let y;
  if (category === "shirt") y = TOP_Y;
  else if (category === "trousers") {
    y = WAIST_Y;
    height = Math.min(height, HEM_LIMIT_Y - WAIST_Y);
  } else y = FEET_Y - height;
  const placement = normalise({ x, y, width, height }, frame);
  placement.height = Math.min(0.95, placement.height);
  return placement;
}

/** Clean, trim and measure a garment layer in one step. */
export function prepareGarmentLayer(rgba, width, height, category, profile, personalized) {
  const trimmed = trimLayer(cleanMask(rgba, width, height), width, height);
  if (!trimmed) return null;
  const anchors = layerAnchors(trimmed.rgba, trimmed.width, trimmed.height, category);
  return {
    ...trimmed,
    anchors,
    placement: alignedPlacement(category, profile, personalized, trimmed, anchors),
  };
}
