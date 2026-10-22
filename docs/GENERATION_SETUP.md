# Enable customer avatar generation

Actual customer avatar generation needs a **Gemini API key on a backend server**. The Android app alone cannot generate a personalized image. A key is not included in the APK, and the app does not offer a field for entering it.

## Set up the backend

1. Create a key in [Google AI Studio](https://aistudio.google.com/apikey) for a project allowed to use Gemini image generation. Enable billing if your account/model requires it. Check current provider pricing and quotas; no fixed cost per avatar is assumed here.
2. Deploy this repository to a Node.js 22.12+ host with a public HTTPS URL. Use build command `npm ci && npm run build` and start command `npm start`. The server reads the host's `PORT` variable (default 3001).
3. In that host's **secret environment variables**, set `TRYON_GEMINI_API_KEY` to your key and `TRYON_MOBILE_TOKEN` to a separate random store access code of at least 24 characters. Do not paste the API key into chat, GitHub, frontend `VITE_` variables, or Android source. For local development, use an ignored `.env` file based on `.env.example`.
4. Keep `TRYON_GEMINI_MODEL=gemini-2.5-flash-image` if that image-capable model is available to your project, or set a supported Gemini image model. Text-only models will not produce an avatar.
5. Restart/deploy the server. In Android, open **Studio connection** and enter its HTTPS origin and the **store access code**, not the Gemini API key. A server from before version 0.2 must be updated: the app requires the `customer-avatar-v2` contract.

An API key alone does not deploy the backend. No public backend has been deployed as part of this repository delivery.

## Generate and review

1. Capture a clear customer face photo and a full-body photo, with consent. Enter approximate height and weight.
2. Choose the closest standard body. Height/weight gives a starting suggestion; staff compare the full-body photo and can select Slim, Regular, Athletic, or Broad. Automatic body measurements are not implemented.
3. Confirm the separate consent to send **both photos and approximate measurements** to Gemini. Tap **Generate customer avatar**.
4. One provider request sends the selected standard template, customer face, customer full-body reference, and measurements. It asks for the customer's face/hair and natural skin tone across all exposed skin while retaining the standard body's proportions, pose and clothing. Face and body photos are lighting-dependent references, not a biometric or calibrated skin-color measurement.
5. Compare the generated result with both original photos. Review facial resemblance, selected body proportions, and consistent skin tone on the face, neck, arms, hands, legs and feet. Approve only after review, then save/share the PNG.

Selecting profiles and editing details make no AI calls. Generation and retries are explicit; there are no automatic retries. A timeout can still incur a provider charge. The pilot limits attempts to 20 per hour per client IP, at least 15 seconds apart, with at most two provider calls in flight globally. These request limits are not a monetary budget cap; use provider quotas/billing controls too.

## Failure and offline behavior

A session containing customer photos cannot proceed to approval/export without a generated customer result. Missing keys, connection errors, invalid inputs, or provider failures never substitute a standard sample as the customer's output. You can still browse/export standard samples in a separate session with no customer photos.

Changing the photos, measurements or selected body invalidates the generated result and its approval. Generation consent is also reset. The app holds photos/results in memory and the backend does not persist them. Provider retention is governed by your account's terms; Android sharing uses temporary cache files as described in the [Android guide](ANDROID.md).

## Current verification status

Automated tests verify the three-image request, separate consent, measurements, selected template, skin-tone instructions, failure handling, approval gates, and export of the returned PNG. They use stubbed provider responses. **A real generated customer's appearance, skin-tone accuracy, latency, and price have not been verified through the live Gemini API**, because no backend key/account is configured in this environment. Physical Android testing also remains pending.
