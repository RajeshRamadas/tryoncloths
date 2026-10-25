# Android app

Forme Studio is an installable Android app for the Level 1 store-assisted avatar workflow. Its React interface and four standard avatars are packaged locally using Capacitor 8. The default sample workflow works offline.

## Install the test app

[Download forme-android-debug.apk](https://github.com/RajeshRamadas/tryoncloths/raw/refs/heads/main/downloads/forme-android-debug.apk) onto your Android phone. Open the file and, if Android asks, allow installation from the browser or file manager you used. This is a debug build for testing, not a Google Play release. Android 7.0/API 24 or newer is required, with Android System WebView/Chrome 108 or newer. Android 10+ with an updated WebView is recommended. The download's SHA-256 is recorded in [SHA256SUMS](../downloads/SHA256SUMS).

The app ID is `com.rajeshramadas.tryoncloths`. If Android reports a signing conflict with an older development copy, uninstall that copy before installing the new APK. Session photos are not durable app records; export anything you need first.

## Try sample browsing offline

1. Open **Forme Studio**. The sample library loads without an internet connection.
2. Enter approximate height/weight and inspect the suggested body profile. Staff can choose another profile.
3. Leave customer photos empty for the sample-only demo.
4. Continue to match, then review the explicitly labelled standard sample.
5. Approve the avatar and tap **Save or share avatar**. Use an installed Android share target to send or save the PNG. Available destinations depend on your phone's installed apps; the app does not claim a gallery save simply because the share sheet closes.
6. Start a new session to clear customer photos and app-owned export files.

If you add customer photos, generation is required before review/export. An offline sample cannot be exported as that customer's result. The full-body photo supports staff selection and, with separate consent, generation and skin-tone matching. Automatic body measurements are not implemented.

## Customer face, body and skin tone

The installed app never contains an OpenAI key or a shared store access code. To enable generation:

1. Run the included Express server behind HTTPS using a valid certificate. Configure `OPENAI_API_KEY` and a randomly generated `TRYON_MOBILE_TOKEN` of at least 24 characters on the server.
2. `TRYON_MOBILE_TOKEN` enables Android-origin CORS and requires bearer authorization for all API routes, including same-origin web requests. Do not treat CORS alone as authentication. This pilot uses a shared store code; per-user accounts, tenant isolation, and token rotation UI remain future work.
3. In the app, tap the cloud icon (**Studio connection**) and enter the HTTPS studio origin and store access code. They are held in memory for the app session, not embedded in the APK or persisted to local storage.
4. Capture a face and full-body photo with consent, enter approximate height/weight, and choose the nearest standard body. Obtain separate consent to send both photos and measurements to OpenAI. Only an explicit **Generate customer avatar** action calls the provider. It sends the selected standard body, face and full-body photo in one request, asking for the customer's face and matching skin tone across all exposed skin. Profile changes and ordinary preview actions do not generate AI requests.
5. Compare the result with the original photos and approve the face, body and skin tone before export. Provider quality, body preservation, skin-tone matching, cost and latency still require live evaluation with an authorized account.

See [step-by-step API-key and backend setup](GENERATION_SETUP.md). Version 0.3.0 requires an updated backend advertising `customer-avatar-v3` and consent naming OpenAI. Update older APKs before using the OpenAI backend; their Gemini consent is not accepted. Native connections require protected mode and a store code. The public website can operate without that code.

Use the studio's real HTTPS origin, for example `https://studio.example.com`, without an API path. A phone cannot reach a computer's loopback address through its own loopback address. The APK does not contain a deployed backend URL.

## Data handling

- Photo inputs, access codes, approval state, and generated results are held in JavaScript memory. Closing/reloading the app can clear them.
- Explicit generation sends both customer photos, approximate measurements and the selected template to the provider. The server normalizes photos in memory and does not persist them. Provider retention follows the configured account's terms.
- Camera capture uses `saveToGallery: false`. Android/camera providers may manage their own temporary data. Choosing a gallery photo does not delete or modify the original.
- Exported PNGs are written only to the app cache for Android's share sheet. They remain there until the next export, new session, or app launch so recipients can finish reading the file. Files saved outside the app by a share target remain under that target's control.
- Android backup is disabled. Cleartext network traffic is disabled. Capacitor bridge logging is disabled so photo payloads are not written to ordinary bridge logs.
- Customer data is never included in the APK or the repository.

## Build from source

Install Node.js 22.12+ (24 recommended), JDK 21, and Android Studio/SDK with API 36 and Build Tools 35.0.0. Set `JAVA_HOME` and `ANDROID_HOME` to those installations, or let Android Studio manage them.

```sh
npm ci
npm test
npm run android:debug
```

The result is `android/app/build/outputs/apk/debug/app-debug.apk`. `npm run android:check` builds it and runs Android lint. `npm run android:open` opens the native project in Android Studio. After changing web code, use `npm run android:sync` before running the native project.

The build wrapper supports Windows and Unix shells. Install the required JDK/SDK first. The Gradle distribution has a pinned SHA-256 checksum. Signing keys, SDK paths, generated web bundles, and Gradle caches are excluded from Git.

For a hosted build, use **Actions → Build Android APK → Run workflow** on GitHub and download the resulting artifact. The workflow runs only when manually requested. It is a repeatable build recipe; a local build does not prove a GitHub Actions run succeeded.

## Validation and release boundary

- This delivery passed **15 unit/API tests** and **29 Playwright tests**, the production TypeScript/Vite build, and Android `assembleDebug lintDebug`. Tests include the three-image generation request, consent, skin-tone instructions, blocked customer export without generation, 16 simulated Android photo sessions, invalid inputs, and all eight WebP orientations. See the [current test report](testing/customer-generation/README.md). Lint reported no errors; 28 warnings concern unused template resources and launcher/splash assets.
- `apksigner verify` passed. APK inspection confirmed app ID/version, minimum API 24, target API 36, and that bundled web assets match the production build. No provider key, store access code, or private signing key is bundled.
- Node tests cover matching, input validation, API consent, exact native origins, bearer authorization, and provider error handling.
- Playwright tests cover the browser workflow and mocked Android camera/filesystem/share contracts, including cancellation, consent, export bytes, clearing, and temporary studio credentials. Mocked bridges do not replace physical-device testing.
- Android compilation and lint validate the native dependency and packaging configuration.
- Runtime device validation is still pending. An Android 15 emulator was started in the cloud environment without hardware acceleration, but Android's package service did not become available during the check, so APK installation/launch could not be verified there. No physical Android phone was available. On a phone, verify cold launch offline, camera/gallery capture and cancellation, portrait/landscape layout, Android Back, approval-gated sharing, and new-session clearing before a store trial.
- A release for Google Play needs an owner-controlled signing key, app listing, privacy/data-safety declarations, and real-device validation. This task delivers a test APK, not a published Play Store app.

The iPhone draft is paused and is not part of the Android delivery.
