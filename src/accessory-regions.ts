import type { Source } from "./jewellery-cutout-photo";

export type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
export type Selection = { bounds: Bounds; source: Source };
export const MAX_ACCESSORIES_PER_PHOTO = 8;
function cropSize({ left, top, right, bottom }: Bounds) {
  const padding = Math.ceil(Math.max(right - left, bottom - top) * 0.01) + 2;
  return { width: right - left + padding * 2, height: bottom - top + padding * 2, padding };
}

/** Find separate foreground islands in an image whose background is transparent. */
export function separateAccessories({ rgba, width, height }: Source): Selection[] {
  const pixels = width * height;
  const labels = new Uint32Array(pixels);
  const queue = new Uint32Array(pixels);
  const minimum = Math.max(24, Math.round(pixels * 0.0004));
  const regions: (Bounds & { label: number; count: number })[] = [];
  let label = 0;
  function visit(index: number, tail: number) {
    if (labels[index] || rgba[index * 4 + 3] < 16) return tail;
    labels[index] = label;
    queue[tail] = index;
    return tail + 1;
  }
  for (let start = 0; start < pixels; start++) {
    if (labels[start] || rgba[start * 4 + 3] < 16) continue;
    label++;
    let tail = visit(start, 0);
    let left = width,
      top = height,
      right = 0,
      bottom = 0;
    for (let head = 0; head < tail; head++) {
      const index = queue[head];
      const x = index % width,
        y = Math.floor(index / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
      for (let dy = -1; dy <= 1; dy++) {
        if (y + dy < 0 || y + dy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx >= 0 && x + dx < width) tail = visit(index + dy * width + dx, tail);
        }
      }
    }
    if (tail >= minimum && right - left >= 8 && bottom - top >= 8)
      regions.push({ left, top, right, bottom, label, count: tail });
  }
  return regions
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_ACCESSORIES_PER_PHOTO)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map(({ left, top, right, bottom, label }) => {
      const bounds = { left, top, right, bottom };
      const { width: cropWidth, height: cropHeight, padding } = cropSize(bounds);
      const crop = new Uint8ClampedArray(cropWidth * cropHeight * 4);
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const index = y * width + x;
          if (labels[index] !== label) continue;
          const offset = ((y - top + padding) * cropWidth + x - left + padding) * 4;
          crop.set(rgba.subarray(index * 4, index * 4 + 4), offset);
        }
      }
      return {
        bounds,
        source: { rgba: crop, width: cropWidth, height: cropHeight },
      };
    });
}

/** Clip the original pixels along a reviewed outline, with transparent padding for storage. */
export function traceAccessory(
  image: HTMLCanvasElement,
  points: Point[],
  openings: Point[][],
): Selection {
  const left = Math.floor(Math.min(...points.map((p) => p.x)));
  const top = Math.floor(Math.min(...points.map((p) => p.y)));
  const right = Math.ceil(Math.max(...points.map((p) => p.x)));
  const bottom = Math.ceil(Math.max(...points.map((p) => p.y)));
  if (points.length < 3 || right - left < 8 || bottom - top < 8)
    throw new Error("Mark at least three corners around the piece.");
  const bounds = { left, top, right, bottom };
  const { width, height, padding } = cropSize(bounds);
  const crop = document.createElement("canvas");
  crop.width = width;
  crop.height = height;
  const context = crop.getContext("2d")!;
  function path(contour: Point[]) {
    context.beginPath();
    for (const { x, y } of contour) context.lineTo(x - left + padding, y - top + padding);
    context.closePath();
  }
  context.save();
  path(points);
  context.clip("evenodd");
  context.drawImage(image, padding - left, padding - top);
  context.restore();
  context.globalCompositeOperation = "destination-out";
  for (const contour of openings) {
    path(contour);
    context.fill("evenodd");
  }
  const { data } = context.getImageData(0, 0, crop.width, crop.height);
  if (!data.some((value, index) => index % 4 === 3 && value >= 16))
    throw new Error("Trace around the visible part of the accessory.");
  return {
    bounds,
    source: { rgba: data, width, height },
  };
}
