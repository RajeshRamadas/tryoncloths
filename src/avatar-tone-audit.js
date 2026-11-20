// A conservative, on-device colour comparison between small areas of the
// generated avatar. It never infers ethnicity, skin type or true complexion.
export const TONE_DIFFERENCE_LIMIT = 28;

const SITES = [
  { code: "neck", description: "The sampled neck/collar area differs from the face.", indices: [0, 11, 12] },
  { code: "left-arm", description: "The sampled left forearm differs from the face or may be covered.", indices: [13, 15] },
  { code: "right-arm", description: "The sampled right forearm differs from the face or may be covered.", indices: [14, 16] },
];

const unverified = (message) => ({
  status: "unverified",
  findings: [{ code: "tone-unverified", message }],
  checkedRegions: 0,
});

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function validPoint(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1 &&
    (point.visibility ?? 1) >= 0.55
  );
}

function between(a, b, fraction) {
  if (!validPoint(a) || !validPoint(b)) return null;
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

/**
 * Sample a tiny square around a landmark. Median RGB suppresses isolated
 * highlights, hair strands and background pixels; this is not skin segmentation.
 */
function patch(input, point) {
  if (!validPoint(point)) return null;
  const { pixels, width, height, person, personWidth, personHeight } = input;
  const px = Math.round(point.x * (width - 1));
  const py = Math.round(point.y * (height - 1));
  const radius = Math.max(1, Math.round(Math.min(width, height) * 0.007));
  const rgb = [[], [], []];
  for (let y = Math.max(0, py - radius); y <= Math.min(height - 1, py + radius); y++) {
    for (let x = Math.max(0, px - radius); x <= Math.min(width - 1, px + radius); x++) {
      if (person) {
        const mx = Math.min(personWidth - 1, Math.floor((x / width) * personWidth));
        const my = Math.min(personHeight - 1, Math.floor((y / height) * personHeight));
        if (person[my * personWidth + mx] < 128) continue;
      }
      const index = (y * width + x) * 4;
      if (pixels[index + 3] < 240) continue;
      for (let channel = 0; channel < 3; channel++) rgb[channel].push(pixels[index + channel]);
    }
  }
  if (rgb[0].length < 3) return null;
  return rgb.map(median);
}

function toLab(rgb) {
  const linear = rgb.map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = linear;
  const pivot = (v) => (v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116);
  const x = pivot((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = pivot(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = pivot((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function colourDifference(a, b) {
  const left = toLab(a);
  const right = toLab(b);
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

/**
 * @param {{
 *   pixels?: Uint8Array | Uint8ClampedArray,
 *   width?: number, height?: number,
 *   landmarks?: Array<{x:number,y:number,visibility?:number}>,
 *   person?: Uint8Array, personWidth?:number, personHeight?:number
 * }} [input]
 * @returns {{status:"clear"|"review"|"unverified", findings:Array<{code:string,message:string}>,checkedRegions:number}}
 */
export function assessAvatarTone(input = {}) {
  const { pixels, width, height, landmarks, person, personWidth, personHeight } = input;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 64 ||
    height < 64 ||
    width > 2048 ||
    height > 2048 ||
    !pixels ||
    pixels.length !== width * height * 4 ||
    !Array.isArray(landmarks) ||
    landmarks.length < 33 ||
    (person && (!Number.isInteger(personWidth) || !Number.isInteger(personHeight) ||
      personWidth < 1 || personHeight < 1 || person.length !== personWidth * personHeight))
  ) {
    return unverified("Pixel or pose data could not be inspected. Review skin tone visually.");
  }

  const nose = landmarks[0];
  const leftCheek = between(nose, landmarks[7], 0.33);
  const rightCheek = between(nose, landmarks[8], 0.33);
  const face = [nose, leftCheek, rightCheek]
    .map((point) => patch(input, point))
    .filter((colour) => colour !== null);
  if (face.length < 2) {
    return unverified("The facial colour reference was not reliable. Review the face and neck manually.");
  }
  const reference = [0, 1, 2].map((channel) => median(face.map((colour) => colour[channel])));

  const shoulders = between(landmarks[11], landmarks[12], 0.5);
  const neck = between(nose, shoulders, 0.7);
  const sites = [
    { ...SITES[0], point: neck },
    { ...SITES[1], point: between(landmarks[13], landmarks[15], 0.82) },
    { ...SITES[2], point: between(landmarks[14], landmarks[16], 0.82) },
  ];
  const findings = [];
  let checkedRegions = 0;
  for (const site of sites) {
    const colour = patch(input, site.point);
    if (!colour) continue;
    checkedRegions++;
    if (colourDifference(reference, colour) > TONE_DIFFERENCE_LIMIT) {
      findings.push({
        code: site.code + "-colour-difference",
        message: site.description + " Check for clothing, shadow, lighting or a blending issue.",
      });
    }
  }

  if (checkedRegions === 0) {
    return unverified("No exposed neck or arm regions could be sampled reliably. Check them visually.");
  }
  return { status: findings.length ? "review" : "clear", findings, checkedRegions };
}
