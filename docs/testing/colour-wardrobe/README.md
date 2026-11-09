# Expanded sample wardrobe validation

The web catalogue now contains 44 reusable sample items: 20 tops, 13 trousers
and 11 footwear pairs. Eight complete sample looks can be applied with one tap;
mixing individual pieces offers 2,860 combinations. Thirty-five colour variants
reuse the nine original prepared garment textures. Selection and recolouring
take place in the browser without provider requests or AI credits.

## Screenshots

Captured from the production build served by `server/index.js --production`,
using the regular standard sample avatar. These are sample clothing previews,
not real inventory or evidence of physical fit.

- [Complete outfits and dressed avatar, desktop](desktop.png)
- [All 20 tops, mobile width](tops-mobile.png)
- [All 13 trousers, mobile width](trousers-mobile.png)
- [All 11 footwear pairs, mobile width](shoes-mobile.png)

## Checks

- `npm test`: **453 passed**.
- `npm run build`: passed TypeScript checking and Vite production build.
- `npx playwright test tests/browser/outfits.spec.js --workers=1`: **8 passed**.
- `npx playwright test --workers=1`: **144 passed** across the full browser suite.
- Production browser smoke: all three sample categories rendered, the complete
  Earth tones outfit applied, thumbnails loaded, no horizontal overflow at
  390 px, no browser page errors and no personalization/try-on requests.
- `git diff --check`: passed.

The new unit coverage checks catalogue IDs/names, preset references, every
variant's underlying asset, unchanged transparency and preserved tonal detail.
Browser coverage checks colour search, imported layers during searches, all
eight preset selections, independent category edits, approval invalidation,
unchanged avatar head pixels and exact downloaded composite pixels.

The production screenshots were checked visually. Female samples remain gated
because these layers use the existing male standing pose. Approximate placement
controls remain available for different male profiles and generated avatars.
No live AI call, Docker deployment, physical device test or APK build was
performed for this change.
