import { avatarCanvas, loadImage } from "./images";

export type Category = "shirt" | "trousers";
export type Placement = { x: number; y: number; width: number; height: number };
export type Garment = { id: string; name: string; category: Category; source: string; placement: Placement; imported?: boolean };
export type Layer = { garment: Garment; placement: Placement };

// Coordinates use the original 384 × 942 standard pose. Generated portraits
// use the padded 692 × 1038 reference; staff can adjust for generation drift.
export function defaultPlacement(category: Category, profile: string, personalized: boolean): Placement {
  const broad = profile === "broad" ? 1.17 : profile === "athletic" ? 1.1 : profile === "slim" ? 0.9 : 1;
  const box = category === "shirt"
    ? { x: 186 - 142 * broad, y: 176, width: 284 * broad, height: 316 }
    : { x: 186 - 105 * broad, y: 474, width: 210 * broad, height: 400 };
  const frame = personalized ? { width: 692, height: 1038, x: 154, y: 48 } : { width: 384, height: 942, x: 0, y: 0 };
  return { x: (box.x + frame.x) / frame.width, y: (box.y + frame.y) / frame.height, width: box.width / frame.width, height: box.height / frame.height };
}

function sampleSvg(category: Category, color: string) {
  const shape = category === "shirt"
    ? 'M72 0 Q100 54 129 0 L174 29 Q187 45 198 120 L163 132 L158 100 L167 279 Q100 286 32 279 L40 100 L37 132 L1 120 Q12 51 25 30 Z'
    : 'M7 2 Q100 12 193 2 L197 100 Q199 173 193 225 L181 390 L145 395 L132 232 L100 116 L68 230 L51 395 L14 390 L5 225 Q1 165 3 108 Z';
  const h = category === "shirt" ? 285 : 400;
  const details = category === "shirt"
    ? '<path d="M72 0 Q100 62 129 0 M40 103 L34 269 M158 103 L165 269 M34 271 Q100 278 165 271"/><path d="M60 45 Q50 90 58 160 M140 50 Q150 110 141 170" opacity=".25"/>'
    : '<path d="M8 18 L192 18 M99 18 L100 116 M30 26 Q34 65 8 77 M170 26 Q166 65 192 77 M16 379 L52 382 M144 382 L180 379"/><path d="M47 100 L34 351 M153 100 L164 351" opacity=".25"/>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${h}" viewBox="0 0 200 ${h}"><defs><linearGradient id="fabric"><stop stop-color="${color}"/><stop offset=".23" stop-color="${color}"/><stop offset=".5" stop-color="#fff" stop-opacity=".12"/><stop offset=".8" stop-color="${color}"/><stop offset="1" stop-color="#000" stop-opacity=".24"/></linearGradient></defs><path d="${shape}" fill="${color}"/><path d="${shape}" fill="url(#fabric)"/><g fill="none" stroke="#101c20" stroke-opacity=".3" stroke-width="2">${details}</g></svg>`)}`;
}

export function sampleCatalogue(profile: string, personalized: boolean): Garment[] {
  return ([
    ["shirt", "navy", "Navy T-shirt", "#233c55"],
    ["shirt", "cream", "Cream T-shirt", "#e7dfca"],
    ["shirt", "sage", "Sage T-shirt", "#7b927f"],
    ["trousers", "denim", "Blue trousers", "#385a77"],
    ["trousers", "charcoal", "Charcoal trousers", "#373d40"],
    ["trousers", "sand", "Sand trousers", "#b7a17f"],
  ] as const).map(([category, id, name, color]) => ({ id, name, category, source: sampleSvg(category, color), placement: defaultPlacement(category, profile, personalized) }));
}

export async function baseAvatar(index: number, personalized: string | null): Promise<string> {
  return personalized || (await avatarCanvas(index)).toDataURL("image/png");
}

export async function renderOutfit(base: string, layers: Layer[]): Promise<HTMLCanvasElement> {
  const avatar = await loadImage(base);
  const canvas = document.createElement("canvas");
  canvas.width = avatar.naturalWidth;
  canvas.height = avatar.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(avatar, 0, 0);
  // Trousers first, shirt last: a shirt hem should sit over the waistband.
  for (const category of ["trousers", "shirt"] as Category[]) {
    const layer = layers.find(item => item.garment.category === category);
    if (!layer) continue;
    const image = await loadImage(layer.garment.source);
    const p = layer.placement;
    ctx.drawImage(image, p.x * canvas.width, p.y * canvas.height, p.width * canvas.width, p.height * canvas.height);
  }
  return canvas;
}

export async function importGarment(file: File, category: Category, profile: string, personalized: boolean): Promise<Garment> {
  if (!["image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a transparent PNG or WebP layer under 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (image.width * image.height > 16_000_000 || image.width < 32 || image.height < 32)
      throw new Error("Use a layer at least 32 × 32 pixels and no larger than 16 megapixels.");
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1, transparent = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const alpha = pixels[(y * canvas.width + x) * 4 + 3];
      if (alpha < 16) transparent++;
      if (alpha > 16) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    }
    if (right < left || transparent < canvas.width * canvas.height * 0.02)
      throw new Error("This layer needs a transparent background and a visible garment. Product photos with a solid background cannot be overlaid directly.");
    const trimmed = document.createElement("canvas");
    trimmed.width = right - left + 1; trimmed.height = bottom - top + 1;
    trimmed.getContext("2d")!.drawImage(canvas, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
    const placement = defaultPlacement(category, profile, personalized);
    // Preserve the imported garment's aspect ratio at its initial width.
    const aspect = personalized ? 692 / 1038 : 384 / 942;
    placement.height = Math.min(0.95, placement.width * aspect * trimmed.height / trimmed.width);
    return { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, "").slice(0, 70), category, source: trimmed.toDataURL("image/png"), placement, imported: true };
  } finally { URL.revokeObjectURL(url); }
}
