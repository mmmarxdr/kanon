#!/usr/bin/env bash
#
# Smoke test for Kanon API.
# Verifies that core endpoints respond correctly after the stack is running.
#
# Usage:
#   ./scripts/smoke-test.sh [BASE_URL]
#
# Default BASE_URL: http://localhost:3000

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

check() {
  local desc="$1"
  local expected_status="$2"
  local actual_status="$3"
  local body="$4"

  if [ "$actual_status" = "$expected_status" ]; then
    green "  PASS: $desc (HTTP $actual_status)"
    PASS=$((PASS + 1))
  else
    red "  FAIL: $desc — expected $expected_status, got $actual_status"
    red "  Body: $body"
    FAIL=$((FAIL + 1))
  fi
}

bold "Kanon API Smoke Test"
bold "Base URL: $BASE_URL"
echo ""

# ── 1. Health check ─────────────────────────────────────────────────────────
bold "[1/8] Health check"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
check "GET /health" "200" "$STATUS" "$BODY"
echo ""

# ── 2. Register ──────────────────────────────────────────────────────────────
bold "[2/8] Register new member"
# First we need a workspace — use seeded workspace slug to find its ID
# For smoke testing, we create a fresh workspace via the API
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/workspaces" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test","slug":"smoke-test"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

# Extract workspace ID (may fail if auth required — that's expected)
if [ "$STATUS" = "401" ]; then
  bold "  (Workspace creation requires auth — using seeded data)"
  echo ""

  # Login with seeded credentials instead
  bold "[2/8] Login with seeded credentials"
  # We need to find the workspace ID first. For the smoke test we use a workaround:
  # try login directly since the seeded workspace exists.
  # First, get workspace ID by attempting auth endpoints which are public
  RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"dev@kanon.io","password":"Password1!","workspaceId":"00000000-0000-0000-0000-000000000000"}')
  STATUS=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  check "POST /api/auth/login (wrong workspace — expected 401)" "401" "$STATUS" "$BODY"
  echo ""

  bold "  NOTE: Full auth flow requires workspace ID from DB."
  bold "  Testing public/health endpoints only in non-seeded mode."
else
  check "POST /api/workspaces" "201" "$STATUS" "$BODY"
fi
echo ""

# ── 3. Login with seeded data (if DB is seeded) ─────────────────────────────
bold "[3/8] Auth endpoints respond"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
# Empty body should return 400 (validation error)
check "POST /api/auth/login with empty body (expect 400)" "400" "$STATUS" "$BODY"
echo ""

# ── 4. Registration validation ───────────────────────────────────────────────
bold "[4/8] Registration validation"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
check "POST /api/auth/register with empty body (expect 400)" "400" "$STATUS" "$BODY"
echo ""

# ── 5. Protected route without auth ─────────────────────────────────────────
bold "[5/8] Protected routes require auth"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/workspaces")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
check "GET /api/workspaces without auth (expect 401)" "401" "$STATUS" "$BODY"
echo ""

# ── 6. Refresh validation ────────────────────────────────────────────────────
bold "[6/8] Refresh endpoint validation"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
# Should return 400 or 401
if [ "$STATUS" = "400" ] || [ "$STATUS" = "401" ]; then
  green "  PASS: POST /api/auth/refresh with no token (HTTP $STATUS)"
  PASS=$((PASS + 1))
else
  red "  FAIL: POST /api/auth/refresh — expected 400 or 401, got $STATUS"
  FAIL=$((FAIL + 1))
fi
echo ""

# ── 7. Issues endpoint without auth ──────────────────────────────────────────
bold "[7/8] Issue endpoints require auth"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/projects/KAN/issues")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
check "GET /api/projects/KAN/issues without auth (expect 401)" "401" "$STATUS" "$BODY"
echo ""

# ── 8. Non-existent route ────────────────────────────────────────────────────
bold "[8/8] 404 for unknown routes"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/nonexistent")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
check "GET /api/nonexistent (expect 404)" "404" "$STATUS" "$BODY"
echo ""

# ── Summary ──────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bold "Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
