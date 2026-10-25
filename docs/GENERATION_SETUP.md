# Enable customer avatar generation

Actual customer avatar generation needs an **OpenAI API key on a backend server**. The Android app alone cannot generate a personalized image. A key is not included in the APK, and the app does not offer a field for entering it. ChatGPT subscriptions and OpenAI API billing are separate; enable API billing/credits for the project that owns the key.

## Switch an existing Lightsail deployment from Gemini

Edit `~/tryoncloths/deploy/lightsail/.env` on the server and add:

```dotenv
OPENAI_API_KEY=your_actual_openai_api_key
TRYON_OPENAI_MODEL=gpt-image-1.5
TRYON_OPENAI_QUALITY=low
TRYON_ACCESS_MODE=public
TRYON_MOBILE_TOKEN=
```

These access settings preserve your public website without a store code. Keep the existing domain/email settings. Old `TRYON_GEMINI_*` variables are no longer used and can be removed. Obtain a key from [OpenAI API keys](https://platform.openai.com/api-keys), enable API billing, and complete any organization verification requested for image-model access.

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml up -d --build tryon
```

Refresh the website after deploying. Version 0.3.0 uses the `customer-avatar-v3` contract and requires explicit `consentProvider: "openai"`. Older Android clients and cached browser versions cannot submit their previous Gemini consent to the new provider. Install the updated Android APK when using the native app; its connections still require protected mode and a store code. No automatic Gemini fallback is used.

The adapter uses OpenAI's `/v1/images/edits` endpoint, sending three multipart image files and requesting one `1024x1536` PNG. Defaults are `gpt-image-1.5`, `quality=low` to limit output cost, and `input_fidelity=high` to help preserve reference faces. Set `TRYON_OPENAI_QUALITY=medium` or `high` if needed after reviewing output; this can increase cost. Fidelity settings are omitted for models that do not support them. The provider timeout is three minutes; no request is retried automatically. The request shape was checked against [OpenAI's official SDK image-edit definitions](https://github.com/openai/openai-node/blob/master/src/resources/images.ts). Consult [current API pricing](https://openai.com/api/pricing/) for costs; no fixed per-avatar price is assumed.

## Set up the backend

For AWS Lightsail, follow the [step-by-step Lightsail deployment guide](AWS_LIGHTSAIL.md), which includes Docker, automatic HTTPS, server secrets, and Android connection steps.

1. Create a key in [OpenAI API keys](https://platform.openai.com/api-keys) for a project allowed to use OpenAI image generation. Enable API billing and check the project's image-model access and quotas.
2. Deploy this repository to a Node.js 22.12+ host with a public HTTPS URL. Use build command `npm ci && npm run build` and start command `npm start`. The server reads the host's `PORT` variable (default 3001).
3. In that host's **secret environment variables**, set `OPENAI_API_KEY` to your key and `TRYON_MOBILE_TOKEN` to a separate random store access code of at least 24 characters. Do not paste the API key into chat, GitHub, frontend `VITE_` variables, or Android source. For local development, use an ignored `.env` file based on `.env.example`.
4. Keep `TRYON_OPENAI_MODEL=gpt-image-1.5` and `TRYON_OPENAI_QUALITY=low`, or select a supported GPT Image model and quality level. Text-only chat models will not produce an avatar through the image-edit endpoint.
5. Restart/deploy the server. In Android, open **Studio connection** and enter its HTTPS origin and the **store access code**, not the OpenAI API key. A server from before version 0.3 must be updated: the app requires the `customer-avatar-v3` contract.

An API key alone does not deploy the backend. No public backend has been deployed as part of this repository delivery.

In protected mode, **browser users also need to connect**: open the cloud icon (**Studio connection**), use the website's HTTPS origin, and enter the store access code. Removing a Caddy browser-password prompt does not remove API authentication. The code stays in memory, so reconnect after refreshing or reopening the page. An unauthenticated API response now shows **Studio connection required**, rather than suggesting the AI service itself is unavailable. If generation remains unavailable after connecting, check the server's OpenAI configuration.

For a website without a store access code, set `TRYON_ACCESS_MODE=public` and leave `TRYON_MOBILE_TOKEN=` empty in the server environment, then recreate the service. The browser uses its own backend automatically; no Studio connection step is needed. The OpenAI key stays server-side. **Anyone who can reach the server can request generation against your OpenAI quota**; request limits and origin checks do not authenticate visitors or cap spending. Public mode ignores any old store token. The existing native Android connection flow still requires protected mode and a code; public mode is for the website. Lightsail defaults to `protected` and refuses to start without a code unless public mode is explicitly selected.

## Generate and review

1. Capture a clear customer face photo and a full-body photo, with consent. Enter approximate height and weight.
2. Choose the closest standard body. Height/weight gives a starting suggestion; staff compare the full-body photo and can select Slim, Regular, Athletic, or Broad. Automatic body measurements are not implemented.
3. Confirm the separate consent to send **both photos and approximate measurements** to OpenAI. Tap **Generate customer avatar**.
4. One provider request sends the selected standard template, customer face, customer full-body reference, and measurements. It asks for the customer's face/hair and natural skin tone across all exposed skin while retaining the standard body's proportions, pose and clothing. Face and body photos are lighting-dependent references, not a biometric or calibrated skin-color measurement.
5. Compare the generated result with both original photos. Review facial resemblance, selected body proportions, and consistent skin tone on the face, neck, arms, hands, legs and feet. Approve only after review, then save/share the PNG.

Selecting profiles and editing details make no AI calls. Generation and retries are explicit; there are no automatic retries. A timeout can still incur a provider charge. The pilot limits attempts to 20 per hour per client IP, at least 15 seconds apart, with at most two provider calls in flight globally. These request limits are not a monetary budget cap; use provider quotas/billing controls too.

## Failure and offline behavior

The app's hourly attempt limit and OpenAI's limits are separate. A generation failure after the app accepted the request does not establish that the hourly limit was reached. Provider failures now distinguish rejected keys/access, unavailable models, OpenAI quota, network failures, timeouts, blocked requests and responses without a usable image. Server logs contain only a fixed error category and provider HTTP status, never the provider response body, API key or customer images. There are no automatic retries.

To check the running shared Lightsail backend without submitting photos or generating another image:

```sh
cd ~/tryoncloths/deploy/lightsail
sudo docker compose -f compose.shared.yaml exec -T tryon node server/check-provider.js
```

Update/rebuild the backend first if that script is missing. The script requests metadata for the configured model using the running server's key. A successful metadata response confirms that endpoint is accessible, but **does not prove image-generation quota, billing eligibility or output quality**. Share its sanitized result when troubleshooting; do not share `.env` contents. After a generation failure, `sudo docker compose -f compose.shared.yaml logs --tail=30 tryon` includes an `avatar_provider_failure` event with its category and HTTP status. `quota` means OpenAI's limit, not the app's 20-attempt limit; check the provider's project billing and model quotas.

A session containing customer photos cannot proceed to approval/export without a generated customer result. Missing keys, connection errors, invalid inputs, or provider failures never substitute a standard sample as the customer's output. You can still browse/export standard samples in a separate session with no customer photos.

Changing the photos, measurements or selected body invalidates the generated result and its approval. Generation consent is also reset. The app holds photos/results in memory and the backend does not persist them. Provider retention is governed by your account's terms; Android sharing uses temporary cache files as described in the [Android guide](ANDROID.md).

## Current verification status

Automated tests verify the three-image request, separate consent, measurements, selected template, skin-tone instructions, failure handling, approval gates, and export of the returned PNG. They use stubbed provider responses. **A real generated customer's appearance, skin-tone accuracy, latency, and price have not been verified through the live OpenAI API**, because no backend key/account is configured in this environment. Physical Android testing also remains pending.
