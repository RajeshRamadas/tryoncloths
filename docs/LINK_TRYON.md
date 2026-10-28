# Try clothes from a product link

Version 0.9 lets store staff dress a saved or approved avatar in a garment from **any clothing website**.

See also: [requirements and design](LINK_TRYON_DESIGN.md) · [implementation guide for an LLM](LINK_TRYON_IMPLEMENTATION.md).

## Workflow

1. Open an approved or saved avatar and choose **Try clothes**.
2. Paste a product page link and choose **Find**. The studio reads the page and shows the product photos it found.
   If a website refuses automated reading (common for large marketplaces), save the product image or take a
   screenshot and use **Or upload a product photo / screenshot**.
3. Pick the clearest photo and answer **What should the avatar wear from this?** (Shirt, T-shirt, Top, Jacket,
   Kurta, Trousers, Jeans, Shorts, Shoes or Full outfit). A guess is pre-selected from the product name; staff confirm it.
4. Confirm the customer agrees to send the avatar and product photo to Gemini, then choose **Put on avatar**.
   This is one AI request, and a provider charge may apply.
5. Review the result. Add the next garment (for example trousers after a shirt) to build a full outfit; each result
   becomes the base for the next. **Undo last garment** goes back one step without another AI request.
6. Approve and download/share the outfit as before. Sample layers still work locally on top, with no AI calls.

## API

- `POST /api/product-link` `{ url }` → `{ title, url, images: [{ source, image }] }`. No AI call.
  Images are normalized to JPEG data URLs (max 1024 px). Limited to 60 reads per hour per client, 2 s apart, 4 in flight.
- `POST /api/tryon` `{ avatar, garment, garmentType, title?, consent: true, consentScope: "avatar-and-garment", consentProvider: "gemini" }`
  → `{ image, kind: "garment-tryon", garmentType, provider, needsReview: true }`.
  Shares the paid-generation limits with avatar generation (20 per hour per client IP, 15 s apart, 2 in flight).
  Output without one detectable face is rejected. No automatic retries.
- `GET /api/health` adds `tryOnAvailable`, `tryOnContract: "garment-tryon-v1"` and `garmentTypes`.

Try-on requires `TRYON_PROVIDER=gemini` with `TRYON_GEMINI_API_KEY`. No new configuration is needed.

## Security

The link reader only fetches `http`/`https` URLs on ports 80/443. Every connection, including each redirect,
is resolved through a lookup that refuses loopback, private, link-local (cloud metadata), carrier-grade NAT,
multicast and reserved IPv4/IPv6 ranges, so DNS answers pointing inside the network are blocked at connect time.
Pages are capped at 4 MB, images at 10 MB, 25–30 megapixels, and requests time out. Page text and product names
are treated as untrusted: only a sanitized product name is passed to the model, labelled for reference only.

## Limits

- Results are approximate visual previews, not size or fit predictions. Garment fidelity (prints, logos) varies.
- Some websites block automated reading or load images with scripts; use the upload fallback.
- Male standard bodies only for now.
- Web 0.10 saves reviewed looks under a saved customer avatar. Use **Save look to account**, then reopen from **Saved avatars → View looks**. Download/share remains available.

## Reliability update

Undo restores the sample layers worn before each AI garment edit. Consent clears
when a paid request starts (including failed requests) and when the selected photo
or garment type changes. Validation: 46 backend tests, production build and all 46
browser tests passed with stubbed provider responses; live garment quality remains
unverified.

## Saved looks (web 0.10)

Save or generate the base avatar into the store account first. After reviewing an
outfit, enter a look name, confirm storage consent and select **Save look to account**.
The composed PNG and up to 10 garment labels are stored, without the source product
photos. Sign in on another browser and open the customer's **View looks** entry.
Review the avatar and choose **Try clothes** to see or extend the saved look. Reopening
makes no AI request. Deleting an avatar also deletes its associated looks; downloaded
PNGs remain outside the library. Up to 200 looks can be held per account.

The persistent account volume is required. Existing databases gain the looks table
at startup without losing avatar records. Endpoints: GET/POST `/api/looks`, optional
GET filter `?avatar=<id>`, GET `/api/looks/:id/image`, DELETE `/api/looks/:id`.
Mutations require the owning account and same-origin requests; saving also requires
`storageConsent: true`. Avatar and account deletion cascade to their looks.
