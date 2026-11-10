# Shop pages

Each store gets its own public page at `/shop/<address>` on the studio website, for
example `https://studio.marketingadda.com/shop/lakshmi-silks`. The page shows the
store's branding, shop photos, about text, opening hours, in-stock catalogue and
contact details, with a **Try it on** entry point on every product. Owners and
managers edit it from **Store tools → Shop page** (`/shop-page`). Editing the page
uses no AI credits.

## What customers see

- The store name, logo and colour from [Branding](STORE_BRANDING.md), with the address,
  phone and map link in the footer.
- An optional tagline, a large cover photo (the first shop photo), **About us** and
  **Opening hours**, and the remaining photos in an "Inside our shop" gallery.
- Up to 60 catalogue items that are in stock or low on stock, newest first. Each shows
  the product photo, name, variant and (optionally) the price and MRP. Items marked out
  of stock are not listed and their images are not served. Jewellery pieces appear the
  same way when the jewellery catalogue is enabled. A Chain store's page includes the
  shared master products it can see.
- **Try it on** and **Book a try-on** open WhatsApp click-to-chat to the store's
  WhatsApp number with a prefilled message naming the product. Without a WhatsApp
  number they call the store phone from Branding. The store then creates the
  customer's avatar and runs the try-on in the studio as usual. "View online" links to
  the product's own HTTPS shop page when the item has one.

Customer records, avatars, looks, staff names and account emails are never shown. All
saved text is escaped, the page runs no scripts, and its Content-Security-Policy only
allows same-origin images and inline styles.

## Editing the page

| Who | Can do |
| --- | --- |
| Owner | Everything below, plus change the page address and publish or unpublish |
| Manager | Tagline, about, hours, WhatsApp number, catalogue/price switches, photos |
| Staff | Open the editor read-only and preview the page |

- **Page address:** 3–40 lowercase letters, numbers and single hyphens. It starts as
  the store name (for example `lakshmi-silks-sarees`); a suffix is added if that is
  taken. A few words such as `admin` and `api` are reserved. Changing the address
  breaks links already shared.
- **Publish:** a new page is unpublished. Until it is published, only signed-in staff of
  that store can open it, with a "Preview" banner, `no-store` caching and `noindex`.
  Anyone else gets "This shop page is not available". Pages of suspended organisations
  are offline.
- **WhatsApp number:** include the country code, e.g. `+91 98765 43210`.
- **Photos:** up to 12 JPEG, PNG or WebP photos of up to 5 MB, at least 320 pixels on the
  long side. Photos are rotated upright and re-encoded as JPEG (max 1600 px), which
  removes EXIF data such as camera and GPS location. Add a caption, move a photo up or
  down, make it the cover, or remove it.
- Saves carry a revision, so two people editing at once get "changed in another tab"
  instead of silently overwriting each other.

## Phones, tablets, laptops and apps

- **Every screen size:** the shop page and the editor are responsive. Phones show two
  products per row, tablets three to four and laptops up to five, with no sideways
  scrolling and 44 px touch targets. Notches and home bars are respected
  (`viewport-fit=cover` with safe-area padding). Checked on iPhone, Android phone, iPad
  portrait, Android tablet landscape and a 1440 px laptop.
- **Add to home screen (iOS and Android):** each page has its own web app manifest,
  theme colour and square icons (180, 192 and 512 px) made from the store logo on the
  brand colour, or the store's initial when there is no logo. Customers can install the
  shop from Safari's Share menu or Chrome's menu, and it opens full screen like an app.
- **Native apps:** `GET /shop/<address>/data.json` returns the same public content as
  the page as JSON (`version: 1`): store name, colours, logo, contacts, tagline, about,
  hours, photos, catalogue items with prices (when shown), try-on links and image URLs
  relative to the studio. It allows any origin (`Access-Control-Allow-Origin: *`)
  without cookies, so the Forme Android app, a future iOS app or a counter tablet kiosk
  can render the shop natively. It carries nothing that the public page does not show,
  and it is unavailable while the page is unpublished.
- **Editor in the app:** the Shop page editor is part of the studio, so it also works in
  the Android (Capacitor) app. When the app is connected to a studio, the page link it
  shows uses that studio's address.

## Routes

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /api/shop-page` | signed-in store staff+ | Settings, address, photo thumbnails and revision; creates the page on first use |
| `PUT /api/shop-page` | owner/manager, same origin | Content and switches; `slug` and `published` are owner-only |
| `POST /api/shop-page/photos` | owner/manager, same origin | `{image: data URL, caption?}` |
| `PATCH /api/shop-page/photos/:id` | owner/manager, same origin | `{caption?, move?: "up" \| "down" \| "first"}` |
| `DELETE /api/shop-page/photos/:id` | owner/manager, same origin | Remove a photo |
| `GET /shop/:slug` | public when published | The shop page |
| `GET /shop/:slug/data.json` | same as the page, any origin | JSON feed for apps |
| `GET /shop/:slug/manifest.webmanifest`, `/icon-{180,192,512}.png` | same as the page | Home-screen install |
| `GET /shop/:slug/logo`, `/photos/:id`, `/items/:id/image` | same as the page | Logo, shop photo and catalogue image |

Data lives in the existing account database (`shop_pages`, `shop_page_photos`) and is
deleted with the store.

## Deployment and choices made

- Pages are served on the studio's own host under `/shop/`. The existing whole-host
  Lightsail proxy already forwards it, and no new secret or service is needed.
  Rebuild with both Compose files as for other updates.
- Custom domains and subdomains (e.g. `lakshmi.forme.shop`) are not included. They need
  DNS, TLS certificates per host and a host-to-store lookup, and can be added on top of
  the same page later.
- The hosted shopper flow (customer uploads their own photos) is still limited to
  signed Shopify launches. When it opens to direct visitors, **Try it on** can link to
  it instead of WhatsApp.
