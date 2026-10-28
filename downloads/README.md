# Forme Studio Android test build

[Download the APK](https://github.com/RajeshRamadas/tryoncloths/raw/refs/heads/main/downloads/forme-android-debug.apk)

Version 0.6.0 (version code 6), app ID `com.rajeshramadas.tryoncloths`. Android 7+ with Android System WebView/Chrome 108+ is required. This APK uses a development signing certificate and is for testing.

Version 0.6.0 adds realistic textured clothing samples and footwear: separate tops, trousers and shoes, nine pre-generated transparent assets, transparent clothing-layer import, placement controls, reset, and reviewed outfit sharing. Clothing selections make no AI calls. See the [clothing guide](../docs/CLOTHING_TRYON.md). Customer avatar generation still requires an updated HTTPS backend and a server-side provider key; see [setup](../docs/GENERATION_SETUP.md).

Open the download on your phone and allow installation from your browser/file manager if prompted. Sample avatars work offline. See [the Android guide](../docs/ANDROID.md) for the photo, approval, sharing, optional AI connection, and source-build workflow.

The checksum is in [SHA256SUMS](SHA256SUMS). From the repository root, run `sha256sum -c downloads/SHA256SUMS` to verify the file.
