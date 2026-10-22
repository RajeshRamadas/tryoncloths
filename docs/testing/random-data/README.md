# Random photo and measurement testing

Run on 2026-10-22 against the Level 1 Android interface, using Chromium with simulated Capacitor camera, filesystem, and share APIs. **14 unit/API tests and 27 browser tests passed** after correcting one WebP orientation bug. Android `assembleDebug lintDebug` and APK signature verification also passed. The downloadable APK includes the fix.

## Inputs and coverage

The photos are synthetic face/body crops from the four generated sample avatars already in the repository. They are not real customers or a diverse validation dataset. A fixed random seed (`20261022`) makes the randomized measurements and photo choices reproducible.

| Check | Coverage | Result |
| --- | --- | --- |
| End-to-end sessions | 16 height/weight pairs: 3 known recommendations, 2 supported-range boundaries, 11 random pairs | Passed |
| Photo formats | JPEG, PNG, WebP; face crops and full-body photos | Passed |
| Large photos | 3000-pixel inputs reduced to at most 1600 pixels | Passed |
| Photo orientation | All 8 WebP EXIF orientations compared with Sharp's independent decoder | Passed after fix |
| Invalid measurements | 10 empty, negative, zero, and out-of-range combinations; recovery after correction | Passed |
| Invalid photos | Unsupported type, corrupt JPEG, 64 × 64 image, and file over 10 MB; existing photo preserved | Passed |
| Manual correction and export | All 4 profiles; approval required; every exported 384 × 942 PNG compared pixel-for-pixel with its selected sample | Passed |
| Session privacy | Consent required, photos cleared on reset/revocation, native cache cleanup requested | Passed |
| AI request count | Zero API requests in all 16 offline sessions | Passed |

Example known recommendations: 175 cm / 55 kg → Slim; 175 cm / 72 kg → Regular; 175 cm / 95 kg → Broad. These verify the current illustrative rule, not real-world sizing accuracy. Athletic is a staff selection.

See [all 16 scenario records](scenarios.json), including image format, normalized dimensions, manually selected profile, and export dimensions.

## Bug found and corrected

The first run passed 25 of 26 browser tests. Chromium decoded a WebP carrying EXIF orientation 8 sideways despite the metadata being valid. The photo pipeline now reads the WebP orientation with bounded metadata parsing, resets the tag before browser decoding to prevent double rotation, and applies the required rotation/mirroring when normalizing the image. A regression test checks all eight orientations against Sharp. The follow-up run passed all 27 browser tests, with no retries or skipped tests.

## Actual test screenshots and output

The following screenshots are from the running interface at a 412-pixel mobile width with simulated Android APIs. They are not emulator or phone screenshots.

[Face input](input-face.png) · [Full-body input](input-body.png) · [Exported PNG](exported-avatar.png)

The full-body input in this example intentionally carries rotation metadata. The interface correctly displays it upright. The exported result is the **Regular standard sample**, with its sample face; no AI face merge occurred.

### Photos and measurements entered

<img src="photos-entered.png" width="360" alt="Actual mobile interface after synthetic face/body uploads and entry of 175 cm and 72 kg">

### Reviewed and approved

<img src="review-approved.png" width="360" alt="Actual review screen with the standard avatar approved for export">

### Exported avatar

<img src="exported-avatar.png" width="240" alt="Regular standard sample PNG captured from the native filesystem bridge call">

## Reproduce

```sh
npm ci
npm test
npm run test:e2e
npm run android:check
```

Only the new photo/data browser tests: `npm run test:e2e -- tests/browser/random-data.spec.js`.

Physical Android camera/gallery/share behavior, live AI face-personalization quality and cost, demographic coverage, and real body-measurement accuracy are **not validated by this run**. Full-body photos remain staff references. No AI provider requests or charges were made.
