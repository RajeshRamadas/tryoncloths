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
- Evaluate local pose/silhouette analysis to assist the manual full-body review, accounting for clothing and camera distortion.
- Add authenticated store sessions, durable private avatar storage, versioning, retention/deletion, and tenant boundaries before a multi-store deployment.
- Prepare aligned transparent garments and masks for the later clothing compositor.

The earlier uploaded platform documents describe a broader proposed baseline. This file captures the revised Level 1 priority confirmed in the conversation.
