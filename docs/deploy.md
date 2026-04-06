# Production Deployment

Deploy Kanon on any VPS with Docker and Docker Compose.

## Prerequisites

- VPS with 1GB+ RAM (2GB recommended with Engram)
- Docker Engine 24+ and Docker Compose v2
- A domain pointing to your server (for HTTPS)

## Quick Deploy

```bash
# 1. Clone
git clone https://github.com/mmmarxdr/kanon.git
cd kanon

# 2. Configure
cp env.production.example .env.production
# Edit .env.production — fill in all CHANGE_ME values
# Generate secrets: openssl rand -base64 48

# 3. Start
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build

# 4. Create first user
curl -X POST https://your-domain.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"YourPassword1!","name":"Admin","workspaceName":"my-workspace"}'

# 5. Share with team
# Each developer runs:
npx @kanon-pm/setup --api-url https://your-domain.com
```

With Engram (AI memory service):
```bash
docker compose -f docker-compose.production.yml --env-file .env.production --profile engram up -d --build
```

## Reverse Proxy (HTTPS)

The web container listens on port 80. Put a reverse proxy in front for TLS.

### Caddy (simplest)

```
your-domain.com {
    reverse_proxy localhost:80
}
```

Caddy handles Let's Encrypt automatically.

### Nginx + Certbot

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

## Team Onboarding

Once deployed, each developer configures their AI tools:

```bash
npx @kanon-pm/setup --api-url https://your-domain.com
```

This auto-detects Claude Code, Cursor, and Antigravity, then installs the MCP server config pointing to your production instance.

## Updating

```bash
cd kanon
git pull
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

The API container runs `prisma migrate deploy` on startup, so database migrations apply automatically.

## Backup

Add a cron job for daily PostgreSQL backups:

```bash
# /etc/cron.d/kanon-backup
0 3 * * * docker exec $(docker ps -qf "name=postgres") pg_dump -U kanon kanon | gzip > /backups/kanon-$(date +\%Y\%m\%d).sql.gz
```

Keep at least 7 days of backups. Test restores periodically:
```bash
gunzip -c /backups/kanon-20260405.sql.gz | docker exec -i $(docker ps -qf "name=postgres") psql -U kanon kanon
```

## Monitoring

The API exposes a health check at `/health` (proxied through the web container). Use it with your monitoring tool:

```bash
curl -f https://your-domain.com/health
```

Returns `200 OK` when the API is ready and connected to the database.

## Troubleshooting

**Containers won't start:** Check secrets are set — the compose file uses required env vars (`${VAR:?message}`) and the API validates JWT secrets are 32+ chars in production.

**API logs:** `docker compose -f docker-compose.production.yml logs -f kanon-api`

**Database connection issues:** Ensure `DATABASE_URL` password matches `POSTGRES_PASSWORD`.

**CORS errors:** Verify `CORS_ORIGIN` matches your exact domain (including `https://`).
