export type GarmentColour = { hex: string; reference: number };

// Colour only isolated clothing pixels, never the customer's avatar. A shared
// transform supplies both thumbnails and exported layers. Alpha is unchanged.
export function colourGarmentPixels(pixels: Uint8ClampedArray, colour: GarmentColour): void {
  const target = [1, 3, 5].map((offset) => parseInt(colour.hex.slice(offset, offset + 2), 16));
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const luminance = Math.sqrt(
      0.2126 * pixels[i] ** 2 + 0.7152 * pixels[i + 1] ** 2 + 0.0722 * pixels[i + 2] ** 2,
    );
    const shade = luminance / colour.reference;
    for (let channel = 0; channel < 3; channel++) {
      pixels[i + channel] =
        shade <= 1
          ? target[channel] * shade ** 0.85
          : target[channel] + (255 - target[channel]) * (1 - Math.exp(-(shade - 1) * 0.65));
    }
  }
}
