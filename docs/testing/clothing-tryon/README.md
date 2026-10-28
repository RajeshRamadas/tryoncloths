# Clothing try-on verification

Captured from the actual local app with a standard sample avatar, navy illustrated top and sand illustrated trousers. These are Canvas composites, not Gemini-generated outfits or real product-fit predictions.

- [Desktop screenshot](desktop.png)
- [Mobile screenshot](mobile.png)

32 unit/API tests and 35 browser tests passed. After the final sample-coverage adjustment, all four clothing scenarios passed again. Android 0.5.0 debug assembly and lint passed. The Android bridge test verifies the shared PNG pixels against the preview; physical-device validation remains pending.

No paid AI calls were made. Customer-generation tests stub the provider output and then verify that outfit changes do not trigger a second provider request. See [the usage and layer guide](../../CLOTHING_TRYON.md) for supported inputs and limitations.
