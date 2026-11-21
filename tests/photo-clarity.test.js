import test from "node:test";
import assert from "node:assert/strict";
import { assessPhotoClarity } from "../src/photo-clarity.js";

const WIDTH = 96;
const HEIGHT = 128;

function photo(paint = () => [128, 128, 128], originalWidth = 960, originalHeight = 1280) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const [r, g, b] = paint(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: WIDTH, height: HEIGHT, originalWidth, originalHeight };
}

test("almost uniform black and white images are blocked before billable generation", () => {
  const black = assessPhotoClarity(photo(() => [0, 0, 0]));
  assert.equal(black.status, "blocked");
  assert.deepEqual(
    black.issues.map((issue) => issue.code),
    ["PHOTO_UNREADABLY_DARK"],
  );
  const white = assessPhotoClarity(photo(() => [255, 255, 255]));
  assert.equal(white.status, "blocked");
  assert.deepEqual(
    white.issues.map((issue) => issue.code),
    ["PHOTO_UNREADABLY_BRIGHT"],
  );
});

test("dark but visible pixels and bright backgrounds warn rather than block", () => {
  const shadow = assessPhotoClarity(
    photo((x, y) => (x < WIDTH / 2 ? [20 + y / 7, 20, 30] : [70, 65, 62])),
  );
  assert.notEqual(shadow.status, "blocked");
  assert.equal(
    shadow.warnings.some((item) => item.code === "PHOTO_DARK"),
    true,
  );
  const backdrop = assessPhotoClarity(
    photo((x) => (x < WIDTH / 2 ? [220, 225, 220] : [255, 255, 255])),
  );
  assert.notEqual(backdrop.status, "blocked");
  assert.equal(
    backdrop.warnings.some((item) => item.code === "PHOTO_BRIGHT"),
    true,
  );
});

test("soft, low-contrast and small photos receive warnings without a false hard block", () => {
  const soft = assessPhotoClarity(photo());
  assert.equal(soft.status, "review");
  assert.equal(soft.issues.length, 0);
  assert.ok(soft.warnings.some((item) => item.code === "PHOTO_LOW_DETAIL"));
  assert.ok(soft.warnings.some((item) => item.code === "PHOTO_LOW_CONTRAST"));

  const small = assessPhotoClarity(photo((x, y) => [x * 2, y, (x + y) / 2], 200, 200));
  assert.ok(small.warnings.some((item) => item.code === "PHOTO_SMALL"));
  assert.notEqual(small.status, "blocked");
});

test("textured, well exposed photo does not automatically receive a sharpness warning", () => {
  const clear = assessPhotoClarity(
    photo((x, y) => {
      const value = ((x * 31 + y * 17) % 155) + 50;
      return [value, value, value];
    }),
  );
  assert.equal(clear.status, "clear");
  assert.deepEqual(clear.issues, []);
  assert.deepEqual(clear.warnings, []);
});

test("unsupported and malformed pixels are unverified; no customer pixels or scores are returned", () => {
  assert.equal(assessPhotoClarity().status, "unverified");
  assert.equal(assessPhotoClarity({ ...photo(), data: new Uint8Array(5) }).status, "unverified");
  const result = assessPhotoClarity(photo((x, y) => [x, y, 85]));
  assert.deepEqual(Object.keys(result).sort(), ["issues", "status", "warnings"]);
  assert.equal("data" in result, false);
  assert.equal("sharpness" in result, false);
});
