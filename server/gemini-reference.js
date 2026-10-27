import sharp from "sharp";

// Measured centres in the four bundled 384 × 942 panels. These are visual
// composition guides, not inferred customer measurements or face landmarks.
const headCentres = { slim: 185, regular: 192, athletic: 190, broad: 186 };

export async function geminiBodyReference(avatar, profileId) {
  const { width, height } = await sharp(avatar).metadata();
  const centre = headCentres[profileId];
  if (width !== 384 || height !== 942 || !Object.hasOwn(headCentres, profileId))
    throw new Error("Review the anatomy guide before changing the standard body library.");

  // Remove identity above the neck, then overlap the original neck with a
  // feathered transition. A hard row boundary can be copied as a visible cut.
  // A narrow background strip contains no part of the person at this height.
  const backgroundStrip = await sharp(avatar)
    .extract({ left: 16, top: 20, width: 24, height: 183 })
    .resize(148, 183, { fit: "fill" }).png().toBuffer();
  // Keep the original collar/shoulders under the fading part of the guide;
  // otherwise the background patch itself washes out the shirt near the neck.
  const originalNeckBand = await sharp(avatar)
    .extract({ left: centre - 74, top: 175, width: 148, height: 28 }).png().toBuffer();
  const background = await sharp(backgroundStrip)
    .composite([{ input: originalNeckBand, left: 0, top: 155 }]).png().toBuffer();
  const neck = await sharp(avatar)
    .extract({ left: centre - 8, top: 180, width: 16, height: 12 }).png().toBuffer();
  const skin = await sharp(neck).stats();
  const colour = skin.channels.slice(0, 3).map(channel => Math.round(channel.mean));
  const shade = delta => `rgb(${colour.map(value => Math.max(0, Math.min(255, value + delta))).join(",")})`;
  // A featureless, approximately life-sized head gives the model a scale and
  // neck anchor without retaining the template person's face or hairstyle.
  const guide = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="148" height="183">
    <defs><radialGradient id="skin" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="${shade(12)}"/><stop offset="1" stop-color="${shade(-15)}"/>
    </radialGradient></defs>
    <path d="M48 126 H100 L110 183 H38 Z" fill="${shade(0)}"/>
    <ellipse cx="26" cy="95" rx="6" ry="12" fill="${shade(-4)}"/>
    <ellipse cx="122" cy="95" rx="6" ry="12" fill="${shade(-4)}"/>
    <ellipse cx="74" cy="84" rx="50" ry="62" fill="url(#skin)"/>
  </svg>`);
  const headRgb = await sharp(background).composite([{ input: guide }])
    .removeAlpha().png().toBuffer();
  const opacity = Buffer.alloc(148 * 183, 255);
  // Fully replace original face/hair through row 174. Fade only into the neck
  // over the next 28 rows, with zero slope at both ends to avoid another edge.
  for (let y = 155; y < 183; y++) {
    const t = (y - 154) / 28;
    const alpha = Math.round(255 * (1 - t * t * (3 - 2 * t)));
    opacity.fill(alpha, y * 148, (y + 1) * 148);
  }
  const head = await sharp(headRgb)
    .joinChannel(opacity, { raw: { width: 148, height: 183, channels: 1 } })
    .png().toBuffer();
  const reference = await sharp(avatar)
    .composite([{ input: head, left: centre - 74, top: 20 }]).removeAlpha().png().toBuffer();

  // Remove only the contact-sheet separators, then pad into a 2:3 portrait.
  // Body pixels keep their scale and positions. Below the neck overlap they
  // remain unchanged; no completed customer output is cut or pasted here.
  return sharp(reference).extract({ left: 4, top: 0, width: 376, height: 942 })
    .extend({ top: 48, bottom: 48, left: 158, right: 158, background: "#c6c6c6" })
    .removeAlpha().png().toBuffer();
}
