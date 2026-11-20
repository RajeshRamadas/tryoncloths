import test from "node:test";
import assert from "node:assert/strict";
import { BUILD_REFERENCES } from "../src/body-build.js";
import { assessAvatarGeometry, BUILD_DRIFT_LIMIT } from "../src/avatar-geometry-audit.js";

const frame = (profileId) => BUILD_REFERENCES.find((x) => x.profileId === profileId);

test("a complete normal pose and reference silhouette return a clear advisory", () => {
  for (const profile of BUILD_REFERENCES) {
    assert.deepEqual(
      assessAvatarGeometry({ profileId: profile.profileId, build: profile, poseHints: [] }),
      { status: "clear", findings: [] },
    );
  }
});

test("shoulder, waist and hip drift is reported separately, without exact measurements", () => {
  const reference = frame("regular");
  const result = assessAvatarGeometry({
    profileId: "regular",
    build: {
      shoulders: reference.shoulders * (1 + BUILD_DRIFT_LIMIT + 0.02),
      waist: reference.waist * (1 - BUILD_DRIFT_LIMIT - 0.02),
      hips: reference.hips * (1 + BUILD_DRIFT_LIMIT + 0.02),
    },
    poseHints: [],
  });
  assert.equal(result.status, "review");
  assert.deepEqual(
    result.findings.map((finding) => finding.code),
    ["shoulders-drift", "waist-drift", "hips-drift"],
  );
  assert.ok(!JSON.stringify(result).includes("0.734"));
});

test("possible cropped feet or head and turned pose always prompt explicit review", () => {
  const result = assessAvatarGeometry({
    profileId: "f-regular",
    build: frame("f-regular"),
    poseHints: [
      { code: "feet-cropped", message: "input camera hint text must not be repeated" },
      { code: "head-cropped" },
      { code: "turned" },
    ],
  });
  assert.equal(result.status, "review");
  assert.deepEqual(
    result.findings.map((finding) => finding.code),
    ["feet-cropped", "head-cropped", "turned"],
  );
  assert.ok(!JSON.stringify(result).includes("camera hint text"));
});

test("unavailable analysis and unknown profiles never claim a clear result", () => {
  assert.deepEqual(assessAvatarGeometry({ profileId: "regular" }), {
    status: "unverified",
    findings: [
      {
        code: "pose-unavailable",
        message: "Local image analysis is unavailable. Review the complete body manually.",
      },
    ],
  });
  const missingBuild = assessAvatarGeometry({
    profileId: "regular",
    build: null,
    poseHints: [],
  });
  assert.equal(missingBuild.status, "review");
  assert.equal(missingBuild.findings[0].code, "silhouette-unavailable");
  const unknown = assessAvatarGeometry({
    profileId: "unknown",
    build: frame("regular"),
    poseHints: [],
  });
  assert.equal(unknown.status, "review");
  assert.equal(unknown.findings[0].code, "profile-unavailable");
});

test("malformed body dimensions and unknown pose hint text do not create false success", () => {
  const result = assessAvatarGeometry({
    profileId: "regular",
    build: { shoulders: Infinity, waist: NaN, hips: -1 },
    poseHints: [{ code: "arbitrary", message: "untrusted content" }],
  });
  assert.equal(result.status, "review");
  assert.deepEqual(
    result.findings.map((f) => f.code),
    ["silhouette-unavailable"],
  );
  assert.ok(!JSON.stringify(result).includes("untrusted content"));
});
