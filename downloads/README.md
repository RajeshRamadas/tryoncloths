# Forme Studio Android test build

[Download the APK](https://github.com/RajeshRamadas/tryoncloths/raw/6a13c5fd60e27668e6a21f04c62e2bb8f9d67187/downloads/forme-android-debug.apk)

Version 0.7.0 (version code 7), app ID `com.rajeshramadas.tryoncloths`. Android 7+ with Android System WebView/Chrome 108+ is required. This APK uses a development signing certificate and is for testing.

Version 0.7.0 adds a local saved-avatar library and downloaded-PNG import, so customers can reuse avatars without generating again. See the [reuse guide](../docs/SAVED_AVATARS.md). It also includes realistic textured clothing samples and footwear: separate tops, trousers and shoes, nine pre-generated transparent assets, transparent clothing-layer import, placement controls, reset, and reviewed outfit sharing. Clothing selections make no AI calls. See the [clothing guide](../docs/CLOTHING_TRYON.md). Customer avatar generation still requires an updated HTTPS backend and a server-side provider key; see [setup](../docs/GENERATION_SETUP.md).

Open the download on your phone and allow installation from your browser/file manager if prompted. Sample avatars work offline. See [the Android guide](../docs/ANDROID.md) for the photo, approval, sharing, optional AI connection, and source-build workflow.

SHA-256: `5580b02929be07742224d835747e9c662f7232596f1822c14c7c8fa8aa31f109`. Verify a downloaded copy with `sha256sum forme-android-debug.apk`.

The APK is no longer stored on `main` to keep the repository small; the link above points to the last commit that contained it. Hosted APK builds are disabled, so no newer build is published.
