import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { webpOrientation, preparePhoto } from "../src/photo-orientation.js";

test("WebP metadata correction is bounded and neutralizes orientation before browser decoding", async () => {
  const image = await sharp("public/avatar-library.png").resize(384).withMetadata({ orientation: 8 }).webp().toBuffer();
  const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(webpOrientation(arrayBuffer(image)).orientation, 8);
  for (let length = 0; length < image.length; length += 19) {
    assert.doesNotThrow(() => webpOrientation(arrayBuffer(image.subarray(0, length))));
  }
  assert.equal(webpOrientation(new ArrayBuffer(0)), null);
  const prepared = await preparePhoto(new File([image], "rotated.webp", { type: "image/webp" }));
  assert.equal(prepared.orientation, 8);
  assert.equal(webpOrientation(await prepared.source.arrayBuffer()).orientation, 1);
  const invalid = Buffer.from(image);
  const tag = webpOrientation(arrayBuffer(invalid));
  invalid.writeUInt16LE(999, tag.offset);
  assert.equal(webpOrientation(arrayBuffer(invalid)), null);
});
