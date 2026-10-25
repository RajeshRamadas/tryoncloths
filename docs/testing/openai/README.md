# OpenAI migration validation — version 0.3.0

The backend now uses OpenAI image edits, with three input files (standard body, customer face, customer full body), one requested PNG portrait, and explicit OpenAI consent. The default model is `gpt-image-1.5` with low output quality and high input fidelity. The website's public access setting remains supported; installed Android connections use protected mode.

Verified locally:

- All 23 unit/API tests passed, including multipart image ordering, bytes and MIME types; model/quality options; one-call behavior; safe provider errors; rejected old/missing-provider consent; and model metadata checks that never request generation.
- The browser suite completed 29 scenarios successfully. One randomized native-bridge scenario timed out while waiting for the initial page's height field; that unchanged scenario passed in a targeted rerun in three seconds. All 30 scenarios therefore passed across the initial run and targeted rerun. These tests use simulated native bridges and provider responses, not a physical device or live OpenAI account.
- Production Docker image built. Read-only containers passed configuration checks in both public and protected modes. Compose validated with an OpenAI key placeholder and no Gemini credentials. The packaged model diagnostic ran with a simulated metadata response.
- Android debug build and lint completed successfully. The APK bundles OpenAI consent and the `customer-avatar-v3` contract, and its checksum is recorded in [SHA256SUMS](../../../downloads/SHA256SUMS).

The adapter's request format was checked against [OpenAI's official image-edit SDK definitions](https://github.com/openai/openai-node/blob/master/src/resources/images.ts). Tests use independently generated dummy customer photos, with stubbed output for generation. No paid OpenAI request was made. Live image fidelity, skin tone, body preservation, model/project access, latency, price and physical Android behavior remain to be checked with the configured account.

See [setup and migration](../../GENERATION_SETUP.md) to configure the server key and deploy. A successful model metadata check does not guarantee image-generation billing or quota.
