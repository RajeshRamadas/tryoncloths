# AI Fashion Studio · Product Requirements

**Version 1.0 · 24 November 2026**  
**Audience:** Product owner, implementer, QA, and coding LLM  
**Companion:** [AI_Fashion_Studio_Technical_Design.md](AI_Fashion_Studio_Technical_Design.md)

## 1. Goal and scope

AI Fashion Studio lets a shopper assemble an outfit from items sourced independently. For example, they can import a striped shirt from one retailer, import olive chinos from another, upload a photo of their own belt, and see all three on the same saved avatar. Each item remains independently selectable. The shopper can build an outfit without paying for an image on every change, then explicitly request a realistic image for the combination they like.

This specification covers the consumer **avatar, wardrobe, outfit builder, and virtual try-on**. It carries forward ideas from the earlier [compositing requirements](https://chatgpt.com/library?file_id=libfile_fded93881fec81919d1d67d8bd8ddee1&account_id=personal) and [AI try-on requirements](https://chatgpt.com/library?file_id=libfile_76b622a1deb88191b7bfba4a778dcc6e&account_id=personal). For this build, layered previews and multi-item generation use the same wardrobe and outfit records. Retailer onboarding, checkout, inventory sync, and multi-tenant SaaS are separate projects.

### Release priorities

| Release | Product scope | Exit condition |
| --- | --- | --- |
| M1 · Outfit builder | Reusable avatar, wardrobe, camera/file upload, saved items, two-dimensional quick preview, outfit save and reopen | A shopper composes a top, bottom, and belt on a standard avatar and swaps one item without an image-generation call |
| M2 · Import and realistic preview | Imports from multiple supported stores, multi-reference image generation, usage limits and optional credits, results and feedback | The reference journey works across sessions. A supported test cohort meets the quality, cost, and reliability gates |
| M3 · 3D pilot | Rotatable template avatar with a curated catalog of compatible 3D assets | A supported outfit rotates and swaps correctly. Unsupported items have an explicit 2D fallback |
| Future experiments | Wardrobe suggestions, weekly planning, affiliate links, live camera AR, optional avatar personalization, retailer integration | Each experiment has its own scope and validation before release |

M1 and M2 together form the consumer MVP. Build and verify them sequentially. Launch geography is India-first, with English and mobile web as planning defaults. A native client may reuse the API when required. Styling previews communicate appearance and outfit coordination. Size recommendations, body measurement, and physical fit are outside the MVP.

## 2. Terminology and display modes

| Term | Meaning |
| --- | --- |
| Avatar | A saved identity with a reference photo for AI and, when available, a selected template for quick preview |
| Wardrobe item | One privately saved shirt, pair of trousers, belt, or other supported item with an editable category and product reference |
| Prepared 2D asset | A background-removed, pose-aligned layer with reviewed geometry and template compatibility |
| Outfit | Editable slot selections. Each saved revision identifies one exact combination |
| Look | A saved visual result linked to the outfit revision that produced it |
| Quick preview | Fixed-angle browser composition with ready 2D layers and neutral defaults for missing layers |
| Realistic preview | AI-generated image using an avatar photo and the selected product reference photos |
| 3D preview | Interactive, on-screen avatar that rotates using compatible meshes and materials |
| AR | Camera-based overlay on a live person, with category-specific tracking requirements |
| VR | Headset-oriented dressing-room experience. No headset is needed for the 3D pilot |

[Three-style preview mockup](https://chatgpt.com/library?file_id=libfile_24455882ef9c81918880f031914c4523&account_id=personal) · [Saved avatar and selected items mockup](https://chatgpt.com/library?file_id=libfile_161167c755748191929b24707dcba12f&account_id=personal)

## 3. Users and permissions

| Actor | Allowed actions |
| --- | --- |
| Visitor | Open the demo and swap curated sample layers without an account |
| Shopper | Manage their avatar, wardrobe, drafts, generation requests, results, and deletion |
| Catalog operator | Prepare and approve curated 2D and 3D assets. Default access is limited to catalog assets |
| Support operator | See job status, error codes, usage, and user-reported details. Any separately granted access to user media is time-limited and audited |
| Worker | Read and write only the assets required for its job and owner |

Private wardrobe, photos, and results use owner-scoped authorization on every operation. An account is required for persistent private data and paid generation.

## 4. Reference journey

1. Sign in, choose a front-facing template avatar, and optionally add a clear full-body photo as the reference for realistic try-on. Show the photo-processing notice before upload.
2. Open **Wardrobe → Add item**. Import a striped shirt and olive trousers from two supported URLs. Confirm the exact photo, variant when known, and category for each. Add a brown belt from the camera or photo picker.
3. Open **Build outfit**. Set **Top**, **Bottom**, and **Belt** separately. The quick-preview panel draws ready layers. A selected item waiting for preparation is visibly marked in its slot.
4. Tap **Swap belt** and select another belt. Top and bottom stay selected. Choosing the old belt restores its exact configuration. Save the outfit and reopen it after signing in again.
5. Tap **Generate realistic look**. Review the selected items and cost before confirming. Leave the screen and return while the request is processing. The result stays attached to the original combination even if the draft changed.
6. Save or download the image, report an incorrect result, or adjust the outfit and request a new generation. Open each imported item’s original product page from the wardrobe or result details.

## 5. Functional requirements

### Account and avatar

| ID | Release | Requirement |
| --- | --- | --- |
| AV-01 | M1 | Reuse the existing login flow where available. Provide a demo mode with template assets. |
| AV-02 | M1 | Select, name, set default, replace, or delete a saved avatar. Display which avatar and preview representation are active. Require exactly one active avatar per outfit revision. |
| AV-03 | M1 | Offer a reusable, front-facing standard avatar with a neutral base and validated compatible layers. An uploaded user photo may be the realistic reference while quick preview still uses the chosen template. Label the template visibly in this case. |
| AV-04 | M1 | Accept a consented image of a single person with the garment region visible. Show capture guidance and actionable errors for cropping, unusable viewpoint, or image problems that validation can detect. Tell the user when visual quality requires their confirmation. |
| AV-05 | M2 | Preserve earlier outfit meaning when the default avatar changes. New drafts may use the new default. Privacy deletion of a reference invalidates affected historical media as specified below. |

### Item capture, URL import, and wardrobe

| ID | Release | Requirement |
| --- | --- | --- |
| WD-01 | M1 | Add items through camera capture, local photo selection, or the curated collection. Denied camera permission leaves photo upload available. MVP categories are top, bottom, and belt. Socks, base footwear, and other visible defaults are template properties. |
| WD-02 | M1 | Confirm category, display name, photo or crop, and optional color and tags. Store provenance and a separate original product reference when available. Draft items can be corrected after a failed upload or preparation. |
| WD-03 | M1 | Browse, filter by category, edit, archive, and permanently delete owned items. An archived item remains visible in historical outfits and is excluded from new selections. Permanent deletion revokes its assets and makes affected generations and paid history available only to the extent described in PR-02. |
| WD-04 | M1 | Track readiness by mode independently. An image may be ready for AI generation while its 2D layer requires alignment or its 3D assets are absent. The shopper can continue using ready items while another is processed. |
| WD-05 | M2 | Add product URLs independently from supported retailers. Present candidate product photos with title and variant when available. Require the user to confirm the chosen image and garment category. Separate the item from unrelated product recommendations, images or bundles. |
| WD-06 | M2 | Show **Upload item photo** when URL import fails, the retailer is unsupported, accessibility is restricted, or the image is unsuitable. Retain the entered URL as an optional source link if safe. Support retailer APIs, permitted metadata and approved feeds according to connector capability. |
| WD-07 | M2 | Preserve the original source link even when an affiliate link is later enabled. Refreshing retailer metadata must not silently change the selected image, variant, or item version in a saved outfit. |

### Outfit builder and quick preview

| ID | Release | Requirement |
| --- | --- | --- |
| OF-01 | M1 | Provide one optional selection each for top, bottom, and belt. Enable realistic generation only after at least one valid item is selected. A swap, clear, reset, or undo changes only the stated selection or action. |
| OF-02 | M1 | Draw compatible ready layers locally in the front pose. The first release supports a curated set and reviewed compatible uploads. Use the neutral template layer where a selected item lacks a compatible overlay and show **Quick preview unavailable for this item** beside the selected item. |
| OF-03 | M1 | Support visible belts over the waistband and a tucked-shirt style for assets that carry the required layer variants. Explain when a chosen shirt hides the belt. The UI cannot imply a belt or garment has been rendered if it is omitted. |
| OF-04 | M1 | Save a named outfit and reload the same avatar and item versions. Expose the current combination and older realistic results clearly. Handle concurrent edits across sessions with revision checks and a reload or duplicate option. |
| OF-05 | M1 | Keep the front preview usable on mobile. Provide manual item pickers with accessible focus, status announcements, and clear labels for selected, missing, disabled, and pending states. |
| OF-06 | M2 | Present **Quick preview**, **Generate realistic look**, and, when eligible in M3, **3D view**. Separate readiness and cost per mode. Selecting an item, changing tabs, opening the screen, and retrying a quick preview have zero paid generation calls. |

### AI generation and saved results

| ID | Release | Requirement |
| --- | --- | --- |
| AI-01 | M2 | After explicit confirmation, use one stored avatar reference and the selected item references in stable slot order. Attempt to preserve face, build, pose, and unchanged visible clothing. Keep shirt pattern, trouser color, and buckle cues recognizable where the model can follow them. |
| AI-02 | M2 | Start with a configurable economical preview preset. Publish the credit cost or free allowance before submission. Higher quality can be enabled after benchmarking. It is a separate confirmed job. |
| AI-03 | M2 | Show queued, processing, succeeded, failed, or cancelled state. Restore results after reload. When a draft changes during generation, label the result with its original outfit revision and allow the shopper to open that revision. |
| AI-04 | M2 | Apply at most one settlement for a successful result. Release reservations for terminal failure or cancellation. Prevent repeated submissions from double-charging. Offer user-initiated regeneration under the shown pricing and quota rules. |
| AI-05 | M2 | Allow save, download, delete, and report. Explain that generated garment details may vary. Keep user input and generated results private. A valid but visually imperfect image is reportable and may be resolved through the configured credit-adjustment policy. |
| AI-06 | M2 | Allow reporting missing items, altered prints or logos, altered face, artifacts, or other. Store feedback with the job and model version. Loss of provider availability leaves quick preview and wardrobe available. |

### 3D, AR, wardrobe planning, and affiliate follow-ons

| ID | Release | Requirement |
| --- | --- | --- |
| XR-01 | M3 | Render a rotating default 3D avatar on supported browsers. Provide reset view and front, side, and back controls. Gating requires a compatible curated asset for every selected item and a compatible avatar. |
| XR-02 | M3 | Users can swap prepared shirts, trousers, and belts without paid generation. Mark generic meshes derived from templates as **3D approximation**. If any item has no compatible asset, keep quick preview available and identify that item. |
| XR-03 | Future | Prototype camera AR for one category first, such as a belt or accessory. Validate tracking, scale, depth, occlusion, camera permission, and visible quality on target devices before adding full outfits. VR is a separate discovery item. |
| ST-01 | Future | Accept a mood, occasion, color preference, or free-text brief. Suggest combinations from saved item IDs and explain choices. Let users review and edit a seven-day wardrobe plan. Recommendations can use rules or a text model. Images require explicit generation. |
| CO-01 | Future | Use approved affiliate programs by retailer, country, and product when available. Show the commercial relationship, keep the original product link accessible, and fall back to that link if no affiliate route exists. |

### Privacy and operations

| ID | Release | Requirement |
| --- | --- | --- |
| PR-01 | M1–M2 | Record the version of the photo-processing notice accepted by the user and their confirmation of permission to use personal photos. Use private storage, short-lived access, scoped operator access, and a provider approved for the configured handling terms. |
| PR-02 | M1–M2 | Provide deletion for photos, avatars, wardrobe items, looks, and accounts. Immediately revoke new reads and job dispatch for impacted private media. Delete dependent private outputs and derivatives on a documented schedule. Keep only necessary minimized operational or credit records per the published policy. |
| PR-03 | M1–M2 | Start with explicit, configurable limits for file size, normalized image pixels, storage quota, rate limits, daily generations, and job retention. Run a support and deletion exercise before private beta. |
| OP-01 | M1–M2 | Operators can see validation errors, timeouts, state transitions, queue age, approved-asset status, and generation cost using opaque IDs. Protect personal images, URLs, and prompt contents from logs. |

## 6. Acceptance criteria

| Test | Scenario and pass criteria |
| --- | --- |
| AC-01 | **Independent sources.** A supported shirt URL, a second store’s trousers URL, and a belt upload yield three reusable wardrobe entries. Each retains its own source and category. Reopen the outfit to see the same three entries. |
| AC-02 | **Fast swap.** With ready layers cached, selecting a second belt updates the rendered belt and the belt slot. A front-view image comparison verifies other eligible layers are unchanged. The generation adapter receives zero calls. |
| AC-03 | **Unsupported quick layer.** A valid shirt reference without an approved overlay stays selected and shows the neutral template plus a per-slot message. It remains eligible for realistic generation if the source reference passed validation. |
| AC-04 | **Import fallback.** A timeout, unsupported store, denied access, or ambiguous product image offers a manual photo path. A cancelled import never creates a confirmed wardrobe item. |
| AC-05 | **Correct job context.** A confirmed outfit with three items produces one job with four ordered references. Change the draft’s trousers while processing. The result remains linked to the original trousers and the UI identifies that version. |
| AC-06 | **Credit correctness.** Concurrent duplicate submissions using one key return the same job. One successful job charges once. Failed and cancelled jobs release their hold. A late callback after cancellation must not publish a result or settle twice. |
| AC-07 | **Ownership and deletion.** A different account cannot read the avatar, asset, job, outfit, or result. A deleted reference can no longer start a job or receive a fresh URL. Repeated deletion requests converge safely. |
| AC-08 | **Photo controls.** The user can change or remove the avatar reference, retry a bad upload, use the template after rejecting photo upload, and remove application-held private data. |
| AC-09 | **3D fallback.** A curated three-item outfit rotates and has a keyboard alternative. Replacing the belt with an upload without 3D assets disables 3D for that outfit and explains why. |
| AC-10 | **Recovery.** A reload during a running job shows its true server status. Duplicate worker deliveries, dropped client polling, and a retryable timeout do not create two visible results. |
| AC-11 | **Output quality.** For released category combinations, reviewers can identify the selected pieces and find acceptable resemblance using the benchmark in the technical design. Results with missing or altered details can be reported. |
| AC-12 | **Mobile and accessibility.** At 360 CSS px width, users can add, swap, save, and request a preview without horizontal scrolling. Keyboard and screen-reader flows cover selection, progress, and errors. |

## 7. Pilot targets and open decisions

These are proposed acceptance targets, to be measured before rollout.

| Metric | Initial target |
| --- | --- |
| Cached 2D slot swap | p95 ≤ 150 ms from input to paint on the selected mid-range phone |
| Quick preview first usable render | p95 ≤ 2.5 s on a repeat visit with 4G test conditions and ready assets |
| AI job status | Show queued or running within 2 s of accepted submission. Start with p95 ≤ 90 s to terminal state for successful preview jobs under pilot load |
| Reviewable AI output quality | At least 80% of the 60-case pilot set meets the face and all selected-item rubric. Report failures by category and combination |
| Duplicate credit settlement | Zero in concurrency, retry, and replay tests |
| Cost | Track cost per accepted output and cost by provider, quality preset, and combination. Establish the launch ceiling before enabling paid beta |

Provider and model, supported importer domains, photo retention periods, paid pricing, credit rates, mobile device matrix, and catalog asset rights are release decisions. Use a fake generation provider and labelled synthetic test assets in development so these decisions do not block M1 or integration tests.
