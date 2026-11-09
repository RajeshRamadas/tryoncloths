import sharp from "sharp";
// Independent schematic hands for geometry/transport tests, not real customer
// photos, avatar assets, or evidence of Gemini rendering/hand-detector quality.
export async function customerHandsFixture(colour = "#bc815c", background = "white") {
  const left = {
    thumb: { x: 395, y: 420, angle: 18, widthPx: 60 },
    index: { x: 330, y: 300, angle: 0, widthPx: 54 },
    middle: { x: 260, y: 275, angle: 0, widthPx: 58 },
    ring: { x: 190, y: 295, angle: 0, widthPx: 52 },
    little: { x: 125, y: 335, angle: 0, widthPx: 44 },
    wrist: { x: 245, y: 730, angle: 0, widthPx: 180 },
  };
  const shape = `<g fill="${colour}"><rect x="140" y="340" width="240" height="330" rx="100"/><rect x="155" y="610" width="180" height="330" rx="35"/><rect x="103" y="185" width="44" height="300" rx="22"/><rect x="164" y="125" width="52" height="370" rx="26"/><rect x="231" y="80" width="58" height="420" rx="29"/><rect x="303" y="145" width="54" height="350" rx="27"/><rect x="365" y="320" width="60" height="225" rx="30" transform="rotate(18 395 420)"/></g>`;
  const image = await sharp(
    Buffer.from(
      `<svg width="1024" height="1024"><rect width="1024" height="1024" fill="${background}"/>${shape}<g transform="translate(1024 0) scale(-1 1)">${shape}</g></svg>`,
    ),
  )
    .png()
    .toBuffer();
  const points = Object.fromEntries(
    Object.entries(left).flatMap(([finger, p]) => [
      ["left." + finger, p],
      ["right." + finger, { ...p, x: 1024 - p.x, angle: p.angle ? -p.angle : 0 }],
    ]),
  );
  return { image, points, url: "data:image/png;base64," + image.toString("base64") };
}
