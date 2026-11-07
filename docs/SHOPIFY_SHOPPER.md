# Shopify shopper setup — C16.2

Web `0.19.0-alpha.2` adds Shopify app installation, a store/product allowlist,
signed launches, lifecycle revocation and a theme app extension. Owners open
**Shopper spending → Shopify widget**, or `/shopify-shopper`. Managers can view
the connection and product list; staff and anonymous visitors cannot manage it.

**This increment is a setup preview.** The button opens a branded page for the
verified product and a return link. It collects no photos, creates no shopper
avatar/session and makes no AI request or credit reservation. Later
[C16.3 sessions](SHOPPER_SESSIONS.md) and [C16.4 photo/try-on flow](SHOPPER_WORKFLOW.md)
are implemented behind additional default-off flags and reviewed dependencies. Both the Forme
setup preview and theme button are disabled by default. No APK was built.

## 1. Configure the Shopify app

Create a **dedicated Forme app** in the Shopify Dev Dashboard, with the intended distribution
and development store. Use these URLs for your own public HTTPS studio origin:

| Setting | Value for this studio |
| --- | --- |
| App URL | `https://studio.marketingadda.com/shopify-shopper` |
| Allowed OAuth redirect | `https://studio.marketingadda.com/shopify/callback` |
| Requested scopes | `read_products` |
| App proxy URL | `https://studio.marketingadda.com/shopper/launch` |
| App proxy prefix / subpath | `apps` / `forme-tryon` |
| Admin GraphQL version | `2026-10` by default; configurable quarterly version |

The app is not embedded. The owner initiates installation from the signed-in
Forme store; opening the dashboard installation URL alone does not map a Forme
tenant. The callback must match exactly. App client id/secret are different from
the existing read-only catalogue token. Existing catalogue connections and
credentials remain unchanged.

Configure these **server-side** variables in `deploy/lightsail/.env`:

```ini
TRYON_PUBLIC_URL=https://studio.marketingadda.com
SHOPIFY_APP_CLIENT_ID=your_shopify_app_client_id
SHOPIFY_APP_CLIENT_SECRET=your_shopify_app_client_secret
TRYON_SECRET_KEY=your_existing_persistent_encryption_key
SHOPIFY_API_VERSION=2026-10
```

Reuse the encryption key already protecting WhatsApp/catalogue tokens; do not
replace it. If none exists, generate it once with `openssl rand -hex 32`. Never
put secrets in `VITE_` variables, theme code, Git, screenshots or public settings.
Use an offline app installation; there is no automatic refresh-token workflow
in this increment. If Shopify access expires or is revoked, reconnect explicitly.

OAuth registers **APP_UNINSTALLED, SHOP_UPDATE, PRODUCTS_UPDATE and PRODUCTS_DELETE**
webhook subscriptions with installation-specific callback URLs. Do not add
duplicates in the manifest. A failed registration leaves the Forme installation
incomplete, rather than enabling a connection without lifecycle protection.
On reconnect, Forme pauses the old preview, removes its stored token and replaces
this dedicated app's subscriptions for these four topics. Other apps and other
topics are untouched. Interrupted/partial subscriptions are removed on the next
explicit connection attempt, preventing accumulation at Shopify's topic limits.
Concurrent installation of the same shop is blocked by a shared three-minute
lease. If reconnect fails, the UI reports `reconnect_required`; reconnect again
or disconnect to release this store mapping. There are no automatic retries.

## 2. Deploy the backend with transient state

Keep using the existing shared-Caddy/account deployment and persistent account
volume. Add the Shopify override:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml -f compose.shopify.yaml up -d --build tryon
```

`compose.shared.yaml` is your existing local shared-Caddy configuration, not a
new tracked file. The new override supplies the app client settings and mounts
`/run/forme-shopper` as a 16 MB tmpfs owned by runtime uid/gid 1000. Do not replace
it with the account volume, a normal disk folder or a bind mount included in
backups. Future updates must keep all three `-f` files. Do not use `down -v`.

For another deployment, pass the same variables to its backend service and set
`TRYON_SHOPPER_STATE_DIR` to an existing writable **absolute tmpfs directory**.
The server checks the filesystem type. Missing/invalid configuration disables
Shopify setup without interrupting existing staff generation. The standalone
Compose backend is named `app`; adapt the override's service name if using that
configuration rather than the existing shared `tryon` service.

Caddy must proxy the entire studio hostname to the current backend, including
`/shopify/*`, `/shopper`, `/shopper/launch` and `/shopper-api/*`. An API-only
`handle /api/*` block cannot serve this flow. Preserve the working upstream and
other applications/hostnames. Keep HTTPS enabled. If access/request logging is
enabled, omit OAuth query strings, capabilities, cookies and request bodies.

Launch/OAuth state and signature replay markers use a separate SQLite database
on tmpfs, outside account backups. Multiple workers using that same mount share
single-use state. Entries are logically denied immediately at expiry and pruned
on writes/every minute; the table is bounded to 10,000 entries. Containers must
share transient state if routing among them; separate tmpfs mounts fail closed
on unknown tickets. A container restart loses these short-lived flows and the
owner/shopper starts again. Durable installations, encrypted app tokens and
product selections remain in the account DB. Host swap/core-dump policy needs
review before the later photo-handling flow is enabled.

## 3. Connect the correct Forme store and products

1. Sign in as the owner, switch to the correct store and open **Shopper spending**.
   Set positive store/organisation limits and allow spending only when ready.
   Setup preview requires an active Growth/Chain organisation and unpaused
   spending; it still costs zero credits.
2. Open **Shopify widget**, enter the canonical `shop-name.myshopify.com` address,
   and choose **Connect Shopify app**. Approve the app on Shopify. Forme returns
   to the connection page without OAuth codes in the final URL.
3. In **Catalogue**, connect/sync this same Shopify shop using the existing
   catalogue workflow. Its token/permissions remain separate; this release
   does not replace catalogue credentials or automatically run a sync.
4. In the widget page, select products with known clothing types and available
   stock. Selection also verifies through Shopify that the product is active,
   published to the online store and uses the synced product page on the verified
   storefront. Draft/unpublished, foreign-store, unrelated-origin and stale
   product-page mappings cannot be enabled. Search and paging cover large lists.
5. Choose **Enable setup preview**. This enables signed setup launches only.
   The owner can disable/disconnect without deleting catalogue products or
   customer avatars. Disconnect removes the stored app token and revokes launches;
   uninstalling the actual app in Shopify is a separate merchant action.

Changes use optimistic revisions. A concurrent update requires refresh; no stale
tab can overwrite a newer connection or product selection. Role/session ownership
is checked again after external requests. One Shopify shop can be actively mapped
to only one Forme store. Reinstallation rotates the webhook epoch, removes old
product selections and leaves preview disabled until the owner selects again.

## 4. Install the theme extension in a draft theme

The extension source lives under `shopify/extensions/forme-tryon/`:

- `blocks/try-on-button.liquid`: product-page app block, escaped label,
  disabled-by-default visibility, explicit setup-preview note.
- `assets/forme-tryon.js`: stamps a random per-click launch nonce. Sends only
  product id and nonce through the Shopify proxy; no customer tracking or photos.
- `assets/forme-tryon.css`: button styling and visible keyboard focus.

With Shopify CLI installed and authorized for your app, prepare the local public
app configuration and replace its placeholders:

```sh
cd ~/tryoncloths/shopify
cp shopify.app.toml.example shopify.app.toml
nano shopify.app.toml
shopify app deploy
```

Enter your actual **public client id and studio URLs**, not the secret. The local
file is ignored by Git. App creation, app registration, distribution approval and
theme extension deployment are operator actions; Codex has not performed them.
In the development store's **draft theme**, add the **Forme try-on preview** app
block to a product section and enable **Show setup preview button**. Keep the
proxy prefix/subpath above; the extension uses `/apps/forme-tryon`. JavaScript is
required for the per-click nonce. Test a selected product before publishing a
theme. The browser opens the hosted setup page in a new tab.

The public app manifest is a configuration template; the Shopify CLI/live-theme
validation has not been run here. The code tests do not prove Shopify has accepted
the app registration, scopes, webhook registrations or extension schema in a live
development store. Keep the setup-preview label until C16.5 live launch checks are complete.

## 5. Launch and lifecycle guarantees

- Shopify query validation uses Shopify's distinct OAuth/app-proxy HMAC
  canonicalizations, timing-safe proof checks, singular critical parameters,
  a 90-second timestamp tolerance and canonical `myshopify.com` shop identity.
  App-proxy nonces prevent simultaneous anonymous product clicks from colliding;
  replayed signatures are rejected across workers sharing transient state.
- OAuth state lasts ten minutes and is tied to the requested shop, active store,
  owner, original live staff session and an independent browser verifier. In
  production its cookie is `__Host-`, Secure, HttpOnly, SameSite=Lax, Path=/,
  with no Domain attribute. This supports the top-level Shopify return while
  preserving the existing Strict staff cookie. Wrong-browser, logged-out,
  demoted, switched-store and replayed callbacks cannot install.
- Access-token exchange and Admin requests are bounded HTTPS calls using the
  existing guarded integration transport, no redirects or automatic retries.
  Tokens are encrypted with store-installation-bound AAD and never returned to
  the browser. No staff/mobile token or client secret appears in the storefront.
- A verified launch issues a random single-use **60-second** ticket in a URL
  fragment. The hosted page removes the fragment before exchanging it via a
  same-origin POST. Tickets bind installation, product pixels/metadata and budget
  revisions. Unknown, expired, consumed, paused, changed or revoked contexts fail
  closed. Return links are limited to the verified storefront/product path.
- Raw-body webhook HMACs are verified before JSON use. Each installation epoch
  has its own callback path, so an old uninstall webhook cannot revoke a new
  installation. Events are idempotent by installation/epoch/topic/body digest;
  raw webhook bodies are not saved. Uninstall clears credentials immediately.
  Events arriving during first-time subscription registration also invalidate
  that pending installation, so credentials cannot be published after uninstall.
- Shop updates conservatively pause previews and revoke outstanding launches
  **before** an awaited domain verification. Even verification failure leaves
  preview paused. Confirm the verified domain and explicitly enable again.
  Product update/delete events disable that selected product and revoke launches;
  sync/review the current catalogue and reselect published products as needed.
  These updates depend on Shopify webhook delivery; live delivery still needs
  verification in the development store.
- Public launch/callback/webhook routes precede the optional studio API token
  gate and have their own verification. Staff management APIs retain their
  existing token/session/role/origin requirements. Preview responses expose only
  public branding, a sanitized logo, product name/type and verified return link.
  They exclude internal tenant/customer ids, credentials and account records.
- The hosted page uses no-store, no-referrer, noindex, no third-party assets and
  restrictive nonce CSP. Merchant text uses DOM text nodes; no photo capture,
  service worker, customer storage or hidden generation is added.

## 6. Routes and verification

| Route | Authority / purpose |
| --- | --- |
| `GET /api/shopify-shopper` | Owner/manager; active-store summary and configuration readiness |
| `GET /api/shopify-shopper/products?search=&offset=0` | Owner/manager; 50 products per page |
| `POST /api/shopify-shopper/connect` | Owner + same-origin; start browser-bound OAuth |
| `PUT /api/shopify-shopper` | Owner + same-origin; `{enabled, revision}` |
| `DELETE /api/shopify-shopper` | Owner + same-origin; disconnect/erase token |
| `PUT /api/shopify-shopper/products/:id` | Owner + same-origin; `{enabled, revision}`; verify publication before enabling |
| `GET /shopify/callback` | Shopify HMAC + owner session binding + separate browser verifier |
| `POST /shopify/webhooks/:installation/:epoch` | Signed raw Shopify event, bounded to 128 KB |
| `GET /shopper/launch` | Signed app-proxy query + eligible enabled product + unpaused store |
| `GET /shopper` | Hosted setup shell; no private metadata in HTML |
| `POST /shopper-api/launch-preview` | Same-origin + single-use ticket; 1 KB JSON limit |

Tests mock every Shopify and AI call. They cover the owner/manager/staff/foreign/
anonymous matrix; HMAC canonicalization, malformed/duplicate/stale inputs,
browser/state/session and async role races; encrypted tokens, registered hooks,
publication and pagination; nonce/replay/expiry/revision behavior; unsubscribe,
domain/product changes, tmpfs enforcement, multi-connection state and zero credit
use. Browser checks exercise mobile setup, product toggles, mocked OAuth navigation,
branded launch, fragment removal, replay rejection and the actual theme script.

Verification: **239 unit/API tests passed**, the full **90-test browser suite
passed**, and `npm run build` passed. The four Shopify browser tests were rerun
after reconnect/lifecycle hardening and passed again. Mobile owner/hosted-page
screenshots were inspected. TOML, Liquid schema JSON, declared assets, the Compose
override and local documentation links were checked. This is not a Shopify CLI
deployment or live Shopify schema/installation test.

[C16.3 shopper sessions and consent/abuse/safety guards](SHOPPER_SESSIONS.md) are
now implemented as an optional session preview. [C16.4 customer photo, avatar review
and clothing try-on](SHOPPER_WORKFLOW.md) is also implemented, disabled until its
reviewed dependencies are configured. [C16.5.1](SHOPPER_LAUNCH.md) now provides
service setup and owner readiness diagnostics. **C16.5 live rollout verification**
still requires evidence. Service selection and legal
review remain prerequisites to enabling photo generation. No live Shopify call,
paid image, external message/payment, Docker build, Lightsail deployment or APK
was performed by this task.
