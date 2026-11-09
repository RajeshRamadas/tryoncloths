#!/usr/bin/env node
// One-off preparation of manually generated Image Gen assets. Never run in CI,
// build, server startup or a customer request. This script makes no AI calls.
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { skinTones } from "../src/profiles.js";
import { validateHandAnchors } from "../server/hands-templates.js";

export async function prepareHandTemplates(manifestFile, output) {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const expected = ["male", "female"].flatMap((body) =>
    skinTones.map((tone) => `${body}-${tone.id}`),
  );
  if (
    !manifest ||
    Array.isArray(manifest) ||
    Object.keys(manifest).length !== expected.length ||
    expected.some((id) => !manifest[id])
  )
    throw new Error("Supply exactly the twelve body/tone source images and reviewed anchor files.");
  const staged = [];
  for (const id of expected) {
    const source = manifest[id];
    if (typeof source.image !== "string" || typeof source.anchors !== "string")
      throw new Error("Each source needs an image and an anchors path.");
    const image = path.resolve(path.dirname(manifestFile), source.image),
      anchorPath = path.resolve(path.dirname(manifestFile), source.anchors);
    const anchors = validateHandAnchors(JSON.parse(await readFile(anchorPath, "utf8")));
    const picture = sharp(await readFile(image), { limitInputPixels: 25_000_000, animated: false }),
      meta = await picture.metadata();
    if (meta.format !== "png" || meta.width !== meta.height || meta.pages > 1)
      throw new Error("Use square, static PNG source images.");
    const png = await picture
      .rotate()
      .resize(1024, 1024, { fit: "contain", background: "#ece9e4" })
      .flatten({ background: "#ece9e4" })
      .toColourspace("srgb")
      .png()
      .toBuffer();
    staged.push({ id, png, anchors });
  }
  // Refuse an existing output; operators review the prepared directory before
  // copying it into public/hands. A mistake cannot overwrite the shipped set.
  try {
    await access(output);
    throw new Error("Choose a new output directory.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(output, { recursive: true });
  for (const { id, png, anchors } of staged) {
    await writeFile(path.join(output, id + ".png"), png, { flag: "wx" });
    await writeFile(path.join(output, id + ".json"), JSON.stringify(anchors, null, 2) + "\n", {
      flag: "wx",
    });
  }
  return staged.map(({ id }) => id);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifest, output, ...extra] = process.argv.slice(2);
  if (!manifest || !output || extra.length) {
    process.stderr.write(
      "Usage: node scripts/make-hand-templates.mjs SOURCES.json NEW_OUTPUT_DIRECTORY\n",
    );
    process.exitCode = 1;
  } else
    try {
      const ids = await prepareHandTemplates(path.resolve(manifest), path.resolve(output));
      process.stdout.write(
        `Prepared ${ids.length} static hands templates. Inspect every image and its anchors before publishing.\n`,
      );
    } catch {
      process.stderr.write(
        "Hands assets could not be prepared. Check the source manifest, anchors and new output directory.\n",
      );
      process.exitCode = 1;
    }
}
