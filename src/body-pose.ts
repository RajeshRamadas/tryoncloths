// On-device pose landmarks for the full-body photo check. The MediaPipe runtime (~15 MB)
// and the pose model (~6 MB) load only when a full-body photo is added, and are cached by
// the browser afterwards. The photo is never uploaded for this check.
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { assessBodyPose } from "./body-pose-check";
import { loadImage } from "./images";

export type PoseHint = { code: string; message: string };

let landmarker: Promise<PoseLandmarker> | null = null;
function poseLandmarker() {
  landmarker ??= (async () => {
    const { PoseLandmarker } = await import("@mediapipe/tasks-vision");
    return PoseLandmarker.createFromOptions(
      { wasmLoaderPath, wasmBinaryPath },
      {
        baseOptions: {
          modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`,
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        numPoses: 2,
      },
    );
  })();
  // A failed download must not disable the check for the rest of the session.
  landmarker.catch(() => (landmarker = null));
  return landmarker;
}

/** Hints for a full-body photo (empty when it looks right), or null if the check could not run. */
export async function checkBodyPhoto(photo: string): Promise<PoseHint[] | null> {
  try {
    const [model, image] = await Promise.all([poseLandmarker(), loadImage(photo)]);
    const result = model.detect(image);
    return assessBodyPose(result.landmarks, image.naturalWidth, image.naturalHeight);
  } catch {
    return null;
  }
}
