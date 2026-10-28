# Web store-account validation — 2026-10-28

- 37 Node tests passed, including owner isolation, persistent database reopen, consent, expired/revoked sessions, password recovery, automatic saving and preservation of paid output if saving fails.
- All 41 Playwright browser tests passed. The new account test uses real account routes and a temporary SQLite database, with only the image-generation result stubbed. It generates once, signs out, signs in from an independent browser context, reloads, opens the saved avatar and tries clothes. The provider stub is called exactly once.
- The account browser test passed again after the final same-origin cookie change. TypeScript and Vite production build passed.
- The [mobile library capture](mobile-library.png) shows a test account and sample avatar from that stubbed generation; it is not evidence of live Gemini quality.
- The production Docker image built successfully. A non-root, read-only container with a named volume passed account registration, Secure/HttpOnly cookie, authenticated image retrieval and anonymous-access rejection checks. After removing and recreating the container with the same volume, login and the saved image still worked. Temporary test containers/volume were removed.
- The account Compose override validates against a minimal shared-service configuration. Live Lightsail deployment and public HTTPS sign-in must be checked after updating the server.

No APK was built or changed. No real customer photos or paid provider calls were used for this validation. Existing Gemini generation revision and the clothing compositor are unchanged.
