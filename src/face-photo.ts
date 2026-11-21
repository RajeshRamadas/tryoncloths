import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { loadImage } from "./images";

let detector: Promise<FaceDetector> | undefined;

function faceDetector() {
  if (!detector) {
    detector = import("@mediapipe/tasks-vision").then(({ FaceDetector }) =>
      FaceDetector.createFromOptions(
        { wasmLoaderPath, wasmBinaryPath },
        {
          baseOptions: {
            modelAssetPath: `${import.meta.env.BASE_URL}models/blaze_face_short_range.tflite`,
            delegate: "CPU",
          },
          runningMode: "IMAGE",
          // Avoid low-confidence duplicate boxes. Keep results advisory pending pilot calibration.
          minDetectionConfidence: 0.65,
        },
      ),
    );
    detector.catch(() => {
      detector = undefined;
    });
  }
  return detector;
}

/** Advisory hints only. The image and detected boxes stay on the device. */
export async function checkFacePhoto(photo: string): Promise<string[] | null> {
  try {
    const [model, image] = await Promise.all([faceDetector(), loadImage(photo)]);
    const { detections } = model.detect(image);
    if (!detections.length)
      return ["No face was detected. Ask the customer to face the camera in even light."];
    if (detections.length > 1)
      return ["More than one face was detected. Retake with only the customer in the frame."];
    const box = detections[0].boundingBox;
    if (!box || box.width <= 0 || box.height <= 0) return null;

    const { naturalWidth, naturalHeight } = image;
    const hints = [];
    const shortEdge = Math.min(naturalWidth, naturalHeight);
    const margin = shortEdge * 0.02;
    if (
      box.originX < margin ||
      box.originY < margin ||
      box.originX + box.width > naturalWidth - margin ||
      box.originY + box.height > naturalHeight - margin
    ) {
      hints.push("The face is close to an edge. Leave space around the whole face.");
    }
    if (Math.min(box.width, box.height) < Math.max(80, shortEdge * 0.24)) {
      hints.push(
        "The face looks small in the photo. Move closer while keeping the whole face in view.",
      );
    }
    return hints;
  } catch {
    return null;
  }
}
