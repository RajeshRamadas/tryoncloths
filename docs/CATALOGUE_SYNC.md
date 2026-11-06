# Shopify, WooCommerce and Chain catalogues — C11

Web `0.18.0-alpha.1` adds **Shop connections** inside **Catalogue**. Owners connect
or disconnect shops. Owners and managers can run **Sync now** and see the latest
successful sync, counts and error. Staff can browse products and use confirmed
clothing types, but cannot manage connections. Sync downloads product data and
photos; it does not generate images or spend AI credits.

## Server setup

Use the existing persistent integration encryption key in the server's ignored
`.env`. If WhatsApp already uses `TRYON_SECRET_KEY`, keep exactly that key. If no
integration key exists yet, generate one with `openssl rand -hex 32` and configure:

```ini
TRYON_SECRET_KEY=your_64_character_hex_key
SHOPIFY_API_VERSION=2026-10
```

Do not paste secrets into Git, `VITE_` variables, screenshots or support logs.
Back up the encryption key securely alongside the database. Changing it prevents
existing shop and WhatsApp credentials from being decrypted until reconnected.
Shop API credentials are entered by an owner in the HTTPS web UI, encrypted using
AES-256-GCM bound to the active store/provider, and never returned by the API.

The account Compose overlay forwards these settings and preserves the database.
Update the existing Lightsail web app:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Allow outbound HTTPS to the configured shop and its image/CDN hosts. API requests
use guarded DNS resolution and reject private/reserved addresses, non-HTTPS shop
URLs, credentials in URLs and redirects. Authentication headers are sent only to
the configured API. Image downloads use the existing separate `safeFetch` path
without shop credentials. No Shopify, WooCommerce or paid AI call is made by the
automated tests. Real credentials, API-version compatibility, permissions and
live shop connectivity still need validation after deployment.

## Connect Shopify

1. Create/install a custom app for the shop with **read_products** and
   **read_inventory** access. Give it no write scopes. Use the Admin API access
   token, not a storefront token or customer password.
2. Sign into the correct Forme store, open **Catalogue → Shop connections →
   Connect Shopify**, and enter `your-shop.myshopify.com` and the access token.
3. Save the connection. Forme tests the shop query and requires the shop's currency
   to be **INR**; other currencies are not silently labelled as rupees.
4. Select **Sync Shopify now**. Review the imported products and any type-review
   notices. Expand **Update connection** to enter a replacement token later.

Shopify products page through Admin GraphQL, 50 per request. Variants page in
batches of 100, including additional pages when required. Product GIDs provide
stable identities. Active products use the featured image, vendor, size/colour
options and lowest variant price. MRP uses the lowest valid compare-at price at
least as high as that product price. These are product-level summaries, not
per-size prices or inventory promises. The first non-empty variant SKU is shown.
Untracked or continue-selling variants count as available; otherwise summed
positive inventory of 1–3 is low, over 3 is in stock, and none is out. Missing
required inventory data aborts the sync instead of guessing.

The quarterly API version defaults to `2026-10`. Operators must review Shopify's
support window and update `SHOPIFY_API_VERSION` and integration validation when
needed; the app does not fall back automatically to a different version.

## Connect WooCommerce

1. In WooCommerce's REST API settings create a consumer key/secret with **Read**
   permission for products. Forme only issues read requests; it cannot certify the
   permissions originally assigned to a key.
2. Enter the public HTTPS WordPress site address (including a subdirectory if the
   site uses one), consumer key and consumer secret. Do not include `/wp-json`,
   credentials or query parameters in the address.
3. Confirm the shop prices products in **INR** and uses a read-only key. WooCommerce
   product responses do not identify the shop currency, so this owner confirmation
   is required. There is no currency conversion.
4. Save, then select **Sync WooCommerce now**. HTTPS Basic authentication is sent
   in a header; keys are never added to URLs. The host must preserve Authorization
   headers for the WooCommerce REST API.

Products use `/wp-json/wc/v3/products?per_page=50&page=n`. Variable products also
page through their variations. The first product image, attributes, product-level
price, regular price, brand when supplied, and stock are imported. Published
available variations with managed total stock of 1–3 are low stock; otherwise
available/backorder products are in stock. Woo product IDs are stable within the
connected site. A different site cannot replace existing products under the same
provider identity, even after disconnecting; use a separate Forme store for a
different shop while old products are retained.

## Sync behaviour

- Products upsert by `(store, source, externalId)`; Shopify and WooCommerce are
  separate sources and can coexist with CSV/manual items. Duplicate upstream IDs,
  invalid pages, broken images, missing product URLs, capacity limits or failed
  credentials abort the entire snapshot. The previous catalogue stays visible.
- Photos download three at a time, at most 5 MB each, and pass the existing image
  decoder/normalizer. Products stage on disk while fetching; only a complete
  validated snapshot is published in one SQLite transaction. Staging is cleared
  after completion/failure. A sync has a five-minute deadline and a 50,000-product
  safety limit in addition to the store's plan capacity.
- Missing or unpublished products are **marked out of stock**, never deleted.
  Their saved adaptations and looks remain. Reappearing products use the same ID.
  Changing an image, name or clothing type invalidates that product's automatic
  reuse cache; stock/price-only changes preserve it. Saved looks are not deleted.
- Repeat snapshots with identical pixels and fields leave the product's ID and
  update timestamp unchanged. Upstream details replace local metadata edits on the
  next successful sync. Disconnecting removes credentials and stops scheduling;
  products, adaptations and looks remain.
- Clothing type is suggested from product type/categories, tags and name. An
  unmapped item shows **Clothing type needs confirmation** and cannot be used for
  try-on until an owner/manager selects a type in Catalogue and confirms it. A
  confirmed type persists while the upstream item remains unmapped. Mapped types
  should still be checked with the customer before generation.
- Production checks scheduling once a minute. Connected catalogues run nightly at
  **02:00 IST**, or catch up later that day if the server starts after 02:00. Each
  connection is attempted once per scheduled day, including failures. Failures
  require a deliberate **Sync now**, or the next nightly attempt; there are no
  immediate retries. A server interrupted before 02:00 waits for that day's run.
- One sync runs at a time per app coordinator. A persistent ten-minute store
  lease prevents another instance, reconnect or disconnect from changing that
  store during a sync. Stale leases/staging are reclaimed by a subsequent run.
  Access and connection revisions are rechecked before publishing. Suspended
  organisations and stores without an enabled owner are skipped by the scheduler.
  Refresh the catalogue/status after an interrupted browser response before
  deciding to run another sync.

## Chain shared master catalogue

An owner on the **Chain** plan can select **Master catalogue store**. The selected
store's own products are exposed to other stores in the same organisation,
alongside each store's local products. They are labelled **Shared master ·
Read-only**. Editing, reclassifying or deleting them from a receiving store is
blocked in both the UI and API. Owners/managers edit them in the master store.
Master changes and new imports appear through the shared catalogue view without
copying every photo to every store.

When a receiving store opens a shared product, the server creates/refreshes a
store-local snapshot for the existing adaptation foreign keys. Its stable ID is
namespaced to the master store and product. Only products actually opened get
such snapshots; browse/search alone do not materialize them. They do not consume
the receiving store's own-product quota. Customer avatars and adaptations remain
isolated to their original store. Changed master images invalidate that store's
old cached adaptation when the product is next opened.

Disabling/changing the master, removing a master product, or leaving the Chain
plan hides the old shared product from the receiving store's catalogue and blocks
new reuse/generation with it. Existing saved customer looks remain viewable.
Previously opened product snapshots remain as historical references in the
database; they are not exposed as editable local catalogue items. No product
or customer data is shared across organisations.

## API

| Method and route | Role | Result |
| --- | --- | --- |
| `GET /api/integrations` | owner/manager | Active-store connection status, sync/error counts and master status; no credentials |
| `PUT /api/integrations/shopify` | owner | Test/save `{shopDomain, token}` |
| `PUT /api/integrations/woo` | owner | Test/save `{siteUrl, key, secret, currency:"INR"}` |
| `DELETE /api/integrations/:provider` | owner | Disconnect without deleting products |
| `POST /api/integrations/:provider/sync` | owner/manager | Run one snapshot and return counts |
| `PUT /api/integrations/master` | Chain owner | Set own-org `{storeId}` or `null` to disable |
| `PATCH /api/catalogue/:id/type` | owner/manager | Confirm `{garmentType}` for a local product |

All mutations enforce session and same-origin checks. Provider names are limited
to `shopify` and `woo`; the store identity comes from the authenticated session.

Tests cover three-page Shopify snapshots and repeat stability, variant paging,
Woo variation mapping, encrypted credentials, safe errors, failed-page/image
rollback, inventory/capacity validation, leases, scheduling, roles/origins,
transport DNS/redirect/body limits, read-only sharing and local cache isolation.
Browser tests cover connections, type review, mobile layout and role controls.
No APK was built. The next priority task is **C13 — AI catalogue photos**.
