// On-device pose landmarks for the full-body photo check and the outfit arm masks. The
// MediaPipe runtime (~13.5 MB) and the pose model (~6 MB) load only when first needed, and
// are cached by the browser afterwards. No image is uploaded for either use.
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { assessBodyPose } from "./body-pose-check";
import { measureBodyCm, measureBuild } from "./body-build";
import { loadImage } from "./images";

export type PoseHint = { code: string; message: string };
export type Landmark = { x: number; y: number; visibility?: number };

const landmarkers = new Map<boolean, Promise<PoseLandmarker>>();
function poseLandmarker(segment: boolean) {
  let landmarker = landmarkers.get(segment);
  if (!landmarker) {
    landmarker = (async () => {
      const { PoseLandmarker } = await import("@mediapipe/tasks-vision");
      return PoseLandmarker.createFromOptions(
        { wasmLoaderPath, wasmBinaryPath },
        {
          baseOptions: {
            modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`,
            delegate: "CPU",
          },
          runningMode: "IMAGE",
          numPoses: segment ? 1 : 2,
          outputSegmentationMasks: segment,
        },
      );
    })();
    landmarkers.set(segment, landmarker);
    // A failed download must not disable pose features for the rest of the session.
    landmarker.catch(() => landmarkers.delete(segment));
  }
  return landmarker;
}

/** Hints for a full-body photo (empty when it looks right), or null if the check could not run. */
export async function checkBodyPhoto(photo: string): Promise<PoseHint[] | null> {
  try {
    const [model, image] = await Promise.all([poseLandmarker(false), loadImage(photo)]);
    const result = model.detect(image);
    return assessBodyPose(result.landmarks, image.naturalWidth, image.naturalHeight);
  } catch {
    return null;
  }
}

export type PoseSegmentation = {
  landmarks: Landmark[];
  /** Person confidence 0–255 at the image's own size, row by row. */
  person: Uint8Array;
  width: number;
  height: number;
};

/** Landmarks and person outline of one image, or null when no person is found. */
export async function segmentPose(image: HTMLImageElement): Promise<PoseSegmentation | null> {
  const model = await poseLandmarker(true);
  const result = model.detect(image);
  try {
    const mask = result.segmentationMasks?.[0];
    if (!result.landmarks.length || !mask) return null;
    const confidence = mask.getAsFloat32Array();
    const person = new Uint8Array(confidence.length);
    for (let i = 0; i < confidence.length; i++) person[i] = Math.round(confidence[i] * 255);
    return {
      landmarks: result.landmarks[0],
      person,
      width: mask.width,
      height: mask.height,
    };
  } finally {
    result.close();
  }
}

export type BodyBuild = { shoulders: number; waist: number; hips: number };
export type BodyGirths = { chestCm: number; waistCm: number; hipCm: number };
export type BodyPhotoAnalysis = {
  build: BodyBuild | null;
  /** Girths for a given height, or null when the photo cannot be measured. */
  girths: (heightCm: number, body: "male" | "female") => BodyGirths | null;
};

/** Build proportions and girth estimates from a full-body photo, measured on the device. */
export async function analyseBodyPhoto(photo: string): Promise<BodyPhotoAnalysis> {
  try {
    const pose = await segmentPose(await loadImage(photo));
    if (!pose) return { build: null, girths: () => null };
    const { landmarks, person, width, height } = pose;
    return {
      build: measureBuild(landmarks, person, width, height),
      girths: (heightCm, body) => measureBodyCm(landmarks, person, width, height, heightCm, body),
    };
  } catch {
    return { build: null, girths: () => null };
  }
}

/** Shoulder, waist and hip proportions from a full-body photo, or null if not measurable. */
export async function measureBodyBuild(photo: string): Promise<BodyBuild | null> {
  return (await analyseBodyPhoto(photo)).build;
}
