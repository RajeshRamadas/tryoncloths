# Store accounts and server-saved avatars — web 0.8

One store account manages its customers' avatars. Sign in with the same store email/password from any browser to reopen the same library. This release updates the website only. The existing Android APK remains version 0.7 with local storage; use the website for the new account workflow. No APK was built for this release.

## Enable on the existing Lightsail instance

Download any currently unsaved avatar PNG before refreshing the old website. Keep the existing provider key and shared Beauty Studio Caddy configuration.

```sh
cd ~/tryoncloths && git pull --ff-only origin main && cd deploy/lightsail && sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml up -d --build tryon
```

**Use both Compose files for future account-enabled updates.** The second file adds the account data directory and persistent named volume to the existing `tryon` service. It does not launch another proxy. Omitting it disables account storage in the container configuration; the named volume remains, but the account library will not be active. Do not remove the volume with `down -v`.

Verify configuration without sending photos or generating an image:

```sh
curl -sS https://studio.marketingadda.com/api/health
```

The response should include `"accountsAvailable":true` and `"storage":"account"`. The Gemini generation revision remains `customer-neck-v6`.

The Docker image creates `/app/data` owned by its unprivileged runtime user. SQLite, its journal files and account/avatar records live in the `tryon_accounts` named volume, rather than in the replaceable container filesystem. Records survive container replacement. For a non-Docker Node 24+ host, set `TRYON_DATA_DIR` to a persistent writable directory. If it is unset, the older local-library behavior remains available.

## Use the account

1. Open the website and choose **Create an account**. Enter a store name, email and a password of 12–128 characters. The email is the sign-in identifier; this release does not send verification or recovery emails.
2. Sign in before generating customer avatars. Enter a customer/avatar name and confirm consent to generation **and saving the result/measurements to the store account**.
3. A successful generated image is saved to the account automatically, before the success response. Review it before trying clothes. Original face and full-body input photos are not saved.
4. On a later visit/device, sign in to the same account and open **Saved avatars → Use**. Review and try clothes without another generation request.
5. **Save avatar for reuse** updates the name/details or saves an imported avatar to this account after explicit consent. Identical output PNGs update an entry rather than duplicate it. An account can hold up to 100 avatars.
6. Signing out clears the active customer session, previews and library list in the browser, while retaining server records. Deleting an avatar removes its saved account copy, not previous downloads.

If generation succeeds but account storage fails, the app retains the generated result and displays a save failure. Download that image or review and save it again; it never repeats a paid provider call to retry a database write.

## Bring over older avatars

After signing in, open **Saved avatars → Open this device’s older library**. Those local copies are not uploaded automatically. Open the desired avatar, review it, confirm account-storage consent and select **Save avatar for reuse**.

Alternatively, open a downloaded full-body PNG from the library's import section. Account uploads accept valid portrait PNGs under 10 MB and at most 16 megapixels. Confirm its profile/measurements and review before saving. No automatic face verification is claimed for imported PNGs.

## Access and operations

Passwords use salted scrypt hashes. A random session token is stored only in an HttpOnly, SameSite=Strict cookie; the database stores its hash. Production cookies require HTTPS and expire after 30 days. Each list, image download and delete is filtered by the authenticated account. Client-supplied account identifiers cannot select another account's records. Mutations require a same-origin request. Sign-in/registration attempts are rate-limited, and concurrent password hashes are bounded for small instances.

There are no staff roles or invitations in this release: people signing in to the same store account access the same customer library. Original customer photos, API keys and store access tokens are excluded from avatar records. Access to the server's disk/backups remains an administrator responsibility.

New registrations can be closed after creating the intended account(s): set `TRYON_ALLOW_SIGNUP=false` in `deploy/lightsail/.env` and recreate `tryon` using both Compose files. Existing accounts continue to sign in. Public registration by itself does not establish store identity; use this switch for a private single-store installation.

Account recovery is operator-assisted. On Lightsail, run the following from `deploy/lightsail`, replacing the example email. The password is read silently and sent on stdin, not placed in the process arguments:

```bash
read -rsp 'New account password: ' tryon_reset_password
printf '%s' "$tryon_reset_password" | sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml exec -T tryon node server/account-admin.js reset-password owner@example.com
unset tryon_reset_password
```

This resets that account's password and revokes all its old sessions. Keep routine backups of the persistent volume (or consistent Lightsail disk snapshots). A volume survives a container update, but is not a backup against disk loss. Do not copy a live SQLite database file alone without its journal; stop the service for a filesystem backup or use a SQLite-aware backup process.

## Validation

API tests cover account isolation, a separate session opening the same library, persisted database reopen, same-origin checks, consent, invalid images/passwords, expiry/logout, password recovery and preserving a generated result if its database save fails. A browser test uses the actual account API/database with only the generation response stubbed: create a store, generate once, sign out, then sign in from a separate browser context and try clothes on the saved avatar. No paid provider generation is used for these checks.

See the [validation report and mobile capture](testing/store-accounts/README.md). The production Docker test also verified account and image persistence after container replacement.
