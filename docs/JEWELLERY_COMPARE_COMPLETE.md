# J10 — Jewellery variants and complete looks

Web `0.20.0-alpha.10` adds side-by-side jewellery comparisons and a complete-look
board combining a saved outfit with a saved jewellery portrait. Both require
store sign-in and `TRYON_JEWELLERY=1`. A new AI variant uses one credit, approved
exact reuse uses none, and complete-look composition uses none. No APK or live
service deployment is included in this update.

## Link variants

Owners/managers save each metal or stone design as its own catalogue item and
photo. Open **Jewellery catalogue → Link metal / colour variants** on the
alternate item, find the original design, select it and save the link. Each
variant points directly to one original of the same jewellery type. A root with
children must be unlinked before it can join a different family. Cross-store,
self, nested and circular links are rejected. Shared master copies remain
read-only; their master-store links are mapped into the branch's visible IDs.

The optional `attributes.variantOf` is catalogue grouping only. Linking or
unlinking retains paid visual adaptations. A changed product image, metal,
dimensions or other visual attribute still invalidates exact reuse. Editing the
normal jewellery details preserves an existing link.

## Compare two designs

1. In the Jewellery studio's **AI adaptation** mode, select a saved item and
   review the starting customer view. Choose a linked variant under **Compare
   metals and variants**.
2. Choose **Check comparison cost — free**. This performs no provider request.
   The quote shows each variant's cost and the total: 2 credits for two new
   images, 1 if one is approved for this exact starting state, or 0 if both are.
3. Confirm customer consent for both selected avatar-and-product requests at the
   displayed cost, then choose **Compare both variants**. Each is generated from
   the same starting image, with the same placement; variants are not stacked.
4. Review each output separately. Download either, or confirm storage agreement
   and **Save reviewed variants for reuse**. Rechecking the exact comparison then
   reports zero credits for the approved results. Save/download previews before
   changing the customer, view, item or placement.
5. **Use [variant]** adds that result to the current jewellery set. Review the set
   before adding more pieces or saving the finished look.

Every provider request uses its own UUID, credit hold, image checks, receipt and
refund. Results are never approved automatically. A failed second variant
refunds only that attempt and returns the first completed image for review and
saving; there is no automatic retry. Session revocation, erasure and changed
visual inputs prevent delivery of private/stale results. Cancelling or a lost
connection may leave a provider charge; do not regenerate just to save a result.

Quotes expire after five minutes and bind the store/user, both exact input
contexts and maximum credit cost. Changed inputs or an increased cost require a
new quote. Missing generation credentials still allow already-approved reuse.
New comparisons require enough credits for all new outputs before starting;
concurrent spending can still leave a partial result. The pilot's 20 hourly
attempt cap remains per user; one consented pair may execute consecutively,
while the 15-second gap still applies between separate fitting operations.

## Build the complete look

Save a clothing look and a portrait jewellery look under the same avatar. Open
**Jewellery studio → Complete look**, or **Combine with jewellery portrait**
beside a saved clothing look. The builder is `/complete-look?avatar=ID`.

Select the two saved references, then **Build complete look — free**. A client
canvas fits the full-body clothing image into 1024 × 1536 px without stretching
it. The portrait inset is 40% of that width, at the top right with a rounded white
border. A footer lists the outfit and jewellery names in two columns with
explicit wrapping and readable type. The canvas grows vertically to retain up
to 20 source item labels; names are not cropped to a fixed footer height.

Review the complete board and confirm storage agreement, then **Save complete
look**. The server independently composes the same owned sources/layout, checks
that neither source changed and saves the canonical PNG with `view = complete`
under the same avatar. It accepts source IDs and a source hash, not arbitrary
client-supplied pixels. The saved board remains available if a source look is
later removed; normal avatar/customer erasure still cascades to the board.

Download the full-resolution board or share it with separate sharing consent.
Existing branding/trial and share-expiry/revocation rules apply. It carries the
portrait's AI/Overlay/mixed preview label once; the public share page identifies
it as a complete look. Reopen it from **Saved avatars → View looks → Open
complete look**, without another provider call. Complete boards are not accepted
as portrait, hands or full-body inputs to jewellery generation.

Composition does not merge portrait pixels into the body's face or infer fit,
lighting or occlusion. It presents the saved outfit and detail portrait together.

## API / implementation

- `GET /api/jewellery/variants/:id`: up to 50 available same-family choices,
  metadata/thumbnails only, with normalized master-store links.
- `POST /api/jewellery/compare`, `action: quote`: same placement/base proof as J7
  plus `itemIds: [first, second]`; returns a signed quote and per-variant costs.
- Same route, `action: run`: quote, two fresh UUID `requestIds`, `consent: true`,
  `consentScope: compare-two-variants`, `consentProvider: gemini`. Returns completed
  `{item,result}` pairs and a partial flag/error when appropriate. Single-piece
  and comparison generation share the existing J7 execution and metering path.
- `POST /api/jewellery/complete/prepare`: avatar, clothing look and portrait look
  IDs; returns normalized owned references, source hash and deterministic layout.
- `POST /api/jewellery/complete`: same IDs/hash plus name, review and storage
  agreement; returns the persisted complete board. It uses no AI job/credit hold.

All paths enforce the pilot flag, store membership, same origin and live session.
Asynchronous work rechecks identity and source state. Comparison and composition
share the two-request-per-worker preparation bound. No provider keys, fresh face
photos or descriptors enter saved comparison/board records. Runtime packaging
includes the shared canvas/layout module for the server renderer.

## Validation

Unit/route coverage checks quotes and exact reuse, independent bases/charges,
partial refunds, invalid links, tenant/role/origin boundaries, stale quotes,
duplicate IDs, credit balance, pilot gaps, revoked sessions, shared masters,
complete-board geometry, wrapped Unicode names, source consent/hash/kind,
public labels and reopening after source deletion. Browser tests cover linking,
cost-before-consent, two variants, approval, free reuse, choosing a result,
partial-failure download, complete save/export/share/library reopen, disabled
flags and session cleanup at 390 px.

Tests use local customer fixtures and injected generation, never live Gemini.
They verify product behavior and accounting, not live-provider jewellery fidelity
or anchor accuracy. [Browser captures](testing/jewellery-compare-complete/README.md)
show the tested screens. J11 now adds [optional sizing help](JEWELLERY_SIZING.md);
pilot quality/cost and commercial release evidence remain outstanding.
