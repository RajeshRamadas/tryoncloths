# Simpler studio — interface review and implementation

Current-run screenshots use an isolated test store and a standard sample avatar.
No customer photos, external messages or paid generation were used.

## Before

1. **Customer start — crowded.** [Mobile capture](01-before-home-mobile.png).
   The account block places catalogue, marketing, billing, analytics and staff
   controls above the customer form. Saved avatars and the first step fall below
   the initial screen. Keep the store identity and credits visible; group
   management tools behind a clearly labelled menu.
2. **Clothing — too much at once.** [Desktop capture](02-before-outfit-desktop.png).
   Eight complete looks consume the first controls screen while individual
   clothes, product photos/links, imports and review/export continue below.
   Separate samples from store products, reveal complete looks and manual
   placement on request, and put review/download beside the preview.
3. **Jewellery — unclear order.** [Mobile capture](03-before-jewellery-mobile.png).
   The large heading and navigation consume space before the saved view. The
   screen later shows catalogue filters, upload and link fields together.
   Add a short choose/view/review guide and one visible product source at a time.

The existing photo consent, explicit approval, AI-credit labels and preservation
of saved avatars are strengths to retain. Visible accessibility risks include
long mobile reading order and dense similarly styled controls. Screenshots do
not establish keyboard or screen-reader support; the implementation needs
keyboard focus, dialog dismissal and responsive-layout browser checks.

## After

1. **Customer start — clearer.** [Mobile](04-after-home-mobile.png). The compact
   store summary keeps saved avatars in the initial mobile viewport. Management
   links move into [Store tools](05-store-tools-mobile.png), grouped by task and
   existing role permissions. The native modal covers the page, wraps keyboard
   focus, closes with Escape/backdrop/close and restores focus to its trigger.
2. **Clothing — fewer simultaneous decisions.** [Desktop](06-after-outfit-desktop.png)
   and [mobile](07-after-outfit-mobile.png). Sample clothes and store products
   are separate choices. Complete looks, placement and prepared-layer import
   expand on request. Review/download sits beside the avatar. Source switching
   keeps selections and drafts; mobile shortcuts jump between clothes and preview.
3. **Jewellery — explicit sequence.** [Desktop](08-after-jewellery-desktop.png)
   and [mobile](09-after-jewellery-mobile.png). A choose/add/review guide explains
   the order. Saved jewellery, photo upload and product links have separate
   controls, with short view-selection help. Secondary links are in More options.

Saved-look names and undo remain visible in either clothing source. The reuse
checks reopen an account look in another browser and verify exact saved-product
adaptations after moving between samples and store products.

The after captures use the standard avatar in the existing generated-avatar
reference frame. The square upload in the jewellery source check is deliberately
a dummy product image. These captures demonstrate interface behaviour, not live
provider quality or jewellery realism.

[Production-build fitting room](10-production-outfit.png) is a separate capture
from the compiled site running through `server/index.js --production`, using the
unpersonalized standard sample workflow.

## Validation

Three new browser scenarios check the native modal/backdrop, Tab wrapping,
keyboard activation of Staff, Escape and focus restoration; clothing source
switches, preserved drafts/selections and reset review after placement changes;
and jewellery source visibility, preserved links and uploads without paid calls.
Existing browser scenarios follow the new menu/source choices while retaining
their API, permissions, persistence, export, billing and consent assertions.

- `npm test`: **453 passed**.
- `npm run build`: TypeScript and production build passed.
- `npx playwright test --workers=2 --timeout=60000 --max-failures=3`:
  **147 passed** across the full browser suite.
- Three focused interface scenarios passed, including keyboard activation of
  Staff inside the modal and focus restoration after dismissal.
- Production browser smoke passed source visibility, a complete sample outfit,
  review/download eligibility, preserved drafts/selections, mobile navigation,
  no page errors and no personalization/try-on requests.
- `git diff --check`: passed.

The review used local browser automation against isolated stores. Production
Lightsail, screen readers, physical devices and live provider output were not
tested. No APK build, API-key change, pilot activation or external message was
performed. See [the interface guide](../../STUDIO_INTERFACE.md) for usage and the
existing shared-Caddy web deployment command.
