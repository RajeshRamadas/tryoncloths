import sharp from "sharp";
import { readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "mobile-resources/icon.svg");
for (const [density, size] of Object.entries({
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
})) {
  const folder = path.join(root, `android/app/src/main/res/mipmap-${density}`);
  for (const filename of ["ic_launcher.png", "ic_launcher_round.png"])
    await sharp(source)
      .resize(size, size)
      .png()
      .toFile(path.join(folder, filename));
  await sharp(source)
    .resize(Math.round(size * 2.25), Math.round(size * 2.25))
    .png()
    .toFile(path.join(folder, "ic_launcher_foreground.png"));
}
await writeFile(
  path.join(root, "android/app/src/main/res/values/ic_launcher_background.xml"),
  '<?xml version="1.0" encoding="utf-8"?><resources><color name="ic_launcher_background">#245e4b</color></resources>\n',
);
// Replace template splash artwork with the same brand mark on the studio background.
const splashSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732"><rect width="2732" height="2732" fill="#f8f9f6"/><rect x="1222" y="1222" width="288" height="288" rx="65" fill="#245e4b"/><text x="1366" y="1430" font-family="sans-serif" font-weight="bold" font-size="200" fill="white" text-anchor="middle">f</text></svg>',
);
const androidRes = path.join(root, "android/app/src/main/res");
for (const name of await readdir(androidRes)) {
  if (!name.startsWith("drawable")) continue;
  const folder = path.join(androidRes, name);
  if (!(await readdir(folder)).includes("splash.png")) continue;
  const filename = path.join(folder, "splash.png");
  const { width, height } = await sharp(filename).metadata();
  await sharp(splashSvg)
    .resize(width, height, { fit: "cover" })
    .png()
    .toFile(`${filename}.new`);
  const { rename } = await import("node:fs/promises");
  await rename(`${filename}.new`, filename);
}
console.log(
  "Generated Android app icons and splash assets from mobile-resources/icon.svg.",
);
