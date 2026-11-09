# Using the simpler studio

## Start with the customer

Sign in to the store. Open **Saved avatars** to reuse a customer, or start a new
session to create one. The store name and credit balance remain visible. Changing
stores or signing out still clears the previous customer's session.

Store management is grouped under **Store tools**:

- **Products & sharing:** clothing catalogue, jewellery catalogue when enabled,
  and WhatsApp.
- **Daily management:** catalogue photos, size charts, analytics, credit usage
  and shopper spending, for owners/managers.
- **Store settings:** billing and branding, for owners.
- **Staff:** invitation and staff management for permitted roles.

Close the menu with its close button, Escape, or a click outside it. Its backdrop
covers the page and keyboard focus stays inside while open. Closing restores
focus to **Store tools**. Existing server-side access checks are unchanged.

## Try clothes

After approving the avatar, choose **Try clothes**.

1. Choose **Sample clothes** for the 44 free colour/style options. Pick a top,
   trousers and shoes, or expand **Complete outfit combinations** for eight
   ready-made looks. Search still works by colour and style.
2. Choose **Your products** to use a product photo, website link or saved store
   catalogue. Product-link reading and paid try-on keep their existing consent
   and credit checks. Switching sources preserves selections and unsent drafts.
3. Check the avatar, confirm the outfit review and download or save the look in
   the panel beside the preview. Changing a garment or its placement resets
   approval. Saved account looks can be reopened later without regeneration.

Expand **Adjust placement** only if a layer needs correction. The prepared PNG/
WebP importer is under **Import a prepared clothing layer**. Female avatars
offer **Prepared layers** and **Your products**; built-in samples use the male
standing pose. On mobile, **Choose clothes** and **View avatar
& save** jump between the two parts of the fitting room.

## Try jewellery

Open **Jewellery** from an approved saved avatar. The screen guides the flow:
**Choose a view → Add jewellery → Review & save**.

- **Portrait:** earrings, nose pins and necklaces.
- **Hands:** rings, bangles, bracelets and watches.
- **Full body:** long necklaces, waist belts and anklets.

Choose **Saved jewellery**, **Upload photo**, or **Product link**. Only the
selected source's fields appear. Source changes preserve unsent link text and
the chosen piece. Item type, metal and consent checks remain explicit. View
preparation, free overlays, AI adaptation, saving, sharing and reuse work as
before. Secondary links are in **More options**.

The jewellery feature still needs account storage and `TRYON_JEWELLERY=1`.
The interface update does not enable the pilot, change API keys or make provider
calls automatically.

## Deploy the web update

Use the existing shared-Caddy Lightsail deployment:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

Retain the account volume and refresh the website. No APK build is included.
