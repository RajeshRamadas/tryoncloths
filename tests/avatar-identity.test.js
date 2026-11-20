import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { avatarFaceCrop, screenAvatarIdentity } from "../server/avatar-identity.js";
import { ProviderError } from "../server/provider-errors.js";

const reference = await sharp({
  create: { width: 300, height: 300, channels: 3, background: "#cda48e" },
})
  .jpeg()
  .toBuffer();
const avatar = await sharp({
  create: { width: 400, height: 800, channels: 3, background: "#bbbbbb" },
})
  .png()
  .toBuffer();
const image = "data:image/png;base64," + avatar.toString("base64");
const locate = async (_png, options) => {
  assert.deepEqual(options, { upper: true });
  return [{ box: { x: 150, y: 65, width: 85, height: 110 } }];
};

test("face crop keeps a bounded, face-centered region", () => {
  assert.deepEqual(
    avatarFaceCrop({ x: 150, y: 65, width: 85, height: 110 }, { width: 400, height: 800 }),
    { left: 94, top: 4, width: 197, height: 243 },
  );
  assert.deepEqual(
    avatarFaceCrop({ x: 1, y: 0, width: 80, height: 85 }, { width: 400, height: 800 }),
    { left: 0, top: 0, width: 133, height: 141 },
  );
  assert.throws(
    () => avatarFaceCrop({ x: 0, y: 0, width: 10, height: 10 }, { width: 400, height: 800 }),
    (error) => error.code === "missing_face",
  );
});

test("comparison sees only temporary PNG face crops and clears them after use", async () => {
  let prepared;
  const accepted = await screenAvatarIdentity({
    face: reference,
    image,
    locate,
    compare: async (source, output, max) => {
      prepared = [source, output];
      assert.equal(max, 0.45);
      const inputInfo = await sharp(source).metadata();
      const cropInfo = await sharp(output).metadata();
      assert.equal(inputInfo.format, "png");
      assert.equal(inputInfo.width, 300);
      assert.equal(cropInfo.format, "png");
      assert.equal(cropInfo.width, 197);
      assert.equal(cropInfo.height, 243);
      return 0.29;
    },
  });
  assert.equal(accepted, true);
  assert.equal(prepared[0].every((byte) => byte === 0), true);
  assert.equal(prepared[1].every((byte) => byte === 0), true);
});

test("rejects missing or multiple generated faces without comparing descriptors", async () => {
  for (const boxes of [[], [{ box: { x: 100, y: 20, width: 70, height: 80 } }, { box: { x: 200, y: 20, width: 70, height: 80 } }]]) {
    await assert.rejects(
      screenAvatarIdentity({
        face: reference,
        image,
        locate: async () => boxes,
        compare: async () => {
          assert.fail("No identity comparison expected");
        },
      }),
      (error) => error.code === "missing_face",
    );
  }
});

test("rejects mismatches and never silently accepts a non-finite score", async () => {
  await assert.rejects(
    screenAvatarIdentity({
      face: reference,
      image,
      locate,
      compare: async () => {
        throw new ProviderError("identity_mismatch");
      },
    }),
    (error) => error.code === "identity_mismatch",
  );
  await assert.rejects(
    screenAvatarIdentity({ face: reference, image, locate, compare: async () => NaN }),
    (error) => error.code === "face_check",
  );
  await assert.rejects(
    screenAvatarIdentity({
      face: reference,
      image,
      locate,
      compare: async () => 0.9,
      maxDistance: 0.45,
    }),
    (error) => error.code === "face_check",
  );
});

test("bad inputs and disabled or invalid models fail without an extra paid call", async () => {
  await assert.rejects(
    screenAvatarIdentity({ face: reference, image: "data:image/jpeg;base64,AA==" }),
    (error) => error.code === "invalid_image",
  );
  await assert.rejects(
    screenAvatarIdentity({ face: null, image }),
    (error) => error.code === "face_input",
  );
  await assert.rejects(
    screenAvatarIdentity({ face: reference, image, maxDistance: 4 }),
    (error) => error.code === "face_check",
  );
});
