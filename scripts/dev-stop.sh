#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }

PID_FILE="$ROOT_DIR/.dev-pids"

# ── Stop background processes ─────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  info "Stopping dev processes..."
  while IFS= read -r pid; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      info "Stopped PID $pid"
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
  ok "Background processes stopped"
else
  info "No PID file found — killing any pnpm dev processes..."
  # Fallback: find processes by port
  for port in "${KANON_API_PORT:-3000}" "${KANON_WEB_PORT:-5173}"; do
    pid=$(lsof -ti ":$port" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
      info "Killed process on port $port (PID $pid)"
    fi
  done
fi

# ── Stop PostgreSQL ──────────────────────────────────────────────────────────
info "Stopping PostgreSQL..."
docker compose -f "$ROOT_DIR/docker-compose.yml" stop postgres 2>/dev/null || true
ok "PostgreSQL stopped"

# ── Stop Engram (only if we started it via Docker) ───────────────────────────
ENGRAM_MARKER="$ROOT_DIR/.engram-started-by-us"
if [[ -f "$ENGRAM_MARKER" ]] && [[ "$(cat "$ENGRAM_MARKER")" == "true" ]]; then
  if docker compose -f "$ROOT_DIR/docker-compose.yml" ps engram 2>/dev/null | grep -q "engram"; then
    info "Stopping Engram (started by dev-start)..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" --profile engram stop engram 2>/dev/null || true
    ok "Engram stopped"
  fi
else
  if docker compose -f "$ROOT_DIR/docker-compose.yml" ps engram 2>/dev/null | grep -q "engram"; then
    info "Engram is running but was not started by dev-start — leaving it alone"
  fi
fi
rm -f "$ENGRAM_MARKER"

# ── Clean up log files ───────────────────────────────────────────────────────
rm -f "$ROOT_DIR/.dev-api.log" "$ROOT_DIR/.dev-web.log"
ok "Log files cleaned up"

echo ""
echo -e "${GREEN}Dev environment stopped.${NC}"
