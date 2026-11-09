import { avatarCanvas, loadImage } from "./images";
import { colourGarmentPixels, type GarmentColour } from "./garment-colours";
import { SAMPLE_GARMENTS } from "./sample-wardrobe";
import { defaultGarmentPlacement, prepareGarmentLayer } from "./garment-layer";
import { CUTOUT_DEFAULT_TOLERANCE, removeBackground, transparentShare } from "./jewellery-cutout";

export type Category = "shirt" | "trousers" | "shoes";
export type Placement = { x: number; y: number; width: number; height: number };
export type Garment = {
  id: string;
  name: string;
  category: Category;
  source: string;
  placement: Placement;
  imported?: boolean;
  colour?: GarmentColour;
  /** Present when the layer was cut out from a product photo on this device. */
  cutout?: CutoutSettings;
};
export type Layer = { garment: Garment; placement: Placement };

// Coordinates use the original 384 × 942 standard pose. Generated portraits
// use the padded 692 × 1038 reference; staff can adjust for generation drift.
export function defaultPlacement(
  category: Category,
  profile: string,
  personalized: boolean,
): Placement {
  return defaultGarmentPlacement(category, profile, personalized);
}

export function sampleCatalogue(profile: string, personalized: boolean): Garment[] {
  if (profile.startsWith("f-")) return [];
  return SAMPLE_GARMENTS.map((garment) => ({
    ...garment,
    placement: defaultPlacement(garment.category, profile, personalized),
  }));
}

// Bounded by the shipped catalogue. Imported layers bypass this cache and the
// colour transform so user uploads remain exactly as supplied.
const sampleSources = new Map<string, Promise<string>>();
export async function garmentSource(garment: Garment): Promise<string> {
  if (!garment.colour || garment.imported) return garment.source;
  const colour = garment.colour;
  const key = `${garment.source}:${colour.hex}:${colour.reference}`;
  let source = sampleSources.get(key);
  if (!source) {
    source = (async () => {
      const image = await loadImage(garment.source);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      colourGarmentPixels(pixels.data, colour);
      ctx.putImageData(pixels, 0, 0);
      return canvas.toDataURL("image/png");
    })();
    sampleSources.set(key, source);
    // A transient load failure must not permanently poison a sample.
    void source.catch(() => sampleSources.delete(key));
  }
  return source;
}

export async function baseAvatar(
  index: number,
  personalized: string | null,
  templateTone = "medium",
): Promise<string> {
  return personalized || (await avatarCanvas(index, templateTone)).toDataURL("image/png");
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
    const layer = layers.find((item) => item.garment.category === category);
    if (!layer) continue;
    const image = await loadImage(await garmentSource(layer.garment));
    const p = layer.placement;
    ctx.drawImage(
      image,
      p.x * canvas.width,
      p.y * canvas.height,
      p.width * canvas.width,
      p.height * canvas.height,
    );
  }
  return canvas;
}

export type LayerSource = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** True when the file had no transparent background and needs a cut-out. */
  photo: boolean;
};
export type CutoutSettings = { tolerance: number; clearEnclosed: boolean };
export const DEFAULT_CUTOUT: CutoutSettings = {
  tolerance: CUTOUT_DEFAULT_TOLERANCE,
  clearEnclosed: true,
};

/** Decode a clothing file on the device, at most 1600 px on the longer side. */
export async function readGarmentFile(file: File): Promise<LayerSource> {
  if (
    !["image/png", "image/webp", "image/jpeg"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("Choose a PNG, WebP or JPEG clothing image under 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (image.width * image.height > 16_000_000 || image.width < 32 || image.height < 32)
      throw new Error("Use an image at least 32 × 32 pixels and no larger than 16 megapixels.");
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      rgba,
      width: canvas.width,
      height: canvas.height,
      photo: transparentShare(rgba) < 0.02,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Turn a decoded clothing image into an aligned layer. Product photos on a plain backdrop
 * have their background removed on the device first; transparent layers are used as supplied.
 */
export function buildGarmentLayer(
  source: LayerSource,
  details: { id: string; name: string; category: Category },
  profile: string,
  personalized: boolean,
  cutout: CutoutSettings = DEFAULT_CUTOUT,
): Garment {
  const pixels = source.photo
    ? removeBackground(source.rgba, source.width, source.height, {
        ...cutout,
        subject: "clothing",
      }).rgba
    : source.rgba;
  const layer = prepareGarmentLayer(
    pixels,
    source.width,
    source.height,
    details.category,
    profile,
    personalized,
  );
  if (!layer) throw new Error("This layer has no visible garment.");
  const canvas = document.createElement("canvas");
  canvas.width = layer.width;
  canvas.height = layer.height;
  canvas.getContext("2d")!.putImageData(new ImageData(layer.rgba, layer.width, layer.height), 0, 0);
  return {
    ...details,
    source: canvas.toDataURL("image/png"),
    placement: layer.placement,
    imported: true,
    ...(source.photo ? { cutout } : {}),
  };
}

export async function importGarment(
  file: File,
  category: Category,
  profile: string,
  personalized: boolean,
): Promise<{ garment: Garment; source: LayerSource }> {
  const source = await readGarmentFile(file);
  const garment = buildGarmentLayer(
    source,
    { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, "").slice(0, 70), category },
    profile,
    personalized,
  );
  return { garment, source };
}
