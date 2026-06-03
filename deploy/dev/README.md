# Self-host Kanon (single box)

Run the whole Kanon stack on **one Linux box** with `docker compose`:
same-origin, real HTTPS, behaves like production. Good for a small/dev
deployment. (Multi-AZ production is out of scope here.)

## Topology

```
browser ──HTTPS──> Caddy (auto-TLS)
                     └─> kanon-web (nginx: serves SPA, proxies /api)
                           └─> kanon-api (Fastify :3000)
                                 └─> postgres (container, volume-backed)
```

Everything is one origin → first-party `SameSite=Lax` cookies, no CORS.
`NODE_ENV=production` + Caddy TLS means cookies are `Secure`, so you need a
real hostname with HTTPS (see sslip.io trick below).

`mcp`, `cli`, `bridge` are client-side / libraries — not hosted. They talk to
this box's API over HTTPS.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | The stack (postgres, kanon-api, kanon-web, caddy). Builds images locally. |
| `docker-compose.images.yml` | Overlay to run prebuilt GHCR images instead of building. |
| `Caddyfile` | TLS termination + reverse proxy (SSE-safe). |
| `env.template` | Copy to `.env` and fill secrets + URL. |

## Prerequisites

- A Linux box (arm64 or amd64) with Docker Engine + the compose plugin.
- Ports 80 and 443 reachable from the internet (for Caddy + Let's Encrypt).
- A hostname pointing at the box. No domain? Use **`<public-ip>.sslip.io`** —
  `sslip.io` resolves `52.1.2.3.sslip.io` → `52.1.2.3`, so Caddy can get a
  real cert with zero DNS setup.

## Deploy

```bash
git clone <repo-url> /opt/kanon
cd /opt/kanon/deploy/dev
cp env.template .env
```

Edit `.env`:
- `SITE_ADDRESS`, `CORS_ORIGIN`, `APP_URL`, `BASE_URL` → your hostname
  (e.g. `<ip>.sslip.io`; the last three with `https://`).
- Generate `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, and a DB
  password with `openssl rand -hex 32` (the `DATABASE_URL` password must match
  `POSTGRES_PASSWORD`).
- `RESEND_API_KEY` blank → emails are logged to the console (not sent); set it
  to deliver invite/verify/reset emails for real.

Bring it up — build locally:

```bash
docker compose up -d --build
```

…or run **prebuilt** images from GHCR (no build on the box):

```bash
docker compose -f docker-compose.yml -f docker-compose.images.yml pull
docker compose -f docker-compose.yml -f docker-compose.images.yml up -d
```

Pin a version with `KANON_IMAGE_TAG=sha-<...>` in `.env`; point at a fork with
`KANON_IMAGE_PREFIX`. Open `https://<your-host>`. DB migrations run
automatically on api start.

## Operate

```bash
docker compose logs -f kanon-api          # app logs
docker compose logs -f caddy              # watch the TLS cert get issued
docker compose exec postgres psql -U kanon -d kanon
docker compose down                       # stop (keeps data)
docker compose down -v                    # stop + wipe DB + certs
```

## Redeploy

```bash
cd /opt/kanon && git pull
cd deploy/dev && docker compose -f docker-compose.yml -f docker-compose.images.yml pull && \
  docker compose -f docker-compose.yml -f docker-compose.images.yml up -d
```

> Automated AWS provisioning + CD for the maintainers' own hosting lives in a
> separate private infra repo (Terraform + an OIDC GitHub Actions workflow that
> deploys via SSM). This repo stays deployment-agnostic.
