# WhatsApp lookbooks — C9

Web `0.16.0-alpha.9` adds the **WhatsApp** page for the active store. It supports
requested outfits, opted-in new-arrival lookbooks, AI credit quotes, review before
sending, delivery webhooks and STOP opt-outs. No Android APK was rebuilt.

## Store workflow

- Owners connect the store's Meta phone number ID, WhatsApp Business account ID and
  access token. The server verifies phone access and membership in the supplied
  business account before saving the encrypted token. Staff never receive the token.
- In Customer details, record **receive their outfits through WhatsApp** separately
  from optional marketing permission. Requested outfit messages require the recorded
  in-store utility permission. New arrivals require marketing opt-in.
- Choose a customer, 1–6 saved outfits, and the approved message template. Confirm
  agreement to publish/send the images. Sending saved images uses no AI credits;
  Meta's own messaging charges are separate.
- Managers/owners use **New arrivals on you**: select avatars and catalogue garments,
  check the maximum credit cost, confirm customer agreement to reuse avatars with
  the AI provider, prepare a campaign, and deliberately generate each pending item.
  Each combination is a separate outfit, starting from that customer's saved avatar;
  it does not stack all selected garments into one outfit. Maximum 6 combinations.
- Existing reviewed adaptations may be reused for free. The quote is conservative:
  up to one AI credit per combination, with at least that many credits required to
  prepare the campaign. New generation uses the existing ledger `meter` function,
  including trial marks, holds, commits and failure refunds. Only Gemini clothing
  try-on is currently supported. Female generation keeps the existing feature flag.
- Review face, body, clothing and complexion for every result. Only approved results
  can be sent from a campaign. Each customer gets one template message containing an
  image preview and a link to all selected outfits, rather than one message per look.
- Saved campaigns reopen after reload. Pending items can be started deliberately;
  failed or interrupted (`generating`) items never restart automatically. Check saved
  looks/usage before preparing anything again. A disk failure after a successful
  provider result may still use a credit; the app does not silently regenerate.

The automation is available to Growth and Chain accounts, plus pilot/trial accounts
for evaluation. Starter is gated. Trial expiry, suspension and overdue subscription
grace periods are enforced. Owners configure the integration; managers create
campaigns; staff can send requested saved outfits and inspect delivery history.

## Meta setup on the existing Lightsail instance

1. Create/configure a Meta Business WhatsApp application and Business account. Obtain
   the **phone number ID**, **WABA ID**, a system-user access token with the required
   WhatsApp Business management/messaging permissions, and the Meta **app secret**.
   The connected phone must appear among the first 100 numbers in that WABA lookup.
2. On Ubuntu, generate two separate values locally:

   ```bash
   openssl rand -hex 32
   openssl rand -hex 32
   ```

   Save the first as the persistent `TRYON_SECRET_KEY` and the second as
   `WHATSAPP_VERIFY_TOKEN`. Do not paste secrets into chat or GitHub.
3. In `~/tryoncloths/deploy/lightsail/.env`, configure:

   ```ini
   TRYON_PUBLIC_URL=https://studio.marketingadda.com
   TRYON_SECRET_KEY=<first_generated_value>
   WHATSAPP_VERIFY_TOKEN=<second_generated_value>
   WHATSAPP_APP_SECRET=<Meta_app_secret>
   WHATSAPP_GRAPH_VERSION=v23.0
   ```

   Protect this file (`chmod 600 .env`). Keep the encryption key with the database
   backup. Losing/changing it requires reconnecting each store's token; encrypted
   tokens cannot be recovered without it. The Meta access token itself is entered
   in the owner's WhatsApp settings page, not the environment or frontend build.
4. Deploy with the existing persistent account volume:

   ```bash
   cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
   ```

5. Ensure Caddy forwards **`/api/*`, `/w/*` and `/s/*`** to the same backend. The
   supplied whole-host reverse proxy already does this. No Basic Auth may obstruct
   `/w/*` images: Meta must be able to fetch the preview over public HTTPS.
6. Configure Meta's webhook callback as
   `https://studio.marketingadda.com/api/whatsapp/webhook`, supplying the generated
   verify token. Subscribe to WhatsApp message events/statuses. This route is mounted
   with raw JSON before account/access-code checks and verifies the app-secret HMAC.
7. Create and get approval for **`look_share`** (utility) and **`new_arrivals`**
   (marketing), with matching language (default `en_US`). Both use:
   - An IMAGE header.
   - Body text with two parameters, in order: customer name and store name.
   - One URL button, index 0, with static prefix
     `https://studio.marketingadda.com/w/` and dynamic `{{1}}` token suffix.
   - Marketing should include a quick-reply opt-out with payload `STOP`, or clearly
     explain that the customer can reply STOP.
   Supply Meta's required sample image/parameters during approval. Templates,
   categories, eligibility and charges remain subject to Meta's review and rules.
8. Sign in as the store owner → **WhatsApp** → verify/connect the supplied IDs and
   access token. Test with consenting recipients registered for Meta test mode
   before using a live sender. Verify delivery and STOP on the real account.

No live Meta account, messages, billing, template approval or live AI quality was
verified by development tests. The app's previous click-to-chat sharing remains
available without Meta credentials.

## Delivery and retry rules

Every explicit send carries a UUID request ID, unique per store. Duplicating that
ID returns the original status and never calls Meta again. The database reserves a
marketing slot before the external request, enforcing one accepted/in-flight/
uncertain marketing message per customer per 7 days, including across restarts.
Explicit Meta 4xx rejection releases that slot for a deliberate corrected request.
Timeouts, malformed responses and 5xx responses are **unknown**, never auto-retried.
An accepted request is not proof of delivery; signed webhooks update sent, delivered,
read or failed status. Out-of-order events do not downgrade read/delivered status.
Early status events are reconciled when Meta's send response arrives; unmatched
status IDs are pruned after 24 hours on subsequent webhooks.

STOP, UNSUBSCRIBE, OPT_OUT and STOP_MARKETING (text or button payload, case
insensitive) clear both marketing and utility permissions for the matching sender
and customer within that store. Other stores with the same customer phone are
unaffected. Inbound message IDs are hashed/deduplicated, so replaying an old STOP
cannot undo newly recorded consent. Opt-out during generation prevents publishing
and refunds an undelivered generation credit. A request already handed to Meta
cannot be recalled. Consent must be recorded again before future messages.

## Storage, public links and API

Tokens use AES-256-GCM (`v1:iv:tag:cipher`), random IVs and store-bound authentication.
They are never returned in responses, included in URLs, persisted in browser
storage, or logged. The typed token is cleared after a connection attempt. Meta
calls are injectable, timeout-bounded, fixed to Graph API HTTPS and never retried
implicitly. Customer contact details are sent to Meta as required for messaging.

`/w/:token` serves a mobile HTML lookbook; `/w/:token/:look/image` serves JPEG previews derived from saved images, bounded to 1024×1536 at quality 85 to stay within Meta’s image-header size limit. The saved originals are unchanged.
Tokens contain 256 random bits, are hashed at rest, expire after 30 days and can be
removed through delivery history. The public page includes store/garment labels,
not customer names or phone numbers; the images themselves show the customer.
No-store, noindex, no-referrer and restrictive CSP headers apply. Deleting any
included look, its avatar or customer removes that lookbook. Customer erasure also
removes associated message/campaign-item rows. It cannot recall previously received
messages or downloaded images. Existing provider/backups retention remains separate.

Endpoints:

| Route | Access |
| --- | --- |
| GET `/api/integrations/whatsapp` | Staff+: redacted connection status |
| PUT/DELETE `/api/integrations/whatsapp` | Owner: verify/save or disconnect |
| POST `/api/whatsapp/send` | Staff for `look_share`, manager+ for `new_arrivals` |
| GET `/api/whatsapp/messages` | Staff+: last 100 sends, delivery status |
| DELETE `/api/whatsapp/messages/:id/link` | Staff+: remove the public lookbook |
| GET `/api/whatsapp/workspace` | Staff+: first 200 avatar/looks entries and catalogue |
| POST `/api/whatsapp/campaigns/quote` | Manager+: scoped selection and max credits |
| POST `/api/whatsapp/campaigns` | Manager+: cost and generation-consent confirmation |
| GET `/api/whatsapp/campaigns/:id` | Manager+: campaign items and previews |
| POST `/api/whatsapp/campaigns/:id/items/:item/generate` | Manager+: one explicit metered generation |
| POST `/api/whatsapp/campaigns/:id/items/:item/review` | Manager+: approve/reject visual result |
| GET/POST `/api/whatsapp/webhook` | Verify-token handshake / signed raw payload |

Send input is `{requestId,customerId,template,lookIds,sendConsent:true}`. Selection
input is `{customers:[{customerId,avatarId}],garmentIds:[...]}`; prepare also requires
`generationConsent:true,maxCredits` from the quote. Store identity always comes
from the session; look/avatar/customer/garment associations must match that store.

Tests use isolated SQLite databases and mocked Meta/AI transports. They cover token
secrecy/tamper resistance, role/store/origin isolation, consent and STOP handling,
webhook signatures, delivery ordering, deduplication, weekly limits, credit quotes,
metered generation, refunds, review gating, persistence and mobile browser flows.
Next task: C10 catalogue fields and CSV/Excel import.
