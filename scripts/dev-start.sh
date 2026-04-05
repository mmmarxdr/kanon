#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── Port configuration (override via env or .env) ────────────────────────────
API_PORT="${KANON_API_PORT:-3000}"
WEB_PORT="${KANON_WEB_PORT:-5173}"
ENGRAM_PORT="${ENGRAM_PORT:-7437}"
ENGRAM_URL="${ENGRAM_URL:-http://localhost:${ENGRAM_PORT}}"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; exit 1; }

# ── Flag parsing ──────────────────────────────────────────────────────────────
WITH_ENGRAM=true
WITH_MCP=true
SHOW_HELP=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-engram)   WITH_ENGRAM=false; shift ;;
    --no-mcp)      WITH_MCP=false; shift ;;
    --help|-h)     SHOW_HELP=true; shift ;;
    --)            shift ;;  # standard argument separator (e.g. pnpm dev:start -- --no-engram)
    *)             warn "Unknown flag: $1"; shift ;;
  esac
done

if [[ "$SHOW_HELP" == "true" ]]; then
  echo "Usage: dev-start.sh [OPTIONS]"
  echo ""
  echo "Start the Kanon development environment (PostgreSQL, API, Web, Engram, MCP)."
  echo ""
  echo "By default, all services are started. Use --no-* flags to opt out."
  echo ""
  echo "Options:"
  echo "  --no-engram    Skip Engram memory service"
  echo "  --no-mcp       Skip MCP package build"
  echo "  --help, -h     Show this help message"
  echo ""
  echo "Environment:"
  echo "  All env vars are documented in packages/api/.env.example"
  echo "  A .env file is auto-created on first run from .env.example"
  echo ""
  echo "Examples:"
  echo "  ./scripts/dev-start.sh              # Start everything (API + Web + Engram + MCP)"
  echo "  ./scripts/dev-start.sh --no-engram  # Skip Engram"
  echo "  ./scripts/dev-start.sh --no-mcp     # Skip MCP build"
  exit 0
fi

# ── PID file for cleanup ─────────────────────────────────────────────────────
PID_FILE="$ROOT_DIR/.dev-pids"
rm -f "$PID_FILE"

cleanup() {
  echo ""
  info "Shutting down dev environment..."
  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  docker compose -f "$ROOT_DIR/docker-compose.yml" stop postgres 2>/dev/null || true
  ok "All processes stopped."
}
trap cleanup SIGINT SIGTERM

# ── 1. Check prerequisites ───────────────────────────────────────────────────
info "Checking prerequisites..."

command -v docker  >/dev/null 2>&1 || fail "docker is not installed"
command -v pnpm   >/dev/null 2>&1 || fail "pnpm is not installed"
command -v node   >/dev/null 2>&1 || fail "node is not installed"

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fail "Node >= 20 required (found $(node -v))"
fi

ok "Prerequisites met (node $(node -v), pnpm $(pnpm -v), docker $(docker --version | awk '{print $3}' | tr -d ','))"

# ── 2. Create .env if missing ────────────────────────────────────────────────
ENV_FILE="$ROOT_DIR/packages/api/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ROOT_DIR/packages/api/.env.example" ]]; then
    info "Creating packages/api/.env from .env.example..."
    cp "$ROOT_DIR/packages/api/.env.example" "$ENV_FILE"
  else
    info "Creating packages/api/.env with dev defaults..."
    cat > "$ENV_FILE" <<'EOF'
DATABASE_URL="postgresql://kanon:kanon@localhost:5432/kanon?schema=public"
JWT_SECRET="dev-jwt-secret-change-in-production"
JWT_REFRESH_SECRET="dev-jwt-refresh-secret-change-in-production"
PORT=${API_PORT}
HOST=0.0.0.0
NODE_ENV=development
CORS_ORIGIN=http://localhost:${WEB_PORT}
EOF
  fi
  ok ".env created"
else
  ok ".env already exists"
fi

# ── 3. Start PostgreSQL ──────────────────────────────────────────────────────
info "Starting PostgreSQL via docker compose..."
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres

info "Waiting for PostgreSQL to be healthy..."
RETRIES=30
until docker compose -f "$ROOT_DIR/docker-compose.yml" ps postgres --format json 2>/dev/null | grep -q '"healthy"' || \
      docker compose -f "$ROOT_DIR/docker-compose.yml" ps postgres 2>/dev/null | grep -q "(healthy)"; do
  RETRIES=$((RETRIES - 1))
  if [[ "$RETRIES" -le 0 ]]; then
    fail "PostgreSQL did not become healthy in time"
  fi
  sleep 1
done
ok "PostgreSQL is healthy"

# ── 3b. Start Engram (default on, skip with --no-engram) ─────────────────────
ENGRAM_STARTED_BY_US=false
ENGRAM_SOURCE=""
if [[ "$WITH_ENGRAM" == "true" ]]; then
  # Check if engram is already running (e.g., installed locally on the host)
  if curl -sf --max-time 2 "${ENGRAM_URL}/health" >/dev/null 2>&1; then
    ok "Using existing Engram instance (already running at ${ENGRAM_URL})"
    ENGRAM_SOURCE="existing"
  else
    info "Starting Engram via docker compose (profile: engram)..."
    if docker compose -f "$ROOT_DIR/docker-compose.yml" --profile engram up -d engram; then
      info "Waiting for Engram to be healthy..."
      ENGRAM_RETRIES=60
      until curl -sf --max-time 2 "${ENGRAM_URL}/health" >/dev/null 2>&1; do
        ENGRAM_RETRIES=$((ENGRAM_RETRIES - 1))
        if [[ "$ENGRAM_RETRIES" -le 0 ]]; then
          warn "Engram did not become healthy — continuing without it"
          WITH_ENGRAM=false
          break
        fi
        sleep 1
      done
      if [[ "$WITH_ENGRAM" == "true" ]]; then
        ok "Engram is healthy (Docker)"
        ENGRAM_STARTED_BY_US=true
        ENGRAM_SOURCE="docker"
      fi
    else
      warn "Docker failed to start Engram (port conflict?) — continuing without it"
      WITH_ENGRAM=false
    fi
  fi
fi

# Persist ENGRAM_STARTED_BY_US so dev-stop.sh knows whether to stop it
echo "$ENGRAM_STARTED_BY_US" > "$ROOT_DIR/.engram-started-by-us"

# Ensure ENGRAM_SYNC_ENABLED is set in .env when engram is available
if [[ "$WITH_ENGRAM" == "true" ]]; then
  if grep -q '^ENGRAM_SYNC_ENABLED=' "$ENV_FILE" 2>/dev/null; then
    sed -i 's/^ENGRAM_SYNC_ENABLED=.*/ENGRAM_SYNC_ENABLED=true/' "$ENV_FILE"
  else
    echo 'ENGRAM_SYNC_ENABLED=true' >> "$ENV_FILE"
  fi
fi

# ── 3c. Build MCP package (default on, skip with --no-mcp) ───────────────────
MCP_STATUS="skipped"
if [[ "$WITH_MCP" == "true" ]]; then
  info "Building MCP package..."
  if pnpm --filter @kanon/mcp build > "$ROOT_DIR/.dev-mcp-build.log" 2>&1; then
    ok "MCP package built"
    MCP_STATUS="built"
  else
    warn "MCP build failed — check .dev-mcp-build.log for details"
    MCP_STATUS="build failed"
  fi
fi

# ── 4. Run upgrade script (deps + prisma generate + migrate + env check) ────
info "Running upgrade script..."
"$ROOT_DIR/scripts/upgrade.sh" --quiet

# ── 5. Seed database ────────────────────────────────────────────────────────
info "Running seed (idempotent upserts for structural data)..."
SEED_OUTPUT=$(pnpm --filter @kanon/api db:seed 2>&1) || true
echo "$SEED_OUTPUT"

# Extract workspace ID from seed output, fallback to direct DB query
WORKSPACE_ID=$(echo "$SEED_OUTPUT" | grep -oP 'Workspace:.*\(\K[0-9a-f-]+(?=\))' || echo "")
if [[ -z "$WORKSPACE_ID" || "$WORKSPACE_ID" == "unknown" ]]; then
  info "Querying workspace ID from database..."
  WORKSPACE_ID=$(cd "$ROOT_DIR/packages/api" && npx tsx -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.workspace.findFirst().then(w => { console.log(w?.id ?? 'unknown'); p.\$disconnect(); });
  " 2>/dev/null | tail -1)
fi

# ── 6. Start API server in background ────────────────────────────────────────
info "Starting API server (port ${API_PORT})..."
pnpm --filter @kanon/api dev > "$ROOT_DIR/.dev-api.log" 2>&1 &
API_PID=$!
echo "$API_PID" >> "$PID_FILE"

# Wait briefly for API to start
sleep 2
if ! kill -0 "$API_PID" 2>/dev/null; then
  fail "API server failed to start. Check .dev-api.log"
fi
ok "API server started (PID $API_PID)"

# ── 7. Start web dev server in background ────────────────────────────────────
info "Starting web dev server (port ${WEB_PORT})..."
pnpm --filter @kanon/web dev > "$ROOT_DIR/.dev-web.log" 2>&1 &
WEB_PID=$!
echo "$WEB_PID" >> "$PID_FILE"

sleep 2
if ! kill -0 "$WEB_PID" 2>/dev/null; then
  fail "Web server failed to start. Check .dev-web.log"
fi
ok "Web dev server started (PID $WEB_PID)"

# ── 8. Print summary ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Kanon Dev Environment Ready${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  API:           ${CYAN}http://localhost:${API_PORT}${NC}"
echo -e "  Web:           ${CYAN}http://localhost:${WEB_PORT}${NC}"
if [[ "$WITH_ENGRAM" == "true" ]]; then
  if [[ "$ENGRAM_SOURCE" == "existing" ]]; then
    echo -e "  Engram:        ${CYAN}${ENGRAM_URL}${NC} ${GREEN}(existing instance)${NC}"
  else
    echo -e "  Engram:        ${CYAN}${ENGRAM_URL}${NC} ${GREEN}(Docker)${NC}"
  fi
else
  ENGRAM_STATUS="not started"
  if curl -sf --max-time 1 "${ENGRAM_URL}/health" >/dev/null 2>&1; then
    ENGRAM_STATUS="detected (external)"
  fi
  echo -e "  Engram:        ${YELLOW}${ENGRAM_STATUS}${NC}"
fi
if [[ "$MCP_STATUS" == "built" ]]; then
  echo -e "  MCP:           ${GREEN}${MCP_STATUS}${NC}"
elif [[ "$MCP_STATUS" == "skipped" ]]; then
  echo -e "  MCP:           ${YELLOW}${MCP_STATUS}${NC}"
else
  echo -e "  MCP:           ${RED}${MCP_STATUS}${NC}"
fi
if [[ ! -f "$ROOT_DIR/.mcp.json" ]]; then
  echo ""
  echo -e "  ${YELLOW}MCP not configured.${NC} Run ${CYAN}pnpm setup:mcp${NC} to auto-generate .mcp.json"
fi
echo ""
echo -e "${GREEN}  ── Login credentials ──────────────${NC}"
echo -e "  Workspace:     ${YELLOW}kanon-dev${NC}"
echo -e "  Workspace ID:  ${YELLOW}${WORKSPACE_ID}${NC}"
echo -e "  Email:         ${YELLOW}dev@kanon.io${NC}"
echo -e "  Password:      ${YELLOW}Password1!${NC}"
echo -e "${GREEN}  ───────────────────────────────────${NC}"
echo ""
echo -e "  ${CYAN}Tip: The login form accepts the workspace slug (kanon-dev) — no UUID needed!${NC}"
echo ""
echo -e "  API logs:      .dev-api.log"
echo -e "  Web logs:      .dev-web.log"
echo ""
echo -e "  Press ${RED}Ctrl+C${NC} to stop all services."
echo ""

# ── 9. Wait for background processes ─────────────────────────────────────────
wait
