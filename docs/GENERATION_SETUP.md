# Enable customer avatar generation

**Web 0.8 account storage:** see [store accounts](STORE_ACCOUNTS.md) for sign-in, automatic saving, reuse across browsers and the persistent-volume deployment command. This web update does not rebuild the Android APK. Local-library instructions below apply when account storage is disabled.

The backend uses **Gemini by default**. Keep the API key on the server; do not enter it in the app. Skin tone is matched automatically from customer photos, using the face as the primary reference and the full-body photo as supporting evidence. The selected standard body supplies proportions, pose, clothing and framing.

## Update your existing Gemini deployment

Keep your existing Gemini key in `~/tryoncloths/deploy/lightsail/.env` and use:

```dotenv
TRYON_PROVIDER=gemini
TRYON_GEMINI_API_KEY=your_existing_gemini_key
TRYON_GEMINI_MODEL=gemini-2.5-flash-image
TRYON_ACCESS_MODE=public
TRYON_MOBILE_TOKEN=
```

Keep existing domain/email settings. Public website mode does not require a store access code. Your existing shared-proxy deployment can be updated with:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml up -d --build tryon
```

Use your existing `compose.shared.yaml` and Beauty Studio Caddy; do not start a second proxy. The shared service must pass the provider/key/model and access-mode environment variables to the container (or extend the updated `app` service in `compose.yaml`). Refresh the website after deployment. Version 0.4.0 requires the `customer-avatar-v4` contract; older cached clients/APKs must be updated. Consent names the provider reported by the backend. A successful metadata check does not verify generation quota or image quality.

## Optional OpenAI configuration

Only if deliberately switching providers, set `TRYON_PROVIDER=openai`, `OPENAI_API_KEY`, `TRYON_OPENAI_MODEL=gpt-image-1.5` and `TRYON_OPENAI_QUALITY=low`. OpenAI API billing is separate from ChatGPT subscriptions. The adapter sends three images to `/v1/images/edits`, requests one portrait PNG, and uses high input fidelity where supported. There is no automatic fallback between providers. Both adapters time out after three minutes and never retry automatically.

## Set up the backend

For AWS Lightsail, follow the [step-by-step Lightsail deployment guide](AWS_LIGHTSAIL.md), which includes Docker, automatic HTTPS, server secrets, and Android connection steps.

1. Create a key in [Google AI Studio](https://aistudio.google.com/apikey) for a project allowed to use Gemini image generation. Enable API billing and check the project's image-model access and quotas.
2. Deploy this repository to a Node.js 22.12+ host with a public HTTPS URL. Use build command `npm ci && npm run build` and start command `npm start`. The server reads the host's `PORT` variable (default 3001).
3. In that host's **secret environment variables**, set `TRYON_GEMINI_API_KEY` to your key and `TRYON_MOBILE_TOKEN` to a separate random store access code of at least 24 characters. Do not paste the API key into chat, GitHub, frontend `VITE_` variables, or Android source. For local development, use an ignored `.env` file based on `.env.example`.
4. Keep `TRYON_GEMINI_MODEL=gemini-2.5-flash-image`, or select a supported Gemini image-generation model. Text-only chat models will not produce an avatar through this adapter.
5. Restart/deploy the server. In Android, open **Studio connection** and enter its HTTPS origin and the **store access code**, not the Gemini API key. A server from before version 0.4 must be updated: the app requires the `customer-avatar-v4` contract.

An API key alone does not deploy the backend. No public backend has been deployed as part of this repository delivery.

In protected mode, **browser users also need to connect**: open the cloud icon (**Studio connection**), use the website's HTTPS origin, and enter the store access code. Removing a Caddy browser-password prompt does not remove API authentication. The code stays in memory, so reconnect after refreshing or reopening the page. An unauthenticated API response now shows **Studio connection required**, rather than suggesting the AI service itself is unavailable. If generation remains unavailable after connecting, check the server's Gemini configuration.

For a website without a store access code, set `TRYON_ACCESS_MODE=public` and leave `TRYON_MOBILE_TOKEN=` empty in the server environment, then recreate the service. The browser uses its own backend automatically; no Studio connection step is needed. The Gemini key stays server-side. **Anyone who can reach the server can request generation against your Gemini quota**; request limits and origin checks do not authenticate visitors or cap spending. Public mode ignores any old store token. The existing native Android connection flow still requires protected mode and a code; public mode is for the website. Lightsail defaults to `protected` and refuses to start without a code unless public mode is explicitly selected.

## Generate and review

1. Capture a clear customer face photo and a full-body photo, with consent. Enter approximate height and weight.
2. Choose the closest standard body. Height/weight gives a starting suggestion; staff compare the full-body photo and can select Slim, Regular, Athletic, or Broad. Automatic body measurements are not implemented.
3. Confirm the separate consent to send **both photos and approximate measurements** to Gemini. Tap **Generate customer avatar**.
4. Gemini receives the customer face first, full-body photo second, and the selected standard body with the actual customer face aligned using local eye landmarks last, plus measurements. The body reference is padded without stretching to keep head and feet in frame. It asks for the customer's face/hair and natural skin tone across all exposed skin while retaining the standard body's proportions, pose and clothing. Face and body photos are lighting-dependent references, not a biometric or calibrated skin-color measurement.
5. Compare the generated result with both original photos. Review facial resemblance, selected body proportions, and consistent skin tone on the face, neck, arms, hands, legs and feet. Approve only after review, then save/share the PNG.

Selecting profiles and editing details make no AI calls. Generation and retries are explicit; there are no automatic retries. A timeout can still incur a provider charge. The pilot limits attempts to 20 per hour per client IP, at least 15 seconds apart, with at most two provider calls in flight globally. These request limits are not a monetary budget cap; use provider quotas/billing controls too.

## Failure and offline behavior

The app's hourly attempt limit and Gemini's limits are separate. A generation failure after the app accepted the request does not establish that the hourly limit was reached. Provider failures now distinguish rejected keys/access, unavailable models, Gemini quota, network failures, timeouts, blocked requests and responses without a usable image. Server logs contain only a fixed error category and provider HTTP status, never the provider response body, API key or customer images. There are no automatic retries.

To check the running shared Lightsail backend without submitting photos or generating another image:

```sh
cd ~/tryoncloths/deploy/lightsail
sudo docker compose -f compose.shared.yaml exec -T tryon node server/check-provider.js
```

Update/rebuild the backend first if that script is missing. The script requests metadata for the configured model using the running server's key. A successful metadata response confirms that endpoint is accessible, but **does not prove image-generation quota, billing eligibility or output quality**. Share its sanitized result when troubleshooting; do not share `.env` contents. After a generation failure, `sudo docker compose -f compose.shared.yaml logs --tail=30 tryon` includes an `avatar_provider_failure` event with its category and HTTP status. `quota` means Gemini's limit, not the app's 20-attempt limit; check the provider's project billing and model quotas.

With customer photos loaded, the preview shows small input references and “Customer avatar not generated yet” until a result arrives. After a failure it shows “Generation did not complete”. Neither state displays a sample as customer output.

Generated images must pass a local face-presence check before reaching approval. A missing or undetectable face produces `missing_face`; it cannot be exported, and no automatic retry is made. This check can reject difficult photos and does not prove likeness, correct complexion or natural proportions. Unusable customer face inputs produce `face_input` before an image-generation call.

A session containing customer photos cannot proceed to approval/export without a generated customer result. Missing keys, connection errors, invalid inputs, or provider failures never substitute a standard sample as the customer's output. You can still browse/export standard samples in a separate session with no customer photos.

Changing the photos, measurements or selected body invalidates the generated result and its approval. Generation consent is also reset. Original photos remain in memory and the backend does not persist them. Version 0.7 adds an optional local saved-avatar library: with explicit consent, the approved avatar PNG, thumbnail, chosen name, profile and measurements are saved on this browser/app for reuse. Original photos and credentials are excluded. See [saved-avatar storage and deletion](SAVED_AVATARS.md). Provider retention is governed by your account's terms; Android sharing uses temporary cache files as described in the [Android guide](ANDROID.md).

## Current verification status

Automated tests verify the three-image request, separate consent, measurements, selected template, skin-tone instructions, failure handling, approval gates, and export of the returned PNG. They use stubbed provider responses. **A real generated customer's appearance, skin-tone accuracy, latency, and price have not been verified through the live Gemini API**, because no backend key/account is configured in this environment. Physical Android testing also remains pending.


## Customer-reference correction

A live test returned HTTP 200 but failed facial resemblance, and a later user result was headless. The updated Gemini reference contains the actual customer face aligned to the selected body, a wider curved neck blend with a gradually introduced underlying neck, and output face-presence validation; see [failure evidence and validation limits](testing/gemini-reference-fix/README.md). After rebuilding, `/api/health` must advertise `generationRevision: "customer-neck-v6"`. This backend update works with the current v0.4.0 APK; no Android reinstall is required. Refresh the browser and generate a new result for visual review.
