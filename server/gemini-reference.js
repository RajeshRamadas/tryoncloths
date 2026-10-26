import sharp from "sharp";

// Geometry is specific to the four bundled 384 × 942 template panels. Keep this
// separate from sample previews/exports, which must retain their original image.
export async function geminiBodyReference(avatar) {
  const { width, height } = await sharp(avatar).metadata();
  if (width !== 384 || height !== 942)
    throw new Error("Review the identity mask before changing the standard body library.");

  // Opaque, generous region covers hair, ears, face and neck in every panel.
  // Retain natural body colour/texture: grayscale references can make Gemini
  // return a coloured face on a gray body. Customer photos still guide complexion.
  const blankHead = await sharp({ create: {
    width: 160, height: 210, channels: 3, background: "#c6c6c6",
  } }).png().toBuffer();
  const reference = await sharp(avatar)
    .composite([{ input: blankHead, left: 112, top: 12 }]).png().toBuffer();

  // Fit the full body into a 2:3 portrait with room above the head/below the feet.
  // Padding, rather than cropping or stretching, preserves the chosen silhouette.
  return sharp(reference).extend({
    top: 48, bottom: 48, left: 154, right: 154, background: "#c6c6c6",
  }).removeAlpha().png().toBuffer();
}
