# Store clothes and reusable adaptations — web 0.14

Store staff can save product photos once and select them for different customers.
Approved adaptations are reusable without an AI charge when the same account,
saved avatar, exact starting outfit, garment, category and model context match.
This is web functionality; no Android APK was rebuilt.

## Staff workflow

1. Sign in to the store account and open an approved customer avatar. To reuse
   adaptations, the avatar must already be saved to that account.
2. In **Try clothes**, paste a product link or upload a product photo. Select the
   photo and confirm the category (shirt, trousers, shoes, etc.).
3. Enter **Garment name** and an optional **Colour / size / SKU variant**, then
   choose **Save garment to store**. This stores the product photo and metadata
   without an AI request. Save it **before** generating to enable adaptation reuse.
4. Choose **My store clothes** to browse, search or filter previously saved items.
   A previously saved link selects its stored photo without reading the retailer
   again. If several products match, select the correct variant. **Read website
   again** explicitly refreshes product photos; it does not overwrite the catalogue.
5. When an approved adaptation matches, choose **Use saved result — no AI charge**.
   Otherwise, give generation consent and choose **Put on avatar** once.
6. Review the face, body and clothing. Confirm agreement to save the outfit, then
   choose **Save adaptation for reuse**. Saving a complete look also saves its
   latest eligible adaptation. If you add sample overlays afterward, save the
   complete look; those extra layers are not silently stored as the AI adaptation.
7. To build an outfit, add the next garment. Each adaptation is associated with its
   exact starting outfit, including previously added clothes. Save each stage after
   reviewing it if you want to reuse intermediate stages. Complete saved looks
   continue to reopen independently through **Saved avatars → View looks**.

A saved garment can be used on any customer. A different avatar or a changed
starting outfit normally needs a new paid adaptation. Matching a product photo
alone is never enough to reuse another customer's rendered image.

## Matching rules

- **Product links:** public HTTP(S) URLs are canonicalized; fragments and known
  tracking parameters are removed and query parameters sorted. Amazon product
  paths normalize around the ASIN. Other retailers use their canonical URL;
  unknown parameters remain because they may describe size, colour or SKU. This
  conservative matching does not resolve every retailer's alternate/short URL.
- **Exact photo duplicates:** normalized image pixels are hashed, independently
  of PNG metadata/encoding. The category and staff variant also matter. Meaningful
  different product URLs remain separate even if a retailer reuses a photograph.
  Exact duplicates select the existing record without overwriting its name/photo.
- **Similar photos:** a local image signature and colour comparison suggest
  possible matches. Staff must confirm them. Resized or recompressed images are
  not guaranteed to be exact matches. No AI service is called for duplicate checks.
- **Adaptations:** the key includes the account-owned avatar and garment ids,
  normalized starting-image pixels, stored garment pixels/category/name, body
  library, provider, model and `ADAPTATION_REVISION`. Product and avatar names alone
  cannot cause a hit. Changed pose, body, overlays, garment or model causes a miss.
  Increment the revision when changing the try-on prompt or normalization behavior.

## Storage and access

The existing private SQLite account database gains `garments`, `garment_links` and
`garment_results`. No new service or database is needed. Existing avatars, looks
and account credentials are preserved by additive table/index creation.

Each store can hold 200 garments and 200 approved adaptations. Garments are bounded
JPEG/PNG/WebP uploads, normalized to PNG within 1024 × 1024 with EXIF removed;
lists return small thumbnails, never all full-size photos. Adaptation PNGs are
normalized within 1024 × 1536. Plan disk usage for these images and back up the
existing account volume. The app does not persist original customer photos or
copies of starting outfits in the new tables; it stores approved outputs and hashes.

Every route requires the store's authenticated session. Writes and match/reuse
POSTs also require the studio's origin. Catalogue data and cached images use the
existing `Cache-Control: no-store` API policy. Account A cannot list, match, read,
delete or reuse account B's items.

Generated results are **not** saved automatically. The server issues an in-memory
key-signed receipt binding its actual output to the precise adaptation context.
Saving requires that receipt, matching output pixels, explicit review and storage
consent. An altered image or receipt is rejected. Receipts expire after 24 hours
and after a server restart; approved saved results remain available across restarts.
If an unsaved receipt expires, save the existing image as a complete look instead
of generating again. The app preserves paid output when receipt creation fails.

Deleting a garment deletes its adaptations. Deleting a customer avatar deletes
that avatar's adaptations, while retaining the store's garment catalogue. Existing
complete saved looks remain independent of garment deletion. **Forget saved
adaptation** removes one result without deleting the garment. Account deletion
cascades through all owned records.

The provider route rechecks for a saved result before consuming paid limits and
prevents concurrent identical requests from starting two provider calls within the
single running API process. Normal consent and the shared 20/hour limit still apply
to new generations. No retries or fallback generation are added. If running multiple
API processes in future, move the in-flight lock to shared durable coordination.

## API

| Route | Behavior |
| --- | --- |
| `GET /api/garments` | Account metadata, thumbnails and saved-adaptation counts |
| `POST /api/garments/match` | Match `{url?, image?}`; return exact, linked and similar suggestions |
| `POST /api/garments` | Save `{name, garmentType, variant, sourceUrl, image, storageConsent:true}` |
| `GET /api/garments/:id` | Read metadata and normalized product image |
| `DELETE /api/garments/:id` | Remove garment and its adaptations |
| `POST /api/garments/:id/reuse` | Lookup using `{avatar, avatarId, garmentType, bodyType}`; no AI |
| `POST /api/garments/:id/results` | Save `{image, receipt, reviewed:true, storageConsent:true}` |
| `DELETE /api/garments/:id/results/:result` | Forget an approved adaptation |

`POST /api/tryon` accepts optional `garmentId` and `avatarId`. When supplied, it
uses the owned stored garment's photo, category and name; client-supplied replacements
cannot poison the cache. Results may include `reuseReceipt`, `garmentId`, `reused`
or `reuseWarning`. The existing `garment-tryon-v1` contract and anonymous/raw-photo
flow remain compatible. Health adds `garmentCatalogueAvailable` when accounts exist.

## Deployment and validation

Use the existing account-enabled deployment and its persistent volume:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

`compose.shared.yaml` is the operator's existing local shared-Caddy configuration.
Keep `TRYON_DATA_DIR` and the account volume from `compose.accounts.yaml`. Without
account storage/sign-in, the catalogue is unavailable and the original transient
try-on workflow remains usable. Existing pilot flags are not enabled by this update.

Automated checks cover canonical links, image/variant matching, suggested duplicates,
account isolation, consent, receipt tampering, output changes, database restart,
capacity, deletion, model/outfit cache misses, concurrency and provider failures.
Browser tests use the real account/database/API with only provider and retailer
responses stubbed. They exercise save, filter, duplicate upload, approved reuse,
reload, changed-outfit rejection and a 390 px viewport. These tests do not verify
live Gemini image quality or the running Lightsail deployment.

Validation on 2026-10-29: 75 backend tests and 52 browser tests passed, along with
the production build. After the final upload optimization, all seven catalogue
and product-link browser tests passed again. No paid provider calls or APK builds
were made. The new tables require the existing account volume at deployment.
