# Kanon — DEV environment (AWS single-box)

The simplest possible hosted Kanon: **one EC2 instance** running the whole
stack with `docker compose`. Same-origin, real HTTPS, behaves like production.
Throwaway by design — `preprod`/`prod` come later as proper Terraform
multi-AZ environments.

## Topology

```
browser ──HTTPS──> Caddy (auto-TLS, <eip>.sslip.io)
                     └─> kanon-web (nginx: SPA + proxy /api)
                           └─> kanon-api (Fastify :3000)
                                 └─> postgres (container, volume-backed)
```

Everything is one origin, so auth cookies are first-party `SameSite=Lax` and
there is no CORS. `NODE_ENV=production` + Caddy TLS means cookies are `Secure`
and the prod config validations run — this box is also the target for the
upcoming MCP installer (`kanon://` → this server), which needs a stable HTTPS
URL.

What is **not** here: `mcp`, `cli`, `bridge` are client-side / libraries — they
are not hosted. They talk to this box's API over HTTPS.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | The dev stack (postgres, kanon-api, kanon-web, caddy). |
| `Caddyfile` | TLS termination + reverse proxy (SSE-safe). |
| `env.template` | Copy to `.env` and fill secrets + URL. |
| `provision.sh` | aws CLI: security group + EC2 + Elastic IP. |
| `user-data.sh` | EC2 bootstrap (Docker, swap). |

## 1. Provision the box (run locally, aws CLI configured)

```bash
export KEY_NAME=your-ec2-keypair                 # must already exist
export MY_IP=$(curl -s https://checkip.amazonaws.com)
bash deploy/dev/provision.sh
```

It prints the **Elastic IP** and the `SITE_ADDRESS` to use
(`<eip>.sslip.io`). t4g.small (arm64) by default; set
`INSTANCE_TYPE=t4g.medium` if image builds run out of memory.

> sslip.io resolves `52.1.2.3.sslip.io` → `52.1.2.3` automatically, so Caddy
> gets a real Let's Encrypt cert with no domain purchase. Move to a real
> domain later by pointing an A-record at the EIP and changing the four URL
> vars in `.env`.

## 2. Deploy the app (over SSH)

```bash
ssh ubuntu@<eip>
git clone <repo-url> /opt/kanon          # or: rsync -az ./ ubuntu@<eip>:/opt/kanon
cd /opt/kanon/deploy/dev
cp env.template .env
```

Edit `.env`:
- Set `SITE_ADDRESS`, `CORS_ORIGIN`, `APP_URL`, `BASE_URL` to `<eip>.sslip.io`
  (the last three with the `https://` prefix).
- Generate `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, and a DB
  password: `openssl rand -hex 32` each. The `DATABASE_URL` password must
  match `POSTGRES_PASSWORD`.
- Leave `RESEND_API_KEY` blank to log emails to the console, or set it to send
  invite/verify/reset emails for real.

Then:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f caddy        # watch the TLS cert get issued
```

Open `https://<eip>.sslip.io`.

## 3. Redeploy after changes

```bash
ssh ubuntu@<eip>
cd /opt/kanon && git pull
cd deploy/dev && docker compose up -d --build
```

DB migrations run automatically on api start
(`prisma migrate deploy` in the api container CMD).

## Prebuilt images (instead of building on the box)

CI publishes arm64 images to GHCR (`ghcr.io/<org>/kanon-api`, `kanon-web` — see
`.github/workflows/publish-images.yml`). To run those instead of building
locally — which is what the CD does, avoiding builds on a small box:

```bash
docker compose -f docker-compose.yml -f docker-compose.images.yml pull
docker compose -f docker-compose.yml -f docker-compose.images.yml up -d
```

Pin a version with `KANON_IMAGE_TAG=sha-<...>` in `.env`; point at a fork with
`KANON_IMAGE_PREFIX`.

> **CD / automated deploy** is intentionally *not* in this open-source repo —
> it targets a specific AWS account. It lives in the private `kanon-infra`
> repo (Terraform + a GitHub Actions workflow that assumes an OIDC role and
> runs `aws ssm send-command` on the box: `git pull` + the two-file
> `compose pull && up -d` above). No SSH, no manual commands.

## Operate

```bash
docker compose logs -f kanon-api          # app logs
docker compose exec postgres psql -U kanon -d kanon   # DB shell
docker compose down                       # stop (keeps volumes/data)
docker compose down -v                    # stop + wipe DB + certs
```

## Notes carried forward to prod (Terraform, later)

- **Migrations**: the api container runs `prisma migrate deploy` on start —
  fine for one container; with multiple Fargate tasks, move migrations to a
  one-shot pre-deploy task to avoid a boot race.
- **DB TLS**: container Postgres has no TLS; RDS will need `sslmode=require`
  in `DATABASE_URL`.
- **Connections**: at ~70 devs a single RDS instance is fine; add
  `?connection_limit=` or RDS Proxy only when scaling api horizontally.
- **SSE**: keep the ALB idle timeout high (≥ the 30s heartbeat) and buffering
  off for `/api/events/*`, same as the nginx/Caddy config here.
