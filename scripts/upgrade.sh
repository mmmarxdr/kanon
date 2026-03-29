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
CHECKMARK="${GREEN}✓${NC}"
WARNING="${YELLOW}⚠${NC}"
CROSS="${RED}✗${NC}"

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; exit 1; }

# ── Flag parsing ──────────────────────────────────────────────────────────────
QUIET=false
SHOW_HELP=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet|-q)  QUIET=true; shift ;;
    --help|-h)   SHOW_HELP=true; shift ;;
    *)           warn "Unknown flag: $1"; shift ;;
  esac
done

if [[ "$SHOW_HELP" == "true" ]]; then
  echo "Usage: upgrade.sh [OPTIONS]"
  echo ""
  echo "Idempotent upgrade script for Kanon."
  echo "Installs dependencies, generates Prisma client, runs pending"
  echo "migrations, and checks for missing environment variables."
  echo ""
  echo "Safe to run multiple times — skips steps that are already up to date."
  echo ""
  echo "Options:"
  echo "  --quiet, -q    Suppress success messages, only show warnings"
  echo "  --help, -h     Show this help message"
  echo ""
  echo "Examples:"
  echo "  ./scripts/upgrade.sh          # Full upgrade with status output"
  echo "  ./scripts/upgrade.sh --quiet  # Quiet mode (warnings only)"
  exit 0
fi

# Track results for summary
STEPS_RUN=()
STEPS_SKIPPED=()
WARNINGS=()

log_run()     { STEPS_RUN+=("$1"); }
log_skip()    { STEPS_SKIPPED+=("$1"); }
log_warn()    { WARNINGS+=("$1"); }

# ── 1. Dependencies (pnpm install) ───────────────────────────────────────────
LOCK_FILE="$ROOT_DIR/pnpm-lock.yaml"
LOCK_HASH_FILE="$ROOT_DIR/node_modules/.lock-hash"
NEEDS_INSTALL=false

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  NEEDS_INSTALL=true
elif [[ ! -f "$LOCK_HASH_FILE" ]]; then
  NEEDS_INSTALL=true
elif command -v md5sum >/dev/null 2>&1; then
  CURRENT_HASH=$(md5sum "$LOCK_FILE" | awk '{print $1}')
  STORED_HASH=$(cat "$LOCK_HASH_FILE" 2>/dev/null || echo "")
  if [[ "$CURRENT_HASH" != "$STORED_HASH" ]]; then
    NEEDS_INSTALL=true
  fi
else
  # No md5sum available — always install to be safe
  NEEDS_INSTALL=true
fi

if [[ "$NEEDS_INSTALL" == "true" ]]; then
  info "Installing dependencies..."
  pnpm install
  # Store lock hash for next run
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$LOCK_FILE" | awk '{print $1}' > "$LOCK_HASH_FILE"
  fi
  log_run "pnpm install"
else
  [[ "$QUIET" == "false" ]] && ok "Dependencies up to date"
  log_skip "pnpm install (lock unchanged)"
fi

# ── 2. Prisma generate ──────────────────────────────────────────────────────
info "Running prisma generate..."
(cd "$ROOT_DIR/packages/api" && npx prisma generate)
log_run "prisma generate"

# ── 3. Prisma migrate deploy ────────────────────────────────────────────────
info "Running prisma migrate deploy..."
MIGRATE_OUTPUT=$(cd "$ROOT_DIR/packages/api" && npx prisma migrate deploy 2>&1) || {
  echo "$MIGRATE_OUTPUT"
  fail "prisma migrate deploy failed"
}
if echo "$MIGRATE_OUTPUT" | grep -q "No pending migrations"; then
  [[ "$QUIET" == "false" ]] && ok "No pending migrations"
  log_skip "prisma migrate deploy (no pending)"
else
  echo "$MIGRATE_OUTPUT"
  log_run "prisma migrate deploy"
fi

# ── 4. Check .env against .env.example ──────────────────────────────────────
ENV_EXAMPLE="$ROOT_DIR/packages/api/.env.example"
ENV_FILE="$ROOT_DIR/packages/api/.env"

if [[ -f "$ENV_EXAMPLE" ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    # Extract var names from .env.example (non-comment, non-empty lines with =)
    EXAMPLE_VARS=$(grep -E '^[A-Z_]+=' "$ENV_EXAMPLE" | cut -d= -f1 | sort)
    ENV_VARS=$(grep -E '^[A-Z_]+=' "$ENV_FILE" | cut -d= -f1 | sort)

    MISSING_VARS=$(comm -23 <(echo "$EXAMPLE_VARS") <(echo "$ENV_VARS"))
    if [[ -n "$MISSING_VARS" ]]; then
      warn "Missing env vars (defined in .env.example but not in .env):"
      while IFS= read -r var; do
        echo -e "  ${WARNING}  ${var}"
        log_warn "Missing env var: $var"
      done <<< "$MISSING_VARS"
    else
      [[ "$QUIET" == "false" ]] && ok "All env vars present"
    fi
  else
    warn ".env file not found at $ENV_FILE"
    warn "Copy .env.example to .env and configure values:"
    warn "  cp packages/api/.env.example packages/api/.env"
    log_warn "No .env file found"
  fi
else
  warn ".env.example not found — cannot check env vars"
  log_warn "No .env.example found"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Kanon Upgrade Summary${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""

if [[ ${#STEPS_RUN[@]} -gt 0 ]]; then
  for step in "${STEPS_RUN[@]}"; do
    echo -e "  ${CHECKMARK}  ${step}"
  done
fi

if [[ ${#STEPS_SKIPPED[@]} -gt 0 ]]; then
  for step in "${STEPS_SKIPPED[@]}"; do
    echo -e "  ${CHECKMARK}  ${step} ${CYAN}(skipped)${NC}"
  done
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo ""
  for w in "${WARNINGS[@]}"; do
    echo -e "  ${WARNING}  ${w}"
  done
fi

echo ""
if [[ ${#WARNINGS[@]} -eq 0 ]]; then
  echo -e "  ${GREEN}All checks passed.${NC}"
else
  echo -e "  ${YELLOW}Completed with ${#WARNINGS[@]} warning(s).${NC}"
fi
echo ""
