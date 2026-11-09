# Realistic sample catalogue

Nine unbranded AI-created sample garment assets, generated for this project on 2026-10-28, now supply **44 colour/style choices**. These are not photos of real inventory or guarantees of garment fit. No user/customer photo was used to create them.

Original atlas: image generation `exec-e13742c8-e6d6-4275-8f46-c1a30eef3f82.png`.
Tops refined to open the rear neckline: `exec-c253c52a-c17e-4e02-8f78-a2c3dd1e2e97.png`.

Atlas items were separated, disconnected background specks excluded during packing, and saved as transparent WebP. Footwear pairs have a widened transparent gap for the standard standing pose. Asset sizes total about 300 KB. The avatar and garment images are composited locally; no model is called when selecting clothes.

- Tops: navy-tee, cream-tee, blue-shirt.
- Trousers: blue-jeans, charcoal-chinos, sand-chinos.
- Footwear pairs: white-sneakers, black-sneakers, brown-shoes.

`src/sample-wardrobe.ts` adds 35 reusable colour variants to these nine originals:
20 tops (12 T-shirts and eight button-down shirts), 13 trousers (six jeans and
seven chinos), and 11 footwear pairs (seven sneakers and four leather shoes).
The browser applies a shared luminance-based colour treatment to the isolated
garment texture, preserving folds, highlights, neckline openings, alpha edges
and shoe-pair gaps. Thumbnails and exported layers use the same cached result.
The original assets and imported store layers remain unchanged. There is no
per-selection AI request and no extra full-size asset download for each colour.

Eight complete sample looks offer one-tap selections, with 2,860 possible
top/trouser/shoe combinations when mixing individual items. These samples retain
the existing male standing-pose geometry; female samples remain gated until
separately prepared and reviewed.

The app uses approximate placement by body profile and allows manual adjustment. A T-shirt neckline must remain open at the top: an isolated rear collar band appears across the avatar's neck. Shoes draw first, then trousers and finally the top. The tests verify transparent assets, open T-shirt necklines and clear gaps between shoes.
