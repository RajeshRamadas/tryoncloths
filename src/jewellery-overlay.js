// Shared geometry only. Coordinates are full view pixels; no provider or DOM.
export const overlayAnchors = {
  stud_earrings: "earlobe",
  drop_earrings: "earlobe",
  jhumka: "earlobe",
  nose_pin: "nostril",
  nose_ring: "nostril",
  maang_tikka: "hairParting",
  matha_patti: "hairParting",
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
    } else if (anchor === "nostril") {
      pw = (type === "nose_pin" ? 4 : 16) * px;
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
    for (let i = 0; i < count; i++)
      result.push({
        id: s + ":" + i,
        x: point.x,
        y: point.y + i * Math.min(Math.max(3, ph * 0.15), (h - point.y) / Math.max(1, count - 1)),
        width: pw,
        height: ph,
        angle: band?.angle || 0,
        mirror: s === "right" && anchor === "earlobe",
        pivotX: 0.5,
        pivotY:
          (anchor === "earlobe" && type !== "stud_earrings") || anchor === "neckBase" ? 0 : 0.5,
      });
  }
  return result;
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
