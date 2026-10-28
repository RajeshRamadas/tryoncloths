import { avatarCanvas, loadImage } from "./images";

export type Category = "shirt" | "trousers" | "shoes";
export type Placement = { x: number; y: number; width: number; height: number };
export type Garment = { id: string; name: string; category: Category; source: string; placement: Placement; imported?: boolean };
export type Layer = { garment: Garment; placement: Placement };

// Coordinates use the original 384 × 942 standard pose. Generated portraits
// use the padded 692 × 1038 reference; staff can adjust for generation drift.
export function defaultPlacement(category: Category, profile: string, personalized: boolean): Placement {
  const broad = profile === "broad" ? 1.17 : profile === "athletic" ? 1.1 : profile === "slim" ? 0.9 : 1;
  const box = category === "shirt"
    ? { x: 186 - 155 * broad, y: 176, width: 310 * broad, height: 316 }
    : category === "trousers"
      ? { x: 186 - 115 * broad, y: 474, width: 230 * broad, height: 400 }
      : { x: 186 - 115 * broad, y: 827, width: 230 * broad, height: 92 };
  const frame = personalized ? { width: 692, height: 1038, x: 154, y: 48 } : { width: 384, height: 942, x: 0, y: 0 };
  return { x: (box.x + frame.x) / frame.width, y: (box.y + frame.y) / frame.height, width: box.width / frame.width, height: box.height / frame.height };
}

export function sampleCatalogue(profile: string, personalized: boolean): Garment[] {
  return ([
    ["shirt", "navy-tee", "Navy T-shirt"],
    ["shirt", "cream-tee", "Cream T-shirt"],
    ["shirt", "blue-shirt", "Blue button-down shirt"],
    ["trousers", "blue-jeans", "Blue jeans"],
    ["trousers", "charcoal-chinos", "Charcoal chinos"],
    ["trousers", "sand-chinos", "Sand chinos"],
    ["shoes", "white-sneakers", "White sneakers"],
    ["shoes", "black-sneakers", "Black sneakers"],
    ["shoes", "brown-shoes", "Brown leather shoes"],
  ] as const).map(([category, id, name]) => ({ id, name, category, source: `/garments/${id}.webp`, placement: defaultPlacement(category, profile, personalized) }));
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
  // Shoes beneath trouser cuffs; the shirt hem sits over the waistband.
  for (const category of ["shoes", "trousers", "shirt"] as Category[]) {
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
