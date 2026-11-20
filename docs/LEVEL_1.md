# Level 1: store-assisted avatar creation

## Agreed direction

Store staff capture a face photo and full-body photo, enter approximate height and weight, select the closest standard avatar, generate the customer's face and matching skin tone on that standard body in one AI step, and review the result for reuse. Prioritize low AI cost and responsive interaction. Clothing selection comes in a later phase.

## Current prototype

1. Obtain customer permission before accepting photos. Sample browsing is available without photos.
2. Enter height and weight. The illustrative suggestion uses weight / height²: below 20 suggests slim, below 27 suggests regular, otherwise broad. These are prototype routing thresholds, not health classifications, sizing rules, or a validated body-shape model.
3. Staff compare the customer's full-body photo to the library and adjust the selection. Athletic is a manual choice. Generated sample profiles have no calibrated measurements.
4. With a provider configured, obtain separate consent for sending both customer photos and approximate measurements, then trigger one generation. The selected body template is the third reference image. Preserve its pose/proportions while applying the customer's face, hair and natural skin tone across all exposed skin.
5. Review facial resemblance, body and skin-tone consistency, approve, and download the generated PNG. A customer-photo session cannot export a sample in place of generation. Empty sessions still support sample browsing/export.

## Asset basis

The four profiles use the generated sample image approved for prototype exploration in the conversation. The image is a contact sheet, displayed through panel cropping. PNG export and the server use the same crop coordinates. These are concept assets, not garment-ready calibrated templates. No real customer image is embedded in the repository.

## Cost and performance choices

- Local matching and profile switches make no AI calls.
- Photo resizing occurs in the browser before generation.
- Both customer photos are normalized and sent with the selected template in one explicit provider request; ordinary profile changes remain local.
- Generation is explicit, has no automatic retries, and is reused during the session.
- Photos, fonts, and standard assets load locally after the app bundle is served.
- Actual provider pricing, generation latency, face resemblance, and body preservation require benchmarking. No fixed performance or cost promise is made.

## Next implementation work

- Calibrate approved standard avatars against a representative body-profile dataset and define height/build bands.
- Benchmark a real provider account with consented test images, including face fidelity, changes to the body, cost, latency, and failures.
- ~~Evaluate local pose/silhouette analysis to assist the manual full-body review.~~ On-device pose hints now assist the review; see [body photo check](BODY_PHOTO_CHECK.md).
- Add authenticated store sessions, durable private avatar storage, versioning, retention/deletion, and tenant boundaries before a multi-store deployment.
- ~~Prepare aligned transparent garments and masks for the later clothing compositor.~~ Imported layers are now cut out, cleaned and aligned on the device; see [clothing layers](CLOTHING_LAYERS.md).

The earlier uploaded platform documents describe a broader proposed baseline. This file captures the revised Level 1 priority confirmed in the conversation.


## Avatar foundation requirements — priority roadmap (2026-11-20)

**Product objective:** Generate a trustworthy, reusable **master customer avatar** from consented face and full-body photos, the closest appropriate body template, and customer-corrected height/build information. All later clothing, jewellery, footwear, watch and accessory adaptations must derive from this approved master without silently changing identity or body. "Perfect" likeness and true physical fit cannot be guaranteed; measurable review gates and real-world validation are required.

**Scope order:** Avatar foundation takes priority over new fashion integrations. Public Shopify shopper launch is on hold; do not enable shopper flags or treat its launch as a prerequisite for staff avatar development. Preserve existing store workflows and privacy/credit controls.

### P0 — Required before calling the avatar foundation production-ready

- **AV-01 Input capture and consent:** Obtain explicit permission to process face and full-body images and, separately, permission for account storage. Show practical capture guidance: single consenting adult, front-facing clear face, neutral expression, adequate even lighting, no obscured features, full standing body including feet, front view, minimal occlusion and appropriate clothing. Provide actionable retake instructions. Never infer age, identity or photo ownership from face detection alone.
- **AV-02 Pre-generation quality checks:** Validate face count/presence, face framing/resolution, blur/exposure where reliable, full-body framing, landmark visibility, major pose/occlusion issues, and incompatible or low-confidence measurements. Use on-device checks where practical. Clearly distinguish hard blockers (missing/unusable input) from advisory warnings; do not silently generate from invalid photos. No external paid calls for preflight.
- **AV-03 Body reference selection and calibration:** Compare height/weight suggestion with photo-derived shoulder/waist/hip proportions; expose uncertainty and manual correction. Retain body profile and measurements with source/confidence metadata. Existing girth factors and synthetic template references are **not** real-customer calibrated; conduct consented measured-pilot validation before using estimates for sizing or fit claims. Never claim single-view photos recover exact body depth or measurements.
- **AV-04 Identity and appearance fidelity:** Preserve recognizable face, hair and permitted accessories; match natural skin tone consistently across face, neck, arms, hands, legs and feet; avoid seams, headless outputs, extra/missing limbs, warped anatomy, and inadvertent changes to selected body proportions. Maintain a stable neutral full-body pose and unobstructed silhouette. Benchmark the existing three-image Gemini reference pipeline and alternative controlled reference strategies without unapproved provider switching.
- **AV-05 Master avatar approval gate:** After generation show side-by-side input references and output; require explicit human review of face likeness, skin-tone consistency, body proportions, neck blend, hands/feet, and full-body framing. Use a 1–5 rubric with a minimum score of 4 on **every** criterion and explicit reviewer confirmation and consent. Reject or request explicit regeneration on failures; no automatic paid retry. A detectable face alone is insufficient. The initial pure review rule is in `src/avatar-quality-gates.js` on the avatar implementation branch; **not yet wired into approval or persistence**.
- **AV-06 Failure, cost and safety:** Keep keys server-side, sanitize logs, cap inputs/output, distinguish quota/timeouts/safety failures, enforce request idempotency and credit reservations, and never substitute a template for a failed customer avatar. Make explicit any new paid attempt. Preserve the existing customer-photo deletion and retention policies.

### P1 — Required for a reusable cross-category master

- **AV-07 Canonical master record:** Save the *approved* original master PNG, stable avatar ID, content hash, version, template/body choice, corrected measurements, provider/model/prompt revision, creation/approval timestamps, reviewer/consent revision, and review scores in tenant-scoped storage. Do not retain source face/body photos unless separately consented and governed by an explicit retention policy. Version changes create a new immutable master; never overwrite the approved bytes.
- **AV-08 Adaptation contract:** Each garment, jewellery, shoe, watch or accessory generation takes a specific approved master version/hash as input and creates a distinct derivative linked to it. Derivatives cannot update the master. Record adaptation category, product reference, generation metadata and approval state; preserve identity, body geometry and unaffected regions.
- **AV-09 Consistent reference views:** Support front, side, back and category-specific crops (face/neck, ears, hands/wrists, feet) **as separately labelled derived references**, not unverified photographs of the real customer. Generate and approve additional views only after the canonical front master is approved. Check cross-view identity, skin tone and geometry; do not assume hidden anatomy is recoverable from one photograph.
- **AV-10 Lifecycle and access:** Provide explicit select-current-master, regenerate-new-version, compare, revoke/delete, and reuse operations with store/account authorization and auditability. Existing saved-avatar flows must be assessed before migration to avoid duplicate records or broken try-on links.

### P2 — Quality evidence and optimization

- **AV-11 Evaluation dataset:** Build a private, consented and representative pilot set covering different body builds, complexion/lighting, hair, glasses, camera qualities and clothing occlusions. Record every attempt including failures; no private images or biometric references in the public repository.
- **AV-12 Measurable release gates:** For each case, evaluate six P0 criteria with blinded or independent human review where possible, report per-criterion pass rates, critical failure counts, cost, latency and provider error rates. Target at least 10 independent accepted live avatars for each supported body library as an **initial pilot minimum**, not statistical proof of accuracy. Review failures and regressions before rollout. Maintain a versioned benchmark and explicit operator sign-off; fixtures and face-presence tests do not prove resemblance.
- **AV-13 Provider optimization:** Compare candidate models on the same consented inputs, template and rubric; document cost, privacy terms, latency, reliability and visual quality before changing the configured provider. Avoid silent fallback and automatic retries.

### Implementation order and acceptance

1. Wire AV-05 into the existing avatar review/approve/save workflow with tests that prove unreviewed or below-threshold avatars cannot become approved masters; do not break current read-only sample browsing.
2. Implement AV-01/AV-02 capture and preflight improvements, including usable error messages and browser tests.
3. Improve AV-03/AV-04 matching and generation; benchmark against consented real outputs and keep the current provider stable until evidence supports change.
4. Implement AV-07/AV-08 immutable master versioning and derivative linkage with authorization, deletion and regression tests.
5. Add AV-09 reference views only after front-view fidelity is accepted; then verify jewellery, watch, shoes and clothing against the same master.
6. Complete AV-11/AV-12/AV-13 live validation and release sign-off.

**Definition of done:** A customer can supply valid photos, select/correct a body template, generate once by explicit consent, inspect a side-by-side review, approve only when all gates pass, reuse an immutable versioned master across fashion categories, and revoke/delete it. Automated tests plus real consented visual evidence must pass. No claim of biometric identity verification, exact measurements, perfect likeness or physical garment fit.
