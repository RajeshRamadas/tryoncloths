import sharp from "sharp";
import path from "node:path";
import { createRequire } from "node:module";
import { ProviderError } from "./provider-errors.js";

const require = createRequire(import.meta.url);
let ready;
let queue = Promise.resolve();

// Models and WASM ship in pinned npm packages. No runtime model downloads,
// face recognition, identity scoring, or additional provider calls are used.
async function detector() {
  if (!ready) ready = (async () => {
    const { default: faceapi } = await import("@vladmandic/face-api/dist/face-api.node-wasm.js");
    const wasm = await import("@tensorflow/tfjs-backend-wasm");
    wasm.setWasmPaths(path.join(path.dirname(require.resolve("@tensorflow/tfjs-backend-wasm/package.json")), "dist/"));
    wasm.setThreadsCount(1);
    await faceapi.tf.setBackend("wasm");
    await faceapi.tf.ready();
    const models = path.join(path.dirname(require.resolve("@vladmandic/face-api/package.json")), "model");
    await faceapi.nets.tinyFaceDetector.loadFromDisk(models);
    await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(models);
    return faceapi;
  })().catch(() => { ready = undefined; throw new ProviderError("face_check"); });
  return ready;
}

function exclusive(work) {
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
}

const average = points => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

export async function detectFaces(bytes, { landmarks = false, upper = false } = {}) {
  return exclusive(async () => {
    const api = await detector();
    const { width, height } = await sharp(bytes).metadata();
    const cropHeight = upper ? Math.max(1, Math.round(height * 0.55)) : height;
    const { data, info } = await sharp(bytes, { limitInputPixels: 25_000_000 })
      .extract({ left: 0, top: 0, width, height: cropHeight })
      .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).toColourspace("srgb").removeAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const tensor = api.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);
    try {
      const task = api.detectAllFaces(tensor, new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }));
      const results = await (landmarks ? task.withFaceLandmarks(true) : task);
      const sx = width / info.width, sy = cropHeight / info.height;
      return results.map(result => {
        const detection = landmarks ? result.detection : result;
        const box = detection.box;
        const face = { score: detection.score, box: { x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy } };
        if (landmarks) {
          const left = average(result.landmarks.getLeftEye());
          const right = average(result.landmarks.getRightEye());
          face.eyes = { left: { x: left.x * sx, y: left.y * sy }, right: { x: right.x * sx, y: right.y * sy } };
        }
        return face;
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("face_check");
    } finally {
      tensor.dispose();
    }
  });
}

export async function customerFace(bytes) {
  const faces = await detectFaces(bytes, { landmarks: true });
  if (faces.length !== 1) throw new ProviderError("face_input");
  const face = faces[0];
  const dx = face.eyes.right.x - face.eyes.left.x;
  const dy = face.eyes.right.y - face.eyes.left.y;
  if (face.box.width < 48 || Math.hypot(dx, dy) < 16 || Math.abs(Math.atan2(dy, dx)) > Math.PI / 5)
    throw new ProviderError("face_input");
  return face;
}

export async function requireVisibleFace(bytes) {
  let faces = await detectFaces(bytes);
  // A full-body portrait may make a face too small for the first local pass.
  if (!faces.length) faces = await detectFaces(bytes, { upper: true });
  if (faces.length !== 1) throw new ProviderError("missing_face");
}
