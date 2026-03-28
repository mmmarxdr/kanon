#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ── Colors & helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; exit 1; }

API_URL="${KANON_API_URL:-http://localhost:3000}"
MCP_PKG="$ROOT_DIR/packages/mcp/dist/index.js"
PROJECT_MCP="$ROOT_DIR/.mcp.json"
GLOBAL_MCP="$HOME/.claude.json"

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required but not installed. See https://pnpm.io/installation"
command -v node >/dev/null 2>&1 || fail "node is required but not installed."
command -v jq   >/dev/null 2>&1 || fail "jq is required but not installed. Run: sudo apt install jq"

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[[ "$NODE_MAJOR" -ge 20 ]] || fail "Node >= 20 required (found v$(node -v))"

curl -sf --max-time 3 "${API_URL}/health" >/dev/null 2>&1 \
  || fail "API is not running at ${API_URL}. Start it first with: pnpm dev:start"

ok "Prerequisites OK (pnpm, node v${NODE_MAJOR}, jq, API healthy)"

# ── 2. Build MCP package ─────────────────────────────────────────────────────
info "Building @kanon/mcp..."
pnpm --filter @kanon/mcp build > "$ROOT_DIR/.setup-mcp-build.log" 2>&1 \
  || fail "MCP build failed — see .setup-mcp-build.log"
ok "MCP package built"

# ── 3. Authentication & API key ──────────────────────────────────────────────
info "Logging in as dev@kanon.io..."
LOGIN_RESP=$(curl -sf --max-time 10 \
  -X POST "${API_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@kanon.io","password":"Password1!","workspaceId":"kanon-dev"}' \
  2>&1) || fail "Login failed. Is the database seeded? Run: pnpm db:seed"

ACCESS_TOKEN=$(echo "$LOGIN_RESP" | jq -re '.accessToken') \
  || fail "Could not extract accessToken from login response"
ok "Logged in"

info "Generating API key..."
APIKEY_RESP=$(curl -sf --max-time 10 \
  -X POST "${API_URL}/api/auth/api-key" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  2>&1) || fail "API key generation failed"

API_KEY=$(echo "$APIKEY_RESP" | jq -re '.apiKey') \
  || fail "Could not extract apiKey from response"
ok "API key generated"

# ── 4. Ask where to install ──────────────────────────────────────────────────
echo ""
echo -e "Where would you like to install the Kanon MCP server?"
echo ""
echo -e "  ${CYAN}1)${NC} global (recommended) — ~/.claude.json — works from any project"
echo -e "  ${CYAN}2)${NC} project — .mcp.json in this project only"
echo -e "  ${CYAN}3)${NC} both — global + project-level"
echo ""
read -rp "Choice [1]: " INSTALL_CHOICE
INSTALL_CHOICE="${INSTALL_CHOICE:-1}"

# ── 5. Write config ──────────────────────────────────────────────────────────
MCP_ENTRY=$(jq -n \
  --arg path "$MCP_PKG" \
  --arg url  "$API_URL" \
  --arg key  "$API_KEY" \
  '{command:"node", args:[$path], env:{KANON_API_URL:$url, KANON_API_KEY:$key}}')

write_project() {
  jq -n --argjson entry "$MCP_ENTRY" '{mcpServers:{kanon:$entry}}' > "$PROJECT_MCP"
  ok "Written $PROJECT_MCP"
}

write_global() {
  if [[ -f "$GLOBAL_MCP" ]]; then
    local tmp; tmp=$(mktemp)
    jq --argjson entry "$MCP_ENTRY" '.mcpServers.kanon = $entry' "$GLOBAL_MCP" > "$tmp" \
      && mv "$tmp" "$GLOBAL_MCP" \
      || { rm -f "$tmp"; fail "Failed to update $GLOBAL_MCP"; }
  else
    jq -n --argjson entry "$MCP_ENTRY" '{mcpServers:{kanon:$entry}}' > "$GLOBAL_MCP"
  fi
  ok "Written $GLOBAL_MCP"
}

case "$INSTALL_CHOICE" in
  1) write_global  ;;
  2) write_project ;;
  3) write_project; write_global ;;
  *) fail "Invalid choice '${INSTALL_CHOICE}'. Enter 1, 2, or 3." ;;
esac

# ── 6. Success summary ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✓ Kanon MCP server configured!${NC}"
echo ""
case "$INSTALL_CHOICE" in
  1) echo -e "  Location: ${CYAN}~/.claude.json (global)${NC}" ;;
  2) echo -e "  Location: ${CYAN}.mcp.json (project)${NC}" ;;
  3) echo -e "  Location: ${CYAN}~/.claude.json (global) + .mcp.json (project)${NC}" ;;
esac
echo -e "  API URL:  ${CYAN}${API_URL}${NC}"
echo ""
echo -e "  ${YELLOW}Restart Claude Code to pick up the new configuration.${NC}"
echo ""
