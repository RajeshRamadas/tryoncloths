import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  createIdentityChecker,
  descriptor,
  requireSameIdentity,
} from "../server/identity-check.js";
import { withFaceApi, requireVisibleFace } from "../server/face-check.js";
import { ProviderError, providerErrorDetails } from "../server/provider-errors.js";
import { standardAvatar } from "../server/app.js";

const vector = (distance) => {
  const result = new Float32Array(128);
  result[0] = distance;
  return result;
};
const empty = (value) => assert.ok(value.every((n) => n === 0));
const code = (expected) => (error) => error instanceof ProviderError && error.code === expected;

test("identity comparison uses all 128 coordinates, accepts the threshold and returns only a rounded distance", async () => {
  const a = vector(0),
    b = vector(0);
  b[127] = 0.5;
  const seen = [],
    check = createIdentityChecker({
      describe: async (input) => {
        seen.push(input);
        return input === "reference" ? a : b;
      },
    });
  const value = await check("reference", "candidate", 0.5);
  assert.equal(value, 0.5);
  assert.equal(typeof value, "number");
  assert.deepEqual(seen, ["reference", "candidate"]);
  empty(a);
  empty(b);
  const rounded = createIdentityChecker({ describe: async (input) => vector(input) });
  assert.equal(await rounded(0, 0.444), 0.44);
  const identical = createIdentityChecker({ describe: async () => vector(0.4) });
  assert.equal(await identical("a", "b"), 0);
});

test("a mismatch is rejected before rounding and both descriptors are cleared without entering errors or logs", async () => {
  const a = vector(0),
    b = vector(0.454);
  const check = createIdentityChecker({ describe: async (input) => (input === 1 ? a : b) });
  await assert.rejects(check(1, 2, 0.45), (error) => {
    assert.equal(error.code, "identity_mismatch");
    assert.equal(error.message, "The result changed the customer's face and was rejected.");
    assert.deepEqual(Object.keys(error).sort(), ["code", "providerStatus"]);
    assert.equal(error.providerStatus, null);
    for (const provider of ["gemini", "openai"])
      assert.deepEqual(providerErrorDetails(error, provider), {
        code: "identity_mismatch",
        message: error.message,
        providerStatus: null,
      });
    return true;
  });
  empty(a);
  empty(b);
});

test("default threshold is read from the environment at check time; invalid configuration fails before image work", async () => {
  const previous = process.env.TRYON_IDENTITY_MAX;
  let calls = 0;
  const check = createIdentityChecker({
    describe: async (input) => {
      calls++;
      return vector(input);
    },
  });
  try {
    delete process.env.TRYON_IDENTITY_MAX;
    await assert.rejects(check(0, 0.5), code("identity_mismatch"));
    process.env.TRYON_IDENTITY_MAX = "0.6";
    assert.equal(await check(0, 0.5), 0.5);
    for (const max of [0, -0.5, NaN, Infinity, 1.01, "0.45", null]) {
      const before = calls;
      await assert.rejects(check(0, 0.5, max), code("face_check"));
      assert.equal(calls, before);
    }
    process.env.TRYON_IDENTITY_MAX = "not-a-number";
    const before = calls;
    await assert.rejects(check(0, 0.5), code("face_check"));
    assert.equal(calls, before);
  } finally {
    if (previous === undefined) delete process.env.TRYON_IDENTITY_MAX;
    else process.env.TRYON_IDENTITY_MAX = previous;
  }
});

test("failed and malformed descriptors fail closed, are sanitized and cleared, and never trigger retries", async () => {
  for (const failAt of [1, 2])
    for (const failure of [
      new ProviderError("missing_face"),
      new Error("PRIVATE IMAGE AND MODEL DETAILS"),
    ]) {
      let calls = 0;
      const a = vector(0.3),
        check = createIdentityChecker({
          describe: async () => {
            if (++calls === failAt) throw failure;
            return a;
          },
        });
      await assert.rejects(check("a", "b"), (error) => {
        assert.equal(error.code, failure instanceof ProviderError ? "missing_face" : "face_check");
        assert.doesNotMatch(JSON.stringify(error), /PRIVATE|MODEL DETAILS|descriptor/);
        return true;
      });
      assert.equal(calls, failAt);
      if (failAt === 2) empty(a);
    }
  for (const invalid of [
    null,
    Array(128).fill(0),
    new Float32Array(127),
    vector(NaN),
    vector(Infinity),
  ]) {
    let calls = 0;
    const check = createIdentityChecker({
      describe: async () => {
        calls++;
        return invalid;
      },
    });
    await assert.rejects(check("a", "b"), code("face_check"));
    assert.equal(calls, 1);
    if (invalid instanceof Float32Array) empty(invalid);
  }
  const a = vector(0.2),
    b = vector(NaN);
  let calls = 0;
  await assert.rejects(
    createIdentityChecker({ describe: async () => (++calls === 1 ? a : b) })("a", "b"),
    code("face_check"),
  );
  empty(a);
  empty(b);
});

test("identity processing contains no logging, persistence, network calls or public descriptor route", async () => {
  const source = await readFile(new URL("../server/identity-check.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /console\s*\.|\b(?:writeFile|appendFile|createWriteStream|fetch|logger|logEvent)\s*\(|\bdb\s*\.|\.(?:json|send|write)\s*\(/,
  );
  for (const name of ["app.js", "accounts.js", "garment-routes.js"])
    assert.doesNotMatch(
      await readFile(new URL("../server/" + name, import.meta.url), "utf8"),
      /from\s+['"].*identity-check|\bdescriptor\s*\(/,
    );
});

test("real local models load once on demand, compare resized faces, reject different or absent faces, and release tensors", async () => {
  const api = await withFaceApi((api) => api);
  assert.equal(
    api.nets.faceRecognitionNet.isLoaded,
    false,
    "importing the helper and ordinary presence initialization must not load recognition",
  );
  assert.equal(api.nets.faceLandmark68Net.isLoaded, false);
  const loads = { landmarks: 0, recognition: 0 },
    landmarkLoad = api.nets.faceLandmark68Net.loadFromDisk,
    recognitionLoad = api.nets.faceRecognitionNet.loadFromDisk;
  let unavailable = true,
    recognitionUnavailable = true;
  api.nets.faceLandmark68Net.loadFromDisk = async function (...args) {
    if (unavailable) {
      unavailable = false;
      throw new Error("PRIVATE MODEL PATH");
    }
    loads.landmarks++;
    return landmarkLoad.apply(this, args);
  };
  api.nets.faceRecognitionNet.loadFromDisk = async function (...args) {
    if (recognitionUnavailable) {
      recognitionUnavailable = false;
      throw new Error("PRIVATE RECOGNITION PATH");
    }
    loads.recognition++;
    return recognitionLoad.apply(this, args);
  };
  const male = await standardAvatar("regular"),
    female = await standardAvatar("f-regular"),
    resized = await sharp(male).resize({ width: 420 }).png().toBuffer();
  try {
    await assert.rejects(descriptor(male), (error) => {
      assert.equal(error.code, "face_check");
      assert.doesNotMatch(error.message, /PRIVATE MODEL PATH/);
      return true;
    });
    await assert.rejects(descriptor(male), (error) => {
      assert.equal(error.code, "face_check");
      assert.doesNotMatch(error.message, /PRIVATE RECOGNITION PATH/);
      return true;
    });
    await requireVisibleFace(male); // A failed optional model load cannot break presence checks.
    const results = await Promise.all([
      requireSameIdentity(male, resized),
      requireVisibleFace(male),
      descriptor(male),
    ]);
    assert.ok(results[0] <= 0.45);
    assert.ok(results[2] instanceof Float32Array);
    assert.equal(results[2].length, 128);
    assert.ok(results[2].every(Number.isFinite));
    results[2].fill(0);
    assert.deepEqual(loads, { landmarks: 1, recognition: 1 });
    const baseline = api.tf.memory().numTensors;
    await assert.rejects(requireSameIdentity(male, female), code("identity_mismatch"));
    const independent = await sharp(
      await readFile(new URL("fixtures/customers/red-plaid-face.jpg", import.meta.url)),
    )
      .png()
      .toBuffer();
    await assert.rejects(requireSameIdentity(male, independent), code("identity_mismatch"));
    const blank = await sharp({
      create: { width: 600, height: 600, channels: 3, background: "#ddd" },
    })
      .png()
      .toBuffer();
    await assert.rejects(descriptor(blank), code("missing_face"));
    const head = await sharp(male)
      .extract({ left: 0, top: 0, width: 384, height: 320 })
      .resize(300, 300, { fit: "contain", background: "#fff" })
      .png()
      .toBuffer();
    const multiple = await sharp({
      create: { width: 600, height: 300, channels: 3, background: "#fff" },
    })
      .composite([
        { input: head, left: 0, top: 0 },
        { input: head, left: 300, top: 0 },
      ])
      .png()
      .toBuffer();
    await assert.rejects(descriptor(multiple), code("missing_face"));
    for (const invalid of [
      Buffer.from("invalid"),
      Buffer.alloc(0),
      "not a buffer",
      await sharp(male).jpeg().toBuffer(),
    ])
      await assert.rejects(descriptor(invalid), code("missing_face"));
    for (let i = 0; i < 3; i++) assert.equal(await requireSameIdentity(male, male), 0);
    for (const [net, method] of [
      ["tinyFaceDetector", "locateFaces"],
      ["faceLandmark68Net", "detectLandmarks"],
      ["faceRecognitionNet", "computeFaceDescriptor"],
    ]) {
      const original = api.nets[net][method];
      try {
        api.nets[net][method] = async () => {
          throw new Error("PRIVATE INFERENCE DETAILS");
        };
        await assert.rejects(descriptor(male), (error) => {
          assert.equal(error.code, "face_check");
          assert.doesNotMatch(error.message, /PRIVATE INFERENCE DETAILS/);
          return true;
        });
      } finally {
        api.nets[net][method] = original;
      }
      assert.equal(
        api.tf.memory().numTensors,
        baseline,
        "failed " + net + " inference must release every image crop",
      );
    }
    assert.equal(
      api.tf.memory().numTensors,
      baseline,
      "no per-image tensors may accumulate after checks",
    );
    assert.deepEqual(loads, { landmarks: 1, recognition: 1 });
    await requireVisibleFace(male);
    assert.equal(
      api.tf.memory().numTensors,
      baseline,
      "ordinary face checks still share the same backend safely",
    );
  } finally {
    api.nets.faceLandmark68Net.loadFromDisk = landmarkLoad;
    api.nets.faceRecognitionNet.loadFromDisk = recognitionLoad;
  }
});
