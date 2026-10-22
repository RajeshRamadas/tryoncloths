# Forme Studio Android test build

[Download the APK](https://github.com/RajeshRamadas/tryoncloths/raw/refs/heads/main/downloads/forme-android-debug.apk)

Version 0.2.0 (version code 2), app ID `com.rajeshramadas.tryoncloths`. Android 7+ with Android System WebView/Chrome 108+ is required. This APK uses a development signing certificate and is for testing.

The current build adds the customer face/body/skin-tone generation contract and blocks customer export without a generated result. It also includes the WebP orientation fix. Actual generation requires an updated HTTPS backend with a server-side Gemini API key; see [setup instructions](../docs/GENERATION_SETUP.md). The SHA-256 identifies the updated APK.

Open the download on your phone and allow installation from your browser/file manager if prompted. Sample avatars work offline. See [the Android guide](../docs/ANDROID.md) for the photo, approval, sharing, optional AI connection, and source-build workflow.

The checksum is in [SHA256SUMS](SHA256SUMS). From the repository root, run `sha256sum -c downloads/SHA256SUMS` to verify the file.
