# Forme — Avatar Studio

Level 1 of `tryoncloths`: a store-assisted customer avatar workflow. Built with React, TypeScript, Vite, Express, and Sharp. Uses four generated adult male sample profiles: slim, regular, athletic, and broad.

## Install on Android

[Download the Android test APK](https://github.com/RajeshRamadas/tryoncloths/raw/refs/heads/main/downloads/forme-android-debug.apk) on your phone, open it, and allow installation from your browser if prompted. Android 7+ and an updated Android System WebView/Chrome (108+) are required. This is a debug build for testing.

The Android app includes the sample avatar workflow offline, native camera/gallery selection, and PNG sharing. Optional AI face personalization connects to your own HTTPS studio server; no AI key is included. See [Android setup, testing, and build instructions](docs/ANDROID.md). Apple development is paused.

## See the app in action

[Open the recorded walkthrough and example output](docs/demo/README.md). The recording shows the actual app selecting a profile, reviewing it, and downloading a PNG. It uses standard sample avatars; live face personalization is not configured in this demo.

## Run locally

Requires Node.js 22.12+ (validated with Node.js 24).

```sh
git clone https://github.com/RajeshRamadas/tryoncloths.git
cd tryoncloths
npm ci
npm run dev
```

The frontend listens on port 5173 and proxies `/api` to the Express server on port 3001. The sample workflow needs no API keys. Fonts and avatar assets are bundled locally. For a production build, run `npm run build`, then `npm start` (port 3001). This is a development pilot; add authentication and complete a privacy/provider review before exposing a credentialed instance publicly.

In the Codex cloud environment, use the existing `/workspace/tryoncloths` checkout and run `npm ci --cache /workspace/.npm-cache` instead of cloning again.

## What works

- Consented face/full-body photo input, with camera capture offered on supported mobile browsers. JPEG, PNG, and WebP validation; 10 MB browser upload limit, client resizing, and removal controls.
- Approximate standard-profile suggestion from height/weight, with staff correction. Athletic build is never inferred from weight alone.
- Independent selection of all four standard sample profiles.
- An optional, explicitly triggered Gemini face-personalization adapter, with server-side credentials and consent checks.
- Review/approval, full-body PNG download, expanded preview, and new-session photo clearing.
- Responsive layout and keyboard-accessible controls/dialogs.

The full-body photo is a **staff reference**, held in browser memory. Automated body-shape analysis is not implemented. The current profile rule is illustrative, not calibrated to real measurements. Default height/weight inputs are sample values, not measured properties of the generated bodies.

## Optional face personalization

Copy `.env.example` to `.env` and set `TRYON_GEMINI_API_KEY` securely. The default model is `gemini-2.5-flash-image`; `TRYON_GEMINI_MODEL` overrides it. Restart the API after configuration. Do not put credentials in `VITE_` variables or commit them. Network access to `generativelanguage.googleapis.com` is needed.

The adapter sends the selected standard body and normalized customer face to Gemini in one request. The full-body reference stays in the browser. It asks the model to preserve the standard pose and body, but generative output can vary and must be reviewed. There are no automatic retries or per-selection AI requests. Repeating a generation is an explicit action and may incur another charge. This development server limits attempts to 20 per hour per client IP, at least 15 seconds apart, with at most two requests in flight globally. These are development limits, not a production quota system.

Without a key, the app reports personalization unavailable and supports the complete sample-avatar path. Provider integration is tested with a stubbed provider; real output quality, account/model access, cost, latency, and retention behavior must be verified with an authorized account. No claim of an actual personalized generation is made by the sample mode.

## Data handling

The app does not use local storage or a customer database. Customer photo inputs and generated images remain in memory for the session. Android exports use temporary app-cache files for the native share sheet; these are cleared at the next export, new session, or app launch. Camera providers can manage their own temporary files. During an explicitly consented generation, the API temporarily decodes the face photo in memory and forwards it to the provider; it does not log or persist image data. Provider retention is governed separately by the configured account's terms. Start a new session, revoke photo consent, or reload to discard in-memory customer data. Downloaded/shared files remain under the recipient's control. See [Android data handling](docs/ANDROID.md#data-handling).

No retailer accounts, durable avatar storage, clothing compositing, fit prediction, or automatic measurements are included yet.

## Validation

[See the independent-photo test report, screenshots, and exported avatars](docs/testing/random-data/README.md). The suite passes 14 unit/API tests and 27 browser tests using three synthetic customers generated separately from the avatar library, including simulated Android sessions. Testing found and fixed WebP photo rotation; the Android download includes the correction.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser tests automatically use `/usr/bin/chromium` when available, so the download step can be skipped in this cloud environment. Set `CHROMIUM_PATH` to use another installed Chromium executable.

Unit/API tests cover matching, invalid inputs, consent, request origin, decoded image validation, provider request handling, attempt limits, and failure isolation. Browser tests cover sample selection/export, consented uploads and clearing, mobile layout/dialogs, and a mocked personalization workflow. No paid external API call is made by tests.

## Files

- `src/App.tsx`: store workflow and session state.
- `src/profiles.js`: sample library and matching rule.
- `src/images.ts`: browser photo normalization and PNG export.
- `server/app.js`: API, validation, and optional Gemini adapter.
- `public/avatar-library.png`: generated conceptual sample contact sheet; UI/export selects the appropriate panel.
- `docs/LEVEL_1.md`: current implementation scope and remaining validation.

Cloud tasks already have an isolated checkout. Work in the existing repository; do not create a worktree unless explicitly requested.
