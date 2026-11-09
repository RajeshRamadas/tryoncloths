import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { skinTones } from "../src/profiles.js";
import {
  handsTemplate,
  createHandsTemplates,
  validateHandAnchors,
  handPositions,
} from "../server/hands-templates.js";

const root = new URL("../public/hands/", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const copy = (value) => JSON.parse(JSON.stringify(value));
const status = (expected) => (error) => error.status === expected;
async function maskPixels(anchors) {
  return sharp(
    Buffer.from(
      `<svg width="1024" height="1024"><polygon points="${anchors.handMask.map((p) => p.join(",")).join(" ")}" fill="white"/></svg>`,
    ),
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
}

test("all twelve static hand templates have unique 1024px PNGs, complete anchors, tone choices and skin masks", async () => {
  const files = await readdir(root);
  assert.equal(files.filter((f) => f.endsWith(".png")).length, 12);
  assert.equal(files.filter((f) => f.endsWith(".json")).length, 12);
  const hashes = new Set();
  for (const body of ["male", "female"]) {
    let previous = Infinity;
    for (const tone of skinTones) {
      const item = await handsTemplate(body, tone.id),
        meta = await sharp(item.png).metadata();
      assert.equal(meta.format, "png");
      assert.equal(meta.width, 1024);
      assert.equal(meta.height, 1024);
      assert.equal(meta.hasAlpha, false);
      assert.equal(item.body, body);
      assert.equal(item.tone, tone.id);
      assert.equal(item.sourceKind, "template");
      assert.deepEqual(item.warnings, []);
      hashes.add(hash(item.png));
      const a = item.anchors;
      assert.deepEqual(validateHandAnchors(a), a);
      const mask = await maskPixels(a),
        rgb = await sharp(item.png).raw().toBuffer();
      let area = 0,
        skin = 0,
        luminance = 0;
      for (let i = 0; i < 1024 * 1024; i++)
        if (mask[i * 4 + 3] > 127) {
          area++;
          const r = rgb[i * 3],
            g = rgb[i * 3 + 1],
            b = rgb[i * 3 + 2];
          if (r - b > 12 && r > g) skin++;
          luminance += r * 0.2126 + g * 0.7152 + b * 0.0722;
        }
      assert.ok(area > 250000 && area < 650000, body + " " + tone.id + " mask area");
      assert.ok(
        skin / area > 0.9,
        body + " " + tone.id + " mask must predominantly cover the actual hands",
      );
      assert.equal(mask[(700 * 1024 + 512) * 4 + 3], 0, "the gap between hands must be excluded");
      const mean = luminance / area;
      assert.ok(
        mean < previous - 1,
        body + " " + tone.id + " should be a distinct progressively darker illustrative tone",
      );
      previous = mean;
      for (const side of ["left", "right"]) {
        assert.deepEqual(Object.keys(a[side]), handPositions);
        for (const [name, p] of Object.entries(a[side])) {
          assert.ok(
            mask[(Math.round(p.y) * 1024 + Math.round(p.x)) * 4 + 3] > 127,
            body + " " + tone.id + " " + side + " " + name + " is inside the hand mask",
          );
          // Sample most of the band, not just its centre, to catch flipped,
          // shifted or resized source images that leave anchors on the surface.
          const radians = (p.angle * Math.PI) / 180;
          for (const fraction of [-0.3, 0, 0.3]) {
            const x = Math.round(p.x + Math.cos(radians) * p.widthPx * fraction),
              y = Math.round(p.y + Math.sin(radians) * p.widthPx * fraction),
              i = (y * 1024 + x) * 3;
            assert.ok(
              rgb[i] - rgb[i + 2] > 12,
              body + " " + tone.id + " " + side + " " + name + " band must land on skin",
            );
          }
        }
      }
    }
  }
  assert.equal(hashes.size, 12);
});

test("missing tone defaults to Medium with a warning; invalid or unsafe selectors fail before filesystem access", async () => {
  const expected = await handsTemplate("female", "medium");
  for (const tone of [undefined, null, ""]) {
    const item = await handsTemplate("female", tone);
    assert.equal(item.tone, "medium");
    assert.deepEqual(item.png, expected.png);
    assert.equal(item.warnings.length, 1);
    assert.equal(item.warnings[0].code, "hands_tone_defaulted");
    assert.match(item.warnings[0].message, /Medium/);
  }
  const missing = createHandsTemplates({ root: "/tmp/does-not-exist-hands-j3" });
  for (const body of ["../male", "", null, [], {}, "__proto__", "Male"])
    await assert.rejects(missing(body, "medium"), status(400));
  for (const tone of ["../medium", "MEDIUM", " ", "unknown", [], {}, false])
    await assert.rejects(missing("male", tone), status(400));
  await assert.rejects(missing("male", "medium"), status(503));
});

test("anchors validate coordinate types, finger and wrist widths, complete bands and useful mask geometry", async () => {
  const { anchors: original } = await handsTemplate("male", "medium");
  const invalid = [
    null,
    [],
    { ...original, unexpected: true },
    { ...original, width: 512 },
    { ...original, schemaVersion: 2 },
  ];
  for (const [key, value] of [
    ["x", -1],
    ["y", 1024],
    ["x", "200"],
    ["angle", NaN],
    ["angle", 181],
    ["widthPx", 29],
    ["widthPx", 91],
  ]) {
    const a = copy(original);
    a.left.ring[key] = value;
    invalid.push(a);
  }
  for (const widthPx of [119, 301]) {
    const a = copy(original);
    a.right.wrist.widthPx = widthPx;
    invalid.push(a);
  }
  const outside = copy(original);
  outside.left.ring.x = 2;
  invalid.push(outside);
  const offHand = copy(original);
  offHand.left.ring.x = 512;
  invalid.push(offHand);
  const missing = copy(original);
  delete missing.left.thumb;
  invalid.push(missing);
  const extra = copy(original);
  extra.right.ring.extra = true;
  invalid.push(extra);
  for (const handMask of [
    [],
    [
      [0, 0],
      [1, 1],
    ],
    Array(6).fill([10, 10]),
    [
      [0, 0],
      [1024, 0],
      [20, 20],
      [20, 30],
      [30, 30],
      [30, 40],
    ],
  ])
    invalid.push({ ...original, handMask });
  for (const value of invalid) assert.throws(() => validateHandAnchors(value), status(400));
  const clean = validateHandAnchors(original);
  clean.left.ring.x = 0;
  clean.handMask[0][0] = 0;
  assert.notEqual(original.left.ring.x, 0);
  assert.notEqual(original.handMask[0][0], 0);
});

test("missing, corrupt or mismatched local assets fail safely without substituting an unrelated template", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "forme-hands-")),
    load = createHandsTemplates({ root: dir }),
    valid = await handsTemplate("male", "medium");
  const check = async () =>
    assert.rejects(load("male", "medium"), (error) => {
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /forme-hands|\.png|ENOENT|Unexpected|JSON/);
      return true;
    });
  try {
    await check();
    await writeFile(path.join(dir, "male-medium.png"), valid.png);
    await check();
    await writeFile(path.join(dir, "male-medium.json"), "{bad json");
    await check();
    await writeFile(
      path.join(dir, "male-medium.json"),
      JSON.stringify({ ...valid.anchors, width: 512 }),
    );
    await check();
    await writeFile(path.join(dir, "male-medium.json"), JSON.stringify(valid.anchors));
    await writeFile(
      path.join(dir, "male-medium.png"),
      await sharp(valid.png).resize(512, 512).png().toBuffer(),
    );
    await check();
    await writeFile(path.join(dir, "male-medium.png"), await sharp(valid.png).jpeg().toBuffer());
    await check();
    await writeFile(path.join(dir, "male-medium.png"), valid.png);
    assert.deepEqual((await load("male", "medium")).png, valid.png);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("callers cannot mutate another request’s template bytes or anchors and asset tooling is never invoked by runtime/build", async () => {
  const first = await handsTemplate("male", "light"),
    before = hash(first.png);
  first.png.fill(0);
  first.anchors.left.ring.x = 0;
  first.warnings.push({ code: "local", message: "local" });
  const next = await handsTemplate("male", "light");
  assert.equal(hash(next.png), before);
  assert.notEqual(next.anchors.left.ring.x, 0);
  assert.deepEqual(next.warnings, []);
  const source = await readFile(new URL("../server/hands-templates.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /\bfetch\s*\(|imagegen|gemini|generateContent|writeFile|console\s*\./,
  );
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /make-hand-templates/);
  const docker = await readFile(new URL("../deploy/lightsail/Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /COPY public\/hands \.\/public\/hands/);
  assert.doesNotMatch(docker, /RUN.*make-hand-templates/);
});
