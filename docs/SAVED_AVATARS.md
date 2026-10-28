# Reuse an avatar — version 0.7.0

You do not need to generate a new avatar each time you try clothes.

## Save once, reuse later

1. Generate and review the customer avatar as usual.
2. Approve the face, body and skin tone.
3. Enter an **Avatar name**, confirm the customer's agreement to save it on this device, and select **Save avatar for reuse**.
4. On a later visit, open **Saved avatars**, choose **Use [name]**, review the reopened avatar and select **Try clothes**.

Reopening an avatar, selecting clothes and exporting an outfit make no image-generation requests. Reopening restores the original avatar image, body profile and approximate height/weight; it does not restore original customer photos or previous clothing selections. Changing the body profile or measurements invalidates the active customer avatar. The saved copy remains available.

## Already downloaded an avatar?

Open **Saved avatars → Open a downloaded avatar PNG**. Select the body profile and approximate measurements used for that avatar, then choose the PNG. Review it and use **Try clothes**, or save it to the local library for next time. This works without a configured AI provider. Imports are not automatically approved or automatically saved.

Use a portrait full-body avatar PNG under 15 MB, at least 128 × 256 pixels and at most 16 megapixels. A screenshot containing application controls or a close-up customer photo is not a suitable clothing base. Importing does not run face verification or generate a new body.

## Where it is saved

The app stores up to 20 explicitly saved avatars in IndexedDB on the same browser/site or Android app. Each record contains the PNG, a thumbnail, the chosen name, body profile, approximate measurements, source type and save time. It stores no original face/body photos, API keys or store access codes. Saving the same PNG again updates its entry instead of creating a duplicate.

The library is not a cloud account and does not sync between browsers, devices, the website and the Android app. Anyone using the same browser/app storage can open it; obtain customer agreement before saving on a shared store device. Starting a new session clears active photos and the active result but keeps saved copies. Use **Delete → Confirm deletion** in the library to remove a saved copy. This does not delete downloads or the already-open session image.

Keep a downloaded PNG backup. Clearing site/app storage, uninstalling the Android app, private browsing or browser storage eviction can remove local records. Storage failures are shown explicitly; the app does not claim a save succeeded before the database transaction commits. Backups can be opened using the PNG import flow above.

## Update

On Lightsail:

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml up -d --build tryon
```

Before refreshing the old app, download the current avatar if it has not been saved elsewhere. Refresh the browser, then open that PNG through Saved avatars. For Android, install the [0.7.0 test APK](../downloads/README.md) as an update to the existing app. No backend key, database or provider setting changes are needed. The existing generation contract remains unchanged.

## Validation

Browser tests cover explicit approval/storage consent, reload persistence, duplicate-image updates, absence of original-photo/credential fields in storage, reuse without new provider requests, deletion across reload, PNG import with selected measurements, profile invalidation, storage failure and the Android bridge/back-button flow. Native bridge checks do not replace physical-device storage validation.

Validation run: all 40 browser tests passed; production frontend build, Android debug assembly and Android lint passed.
