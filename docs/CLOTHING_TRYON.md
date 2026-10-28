# Clothing try-on — version 0.6

Approve an avatar in **Review & save**, then choose **Try clothes**. You can use an approved sample offline or an approved generated customer avatar. The original avatar stays unchanged. Use **Saved avatars** to reopen a previously saved customer avatar or downloaded PNG without another generation; see [the reuse guide](SAVED_AVATARS.md).

1. Choose a shirt/top, trousers and shoes independently. The catalogue includes navy and cream T-shirts, a blue button-down shirt, blue jeans, charcoal and sand chinos, white and black sneakers, and brown leather shoes. These are realistic AI-created sample assets, not photographs of store inventory.
2. To use store garments, select the category and choose **Import top layer**, **Import trousers layer** or **Import shoes layer** (a left/right pair).
3. Adjust left/right, up/down, width and length to line up the garment with the avatar. Check the neckline, waistband, hands and cuffs, and ensure the original clothing is covered.
4. Confirm the outfit review checkbox, then **Download outfit** in the browser or **Save or share outfit** on Android.

Switching, adjusting, importing and exporting clothes happen locally with Canvas compositing. They make no AI requests and send no photos or clothing layers to a server. Only initial customer-avatar generation uses the configured provider. The displayed composite and exported PNG use the same renderer and layer order: avatar, shoes, trousers, then top. Shoes sit beneath trouser cuffs.

## Preparing store layers

Use transparent PNG or WebP files under 10 MB and at most 16 megapixels. The layer must contain a visible garment, with a transparent background, in the same front-facing pose as the avatar. The importer crops transparent outer padding, preserves transparency and starts with the garment's aspect ratio. Opaque product photos and SVG uploads are rejected. There is no automatic background removal, body segmentation or garment warping.

Prepare each garment for the intended standard body profile (Slim, Regular, Athletic or Broad). Samples use approximate profile-specific widths. Customer generations can differ from the standard reference in framing and proportions, so staff must check and adjust placement. Separate layers for different poses/profiles will give better results than stretching one product image. Importing a layer is an in-session action, not a persistent store-catalogue upload; up to 12 imported layers are held at a time. Return to the avatar without losing the outfit; starting a new session or changing the approved avatar discards it. Reloading the app also clears it.

This is a 2D styling preview. It does not infer fabric drape, sizing, physical fit, hands in front of garments or unseen garment surfaces. The sample catalogue uses pre-generated textured transparent images, not photographed merchandise. The original clothes are covered by overlays rather than erased: a narrower/shorter layer can leave them visible. Use compatible covering layers and review the result before exporting.

## Deployment

Website, on the existing Lightsail instance:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml up -d --build tryon
```

Refresh the page. No provider-key changes are needed for clothing selection. For Android, install the version 0.7.0 test APK from [downloads](../downloads/README.md). The backend generation contract remains `customer-avatar-v4`; the clothing feature is client-side.

## Validation

The 33 unit/API tests and five focused clothing browser tests passed. Clothing scenarios cover independent selections, unchanged head pixels, generated-avatar reuse without additional provider requests, import rejection and transparency, exact exported pixels, approval reset after edits, profile invalidation, narrow-screen layout footwear switching/clearing without upper-body changes, and Android share-bridge behavior. Production build, Android debug assembly and lint passed. Device camera/gallery/share behavior still requires a physical Android check; automated native tests use a simulated bridge. No live customer-avatar generation was needed for clothing tests. Catalogue images were created once using image generation and ship with the app; outfit selection makes no AI request.
