import test from "node:test";
import assert from "node:assert/strict";
import { profiles, recommendProfile } from "../src/profiles.js";

test("suggests sample profiles from valid height and weight", () => {
  assert.equal(recommendProfile(175, 55), "slim");
  assert.equal(recommendProfile(175, 72), "regular");
  assert.equal(recommendProfile(175, 95), "broad");
});
test("invalid or unsupported measurements cannot silently produce a match", () => {
  for (const [height, weight] of [
    [0, 72],
    [NaN, 72],
    [175, Infinity],
    [139, 60],
    [211, 80],
    [175, 34],
    [175, 201],
  ])
    assert.equal(recommendProfile(height, weight), null);
});
test("athletic profile requires human selection; numeric inputs do not infer muscle", () => {
  assert.ok(profiles.some((p) => p.id === "athletic"));
  for (let weight = 35; weight <= 200; weight++)
    assert.notEqual(recommendProfile(175, weight), "athletic");
});
