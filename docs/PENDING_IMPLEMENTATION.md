# Pending implementation — tryoncloths (Forme)

_Last reviewed: 2026-11-09, against `main` after PR #7. Version 0.21.0-rc.3._

All planned feature tasks are implemented: commercial **C1–C16** (including
C16.5.1 and C16.5.2 tooling) and jewellery **J1–J14**. The items below are what
remains, grouped by what they need.

## 1. Code to write (not yet planned as tasks)

| Item | Current state | Source |
| --- | --- | --- |
| Automatic body measurements and fit prediction from customer photos | Profile is chosen from an illustrative height/weight rule plus staff correction | [README](../README.md), [LEVEL_1](LEVEL_1.md) |
| Calibrate standard avatars against real body measurements; define height/build bands | Sample profiles have no calibrated measurements | [LEVEL_1](LEVEL_1.md) |
| Local pose/silhouette analysis to assist the full-body photo review | Manual staff review only | [LEVEL_1](LEVEL_1.md) |
| Aligned transparent garment layers and masks for the clothing compositor | Sample layers come from nine AI-created textures; no aligned masks | [LEVEL_1](LEVEL_1.md) |
| Automatic background removal for jewellery product photos | Free overlays need a store-supplied transparent PNG | [jewellery requirements](jewellery/REQUIREMENTS.md) §9 |
| Extra jewellery types (nose-ring chains to ear, hair accessories) | Open decision | [jewellery requirements](jewellery/REQUIREMENTS.md) §10 |
| Portrait capture as part of the default avatar flow for jewellery stores (+1 credit per customer) | Open decision | [jewellery requirements](jewellery/REQUIREMENTS.md) §10 |
| 3D / AR live-camera try-on | Out of scope today; possible later with a separate engine | [jewellery requirements](jewellery/REQUIREMENTS.md) §9 |

## 2. Live-service validation (needs accounts, keys or a deployed server)

- [ ] Live Gemini quality run: generate consented avatars and try-ons on a configured studio, then review face fidelity, skin tone, garment fidelity, framing, cost, latency and failures with `npm run evaluate:quality` (it reviews existing results and makes no AI calls). See [release validation](RELEASE_VALIDATION.md).
- [ ] Live product-link reading benchmark: `npm run benchmark:links -- --manifest … --out … --mode static --live yes` (reads retailer pages; no AI calls).
- [ ] Browser link reader pilot: real-shop benchmark and memory review ([browser reader](BROWSER_LINK_READER.md)).
- [ ] Decide whether a dedicated try-on model is needed if garment fidelity falls short.
- [ ] Product-link try-on on the Lightsail server: 3–4 real shop links (Myntra, Ajio, Amazon, a small brand) and 10+ reviewed live try-ons.
- [ ] Confirm `TRYON_TRUST_PROXY_HOPS=1` behind Caddy so per-IP limits work.
- [ ] Female body library quality review (pilot, disabled by default).
- [ ] Razorpay test mode, then live mode; verify subscriptions, packs, webhooks and GST invoices.
- [ ] SMTP delivery for staff invitations, invoices and monthly analytics emails.
- [ ] Shopify and WooCommerce: live shop connectivity and nightly sync after deployment ([catalogue sync](CATALOGUE_SYNC.md)).
- [ ] WhatsApp Business: Meta template approval, live delivery, STOP opt-out and charges on a real account ([WhatsApp](WHATSAPP.md)).
- [ ] Jewellery: calibrate the face-descriptor threshold on 50+ pilot portraits before enforcing rejections.
- [ ] Jewellery: measure the pilot targets ([jewellery requirements](jewellery/REQUIREMENTS.md) §8) before general release (`npm run evaluate:jewellery`).
- [ ] Customer hand photos: live photo-quality review in the pilot.
- [ ] Physical Android device testing. Hosted APK builds are disabled, but local builds (`npm run android:debug`) still work for device testing.

## 3. Shopper "Try it on me" launch (C16.5) — business and legal

- [ ] Select CAPTCHA and image-moderation services; confirm tariffs, capacity, age/safety limits and provider processing/retention terms.
- [ ] Legal review: merchant/provider roles, adult own-photo consent, privacy contact, deletion/complaints process, cross-border processing disclosures.
- [ ] Verify Gemini billing and quality for shopper traffic, the Shopify theme button, target deployment, load and retention.
- [ ] Run a supervised pilot and approve the live launch.

## 4. Commercial open decisions

- [ ] Store-account data retention and erasure policy before general paid rollout, including trial-eligibility hashes kept after account deletion and backup/WAL handling ([billing](BILLING.md)).
- [ ] Final prices after 5 pilot store interviews.
- [ ] Whether trials need a phone OTP to limit abuse.
- [ ] WhatsApp: each store's own Business number (preferred) or a shared Forme number.

## 5. Repository housekeeping

- [ ] Move `downloads/forme-android-debug.apk` (11 MB, app 0.7.0) out of git, e.g. to GitHub Releases.
- [ ] Hosted mobile builds are disabled (Android workflow removed; no iOS project); local Android builds still work. Rebuild and publish the APK if mobile work resumes; it lags the web app (0.7.0 vs 0.21.0-rc.3).
- [ ] Tick or archive the stale acceptance checkboxes in `docs/LINK_TRYON_IMPLEMENTATION.md`; that work shipped in PR #1.
- [ ] Address the 8 `npm audit` advisories (6 moderate, 2 high) reported by `npm ci`.
