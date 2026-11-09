# Full-body photo check

When staff add a customer's full-body photo, the studio checks the pose and framing on the
device and shows hints under the photos. The hints are advice only: staff still review the
photo and decide, and nothing blocks generation.

## How it works

- [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
  (`@mediapipe/tasks-vision`, Apache-2.0) finds 33 body landmarks in the browser, on the CPU.
- The runtime (about 13.5 MB of WebAssembly, about 4 MB gzipped) and the lite pose model
  (`public/models/pose_landmarker_lite.task`, 5.8 MB) load only when a full-body photo is
  added. The browser caches them after that.
- The photo is not uploaded for the check, and no AI credit is used.
- `src/body-pose-check.js` turns the landmarks into hints. It is plain code with unit tests.
- If the model cannot load, for example when offline before the first download, no hint
  is shown and the studio works as before.

## Hints

| Hint             | Raised when                                                                         |
| ---------------- | ----------------------------------------------------------------------------------- |
| No person found  | No pose is detected                                                                 |
| Several people   | More than one pose is detected                                                      |
| Landscape photo  | The image is more than 1.1 × wider than tall                                        |
| Head cut off     | The estimated crown (0.9 ear-spans above the eyes) is at the top edge               |
| Feet cut off     | A heel or toe is at the bottom edge, or the model cannot see it                     |
| Too far          | Crown to soles is less than 55% of the image height                                 |
| Off-centre       | The hip centre is outside the middle 40% of the width                               |
| Turned           | Shoulder width is under 45% of the shoulder-to-hip length                           |
| Tilted           | The shoulders-to-ankles line leans more than 10° from vertical                      |
| Arms raised      | A visible wrist is above its shoulder                                               |
| Arms held out    | A visible wrist is further from its hip than 55% of the torso length                |
| Arms in front    | A visible wrist is above the hips and between the shoulders                         |

The three synthetic customer photos in `tests/fixtures/customers` pass with no hints. Their
landmarks are stored in `body-poses.json` for the unit tests.

## Limits

- The thresholds are first estimates from synthetic photos. Calibrate them on consented
  pilot photos before relying on them.
- Loose clothing such as sarees, long kurtas or coats can hide the hips and ankles, so the
  landmarks there are less reliable.
- The landmarks are not yet used to choose the body profile. The outfit studio uses the
  same model for [arms in front of tops](CLOTHING_LAYERS.md#arms-in-front-of-tops).

## Updating the model

The model came from Google's MediaPipe model storage:
`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
(SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`). If you
replace it or upgrade `@mediapipe/tasks-vision`, re-run the browser test
`tests/browser/body-photo-check.spec.js` and refresh `body-poses.json`.
