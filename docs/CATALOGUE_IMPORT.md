# Catalogue fields and spreadsheet import — C10

Web `0.16.0-alpha.10` adds **Catalogue** to the signed-in store navigation. Owners
and managers import products and edit inventory details; staff can browse. Imports,
product editing and catalogue selection make no AI calls or credit deductions.
Trying a garment on a new avatar still follows the existing AI-credit workflow.
No Android APK was rebuilt.

## Store workflow

1. Open **Catalogue → Download import template**. Replace the example values and
   image URLs with the store's products. Use one unique SKU per product/variant.
2. Upload CSV, XLSX or XLS, up to **5 MB**, and choose **Import selected spreadsheet**.
   Excel converts in a worker in the browser: only the first worksheet is used;
   conversion never runs on the backend. Use at most 10,000 data rows. Keep SKUs
   with leading zeroes formatted as text in Excel.
3. Review the created / updated / skipped counts. Download the error CSV for all
   rejected rows; the page shows the first 20 errors. Row numbers identify physical
   CSV lines (a multiline quoted record is identified by its ending line).
4. Reimporting the same case-sensitive SKU updates that store's CSV product while
   preserving its ID. Identical rows are skipped; absent SKUs are never deleted.
   A SKU appearing twice in one file is an error on the second otherwise-valid row.
5. **Browse products** searches names, SKUs, brands and colours, filters category and
   stock, and pages through 50 products at a time. Available stock is the default;
   select all stock statuses to see sold-out items. Owners/managers can edit SKU
   (manual products only), brand, price, MRP, sizes, colour and stock.
6. The fitting room's **My store clothes** also displays prices/sizes and hides
   out-of-stock items by default. **Include out-of-stock clothes** reveals them for
   deliberate selection. Choosing clothes remains free; importing does not reshape
   a product photo or automatically create an adaptation.

## File columns

Use a comma-separated UTF-8 CSV; a BOM and quoted fields are accepted. Required
headers: `name,type,sku,image_url`. Other template columns are optional. Unknown or
duplicate headers, broken quotes, inconsistent columns, invalid UTF-8 and empty
files reject the file before any writes. Correctly formed records with invalid
product fields are rejected individually, leaving valid records importable.

| Column | Rules |
| --- | --- |
| `name` | Required, up to 100 characters |
| `type` | Supported app type: shirt, tshirt, top, jacket, kurta, trousers, jeans, shorts, shoes, dress, skirt, saree, lehenga, blouse, outfit |
| `sku` | Required, case-sensitive, up to 64 characters; one row per product/variant |
| `brand` | Optional, up to 80 characters |
| `price` | INR amount, 0–10,000,000, at most 2 decimal places; no currency symbols/grouping commas |
| `mrp` | Same numeric rules; must be at least price when both supplied |
| `sizes` | Up to 30 labels of at most 30 characters, separated with `|`; quoted comma/semicolon-separated values also work |
| `colour` | Human-readable colour, up to 80 characters |
| `stock` | `in` (default), `low`, or `out` |
| `product_url` | Optional public HTTP(S) product URL, without credentials |
| `image_url` | Required public HTTP(S) image URL, without credentials |

Each CSV row is a full product snapshot: blank optional fields clear those values,
blank sizes become an empty list, and blank stock becomes `in`. This is not a
selective patch format. Numeric Excel prices use raw cell values, so formatted INR
amounts can convert correctly. Formula evaluation is not performed by the app.

## Identity, adaptations and limits

CSV identity is `(active store, source=csv, sku)`, with `externalId=sku`. Two stores
can import the same SKU independently. Same-photo products with different SKUs stay
separate. Manual products are not silently converted or overwritten by imports;
a legacy photo/category/variant collision is reported for explicit resolution.
The imported SKU is also the product's variant label. `colourLabel` holds the human
colour; the existing `colour` image-signature column remains untouched in meaning.

Changing photo pixels, type or name clears obsolete saved adaptation results.
Price, MRP, sizes, colour labels and stock changes preserve them. Saved whole looks
and avatars remain intact. New try-on contexts still include the product pixel hash,
category, title, provider and model, so older results cannot dress the wrong image.
Prices are displayed in catalogue and garment selection; older saved looks contain
labels without stable product references, so public share pages do not infer prices
from matching names.

| Plan | Products per store |
| --- | ---: |
| Starter, pilot, trial | 500 |
| Growth | 5,000 |
| Chain | 50,000 |

Limits count all products, including out-of-stock and manual products. Existing
products can update at capacity; duplicate manual saves still return the existing
product. Imports that clearly exceed the limit fail with **409 before downloads or
writes**. Capacity is also checked transactionally on every insert. If capacity or
membership changes during an import, earlier authorized writes may have completed;
the returned counts/errors describe the partial outcome (409/403 as appropriate).
A downgrade does not delete products automatically.

## Resources and request interruption

Downloads use the existing `safeFetch` DNS/address guard on every redirect and
connection, followed by `normalizeGarmentImage`. Private/loopback/link-local URLs,
credentials, unsupported ports and DNS rebinding are blocked. Each download is
limited to 5 MB and 12 seconds, decoded with pixel limits, and normalized to at most
1024×1024. Three workers run per import, with a bounded 16-image cache. Photos and
metadata commit per row; a file is not held as thousands of decoded images in RAM.

One import per store runs at a time within the server process. The request has a
five-minute work budget; remaining rows receive errors if the budget expires.
There are no automatic import retries. A browser/proxy timeout may leave completed
rows in the database: refresh the catalogue, then reimport the remaining/same SKUs.
Repeated unchanged rows safely skip. Keep the reverse proxy's request timeout long
enough for the import response; use smaller files on a small Lightsail instance.

Excel conversion is bounded to 20 seconds, 10,000 data rows and 32 columns. Convert
or split oversized/slow workbooks yourself. Dependency `xlsx` is pinned to the
SheetJS CE 0.20.3 npm mirror `@e965/xlsx` with lockfile integrity; the upstream tarball
CDN was unavailable in this development environment. The worker loads on demand,
not in the initial browser render, and terminates after conversion. Original
spreadsheets are not stored on the server. Error CSV cells are escaped against
spreadsheet formula execution.

## API and migration

All tenancy comes from the active session; clients cannot supply a store ID.
Mutations require the same studio origin. Import/edit/template actions require
owner or manager; browse is also available to staff.

| Route | Behavior |
| --- | --- |
| GET `/api/catalogue` | Paged products; `search`, `type`, `stock` (`available` default, `all`, `in`, `low`, `out`), `offset`, `limit` (1–200); returns garments, filtered total, offset, limit, capacity and stored count |
| GET `/api/catalogue/template.csv` | Download the template |
| POST `/api/catalogue/import` | Multipart, exactly one CSV field named `file`, up to 5 MB; `{created,updated,skipped,errors:[{row,message}]}` |
| PATCH `/api/catalogue/:id` | Edit `sku,brand,priceInr,mrpInr,sizes,colourLabel,stock`; CSV SKU is immutable through this route |

`skipped` includes unchanged rows as well as rejected rows. `errors` only describes
rejections; row 0 means a whole-import issue. The API accepts CSV only; XLS/XLSX
conversion is a client responsibility. Older `/api/garments` routes remain available
for compatibility; its listing is now paged (up to 200 products) and hides out-of-stock
products by default, with the same query filters. New inventory/fitting-room pages use bounded catalogue queries;
WhatsApp campaign selection is bounded to the first 200 available products.

Startup adds guarded columns and indexes transactionally, defaults older products
to manual/in-stock, and backfills `updatedAt` from `savedAt`. Existing credentials,
IDs, images, avatars, looks and valid adaptations survive. No new environment
variables or external API keys are needed. Rebuild with the persistent volume:

```bash
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Tests cover the 1,000-row/20-error requirement, SKU idempotency, store/role/origin
isolation, plan limits, multipart size limits, worker concurrency, URL blocking,
adaptation invalidation, legacy startup and pagination. Browser tests exercise CSV
reports, Excel-worker conversion, first-sheet handling, stock filtering, editing,
read-only staff and the mobile layout using a real isolated database with mocked
image downloads. No paid AI calls or live retailer imports are used in tests.
Next priority in the implementation guide: C12 size recommendations.
