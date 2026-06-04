#!/usr/bin/env bash
# ─── backup-local-db.sh ──────────────────────────────────────────────────────
# Dumps the local Kanon dev database to a timestamped file BEFORE any
# destructive Prisma operation (migrate reset, migrate dev that re-applies, etc.).
#
# WHY THIS EXISTS: on 2026-06-04 a `prisma migrate reset` wiped the local Kanon
# dogfooding board (the KAN project the Kanon MCP manages via localhost:3000 —
# same DB). The seed only restores ~13 demo issues, NOT the real board. There
# was no backup. This script makes "dump before reset" a one-command habit.
#
# Usage:
#   bash scripts/backup-local-db.sh                 # dump to ./.db-backups/
#   bash scripts/backup-local-db.sh /some/dir       # dump to a custom dir
#
# Restore:
#   psql "$DATABASE_URL" < .db-backups/kanon-<timestamp>.sql
#
# Reads DATABASE_URL from packages/api/.env (dev) by default.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
OUT_DIR="${1:-$REPO_ROOT/.db-backups}"
ENV_FILE="$REPO_ROOT/packages/api/.env"

# Extract DATABASE_URL from the api .env without printing it.
if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found — cannot resolve DATABASE_URL" >&2
  exit 1
fi
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')"
if [ -z "${DB_URL:-}" ]; then
  echo "error: DATABASE_URL not set in $ENV_FILE" >&2
  exit 1
fi

# Safety: this helper is for the LOCAL dev DB only. Refuse non-local hosts.
case "$DB_URL" in
  *localhost*|*127.0.0.1*) : ;;
  *) echo "error: DATABASE_URL host is not local — refusing (this script is dev-only)." >&2; exit 1 ;;
esac

mkdir -p "$OUT_DIR"
# Timestamp is provided by the shell (date), which the human runs — not an agent.
TS="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$OUT_DIR/kanon-${TS}.sql"

echo "[backup] dumping local Kanon DB → $OUT_FILE"
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DB_URL" > "$OUT_FILE"
else
  # Fallback: dump via the running postgres docker container (pg_dump lives inside).
  echo "[backup] pg_dump not found on PATH — dumping via docker container"
  PGC="$(docker ps --format '{{.Names}}' | grep -i postgres | head -1)"
  if [ -z "$PGC" ]; then
    echo "error: no running postgres container found and pg_dump not on PATH" >&2
    exit 1
  fi
  # Parse db name + user from DATABASE_URL (postgresql://user:pass@host:port/dbname).
  DB_NAME="$(printf '%s' "$DB_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
  DB_USER="$(printf '%s' "$DB_URL" | sed -E 's#.*://([^:]+):.*#\1#')"
  docker exec -e PGPASSWORD_UNUSED=1 "$PGC" pg_dump -U "${DB_USER:-kanon}" "${DB_NAME:-kanon}" > "$OUT_FILE" \
    || { echo "error: docker pg_dump failed" >&2; exit 1; }
fi

LINES="$(wc -l < "$OUT_FILE")"
echo "[backup] done — $OUT_FILE ($LINES lines)"
echo "[backup] restore with: psql \"\$DATABASE_URL\" < $OUT_FILE"
