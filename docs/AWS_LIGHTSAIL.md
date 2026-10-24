# Host the Android backend on AWS Lightsail

This guide runs the Forme backend and HTTPS proxy on one Ubuntu instance. The Android app sends customer photos to this backend; the backend calls Gemini. No GPU is needed. AWS hosting and Gemini usage are billed separately. These files prepare deployment; they do not create an AWS instance.

You need an AWS account, a domain you can edit, and a Gemini API key with access to an image-generation model. Create the key in [Google AI Studio](https://aistudio.google.com/apikey). Keep it on the server, never in the APK or GitHub.

## 1. Create an instance

In the [Lightsail console](https://lightsail.aws.amazon.com/), choose **Create instance**:

- Select a region near your store.
- Choose **Linux/Unix → OS Only → Ubuntu 24.04 LTS** (x86_64).
- Start with a **2 GB RAM** plan. Review the price shown by AWS before creating it.
- Name it `forme-backend` and create it.

This is a pilot starting size; monitor memory and generation traffic before serving more stores.

## 2. Attach a static IP and connect your domain

In Lightsail **Networking**, create a static IP and attach it to `forme-backend`. At your domain's DNS provider, add an **A record** such as:

| Type | Name | Value |
| --- | --- | --- |
| A | `api` | Your Lightsail static IPv4 address |

For a domain `yourdomain.com`, the backend address will be `https://api.yourdomain.com`. Replace that example throughout this guide. Wait until DNS resolves to the static IP. Use a DNS-only record during setup if your provider offers proxying. Do not add an AAAA record unless you have also configured IPv6 routing and firewall access.

This setup uses a domain for Caddy's automatic trusted HTTPS certificate, which Android requires.

## 3. Set the Lightsail firewall

Open your instance's **Networking** tab. Allow inbound TCP **80** and **443** publicly. Keep SSH TCP **22** limited to your administrative IP, while preserving Lightsail browser SSH access if you use it. Do not open port 3001: only the proxy should reach the application.

## 4. Install Docker

Open **Connect using SSH** in Lightsail and run:

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git openssl
sudo systemctl enable --now docker
sudo docker compose version
```

These commands target Ubuntu 24.04. If you chose a different OS, use that OS's Docker installation instructions instead.

## 5. Download the application

```sh
git clone https://github.com/RajeshRamadas/tryoncloths.git
cd tryoncloths/deploy/lightsail
umask 077
cp .env.example .env
openssl rand -hex 24
```

The last command prints a new random **store access code**. Keep it securely for the server and Android app. It is separate from the Gemini API key.

Open the configuration:

```sh
nano .env
```

Fill in these values, replacing all placeholders:

```dotenv
STUDIO_DOMAIN=api.yourdomain.com
ACME_EMAIL=you@yourdomain.com
TRYON_GEMINI_API_KEY=your_actual_gemini_key
TRYON_MOBILE_TOKEN=the_random_store_access_code_you_generated
TRYON_GEMINI_MODEL=gemini-2.5-flash-image
FORME_IMAGE_TAG=local
```

Use only the hostname for `STUDIO_DOMAIN`, without `https://` or a path. Use an image-capable Gemini model available to your project; change the model variable if necessary. In nano, save with **Ctrl+O**, Enter, then exit with **Ctrl+X**.

```sh
chmod 600 .env
```

The `.env` file is ignored by Git and excluded from the Docker build context. Do not paste its contents into chat or commit it. The running container receives the secrets at startup.

## 6. Start the backend and HTTPS proxy

From `tryoncloths/deploy/lightsail`:

```sh
sudo docker compose config --quiet
sudo docker compose up -d --build
sudo docker compose ps
```

The first build can take several minutes. The `app` service should become healthy and `caddy` should be running. Caddy obtains and renews the HTTPS certificate automatically once DNS and ports 80/443 work. Containers restart after a server reboot.

The backend runs as a non-root user with a read-only filesystem and no published host port. It trusts exactly one reverse proxy for per-client rate limits. Keep this network layout when using `TRYON_TRUST_PROXY_HOPS=1`.

## 7. Check the deployment

```sh
sudo docker compose exec -T app node --input-type=module < check.mjs
curl -I https://api.yourdomain.com/
```

The script checks authentication, Android CORS, and configured generation capability without printing secrets or making a paid AI request. It does **not** validate the Gemini key with Google. The `curl` command should complete with a valid HTTPS connection and a successful response. Opening `/api/health` without the store access code returns **401**, intentionally.

## 8. Connect the Android app

Install the [current Android test APK](https://github.com/RajeshRamadas/tryoncloths/raw/refs/heads/main/downloads/forme-android-debug.apk). Open **Studio connection** (cloud icon), enter:

- **Backend URL:** `https://api.yourdomain.com`
- **Store access code:** the value you saved as `TRYON_MOBILE_TOKEN`.

Connect. Never enter the Gemini API key into the app. Connection settings are kept in memory, so you may need to reconnect after restarting the app.

For your first real test, add a consenting customer's face and full-body photos, enter height/weight, choose a standard body, confirm generation consent, and tap **Generate customer avatar**. Review the face, body and skin tone before approving/exporting. This makes a billable Gemini request; browsing profiles does not. The first live generation verifies provider access and output quality, which local configuration checks cannot establish.

## Troubleshooting

### Website without a store access code

If you want public browser generation, update the repository and set these values in the deployment `.env`:

```dotenv
TRYON_ACCESS_MODE=public
TRYON_MOBILE_TOKEN=
```

Keep the real `TRYON_GEMINI_API_KEY` on the server. Rebuild/recreate the backend with your deployment's Compose file. For the existing Beauty Studio shared-proxy setup:

```sh
sudo docker compose -f compose.shared.yaml up -d --build tryon
sudo docker compose -f compose.shared.yaml exec -T tryon node --input-type=module < check.mjs
```

For the standalone setup in this guide, use `sudo docker compose up -d --build` instead. Reload the website; it connects to its own backend without a code. An existing Caddy Basic Auth rule, if present, must be handled separately.

Public mode allows anyone who reaches the API to use your Gemini quota. The key is never sent to the browser, but request limits are not a spending cap. Native Android connections still require protected mode. To restore protected access, set `TRYON_ACCESS_MODE=protected`, configure a random `TRYON_MOBILE_TOKEN` of at least 24 characters, and recreate the service.

### Diagnose a failed deployment

Run these from the deployment directory:

```sh
sudo docker compose ps
sudo docker compose logs --tail=80 app caddy
```

| Symptom | Check |
| --- | --- |
| HTTPS unavailable or certificate error | DNS points to the attached static IP; ports 80/443 are open; no incorrect AAAA record; inspect Caddy logs. |
| App container unhealthy | Gemini key is present; store access code is at least 24 characters; inspect app logs. |
| Android connection rejected | HTTPS URL has no `/api` suffix; store access code matches `.env`; use the current APK and backend. |
| Generation fails after connection succeeds | Gemini key, billing, model availability and quota. A successful health check only confirms the key is configured. |
| Too many requests | Wait at least 15 seconds between attempts; the pilot also limits each client IP to 20 attempts/hour and allows two concurrent generations. |

After editing `.env`, apply it with `sudo docker compose up -d`. Do not share logs without checking for sensitive information.

## Update and operate

From `tryoncloths/deploy/lightsail`:

```sh
git pull --ff-only
sudo docker compose up -d --build
sudo docker compose exec -T app node --input-type=module < check.mjs
```

Keep the Caddy named volumes: they hold certificate state. `sudo docker compose down` stops the services, but stopping containers or the instance does not by itself remove all AWS charges. Manage resource deletion and billing in AWS when retiring the deployment.

Use Lightsail monitoring for resource usage and configure Gemini quotas/billing controls for your pilot. Request limits are not a spending cap. Customer photos/results are processed in memory; the backend does not save an avatar database. See [generation setup](GENERATION_SETUP.md) for provider data handling and current verification limits.

## Deployment validation

Validated locally on 2026-10-23: Docker production build; Compose configuration with dummy credentials; Caddy configuration; non-root, read-only container startup and healthy status; API authentication and Android CORS; frontend serving; Sharp avatar template rendering; and all 16 unit/API tests, including per-client limits behind one proxy. No AWS resources were created. Public DNS, certificate issuance, physical Android connectivity and live Gemini generation must be checked on your deployment.
