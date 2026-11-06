# Outfit sharing — C8

Web `0.16.0-alpha.8` adds expiring links and WhatsApp click-to-chat for saved looks.
Sharing uses the saved PNG, never a new AI call or an AI credit. Account storage is
required. The Android APK is unchanged.

## Staff workflow

1. Review and save an outfit to the store account. **Share this outfit** appears in
   the fitting room. You can also open **Saved avatars → View looks → Share**.
2. Choose 7, 30 (default), or 90 days and confirm the customer's agreement to make
   the outfit available through a link.
3. Choose **Create outfit link**. **Share on WhatsApp** opens a prepared message to
   the associated customer's mobile number. Staff review and send it in WhatsApp;
   this app does not automatically message anyone.
4. For unassigned avatars, use **Copy link**, or **Share using another app** when the
   browser supports the Web Share API. Both options are also available for assigned
   customers. Marketing opt-in is not required for this staff-initiated outfit share.
5. **Manage outfit links** lists expiry, page views and revocation controls. Reopen
   it from Saved avatars later to revoke a link. Addresses are returned only at
   creation; if lost, revoke the old link and create another.

The public page shows the saved image, garment labels and store name. It includes
Call store / Get directions only when the store already has a valid phone / map URL
in its settings. Customer name, mobile number, notes and account details are not
rendered as public metadata. The image itself depicts the customer: anyone holding
the link can view it until expiry/revocation. Clothes are approximate styling, not
size or fit predictions. Pricing awaits C10 catalogue price fields; prices are not
inferred from garment labels. C15 adds the store branding editor.

Changing clothing clears the current fitting room's share controls; previously
created links continue showing their original saved look until revoked, expired or
deleted. Share links always reference a saved look. Saving new pixels creates a
separate look; changing the look's private name does not publish that name.

## API

Owner, manager and staff roles can manage links within their active store. POST
and DELETE require the same studio origin; public GETs require no account or store
access code.

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/api/looks/:id/share` | `{days?:1..90, sharingConsent:true}` → `{id,url,expiresAt,customerPhone}`; default 30 days |
| GET | `/api/looks/:id/shares` | Up to 100 links' IDs, expiry, revocation and views; never raw addresses |
| DELETE | `/api/share/:id` | Revoke an owned link; repeat revocation is harmless |
| GET | `/s/:token` | Mobile public HTML, or 410 when unavailable |
| GET | `/s/:token/image` | PNG, or 410 when unavailable |

Tokens have 32 cryptographically random bytes (256 bits), base64url encoded. SQLite
stores only their SHA-256 hash. All private API responses are no-store. Public HTML
is private/no-store; PNGs use `private, max-age=300, no-cache`, forcing revalidation
before reuse so revocation is checked on the next request, including conditional
requests. Both endpoints enforce expiry and revocation before serving anything.
Pages send noindex/nofollow/noarchive, no-referrer and a restrictive CSP; text and
URLs are escaped and unsafe phone/map schemes are omitted.

Deletion of a look, avatar or customer cascades to its share links. Copies already
downloaded, screenshots and messages already sent cannot be recalled. Open pages
may still display previously downloaded pixels until refreshed.

C8 also creates the minimal `events` table, indexed by store/type/date. Creation
records `look_shared`; public page GETs record `share_viewed` and increment views.
HEAD and image requests do not count as views. These are raw page requests (bots
may count), not unique viewers or confirmed WhatsApp delivery. Events contain IDs,
not raw tokens, customer contact details, browser identifiers or IP addresses. C14
will add broader event recording and analytics.

## Deployment and verification

Set `TRYON_PUBLIC_URL=https://studio.marketingadda.com` in the Lightsail `.env` so
shared links consistently use the public HTTPS host. The existing accounts Compose
overlay already passes this variable. Without it, development uses the request's
origin. Rebuild with the persistent account volume:

```bash
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

The reverse proxy must route `/s/*` to this backend as well as `/api/*`; the supplied
Caddyfile forwards the whole studio host. If an older shared Caddy configuration
only forwards `/api/*`, add a `/s/*` handler using the same backend upstream and
reload Caddy. Development Vite proxies only the `/s/` path, preserving `/src` assets.
No Meta credentials are needed for click-to-chat.

Backend tests cover token hashing, ownership and role matrices, consent, lifetimes,
escaping, headers, view events, expiry, revocation, restart persistence and deletion
cascades. Browser tests use a real isolated database to exercise mobile sharing,
public image rendering, WhatsApp URL contents, revocation after reopening the
library, fitting room changes and native-share fallback. No paid provider calls or
real WhatsApp messages are made. Production deployment and delivery on a real
WhatsApp device are operator checks. Razorpay live configuration and provider
quality checks remain separate release checks; this change retains the alpha tag.
