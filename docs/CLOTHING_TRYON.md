# Clothing try-on

**Web 0.8 account storage:** see [store accounts](STORE_ACCOUNTS.md) for sign-in, automatic saving, reuse across browsers and the persistent-volume deployment command. This web update does not rebuild the Android APK. Local-library instructions below apply when account storage is disabled.

Approve an avatar in **Review & save**, then choose **Try clothes**. You can use an approved sample offline or an approved generated customer avatar. The original avatar stays unchanged. Use **Saved avatars** to reopen a previously saved customer avatar or downloaded PNG without another generation; see [the reuse guide](SAVED_AVATARS.md).

1. Choose one of eight **Complete outfit combinations**, or select a shirt/top, trousers and shoes independently. The catalogue has **44 sample options**: 12 T-shirts, eight button-down shirts, six jeans, seven chinos, seven sneakers and four leather shoes. Colours include white, black, grey, navy, blue, red, burgundy, green, olive, pink, lavender, cream, beige, sand, brown and tan. These reuse realistic AI-created textures, not photographs of store inventory.
2. To use store garments, select the category and choose **Import top layer**, **Import trousers layer** or **Import shoes layer** (a left/right pair).
3. Adjust left/right, up/down, width and length to line up the garment with the avatar. Check the neckline, waistband, hands and cuffs, and ensure the original clothing is covered.
4. Confirm the outfit review checkbox, then **Download outfit** in the browser or **Save or share outfit** on Android.

Switching, adjusting, importing and downloading unbranded sample clothes happen locally with Canvas compositing. They make no AI requests. Customer-avatar generation and product-photo/link try-on use the configured provider after consent. Saving a look to an account and preparing a store-branded export send the composite to the backend, without generating another image. The displayed composite and exported PNG use the same renderer and layer order: avatar, shoes, trousers, then top. Shoes sit beneath trouser cuffs.

## Expanded colour wardrobe

The 20 tops, 13 trousers and 11 footwear pairs provide **2,860** complete
combinations. **Weekend casual**, **Office classic**, **Earth tones**,
**Monochrome**, **Summer light**, **Evening smart**, **Colour pop** and
**Soft pastels** each apply all three categories at once. Individual pieces can
then be changed independently. A selection or placement edit resets outfit
approval; review again before downloading or saving the look.

Use **Search sample clothes** to find a colour or style in the active category.
Switch categories to browse matching trousers or shoes. A search never hides
imported layers, and clearing it restores the complete sample list. The original
top/bottoms and bare-feet buttons remain available during searches.

Colour variants preserve the prepared texture's shading and transparency. The
same colour treatment is used for the thumbnail, avatar overlay and download;
it is never applied to the customer's face, skin or imported garments. These
samples use the existing male standing pose. Female samples still need separate
preparation; female profiles continue to support product-photo try-on and
compatible imported layers.

## Preparing store layers

Use transparent PNG or WebP files under 10 MB and at most 16 megapixels. The layer must contain a visible garment, with a transparent background, in the same front-facing pose as the avatar. The importer crops transparent outer padding, preserves transparency and starts with the garment's aspect ratio. Opaque product photos and SVG uploads are rejected. There is no automatic background removal, body segmentation or garment warping.

Prepare each garment for the intended standard body profile (Slim, Regular, Athletic or Broad). Samples use approximate profile-specific widths. Customer generations can differ from the standard reference in framing and proportions, so staff must check and adjust placement. Separate layers for different poses/profiles will give better results than stretching one product image. Importing a layer is an in-session action, not a persistent store-catalogue upload; up to 12 imported layers are held at a time. Return to the avatar without losing the outfit; starting a new session or changing the approved avatar discards it. Reloading the app also clears it.

This is a 2D styling preview. It does not infer fabric drape, sizing, physical fit, hands in front of garments or unseen garment surfaces. The sample catalogue uses pre-generated textured transparent images, not photographed merchandise. The original clothes are covered by overlays rather than erased: a narrower/shorter layer can leave them visible. Use compatible covering layers and review the result before exporting.

## Deployment

Website, on the existing Lightsail instance:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Refresh the page. No provider-key changes are needed for clothing selection.
Keep both Compose files so account storage stays enabled, and retain the
persistent volume. This is a web-only update. The existing Android APK remains
0.7.0 and does not include the expanded wardrobe.

## Validation

The expanded wardrobe's unit checks cover unique items, valid complete outfits,
available base assets, unchanged alpha channels for every colour, and retained
shadows/highlights. Eight clothing browser tests cover independent selections,
unchanged head pixels, customer-avatar reuse, transparency/import rejection,
matching export pixels, approval reset, profile invalidation, all eight complete
looks, colour search, mobile layout and the simulated Android share bridge.
See [validation and screenshots](testing/colour-wardrobe/README.md). No live
provider generation or APK build is part of this web update.
