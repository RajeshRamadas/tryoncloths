# Optional Gemini image-safety review — C16.5.2

Web `0.19.0-alpha.6` supplies a built-in image eligibility/safety adapter for the
[hosted shopper flow](SHOPPER_WORKFLOW.md). It can use the existing Gemini API
key, so an operator can configure the safety stage without writing a custom
moderation module or adding a different AI vendor. It is **disabled by default**.

This is a conservative general-purpose model assessment, not certified age,
identity or photo-ownership verification. Its correctness, false accept/reject
rates, policy suitability, actual price/quota and data terms are **not verified**
by the mocked tests. Adult own-photo attestation, existing face-presence checks,
human review and the [C16.5 live launch evidence](SHOPPER_LAUNCH.md) still apply.
No service has been activated or live customer photos sent by this task.

## Configure after service/privacy review

Keep the existing separate shopper flags false while preparing setup. In the
server's `deploy/lightsail/.env`, the optional selection is:

```ini
TRYON_SHOPPER_MODERATION=gemini
TRYON_SHOPPER_MODERATION_MODEL=gemini-2.5-flash-lite
# Optional separate project/key; otherwise the existing TRYON_GEMINI_API_KEY is used:
TRYON_SHOPPER_MODERATION_API_KEY=
```

The safety model is separate from `TRYON_GEMINI_MODEL`, the existing image
generation model. The default is `gemini-2.5-flash-lite`. Current availability,
billing and quotas must be verified in the chosen Google project; a configured
model name or successful model-metadata request does not prove those conditions.
No model/provider fallback or automatic retry is introduced.

The safety key remains server-only. The optional
`compose.shopper-services.yaml` override passes these variables. Preserve all
existing shared/account/Shopify/service overrides when rebuilding; see the
[mount and deployment guide](SHOPPER_LAUNCH.md). No new mount or database migration
is needed for this adapter, and no APK is built.

The trusted `services.mjs` module remains necessary for the reviewed disclosure
and verification configuration. When selecting the built-in safety adapter,
omit `moderation` or keep it `null`, as in the example module:

```js
import disclosure from './reviewed-disclosure.mjs';
export default {disclosure, moderation: null};
```

A non-null custom `moderation` plus `TRYON_SHOPPER_MODERATION=gemini` is a conflict
and clears shopper dependencies with `moderation_invalid`; it never silently
chooses one. An unknown selection, missing key or unsafe model name also fails
closed. Selecting an image-generation/streaming/TTS/embedding model for this
text classification endpoint is refused.

Update the legally reviewed processing disclosure and consent revision to cover
the safety analysis **as well as** avatar/clothing generation, including the
actual Google project/service data handling and retention. Review processing
terms for the relevant project/tier; the application does not assume that they
are the same across all keys or plans. If the separate environment consent
revision is set, it must match the module. Flags and a version id do not provide
legal review or live approval.

## Request and acceptance rules

The server sends trusted action/role labels alongside its normalized image buffers:

| Stage | Action | Roles |
| --- | --- | --- |
| Input | Avatar | `face`, `body` |
| Input | Try-on | `avatar`, `garment` |
| Output | Avatar or try-on | `result` |

These roles come from the guarded server executor, never from shopper JSON or a
product title. Existing custom adapters may ignore the additive `action`/`roles`
fields. The built-in adapter rejects missing, changed or mismatched labels before
any request. It does not accept arbitrary prompts, URLs or image-upload endpoints.

Each stage makes **one** request to the fixed Gemini `generateContent` endpoint:

- At most two JPEG/PNG/WebP buffers, individually ≤10 MB/12 MP; single-frame,
  at least 128×128. Current shopper upload limits remain 5 MB per original photo.
- Metadata stripped, rotated/flattened and resized inside 768×768, JPEG quality 80.
  This copy is used only for safety review; it does not alter the approved avatar
  or existing image-generation prompts/body geometry.
- The fixed system instruction treats image text as untrusted content. It asks
  for image eligibility fields only, without names, numeric ages, identity claims,
  free-text analysis, image generation or instructions.
- One structured JSON candidate, temperature 0, maximum 512 output tokens,
  a 15-second deadline including preparation/transport, and a ≤2 MB request body.
  Supported Gemini 2.5 Flash/Flash-Lite models explicitly disable thinking; other
  configured text models still need compatibility/cost review.
- Four supported harm categories use `BLOCK_LOW_AND_ABOVE`. Provider safety
  blocks or any returned non-negligible/ambiguous rating cannot be accepted.
  These default provider filters supplement the explicit review rather than
  replacing it.
- No redirects, retries, fallback provider or result cache. HTTP-error bodies
  are cancelled unread; JSON responses are capped at 64 KB and classification
  text at 16 KB. Raw provider errors are never returned to the shopper.

The response must contain exactly the requested revision, number/order of roles
and all typed fields. Missing/extra/repeated keys, wrong roles, ambiguous types,
malformed JSON, multiple candidates, unexpected parts or truncated output cannot
pass. Each customer face/body/avatar/result needs one visible, adult-looking face.
A garment may have no person, or one adult-looking model; it does not waive the
safety rules. Multiple people, young/minor-looking or uncertain appearance,
obscured faces, sexualized presentation, exposed intimate parts or unsafe content
block acceptance. Cropped product-model photos can therefore be rejected; prefer
standalone garment images and assess coverage during the live pilot.

These are fallible appearance judgments. A positive classification does not prove
someone is 18 or that the photos belong to them; a false result remains possible.
Do not use this adapter to claim verified adulthood/identity or suitability for
an unreviewed regulated process. Image prompt-injection resistance and real-world
policy coverage require live evaluation; schema checks do not prove model accuracy.

The adapter returns only `{allowed, policy}`. Detailed assessments, apparent-age
labels, image bytes and model reasoning are not persisted in account or transient
databases, logs, analytics or browser storage. The provider handles transmitted
copies under the reviewed external terms. Ending a session cannot recall them.

## Consent, billing and cancellation

The safety service id fingerprints the model, prompt/schema, policy revision and
request limits, without encoding the API key. A model/policy change invalidates
old action consent/proofs. A secret rotation with the same processing policy does
not expose the key through its id. Change the public disclosure revision whenever
its wording or processing terms change.

Each input/output adapter invocation reserves one existing moderation allowance
**before** external work, including failed calls. The existing ceilings remain
100/store and 400/organisation per month. Each invocation sends at most one
classification request containing one/two images, not one request per image.

A successful avatar plus its first try-on uses:

- **2 image-generation requests / AI credits**.
- **4 additional safety-classification requests / moderation allowances**.

Safety calls can have separate Google charges and quotas; they are not deducted
as extra application AI credits. No per-call price or free tier is promised.
Confirm input-image/token tariffs, configured model behavior and project limits
before enabling a pilot. Monthly invocation/attempt caps limit calls, not a fixed
currency amount. Failures and deliberate retries also consume allowances.

Input rejection prevents the image-generation call. Output rejection/cancellation
discards the generated image and refunds its unsettled AI hold once, while the
dispatched image attempt and moderation counts remain consumed. The provider may
still bill work already submitted. A new explicit attempt needs fresh unchecked
consent/verification; the client never retries automatically.

The 120-second whole image-attempt deadline, pre-upload shared image slot,
device/IP limits, owner pause and store/product authority checks remain intact.
End/expiry/disconnect abort the safety transport; late output cannot restore an
ended result or create a saved customer/avatar record.

## Check setup and remaining verification

Use `npm run check:shopper` in a source checkout or the existing container
preflight command from [C16.5.1](SHOPPER_LAUNCH.md). It reports only local
configuration and includes the configured safety model/revision; it sends no
photos or provider probes and still reports `liveVerified:false`.

The owner/manager **Shopify widget → Shopper launch readiness** screen also shows
the safety model and outstanding live review. The provider's secret/raw responses
remain absent. Built-in availability is an implementation option, not service
selection approval, legal approval or a completed deployment.

Before activation, complete the service/legal/billing/quality, Shopify/theme,
target proxy/memory/retention, real-device and supervised-pilot evidence in C16.5.
Evaluate clear adult photos, ambiguous/young-looking faces, screenshots/text
instructions, cropped/modelled products, lighting and actual generated outputs
privately. Do not put customer photos or classifications in GitHub or public logs.

Protocol reference: the official [Google Gen AI SDK types](https://github.com/googleapis/js-genai/blob/main/src/types.ts)
for structured response schemas, safety settings, token bounds and thinking
configuration. Protocol compatibility does not establish real model availability
or suitability for the shopper policy.

## Validation

On 2026-11-07, `npm test` passed **295 tests**, `npm run test:e2e` passed
**109 tests**, and `npm run build` passed. New coverage checks trusted roles,
metadata removal and image/request/response bounds; malformed/duplicate/truncated
verdicts; unsafe/uncertain assessments; provider errors/cancellation/no retry;
explicit selection and configuration conflicts; model-bound consent; guarded
avatar reuse; refunds and cancellation during output review. Browser tests cover
both safety stages, rejected-result blocking and the mobile owner model display.
The owner screenshot was inspected. External services and classification results
were mocked, with independent synthetic customer input photos. These tests prove
control flow and accounting, not actual classification accuracy or live costs.
