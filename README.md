# Forme — Avatar Studio

Level 1 of `tryoncloths`: a store-assisted customer avatar workflow. Built with React, TypeScript, Vite, Express, and Sharp. Web 0.15 includes 48 generated adult sample templates: male and female bodies, four profiles each, and six complexion ranges. See the [avatar library and approximate matching](docs/AVATAR_LIBRARY.md).

## Install on Android

[Download the Android test APK](https://github.com/RajeshRamadas/tryoncloths/raw/refs/heads/main/downloads/forme-android-debug.apk) on your phone, open it, and allow installation from your browser if prompted. Android 7+ and an updated Android System WebView/Chrome (108+) are required. This is a debug build for testing.

The Android app includes native camera/gallery selection, standard-body selection, customer-avatar generation through your HTTPS studio, and PNG sharing. Generation sends both customer photos and matches the face and skin tone onto the selected standard body. **Actual generation requires a server-side Gemini API key**; see [backend setup](docs/GENERATION_SETUP.md). Offline sessions without customer photos can browse/export samples. See [Android installation and builds](docs/ANDROID.md). Apple development is paused.

## See the app in action

[See a separate visual example of the customer's face and skin tone on a standard body](docs/testing/visual-example/README.md). It was generated with Image Gen outside the app; the Gemini backend still requires configuration and live validation.

[Open the recorded walkthrough and example output](docs/demo/README.md). The recording shows the actual app selecting a profile, reviewing it, and downloading a PNG. It uses standard sample avatars; live face personalization is not configured in this demo.

## Run locally

Requires Node.js 22.12+ (validated with Node.js 24).

```sh
git clone https://github.com/RajeshRamadas/tryoncloths.git
cd tryoncloths
npm ci
npm run dev
```

The frontend listens on port 5173 and proxies `/api` to the Express server on port 3001. The sample workflow needs no API keys. Fonts and avatar assets are bundled locally. For a production build, run `npm run build`, then `npm start` (port 3001). The deployment guide describes protected store access and public website mode for this pilot.

In the Codex cloud environment, use the existing `/workspace/tryoncloths` checkout and run `npm ci --cache /workspace/.npm-cache` instead of cloning again.

## What works

- Consented face/full-body photo input, with camera capture offered on supported mobile browsers. JPEG, PNG, and WebP validation; 10 MB browser upload limit, client resizing, and removal controls.
- Approximate standard-profile suggestion from height/weight, with staff correction. Athletic build is never inferred from weight alone.
- Male/female template selection with four body profiles and six skin tones each; saved avatars retain the chosen template tone.
- An explicitly triggered Gemini customer-avatar adapter using both customer photos, a selected body template, and whole-body skin-tone matching instructions, with server-side credentials and consent checks.
- Review/approval, full-body PNG download, expanded preview, and new-session photo clearing.
- Responsive layout and keyboard-accessible controls/dialogs.

The full-body photo supports staff selection and, with separate consent, is sent to the provider as a visual and skin-tone reference. Automated body-shape measurements are not implemented. The current profile rule is illustrative, not calibrated to real measurements. Default height/weight inputs are sample values, not measured properties of the generated bodies.

## Customer avatar generation

To host the backend on AWS, follow the [AWS Lightsail setup guide](docs/AWS_LIGHTSAIL.md).

Copy `.env.example` to `.env` and set `TRYON_GEMINI_API_KEY` securely. Gemini is the default (`TRYON_PROVIDER=gemini`, `TRYON_GEMINI_MODEL=gemini-2.5-flash-image`). Existing Gemini keys can stay in place. Restart the API after configuration. Do not put credentials in `VITE_` variables or commit them. Network access to `generativelanguage.googleapis.com` is needed. Follow the [existing Lightsail update steps](docs/GENERATION_SETUP.md#update-your-existing-gemini-deployment). Version 0.4.0 requires the `customer-avatar-v4` contract and consent naming the active provider. OpenAI remains an explicit optional configuration; there is no automatic provider fallback.

Gemini sends three labelled images in one request: customer face first, full-body photo second, and the selected body reference last. Local eye landmarks align the actual customer face to the body reference with uniform scaling and rotation. Gemini blends the hair, neck and collar and matches exposed skin to the customer photos. A local face-presence check rejects headless outputs before approval/export; it does not verify identity or anatomical quality. The checks use bundled CPU/WASM models without extra paid AI calls or runtime downloads. Original sample previews/exports are unchanged. See [the reference corrections and validation limits](docs/testing/gemini-reference-fix/README.md); the latest correction still needs live visual validation after deployment.

Generative output can vary and must be reviewed. There are no automatic retries or per-selection AI requests. Repeating a generation is an explicit action and may incur another charge. This development server limits attempts to 20 per hour per client IP, at least 15 seconds apart, with at most two requests in flight globally. These are development limits, not a production quota system. See [generation setup and review](docs/GENERATION_SETUP.md).

With customer photos loaded, the preview displays input references and an explicit pending state until generation succeeds. It never presents the standard sample as a personalized result. Personalized skin tone is matched automatically from the photos; the six template complexion choices are starting references only.

Without a key, customer generation is unavailable. Sessions containing customer photos cannot approve or export a standard sample as the customer's result. Sample browsing/export remains available in sessions without photos. Provider integration is tested with a stubbed provider; real face fidelity, skin-tone matching, account/model access, cost, latency, and retention behavior must be verified with an authorized account. No claim of an actual personalized generation is made by sample mode or stubbed tests.

## Data handling

Original customer photo inputs stay in memory and are sent to the configured provider only with generation consent. Web 0.8 can save generated avatar PNGs, names, profiles and measurements to a signed-in store account using a persistent server database. Account generation asks for storage consent and saves successful results automatically. Original input photos and credentials are excluded from avatar records. Without account storage enabled, the optional local library saves approved avatars on the same browser/app with explicit consent. Downloaded files remain under the recipient's control. Provider retention is governed separately by its terms. See [store accounts and retention](docs/STORE_ACCOUNTS.md), [local storage](docs/SAVED_AVATARS.md) and [Android data handling](docs/ANDROID.md#data-handling).

No retailer accounts, durable avatar storage, clothing compositing, fit prediction, or automatic measurements are included yet.

## Validation

Automated validation covers both provider adapters, provider-specific consent, whole-body skin-tone instructions, pending/error previews, customer-export blocking, and approval of a stubbed provider result. Test customer photos were generated independently of the avatar library. See [version 0.4 validation](docs/testing/avatar-v4/README.md). Live provider quality remains unverified. The Android download is version 0.7.0 with saved-avatar reuse and local clothing try-on and consent naming the configured provider.

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
- `server/app.js`: API, consent, validation, and access controls.
- `server/gemini.js`: default Gemini three-image request and PNG response handling.
- `server/openai.js`: OpenAI image-edit request and PNG response handling.
- `public/avatar-library.png`: generated conceptual sample contact sheet; UI/export selects the appropriate panel.
- `docs/LEVEL_1.md`: current implementation scope and remaining validation.

Cloud tasks already have an isolated checkout. Work in the existing repository; do not create a worktree unless explicitly requested.

## Clothing try-on

Version 0.6 includes **Try clothes** after avatar approval: independent tops/trousers/shoes, nine realistic AI-created sample garments, transparent PNG/WebP import, placement controls, reset and reviewed PNG download/Android sharing. Clothing changes are composed locally with no AI requests. See [usage, layer preparation and limitations](docs/CLOTHING_TRYON.md). This is an approximate 2D preview, not a fit or drape simulation.

## Try clothes from any website

**Web 0.9:** in **Try clothes**, paste a product link from any clothing website (or upload a product photo/screenshot), choose the photo and what to put on (shirt, T-shirt, trousers, jeans, shoes, kurta, jacket, full outfit…), and Gemini dresses the saved avatar in that garment with one AI request. Add garments one after another to build an outfit; undo goes back without another request. The link reader blocks private/internal addresses. See [product-link try-on](docs/LINK_TRYON.md).

## Reuse a customer avatar

**Web 0.8:** enable [store accounts](docs/STORE_ACCOUNTS.md), create a store account and sign in before generating. With customer consent, generated avatars save automatically to that account. Sign in from another browser, open **Saved avatars**, choose the customer and use **Try clothes** without another generation. Older local avatars and downloaded PNGs can be opened, reviewed and explicitly saved to the account. The deployment needs the account Compose override and persistent volume described in the guide.

The existing Android APK remains 0.7.0; no APK was built for this web release. Without account storage enabled, the [local library](docs/SAVED_AVATARS.md) remains available on the same browser/app.

## Web 0.12 updates

Reviewed outfits can be saved under customer avatars and reopened from the store account. Undo restores previous sample layers, and failed try-on requests require fresh consent. The [female body library](docs/FEMALE_PROFILES.md) and [isolated browser reader](docs/BROWSER_LINK_READER.md) are optional pilots, disabled by default pending live validation. No Android APK was rebuilt.

## Web 0.13 release validation

Operators can run a fixed 20-product-link benchmark with `npm run benchmark:links`,
and prepare a private image-review page with `npm run evaluate:quality`. The review
compares avatar/garment references with provider outputs, scores face and skin-tone
fidelity, proportions, neck joins and clothing, and reports failures, measured cost
and latency. It supports imported dedicated-provider results for evaluation; Gemini
remains active. Neither tool makes paid AI calls. See [instructions and examples](docs/RELEASE_VALIDATION.md).

Live rollout checks remain outstanding; female profiles and the browser worker are
still opt-in pilots. This is a web/operator-tool update; the APK is unchanged.

## Web 0.14: my store clothes

Save product photos, categories, links and variants to your store account, then
select them for any customer from **My store clothes**. Duplicate photos/links
reuse the saved garment; similar photos are suggestions for staff to confirm.
After reviewing an adaptation, save it for automatic reuse on the exact same
avatar and starting outfit with **no new AI charge**. Different avatars/outfits
still need a new adaptation. See [catalogue, matching and deployment](docs/GARMENT_CATALOGUE.md).

## Commercial foundation

Web `0.16.0-alpha.1` adds the [C1 tenancy migration](docs/TENANCY_MIGRATION.md).
Existing accounts become organisations, stores and owner users on startup. Current
logins and saved data remain in use; staff login and store switching are next (C2).
Billing and the rest of R1 are not enabled by this foundation update.
