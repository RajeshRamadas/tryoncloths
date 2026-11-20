import test from "node:test";
import assert from "node:assert/strict";
import { assessAvatarReadiness } from "../src/avatar-readiness.js";

const photo = "data:image/png;base64,aGVsbG8=";
const valid = {
  consent: true,
  facePhoto: photo,
  bodyPhoto: photo,
  profileId: "regular",
  templateTone: "medium",
  heightCm: 175,
  bodyAnalysis: { status: "valid" },
  additionalView: true,
};

test("complete input is ready without warnings", () => {
  assert.deepEqual(assessAvatarReadiness(valid), {
    ready: true,
    issues: [],
    warnings: [],
    quality: "ready",
  });
});

test("missing consent and photos block generation", () => {
  const result = assessAvatarReadiness();
  assert.equal(result.ready, false);
  assert.equal(result.quality, "blocked");
  assert.ok(result.issues.some((i) => i.code === "CONSENT_REQUIRED"));
  assert.ok(result.issues.some((i) => i.code === "FACE_PHOTO_REQUIRED"));
  assert.ok(result.issues.some((i) => i.code === "BODY_PHOTO_REQUIRED"));
});

test("unverified body geometry prompts review, not fabricated precision", () => {
  const result = assessAvatarReadiness({
    ...valid,
    heightCm: null,
    bodyAnalysis: null,
    additionalView: false,
  });
  assert.equal(result.ready, true);
  assert.equal(result.quality, "review");
  assert.deepEqual(
    result.warnings.map((w) => w.code),
    ["HEIGHT_UNVERIFIED", "BODY_POSE_UNVERIFIED", "DEPTH_UNVERIFIED"],
  );
});

test("rejects unsupported image formats and invalid height", () => {
  const result = assessAvatarReadiness({
    ...valid,
    facePhoto: "data:image/svg+xml;base64,abc",
    heightCm: Number.NaN,
  });
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((i) => i.code === "FACE_PHOTO_REQUIRED"));
  assert.ok(result.issues.some((i) => i.code === "HEIGHT_INVALID"));
});

test("does not expose customer image data in assessment", () => {
  const result = assessAvatarReadiness(valid);
  assert.ok(!JSON.stringify(result).includes(photo));
});
