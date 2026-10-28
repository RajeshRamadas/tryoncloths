# Clothing try-on verification — 0.6.0

Captured from the local app with a standard sample avatar, a textured navy T-shirt, sand chinos and white sneakers. These are local Canvas composites using pre-generated transparent catalogue images. They are not photographs of real store inventory or product-fit predictions.

- [Desktop screenshot](desktop.png)
- [Mobile screenshot](mobile.png)

33 unit/API tests and five focused clothing browser scenarios passed. Coverage includes transparent assets, open T-shirt necklines, independent footwear selection/removal, unchanged upper-body pixels when changing shoes, review invalidation, local imports, generated-avatar reuse, exact export pixels and Android share-bridge output. Android 0.6.0 debug assembly and lint passed. Physical-device validation remains pending.

No customer-avatar provider calls were made during testing. Catalogue images were created once with image generation and packaged with the app. Choosing clothes makes no AI request. See [the usage and layer guide](../../CLOTHING_TRYON.md) for supported inputs and limitations.
