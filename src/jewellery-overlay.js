// Shared geometry only. Coordinates are full view pixels; no provider or DOM.
export const overlayAnchors = {
  stud_earrings: "earlobe",
  drop_earrings: "earlobe",
  jhumka: "earlobe",
  nose_pin: "nostril",
  nose_ring: "nostril",
  nath_chain: "nostril",
  maang_tikka: "hairParting",
  matha_patti: "hairParting",
  hair_accessory: "hairSide",
  choker: "neckBase",
  necklace: "neckBase",
  pendant: "neckBase",
  long_haar: "neckBase",
  mangalsutra: "neckBase",
  ring: "finger",
  bangles: "wrist",
  bracelet: "wrist",
  watch: "wrist",
  waist_belt: "waist",
  anklets: "ankle",
};
const areaNames = {
  earlobe: "ear",
  nostril: "nostril",
  hairParting: "hairline",
  hairSide: "temple",
  neckBase: "neck",
  finger: "hand",
  wrist: "wrist",
  waist: "waist",
  ankle: "ankle",
};

/** One close-up per body side, even when a wrist has several bangles. */
export function overlayRegions(placements, anchor) {
  const area = areaNames[anchor] || "piece";
  const regions = new Map();
  placements.forEach(({ id }, index) => {
    const side = id.split(":")[0];
    if (!regions.has(side))
      regions.set(side, {
        label: side === "centre" ? area : side + " " + area,
        index,
      });
  });
  return [...regions.values()];
}
// Above the temple on one side: between the hair parting and that side's earlobe.
function hairSide(portrait, imageSide) {
  const parting = portrait.hairParting,
    ear = portrait[imageSide + "Earlobe"];
  if (!parting || !ear) return undefined;
  return {
    x: ear.x + (parting.x - ear.x) * 0.2,
    y: parting.y + (ear.y - parting.y) * 0.3,
  };
}
export const previewLabel = (mode) =>
  mode === "overlay"
    ? "Overlay preview"
    : mode === "mixed"
      ? "AI + Overlay preview — actual piece may differ in detail"
      : "AI preview — actual piece may differ in detail";
export const combinedMode = (base, next) => (!base || base === next ? next : "mixed");
const bad = () => {
  throw new Error("Use valid, in-frame overlay placement with the original piece proportions.");
};
export function defaultOverlayPlacements({
  type,
  attributes: a,
  view,
  side,
  hand,
  finger,
  wrist,
  anchors = {},
  width: w,
  height: h,
  assetWidth: aw,
  assetHeight: ah,
}) {
  if (
    !Object.hasOwn(overlayAnchors, type) ||
    ![w, h, aw, ah].every((n) => Number.isFinite(n) && n > 0)
  )
    bad();
  const anchor = overlayAnchors[type],
    portrait = anchors.anchors || {},
    px = Number.isFinite(anchors.pxPerMm) && anchors.pxPerMm > 0 ? anchors.pxPerMm : w / 400;
  const chosen =
    anchor === "finger"
      ? [hand]
      : anchor === "wrist"
        ? wrist === "both"
          ? ["left", "right"]
          : [wrist]
        : side === "both"
          ? ["left", "right"]
          : [side || "centre"];
  const result = [];
  for (const s of chosen) {
    const imageSide = s === "left" ? "right" : "left"; // Portrait/full views face camera.
    let point, band;
    if (view === "hands") {
      band = anchors[s]?.[anchor === "finger" ? finger : "wrist"];
      point = band;
    } else if (view === "portrait")
      point =
        anchor === "earlobe"
          ? portrait[imageSide + "Earlobe"]
          : anchor === "nostril"
            ? portrait[imageSide + "Nostril"]
            : anchor === "hairSide"
              ? hairSide(portrait, imageSide)
              : portrait[anchor];
    else
      point = {
        x: w * (anchor === "ankle" ? (s === "left" ? 0.62 : 0.38) : 0.5),
        y: h * (anchor === "ankle" ? 0.91 : anchor === "waist" ? 0.5 : 0.23),
      };
    if (!point || ![point.x, point.y].every(Number.isFinite)) bad();
    let pw, ph;
    if (anchor === "earlobe" && type !== "stud_earrings") {
      ph = (a.dropMm || 24) * px;
      pw = (ph * aw) / ah;
    } else if (type === "stud_earrings") {
      pw = (a.dropMm || 8) * px;
      ph = (pw * ah) / aw;
    } else if (type === "nath_chain") {
      // The cut-out runs from the ring (left edge) to the chain's end at the hair by the ear.
      const ear = portrait[imageSide + "Earlobe"];
      pw = ear ? Math.max(20 * px, Math.abs(ear.x - point.x) * 1.05) : 110 * px;
      ph = (pw * ah) / aw;
    } else if (anchor === "nostril") {
      pw = (type === "nose_pin" ? 4 : 16) * px;
      ph = (pw * ah) / aw;
    } else if (anchor === "hairSide") {
      pw = (a.pendantMm || 40) * px;
      ph = (pw * ah) / aw;
    } else if (anchor === "hairParting") {
      ph = (a.pendantMm || 30) * px;
      pw = (ph * aw) / ah;
    } else if (anchor === "finger") {
      pw = band.widthPx * 1.05;
      ph = (pw * ah) / aw;
    } else if (anchor === "wrist") {
      pw = band.widthPx * 1.05;
      ph = (pw * ah) / aw;
    } else {
      pw =
        anchor === "neckBase" && a.lengthCm
          ? a.lengthCm * 10 * px * 0.4
          : w * (anchor === "ankle" ? 0.1 : anchor === "waist" ? 0.36 : 0.55);
      ph = (pw * ah) / aw;
    }
    const fit = Math.max(Math.min(1, (w * 0.85) / pw, (h * 0.65) / ph), 2 / pw, 2 / ph);
    pw *= fit;
    ph *= fit;
    if (pw > w || ph > h) bad();
    const count = type === "bangles" ? a.count || 1 : 1;
    const bandAngle = band?.angle || 0;
    const radians = (bandAngle * Math.PI) / 180;
    const towardsForearm = Math.cos(radians) >= 0 ? 1 : -1;
    const dx = -Math.sin(radians) * towardsForearm;
    const dy = Math.cos(radians) * towardsForearm;
    const room = (start, delta, limit) => {
      if (Math.abs(delta) < 1e-6) return Infinity;
      return ((delta > 0 ? limit : 0) - start) / delta;
    };
    const step = Math.min(
      Math.max(3, Math.min(ph * 0.15, pw * 0.12)),
      Math.min(room(point.x, dx, w), room(point.y, dy, h)) / Math.max(1, count - 1),
    );
    for (let i = 0; i < count; i++)
      result.push({
        id: s + ":" + i,
        x: Math.min(w, Math.max(0, point.x + i * step * dx)),
        y: Math.min(h, Math.max(0, point.y + i * step * dy)),
        width: pw,
        height: ph,
        angle: bandAngle,
        mirror:
          s === "right" && (anchor === "earlobe" || anchor === "hairSide" || type === "nath_chain"),
        pivotX: type === "nath_chain" ? 0 : 0.5,
        pivotY:
          (anchor === "earlobe" && type !== "stud_earrings") || anchor === "neckBase" ? 0 : 0.5,
      });
  }
  return result;
}

/** Convert the two detected ear tragions into approximate piercing positions. */
export function refineEarringPlacements(placements, keypoints, { width, height }) {
  if (keypoints.length !== 6) return { placements, matched: 0 };
  const pixels = keypoints.map(({ x, y }) => ({ x: x * width, y: y * height }));
  const [eyeLeft, eyeRight] = pixels.slice(0, 2).sort((a, b) => a.x - b.x);
  const [earLeft, earRight] = pixels.slice(4).sort((a, b) => a.x - b.x);
  const dx = eyeRight.x - eyeLeft.x;
  const dy = eyeRight.y - eyeLeft.y;
  const earSpan = earRight.x - earLeft.x;
  const span = Math.hypot(dx, dy);
  if (
    !pixels.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)) ||
    dx < width * 0.08 ||
    earLeft.x >= eyeLeft.x ||
    earRight.x <= eyeRight.x ||
    earSpan < dx * 1.5 ||
    earSpan > dx * 3.2 ||
    Math.abs(dy) > dx * 0.4
  )
    return { placements, matched: 0 };
  let matched = 0;
  const refined = placements.map((piece) => {
    const left = piece.id.startsWith("left:");
    const tragion = left ? earRight : earLeft;
    // Tragion estimates can fall inside the cheek. Blend their lateral position
    // with the jaw's outside edge while locating the lobe below the ear point.
    const outer = tragion.x + (left ? 1 : -1) * dx * 0.08 - dy * 0.31;
    const x = piece.x * 0.65 + outer * 0.35;
    const y = tragion.y + dx * 0.31;
    if (
      x < 0 ||
      x > width ||
      y < 0 ||
      y > height ||
      Math.hypot(x - piece.x, y - piece.y) > span * 0.6
    )
      return piece;
    matched++;
    return { ...piece, x, y };
  });
  return { placements: refined, matched };
}

// MediaPipe's landmark indices use the wearer's left and right. Distances and
// angles use pixels so a portrait canvas does not stretch the geometry.
const bodyJoint = (landmarks, index, width, height) => {
  const joint = landmarks[index];
  if (
    !joint ||
    ![joint.x, joint.y, joint.visibility].every(Number.isFinite) ||
    joint.visibility < 0.55 ||
    joint.x < 0 ||
    joint.x > 1 ||
    joint.y < 0 ||
    joint.y > 1
  )
    return null;
  return { x: joint.x * width, y: joint.y * height };
};
const between = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const degrees = (rise, run) => (Math.atan2(rise, run) * 180) / Math.PI;

function bodyLine(a, b, minSpan) {
  if (!a || !b) return null;
  const [left, right] = a.x < b.x ? [a, b] : [b, a];
  const dx = right.x - left.x,
    dy = right.y - left.y;
  const span = Math.hypot(dx, dy);
  const angle = degrees(dy, dx);
  if (dx < minSpan || Math.abs(angle) > 25) return null;
  return { centre: between(left, right, 0.5), span, angle, dx, dy };
}

/** Refine the editor defaults in memory. Unclear joints keep their manual starting positions. */
export function refineFullBodyPlacements(placements, type, landmarks, { width, height }) {
  const joint = (i) => bodyJoint(landmarks, i, width, height);
  const anchor = overlayAnchors[type];
  const shoulders = bodyLine(joint(11), joint(12), width * 0.1);
  const hips = bodyLine(joint(23), joint(24), width * 0.075);

  function fittingPoint(id) {
    if (anchor === "ankle") {
      const left = id.startsWith("left:");
      const knee = joint(left ? 25 : 26);
      const ankle = joint(left ? 27 : 28);
      if (!knee || !ankle || ankle.y - knee.y < height * 0.07) return null;
      const angle = degrees(knee.x - ankle.x, ankle.y - knee.y);
      if (Math.abs(angle) > 35) return null;
      return {
        ...between(ankle, knee, 0.05),
        angle,
        width: Math.hypot(ankle.x - knee.x, ankle.y - knee.y) * 0.24,
      };
    }
    if (!shoulders) return null;
    if (anchor === "waist" && hips && hips.centre.y - shoulders.centre.y >= height * 0.09) {
      return {
        ...between(shoulders.centre, hips.centre, 0.72),
        angle: hips.angle,
        width: Math.max(hips.span * 1.2, shoulders.span * 0.86),
      };
    }
    if (anchor === "neckBase") {
      // The necklace's top edge attaches above the shoulder line, with its
      // visible width limited by the shoulders. Preserve the cut-out's drape.
      return {
        x: shoulders.centre.x + shoulders.dy * 0.16,
        y: shoulders.centre.y - shoulders.dx * 0.16,
        angle: shoulders.angle,
        width: shoulders.span * 0.66,
      };
    }
    return null;
  }

  let matched = 0;
  const refined = placements.map((piece) => {
    const point = fittingPoint(piece.id);
    if (!point || point.x < 0 || point.x > width || point.y < 0 || point.y > height) return piece;
    const ratio = piece.height / piece.width;
    const fittedWidth = Math.min(point.width, width, height / ratio);
    if (fittedWidth < 2 || fittedWidth * ratio < 2) return piece;
    matched++;
    return { ...piece, ...point, width: fittedWidth, height: fittedWidth * ratio };
  });
  return { placements: refined, matched };
}

export function validateOverlayPlacements(input, defaults, { width, height }) {
  if (!Array.isArray(input) || input.length !== defaults.length || input.length > 48) bad();
  let area = 0;
  const result = input.map((p, i) => {
    const d = defaults[i];
    if (
      !p ||
      typeof p !== "object" ||
      Object.keys(p).some(
        (k) =>
          !["id", "x", "y", "width", "height", "angle", "mirror", "pivotX", "pivotY"].includes(k),
      ) ||
      p.id !== d.id ||
      typeof p.mirror !== "boolean"
    )
      bad();
    if (
      !["x", "y", "width", "height", "angle"].every(
        (k) => typeof p[k] === "number" && Number.isFinite(p[k]),
      ) ||
      p.x < 0 ||
      p.x > width ||
      p.y < 0 ||
      p.y > height ||
      p.width < 2 ||
      p.height < 2 ||
      p.width > width ||
      p.height > height ||
      Math.abs(p.angle) > 180 ||
      Math.abs(p.width / p.height / (d.width / d.height) - 1) > 1e-6
    )
      bad();
    if (
      (p.pivotX !== undefined && p.pivotX !== d.pivotX) ||
      (p.pivotY !== undefined && p.pivotY !== d.pivotY)
    )
      bad();
    area += p.width * p.height;
    return { ...p, pivotX: d.pivotX, pivotY: d.pivotY };
  });
  if (area > width * height * 4) bad();
  return result;
}
