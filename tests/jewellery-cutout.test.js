import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  removeBackground,
  estimateBackground,
  transparentShare,
  cutoutSize,
  CutoutError,
} from "../src/jewellery-cutout.js";
import { overlayAsset } from "../server/jewellery-overlay.js";

const ringSvg = (background = "#f7f7f5") =>
  `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="400" fill="${background}"/><circle cx="200" cy="220" r="110" fill="none" stroke="#c9a03a" stroke-width="34"/><circle cx="200" cy="100" r="26" fill="#2f6fd0"/></svg>`;

async function decode(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data), width: info.width, height: info.height };
}
const alphaAt = (img, out, x, y) => out[(y * img.width + x) * 4 + 3];

test("a ring on a plain backdrop becomes a transparent cut-out with a clear centre hole", async () => {
  // JPEG adds realistic compression noise around the backdrop and edges.
  const img = await decode(await sharp(Buffer.from(ringSvg())).jpeg({ quality: 80 }).toBuffer());
  const { rgba, background, foregroundShare } = removeBackground(img.rgba, img.width, img.height);
  assert.ok(
    background.every((c) => c > 235),
    "backdrop colour is estimated from the border",
  );
  assert.equal(alphaAt(img, rgba, 5, 5), 0, "corner backdrop is transparent");
  assert.equal(alphaAt(img, rgba, 200, 220), 0, "enclosed ring hole is transparent");
  assert.equal(alphaAt(img, rgba, 200 + 110, 220), 255, "metal band stays opaque");
  assert.equal(alphaAt(img, rgba, 200, 100), 255, "stone stays opaque");
  assert.ok(foregroundShare > 0.1 && foregroundShare < 0.4);
  assert.ok(transparentShare(rgba) > 0.5);
});

test("keeping enclosed areas leaves the ring hole opaque when requested", async () => {
  const img = await decode(Buffer.from(ringSvg()));
  const { rgba } = removeBackground(img.rgba, img.width, img.height, { clearEnclosed: false });
  assert.equal(alphaAt(img, rgba, 200, 220), 255);
  assert.equal(alphaAt(img, rgba, 5, 5), 0);
});

test("small light details inside the piece are not cleared as enclosed backdrop", async () => {
  const svg =
    '<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="400" fill="#ffffff"/><rect x="100" y="100" width="200" height="200" fill="#b8892e"/><circle cx="200" cy="200" r="4" fill="#ffffff"/></svg>';
  const img = await decode(Buffer.from(svg));
  const { rgba } = removeBackground(img.rgba, img.width, img.height);
  assert.equal(alphaAt(img, rgba, 200, 200), 255, "a 4 px highlight stays opaque");
});

test("a backdrop with a soft vignette and shadow gradient is removed at the default tolerance", async () => {
  const svg =
    '<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="v" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c8c8c4"/></radialGradient></defs><rect width="400" height="400" fill="url(#v)"/><circle cx="200" cy="220" r="110" fill="none" stroke="#c9a03a" stroke-width="34"/></svg>';
  const img = await decode(await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer());
  const { rgba } = removeBackground(img.rgba, img.width, img.height);
  for (const [x, y] of [
    [2, 2],
    [397, 397],
    [200, 20],
    [40, 220],
  ])
    assert.equal(alphaAt(img, rgba, x, y), 0, `backdrop at ${x},${y} is transparent`);
  assert.equal(alphaAt(img, rgba, 310, 220), 255);
});

test("dark backdrops work and edge pixels are feathered without a light fringe", async () => {
  const img = await decode(Buffer.from(ringSvg("#151515")));
  const { rgba, background } = removeBackground(img.rgba, img.width, img.height);
  assert.ok(background.every((c) => c < 40));
  let partial = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0 && rgba[i] < 255) partial++;
  assert.ok(partial > 0, "anti-aliased edges keep partial alpha");
});

test("busy, empty and all-foreground images are rejected with actionable messages", async () => {
  const noise = Buffer.alloc(200 * 200 * 4);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
  for (let i = 3; i < noise.length; i += 4) noise[i] = 255;
  assert.throws(() => removeBackground(noise, 200, 200), CutoutError);
  assert.throws(() => removeBackground(noise, 200, 200), /too busy/);
  const blank = await decode(
    await sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff" } })
      .png()
      .toBuffer(),
  );
  assert.throws(() => removeBackground(blank.rgba, 300, 300), /No jewellery was found/);
  assert.throws(() => removeBackground(new Uint8ClampedArray(4), 2, 2), /could not be read/);
});

test("the border estimate reports how plain the backdrop is", async () => {
  const img = await decode(Buffer.from(ringSvg()));
  const { plainShare } = estimateBackground(img.rgba, img.width, img.height);
  assert.equal(plainShare, 1);
});

test("cut-out output passes the existing server overlay validation and trimming", async () => {
  const img = await decode(await sharp(Buffer.from(ringSvg())).jpeg({ quality: 85 }).toBuffer());
  const { rgba } = removeBackground(img.rgba, img.width, img.height);
  const png = await sharp(Buffer.from(rgba.buffer), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .png()
    .toBuffer();
  const saved = await overlayAsset(
    "data:image/png;base64," + png.toString("base64"),
    "finger",
    "ring",
  );
  const meta = await sharp(saved).metadata();
  assert.ok(meta.hasAlpha);
  assert.ok(meta.width < img.width && meta.height < img.height, "transparent margins trimmed");
});

test("cut-out size stays within the overlay limits without upscaling", () => {
  assert.deepEqual(cutoutSize(800, 600), { width: 800, height: 600 });
  const big = cutoutSize(6000, 4000);
  assert.ok(big.width <= 2048 && big.height <= 2048 && big.width * big.height <= 4_000_000);
  assert.ok(Math.abs(big.width / big.height - 1.5) < 0.01);
});
