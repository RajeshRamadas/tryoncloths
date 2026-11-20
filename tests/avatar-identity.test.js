import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ProviderError } from "../server/provider-errors.js";
import {
  avatarFaceCrop,
  parseAvatarIdentityMode,
  parseAvatarIdentityMax,
  screenAvatarIdentity,
} from "../server/avatar-identity.js";

const source = await sharp({
  create: { width: 420, height: 520, channels: 3, background: "#cccccc" },
})
  .jpeg()
  .toBuffer();
const result = await sharp({
  create: { width: 800, height: 1200, channels: 3, background: "#dddddd" },
})
  .png()
  .toBuffer();
const image = `data:image/png;base64,${result.toString("base64")}`;

function oneFace(_bytes, { upper = false } = {}) {
  return [
    {
      box: upper
        ? { x: 360, y: 100, width: 80, height: 90 }
        : { x: 150, y: 100, width: 120, height: 130 },
    },
  ];
}

test("identity screen defaults off without reading images or running a face model", async () => {
  let called = false;
  const result = await screenAvatarIdentity({
    mode: "off",
    detect: () => {
      called = true;
    },
    compare: () => {
      called = true;
    },
  });
  assert.deepEqual(result, { status: "not_checked" });
  assert.equal(called, false);
});

test("invalid identity mode is rejected instead of silently disabling checks", async () => {
  for (const mode of ["enforcee", "", "OFF", null, false]) {
    assert.throws(() => parseAvatarIdentityMode(mode), /TRYON_AVATAR_IDENTITY_MODE/);
    await assert.rejects(screenAvatarIdentity({ mode }), /TRYON_AVATAR_IDENTITY_MODE/);
  }
  for (const mode of ["off", "review", "enforce"]) {
    assert.equal(parseAvatarIdentityMode(mode), mode);
  }
});

test("distance calibration is separate and rejects invalid settings", async () => {
  assert.equal(parseAvatarIdentityMax(0.45), 0.45);
  assert.equal(parseAvatarIdentityMax("0.53"), 0.53);
  for (const value of ["", null, -1, "NaN", 2]) {
    assert.throws(() => parseAvatarIdentityMax(value), /TRYON_AVATAR_IDENTITY_MAX/);
  }
});

test("full-body face is cropped and upscaled for private comparison; temporary images are cleared", async () => {
  const checked = [];
  const detections = [];
  const assessment = await screenAvatarIdentity({
    reference: source,
    output: image,
    mode: "review",
    detect: async (bytes, options) => {
      detections.push({ image: (await sharp(bytes).metadata()).format, upper: options.upper });
      return oneFace(bytes, options);
    },
    compare: async (a, b, max) => {
      assert.equal(max, 0.45);
      checked.push(a, b);
      for (const crop of [a, b]) {
        const metadata = await sharp(crop).metadata();
        assert.deepEqual([metadata.format, metadata.width, metadata.height], ["png", 512, 512]);
      }
      return 0.21;
    },
  });
  assert.deepEqual(assessment, { status: "screen_pass" });
  assert.deepEqual(detections, [
    { image: "jpeg", upper: false },
    { image: "png", upper: true },
  ]);
  assert.equal(checked.length, 2);
  assert.ok(checked.every((bytes) => bytes.every((value) => value === 0)));
  assert.ok(source.some((value) => value !== 0));
  assert.ok(result.some((value) => value !== 0));
  assert.equal(JSON.stringify(assessment).includes("0.21"), false);
});

test("a possible mismatch becomes advisory in review mode but blocks in enforce mode", async () => {
  const check = () => {
    throw new ProviderError("identity_mismatch");
  };
  const review = await screenAvatarIdentity({
    reference: source,
    output: image,
    mode: "review",
    detect: oneFace,
    compare: check,
  });
  assert.deepEqual(review, { status: "needs_review", reason: "possible_mismatch" });
  await assert.rejects(
    screenAvatarIdentity({
      reference: source,
      output: image,
      mode: "enforce",
      detect: oneFace,
      compare: check,
    }),
    (error) => error instanceof ProviderError && error.code === "identity_mismatch",
  );
});

test("missing or ambiguous generated faces cannot be called a match", async () => {
  let compared = false;
  const detect = (_bytes, { upper }) => (upper ? [] : oneFace(null));
  const screen = async (mode) =>
    screenAvatarIdentity({
      reference: source,
      output: image,
      mode,
      detect,
      compare: () => {
        compared = true;
      },
    });
  assert.deepEqual(await screen("review"), {
    status: "needs_review",
    reason: "check_unavailable",
  });
  await assert.rejects(screen("enforce"), (error) => error.code === "missing_face");
  assert.equal(compared, false);
});

test("unusable images and model errors fail safely without disclosing input bytes", async () => {
  for (const output of ["invalid", "data:image/png;base64,%%%"]) {
    const assessment = await screenAvatarIdentity({
      reference: source,
      output,
      mode: "review",
      detect: oneFace,
    });
    assert.deepEqual(assessment, { status: "needs_review", reason: "check_unavailable" });
  }
  const assessment = await screenAvatarIdentity({
    reference: source,
    output: image,
    mode: "review",
    detect: oneFace,
    compare: () => {
      throw new Error("SENSITIVE MODEL INTERNALS");
    },
  });
  assert.deepEqual(assessment, { status: "needs_review", reason: "check_unavailable" });
  assert.doesNotMatch(JSON.stringify(assessment), /SENSITIVE|base64|descriptor/);
});

test("invalid geometry is not sent to recognition", async () => {
  const invalid = [{ box: { x: -3, y: 4, width: 100, height: 100 } }];
  await assert.rejects(
    avatarFaceCrop(result, { detect: () => invalid }),
    (error) => error instanceof ProviderError && error.code === "face_check",
  );
});
