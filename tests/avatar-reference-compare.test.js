import test from "node:test";
import assert from "node:assert/strict";
import {
  availableAvatarReferences,
  isSessionReferencePhoto,
} from "../src/avatar-reference-compare.js";

const face = "data:image/jpeg;base64,Y3VzdG9tZXI=";
const body = "data:image/png;base64,Ym9keQ==";

test("recognizes only session-local JPEG, PNG and WebP reference data URLs", () => {
  assert.equal(isSessionReferencePhoto(face), true);
  assert.equal(isSessionReferencePhoto(body), true);
  assert.equal(isSessionReferencePhoto("data:image/webp;base64,YWJj"), true);
  assert.equal(isSessionReferencePhoto("data:image/svg+xml;base64,YWJj"), false);
  assert.equal(isSessionReferencePhoto("https://example.com/customer.jpeg"), false);
  assert.equal(isSessionReferencePhoto("data:image/jpeg;base64,YWJj<script>"), false);
  assert.equal(isSessionReferencePhoto("data:image/jpeg;base64,"), false);
  assert.equal(isSessionReferencePhoto(null), false);
});

test("reference availability never returns or persists the source image data", () => {
  const summary = availableAvatarReferences({ facePhoto: face, bodyPhoto: body });
  assert.deepEqual(summary, { face: true, body: true });
  assert.equal(JSON.stringify(summary).includes(face), false);
  assert.equal(JSON.stringify(summary).includes(body), false);
});

test("reopened or imported avatars report missing references rather than a false match", () => {
  assert.deepEqual(availableAvatarReferences(), { face: false, body: false });
  assert.deepEqual(availableAvatarReferences({ facePhoto: face }), {
    face: true,
    body: false,
  });
  assert.deepEqual(
    availableAvatarReferences({
      facePhoto: "https://example.org/face.jpg",
      bodyPhoto: body,
    }),
    { face: false, body: true },
  );
});

test("overly large and non-string inputs are never displayed as session references", () => {
  const tooLarge = "data:image/png;base64," + "a".repeat(20_000_001);
  assert.equal(isSessionReferencePhoto(tooLarge), false);
  assert.equal(isSessionReferencePhoto({ src: face }), false);
});
