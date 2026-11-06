# Store branding — C15

Web `0.18.0-alpha.3` adds **Branding** for the owner of the active store. Configure
a public display name, six-digit primary colour, logo, store phone, address and
HTTPS map link. These settings apply to shared outfit pages, WhatsApp lookbooks,
the store name in WhatsApp template messages, and exported images. Branding uses
no AI credits and does not regenerate customer avatars or catalogue photos.

## Owner workflow

1. Sign into the correct store and open **Branding** next to Billing.
2. Set the public store name, colour and optional contacts. The internal account
   name and legal invoice details remain separate from the public display name.
3. Upload a PNG, JPEG or simple static SVG logo, up to **500 KB**. Save to see
   the rasterized logo in the saved preview. Tick **Remove the saved logo** to
   remove it later; leaving the file input empty keeps the existing logo.
4. Choose whether eligible exports should include the store footer by default.
   Public share/lookbook images and approved catalogue-photo downloads use this
   default. On avatar/outfit downloads, staff can make a per-export choice.
5. Save. Existing valid shared pages use the current identity/contacts on their
   next request. Previously downloaded files are not modified.

Only an owner can change branding. Managers and staff can read the current
settings and export permitted images. Each store has its own branding, including
within a Chain organisation. Another store cannot choose your logo or metadata
using a body/query store ID. Revision checks reject conflicting concurrent saves;
owner membership is rechecked after asynchronous logo decoding.

The preview uses a black/white text colour selected for contrast against the
primary colour. Logo colours are preserved. Store name and contacts are escaped
on public pages and image labels; map links must be public HTTPS URLs without
credentials or private/literal local addresses. The server does not fetch maps.
Only the configured store contact fields are published—customer names, phone
numbers, notes and account emails are excluded.

## Logo handling

SVG uploads are parsed as XML using `saxes` before Sharp sees them. The supported
subset covers shapes, paths, groups, static text, gradients and clipping paths.
Scripts, event attributes, CSS styles, animation, embedded HTML/images, `use`,
external references, processing instructions and DTD/entities are rejected.
Only local fragment paint/clip references such as `url(#gradient)` are allowed.
Node count, depth, text and numeric geometry are bounded. Unsupported SVGs should
be exported as a PNG by the store, or simplified to supported static paths.
Custom external fonts are not loaded; convert logo text to paths when exact
lettering matters.

The sanitized SVG is rasterized, and raster inputs are decoded and re-encoded.
Stored/served logos are always PNG, at most 512 pixels on their longest side.
Raster input is limited to four megapixels; metadata and original SVG source
are not retained. A failed upload leaves the previously saved logo intact.
The logo lives in the existing persistent account database, not on a public
filesystem path. Public logo routes use the same share/lookbook capability as
their page: expiry, revocation and customer/linked-data deletion make them
unavailable. Loading a logo or image does not count as another page view.

## Export and watermark rules

- **Trial:** the server always adds the Forme trial mark to exported/shared
  images. `storeFooter:false` cannot suppress it, and unsupported flags such as
  `watermark:false`, `removeForme:true` or `trial:false` are rejected. The UI
  displays the required mark rather than a removal control.
- **Paid/pilot/photo accounts:** the store footer is optional. The owner sets
  the default, and staff can override it on avatar/outfit downloads. Turning it
  off adds no store footer; it does not erase marks already baked into an image.
- PNG avatar/outfit/shared exports append a footer strip, preserving the complete
  original image above it. No part of the head, body, clothing or feet is cropped
  to make room. Long names/contacts are shortened only on the image strip; public
  pages show the full saved values.
- Catalogue JPEGs retain their exact 1:1 / 4:5 / 3:4 / 2:3 dimensions. With a
  footer enabled, the original image is uniformly contained above the strip.
  IPTC XMP `DigitalSourceType=trainedAlgorithmicMedia` is preserved. Individual
  photo files and ZIP entries use the current store branding.
- Branding is applied during export/rendering. Stored fitting originals, approved
  adaptation keys/receipts and saved generated photo pixels are not rewritten by
  a branding update. Returning customers can continue reuse without another AI
  call. Existing generated trial images may already include their generation-time
  mark; branding does not remove that mark after an upgrade.

Public images revalidate their capability after asynchronous rendering, so
revocation or deletion during rendering cannot publish a late response. Approved
catalogue-photo downloads similarly recheck the current approved attempt. These
changes do not create Meta messages, marketing sends or provider requests.

## Routes and deployment

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /api/branding` | signed-in store staff+ | Safe settings, logo presence, revision and server trial policy |
| `PUT /api/branding` | owner, same origin | Partial/full metadata update and optional `logo` data URL or `null` |
| `GET /api/branding/logo` | signed-in store staff+ | Normalized PNG for the active store |
| `POST /api/exports/image` | signed-in store staff+, same origin | `{image: PNG data URL, storeFooter?:boolean}`; server-enforced PNG export |
| `/s/:token/logo`, `/w/:token/logo` | valid public capability | Logo for the shared outfit/lookbook |

Metadata fields are `displayName`, `primaryColor`, `phone`, `address`, `mapUrl`
and `exportFooter`. `revision` is returned by GET and may be supplied on PUT to
detect a stale editor. Export accepts portrait PNGs under 10 MB and 16 megapixels,
up to 8192 pixels per dimension. Editor-source image APIs remain available for
fitting; the app's download actions use the export policy. Offline sample browsing
without a store account continues to use local exports.

No new environment secret or external service is required. The production image
now installs DejaVu and Noto core fonts for Sharp/librsvg trial/store text. Use a
rebuild to install the dependency, fonts and new web assets; preserve the database
volume:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

The reverse proxy must forward `/branding`, `/api/*`, `/s/*` and `/w/*` to the app.
The existing whole-host Lightsail proxy does this. Codex has not deployed the
update or built an APK.

Tests cover SVG attacks and limits, atomic logo replacement, revision/role races,
store isolation, contact escaping, mandatory trial marks, PNG fitting-pixel
preservation, stable reuse keys, public-capability expiry/revocation, WhatsApp
brand parameters, JPEG dimensions/XMP and mobile upload/export workflows. Meta
and AI are mocked; no real messages, paid generations or payments were sent.
The Docker image and live deployment were not built or tested in this task.

C15 completes the R3 implementation tasks. The release retains an alpha label
until configured live services are verified. C16 shopper design and cost caps
are now approved, and [C16.1 shopper spending controls](SHOPPER_SPENDING.md) are
implemented. [C16.2 Shopify setup/signed launches](SHOPIFY_SHOPPER.md) are now
implemented as well; shopper sessions and the hosted photo/generation flow remain
pending.
