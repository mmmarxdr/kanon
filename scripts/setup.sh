#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[setup]${NC}  $*"; }
ok()    { echo -e "${GREEN}[setup]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC}  $*"; }
fail()  { echo -e "${RED}[setup]${NC}  $*" >&2; exit 1; }

echo ""
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo -e "${CYAN}  Kanon Setup${NC}"
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo ""

# ── 1. Preflight checks ───────────────────────────────────────────────────────
info "Running preflight checks..."

# Node version check — compare against engines.node in package.json
REQUIRED_NODE_MAJOR=20
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo "0")
if [[ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]]; then
  fail "Node.js >= ${REQUIRED_NODE_MAJOR} required (found $(node -v 2>/dev/null || echo 'not found')). Install from https://nodejs.org/"
fi
ok "Node.js $(node -v) — OK"

# pnpm check
if ! command -v pnpm >/dev/null 2>&1; then
  fail "pnpm is not installed. Install it: npm install -g pnpm@10.32.1"
fi
ok "pnpm $(pnpm -v) — OK"

# Docker check — warn only (DB might run outside Docker)
if ! docker info >/dev/null 2>&1; then
  warn "Docker is not running or not installed."
  warn "If your database runs via Docker, start Docker before running 'pnpm dev:start'."
  warn "If you manage the database yourself, you can ignore this warning."
else
  ok "Docker — OK"
fi

echo ""

# ── 2. Install deps + Prisma generate + migrate + env check ──────────────────
info "Running upgrade (install, generate, migrate, env check)..."
bash "$ROOT_DIR/scripts/upgrade.sh"

echo ""

# ── 3. Build MCP package ──────────────────────────────────────────────────────
info "Building @kanon/mcp..."
pnpm --filter @kanon/mcp build
ok "@kanon/mcp built"

echo ""

# ── 4. Build setup package ────────────────────────────────────────────────────
info "Building @kanon-pm/setup..."
pnpm --filter @kanon-pm/setup build
ok "@kanon-pm/setup built"

echo ""

# ── Success banner ────────────────────────────────────────────────────────────
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Kanon is ready!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  Run ${CYAN}pnpm dev:start${NC} to start the development environment."
echo ""
