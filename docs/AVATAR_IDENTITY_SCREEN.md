# Optional avatar facial-identity screen (pilot)

## Goal

Forme already rejects generated full-body images that have no detectable face. This adds a **second, optional, local face comparison** that checks whether the visible generated face resembles the consenting customer's reference face, before returning a customer-avatar draft.

It is **not identity proof**, a guarantee of accurate likeness, or a replacement for the six-point human review and customer approval. This screening can be wrong for low-resolution faces, different lighting, glasses, occlusions and demographic or camera variation. The default remains **off** until evaluated on consented and representative real-world results.

## Flow

1. In `review` or `enforce` mode, a configured generation provider reports `avatarIdentityScreenAvailable: true` in `GET /api/health`. The endpoint also reports the configured `avatarIdentityMode`.
2. The web studio presents an **additional, separate consent checkbox** describing temporary local biometric comparison. The server independently rejects a request that lacks `identityCheckConsent: true`, before any provider call.
3. After the existing Gemini/OpenAI generation call returns its PNG, the studio locates one face in the upper part of the full-body result, extracts a face-centered crop and scales its longest edge to 512 pixels, converts the normalized reference face to PNG, and uses the already-bundled local recognition model to compare them.
4. In `review` mode, the API returns a draft with `identityReview.status` set to `screen_pass` or `needs_review`. The latter carries only `possible_mismatch` or `check_unavailable`.
5. In `enforce` mode, a mismatch or uncheckable output returns a safe error and no avatar image. There is no automatic retry. The generation request may still incur a provider charge. Where configured, the app's credit-metering error path applies.
6. All returned images are **drafts requiring human quality review and separate customer approval**. The review status is shown for the current draft. Distances and facial embeddings are never returned or stored.

All screening runs on the studio server with the existing pinned CPU/WASM face model. It sends **no additional request to the AI provider** and creates no durable biometric record. Temporary PNG buffers and descriptors are explicitly cleared after comparison. Existing original customer photo and provider-retention policies are unchanged.

## Configuration and rollout

```dotenv
TRYON_AVATAR_IDENTITY_MODE=off
TRYON_AVATAR_IDENTITY_MAX=0.45
```

`off` is the default. Use `review` for advisory pilot feedback and evaluate representative results before enabling `enforce`. The explicit mode takes precedence over the legacy `TRYON_AVATAR_IDENTITY_CHECK` flag. With no explicit mode, legacy `1` still selects enforcement. Invalid modes and thresholds fail at startup. Update both the web client and backend before the pilot so staff can record the additional consent.

`TRYON_AVATAR_IDENTITY_MAX` is a Euclidean distance threshold in `(0,1]` for the existing model. This value is **not calibrated for full-body generated avatars**; 0.45 is a starting pilot value, not an endorsed accuracy/safety cutoff. Pilot with diverse consented portraits, measure false acceptances and false rejections, and tune carefully **before** any broader rollout. Do not silently lower or raise the threshold to hide failures.

The pilot covers `POST /api/personalize` in the staff Avatar Studio. It does not change the separate hosted shopper workflow, jewellery identity setting (`TRYON_IDENTITY_MAX`), previously saved avatars, or exports of sample templates.

## Safe verification

Automated tests cover explicit consent, disabled-default behavior, rejection before avatar return, face crop bounds, bad inputs, comparison failure and temporary-buffer disposal. Provider and recognition network calls are stubbed in tests. CI should pass `npm run format:check`, `npm test`, `npm run build` and `npm run test:e2e`.

The model's actual likeness performance, latency and bias are **not established by unit tests**. A live evaluation protocol using appropriate consent and private evaluation records is required before production enablement.
