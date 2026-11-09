# J8 — jewellery studio

J9 adds [free transparent cut-out overlays](JEWELLERY_OVERLAY.md) alongside this
AI workflow. Overlay placement uses no Gemini key or AI credit.


Web `0.20.0-alpha.8` adds Task J8's staff screen using the
[saved views](AVATAR_VIEWS.md) and [J7 API](JEWELLERY_API.md).
It loads separately from the main app bundle. No APK, production deployment,
flag activation or live paid request is made by this release.

## Open and prepare

Use persistent account storage, `TRYON_JEWELLERY=1` and the configured Gemini
image service. The existing female generation pilot flag still applies.
Sign in, open and approve a saved avatar, then choose **Jewellery** beside
**Try clothes**. **Saved avatars → Jewellery for [customer]** also opens it.
The route is `/jewellery?avatar=ID`; disabled studios expose no photo or paid controls.

Portrait preparation embeds J5's existing flow: fresh photo, whole head visible,
face forward, neck/collarbones and ears visible where possible. Moving hair
behind the ears requires customer agreement. Confirm the approved body and
provider consent, generate once, review, then approve storage. Sample hands are
free reusable templates in the chosen tone, not the customer's own hand photo.
An approved view is reused for each piece; a replacement is optional.

## Choose and fit

- Browse saved jewellery by name, type and metal, with images, purity and private
  catalogue prices. Pagination and stock filtering use the existing catalogue.
- Paste a product link. Saved matches are offered first; the shared product-photo
  reader retains clothing's URL guards and optional isolated-reader fallback.
- Upload a JPEG, PNG or WebP product photo/screenshot. Matching saved products
  are offered without silently selecting another variant.
- New photos/links can suggest a type from the title. Staff must confirm the
  type/photo and choose the metal. Dimensions are optional approximate scale cues.
  Owners/managers can explicitly consent to saving the product to inventory;
  staff can fit uploads without acquiring inventory-write permissions.

Type/length selects the view. Necklaces, pendants and mangalsutra allow a
portrait/full override. Choose pair/side, hand/finger, wrist/bangle count and
whether to replace existing jewellery only in that region. Left/right means
the wearer's anatomy. Preview count changes do not edit the saved bangle item.

Review the current base and obtain fresh view-and-item consent for every action.
A new image uses one AI credit; an approved exact match is reused free. Failed
J6 checks refund the app credit, without reversing possible provider charges.
There are no automatic retries. Each accepted result becomes the next base.

Each view has its own history, up to ten pieces per look. **Undo last jewellery
item** restores the prior image with no AI. **Reset jewellery view** restores
the approved base. A reopened archived look is a complete image: undo applies
to additions made after reopening. The preview has a zoom slider, internal
scrolling, touch pinch zoom and the AI-preview label; dimensions do not verify fit.

## Keep and share

Review the final image, name it and confirm storage consent. **Save jewellery
look** saves the raw image, view and ordered item/placement metadata under the
same avatar. Eligible catalogue adaptations in the stack are also approved for
exact-context reuse. If that approval fails, a saved look is retained without
retrying generation. Open it from **Saved avatars → View looks → Open jewellery
look**, without AI, and review it before exporting or adding more pieces.

**Download jewellery PNG** appends “AI preview — actual piece may differ in
detail” below the image without cropping anatomy. Existing store/trial branding
is respected. Sharing needs separate consent and uses existing expiring links,
revocation, copy/native share and optional WhatsApp click-to-chat. Both the public
page and PNG carry the AI-preview label. Raw saved pixels remain separate from
the labelled export. Shared labels include names, metals and purity; this release
does not put private catalogue prices on public pages.

If saving fails or a receipt expires, download the reviewed image; do not generate
again just to save it. Cancellation ignores late responses. Store/user/session
changes clear private previews, photo inputs, selections and customer state on resume.

## Storage and API additions

- `POST /api/jewellery/looks`: `avatarId`, `view`, `name`, original `image`,
  `itemsJson`, `reviewed`, `storageConsent`, and final `receipt` (or an approved
  `resultId`, or `baseLookId` for an unchanged archived image). Types, dimensions,
  ownership, original output and live session are checked before persistence.
- `GET /api/jewellery/looks/:id`: authenticated raw look and metadata for this
  store. Staff roles and the jewellery flag apply to both routes; writes need
  the same website origin.
- J7 accepts `baseLookId` plus the original base PNG and `baseReviewed: true`
  for an owned saved-look base. `count` is a bounded bangle-only preview override.
  Reuse returns a fresh signed receipt where available, without a provider call.
- Idempotent migrations add `looks.view` (default `full`) and `looks.itemsJson`
  (default `[]`). Clothing image bytes and behavior are preserved. Square hands
  images are accepted through the jewellery path; legacy clothing rules remain.
  Existing avatar/customer/store deletion cascades still apply. No fresh face
  photos, descriptors or provider credentials enter saved look records.

## Validation and next steps

Browser coverage includes portrait → earrings → nose pin → undo → save/share/
download/reopen, hand/finger/count choices, links/uploads, disabled flags and
revoked sessions. Route tests cover hands look storage/restart, tenant/proof
checks, raw image preservation and labelled public PNGs. Screen captures use
dummy product data and injected image generation, not live provider results.

Release validation: **377 backend tests, 123 browser tests and the production
web build passed**. The browser suite includes expiry during a pending export,
which cancels the download before it writes a customer image.

J9 adds [free overlays](JEWELLERY_OVERLAY.md), and J10 adds
[variant comparisons and complete looks](JEWELLERY_COMPARE_COMPLETE.md). J11 adds
[optional sizing help](JEWELLERY_SIZING.md). Customer hand photos and live jewellery evaluation remain later work. Real
Gemini detail fidelity, placement, costs, identity/hand thresholds and Lightsail
performance still require pilot evidence.

## Jewellery activity reporting

Owners/managers can review [jewellery analytics](JEWELLERY_ANALYTICS.md) from
**Analytics → Jewellery activity**. The studio groups AI, free overlay and
comparison actions for the selected avatar in one in-memory visit. Successful
fittings, first saved sets, shares and active purchase marks are reported with
explicit historical gaps; opening a saved look or checking a cost is not another
fitting. No additional AI request is made for analytics.
