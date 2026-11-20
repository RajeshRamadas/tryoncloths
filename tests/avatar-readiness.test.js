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

test("severe exposure issues block before any paid avatar generation", () => {
  const result = assessAvatarReadiness({
    ...valid,
    faceClarity: {
      status: "blocked",
      issues: [
        {
          code: "PHOTO_UNREADABLY_DARK",
          message: "Retake the almost-black face photo.",
        },
      ],
      warnings: [],
    },
  });
  assert.equal(result.ready, false);
  assert.equal(result.quality, "blocked");
  assert.deepEqual(
    result.issues.map((item) => item.code),
    ["FACE_PHOTO_UNREADABLY_DARK"],
  );
  assert.equal(JSON.stringify(result).includes(photo), false);
});

test("possible blur, shadows and unavailable analysis are advisory and do not block", () => {
  const result = assessAvatarReadiness({
    ...valid,
    faceClarity: {
      status: "review",
      issues: [],
      warnings: [{ code: "PHOTO_LOW_DETAIL", message: "Check that the face is sharp." }],
    },
    bodyClarity: {
      status: "unverified",
      issues: [],
      warnings: [
        {
          code: "PHOTO_ANALYSIS_UNAVAILABLE",
          message: "Full-body analysis unavailable.",
        },
      ],
    },
  });
  assert.equal(result.ready, true);
  assert.equal(result.quality, "review");
  assert.deepEqual(
    result.warnings.map((item) => item.code),
    ["FACE_PHOTO_LOW_DETAIL", "BODY_PHOTO_ANALYSIS_UNAVAILABLE"],
  );
});
