# Optional isolated browser reader — web 0.12

The normal product-link reader remains the default. If a site refuses that reader
or returns no product images, an optional Chromium worker can execute the page's
scripts and return its metadata. Images are subsequently downloaded through the
normal guarded fetcher. Neither link-reading path makes an AI generation call.

## Status and limits

The feature is disabled unless `TRYON_LINK_BROWSER=1`. It is intended for a
controlled pilot, not automatic enablement on every shop. The requirements call
for recording results against a fixed set of 20 real product links before enabling
it in production; that retailer benchmark has not been performed here. Automated
checks use synthetic HTML and mocked external responses. Browser execution is not
a guarantee that a retailer allows reading its products; photo upload remains the
fallback.

One page runs at a time, with a 20-second browser deadline and an 8 MB data budget.
HTML returned to the API is capped at 4 MB. Downloads, popup pages, service workers,
fonts, media and browser image loads are blocked. Third-party scripts are blocked;
some legitimate shops need them and will therefore still require photo upload.
No login, customer cookies, provider keys, original customer photos or avatar images
are sent to the browser worker. Browser contexts are disposable.

## Isolation

The worker runs in its own Docker container, with no published ports and a separate
random token. Its entrypoint installs IPv4 rules preventing new connections to
private, loopback, link-local, carrier-grade NAT, multicast and reserved addresses.
Only Docker DNS and public HTTP/HTTPS destinations are allowed. New IPv6 connections
are dropped, so the browser path uses IPv4. Established replies let the authenticated
API communicate with the worker. All capabilities are dropped before launching
Node and Chromium as UID 1000. A failed firewall setup prevents worker startup.

Chromium's process sandbox is disabled inside this container; the dedicated
unprivileged container, read-only filesystem, dropped capabilities and kernel
network rules are the isolation boundary. Do not run this worker directly on the
Lightsail host or give it the host network, Docker socket, provider keys, database
volume or writable application files.

The main API still validates URLs and every redirect, normalizes images and guards
DNS at connect time. The static fetcher now enforces an absolute deadline, including
continuously streaming responses. Browser fallback only handles `no_images` and
`site_refused`, never a blocked address, oversized response or validation failure.

## Shared-Caddy Lightsail pilot

Use the normal two-file update command to keep this feature disabled. The extra
worker allows up to 512 MB plus the existing API; the current approximately 1 GB
Lightsail instance is tight for both. Use a larger instance or a separate worker
host before enabling it, and measure peak usage with real pages.

For an adequately sized instance on the existing `beauty_studio_default` network,
add a separate random `TRYON_READER_TOKEN` of at least 32 characters to the private
`deploy/lightsail/.env` (for example generate it with `openssl rand -hex 32`). Then:

```sh
cd ~/tryoncloths/deploy/lightsail
sudo docker compose -f compose.shared.yaml -f compose.accounts.yaml -f compose.reader.yaml up -d --build tryon link-reader
```

The overlay opts the API into fallback and starts the restricted worker on the
existing shared network. It does not change Caddy or expose a new public port.
The worker needs kernel IPv4/IPv6 filtering support. It fails closed when either
filter cannot be installed. It retains no database or browser profile.

To disable fallback, recreate `tryon` with only `compose.shared.yaml` and
`compose.accounts.yaml`, then stop the worker using the three-file Compose command.
Existing avatars and looks remain in their named volume.

## Validation

Unit coverage checks request filtering, eligible fallback errors, response bounds,
final-URL validation, worker authentication, one-page concurrency and the absolute
static-reader deadline. A real Chromium test executes a script that inserts product
metadata and verifies that a private subrequest is aborted. All network responses
in that browser test are controlled fixtures; it makes no retailer requests.


Final validation: 57 backend tests, 49 browser tests and the production build
passed. The worker Docker image built successfully. Container checks with the
current worker/entrypoint mounted read-only verified authenticated health, blocked
private sockets and blocked Chromium navigation when a public-looking hostname
resolved to a private test container. The target received zero requests. Temporary
containers and their network were removed. The first run failed closed because
this kernel lacks IPv6 REJECT support; IPv6 DROP passed the same isolation test.
No real-shop benchmark or live provider-generation quality check was performed.
