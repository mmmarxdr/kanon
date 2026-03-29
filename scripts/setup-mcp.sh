#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
# Kanon MCP Setup — Multi-Tool Integration
#
# Configures the Kanon MCP server for AI coding tools.
# Supports: Claude Code, Cursor, Windsurf, VS Code, Continue, Zed, OpenCode,
#           Antigravity
#
# Usage:
#   pnpm setup:mcp              # Interactive mode — detect & select tools
#   pnpm setup:mcp --all        # Configure all detected tools
#   pnpm setup:mcp --tool cursor  # Configure a specific tool
#   pnpm setup:mcp --remove --all # Remove kanon from all detected tools
#   pnpm setup:mcp --help       # Show help
#
# Tool Registry Format (to add a new tool, add 4 entries to the parallel arrays):
#   TOOL_NAMES+=("my-tool")
#   TOOL_CONFIGS+=("$HOME/.my-tool/mcp.json")
#   TOOL_ROOT_KEYS+=("mcpServers")
#   TOOL_DETECTS+=("test -d \$HOME/.my-tool")
# ═══════════════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ── Colors & helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail()  { echo -e "${RED}  ✗${NC} $*"; exit 1; }

# ── Tool Registry (parallel arrays — Bash 3+ compatible) ─────────────────────
# Index order must match across all four arrays.
TOOL_NAMES=(
  "claude-code"
  "cursor"
  "windsurf"
  "vscode"
  "continue"
  "zed"
  "opencode"
  "antigravity"
)

TOOL_CONFIGS=(
  "$HOME/.claude.json"
  "$HOME/.cursor/mcp.json"
  "$HOME/.codeium/windsurf/mcp_config.json"
  "$ROOT_DIR/.vscode/mcp.json"
  "$HOME/.continue/config.json"
  "$HOME/.config/zed/settings.json"
  "$ROOT_DIR/opencode.json"
  "$HOME/.gemini/antigravity/mcp_config.json"
)

TOOL_ROOT_KEYS=(
  "mcpServers"
  "mcpServers"
  "mcpServers"
  "servers"
  "mcpServers"
  "context_servers"
  "mcp"
  "mcpServers"
)

TOOL_DETECTS=(
  "command -v claude >/dev/null 2>&1 || test -d \$HOME/.claude"
  "test -d \$HOME/.cursor"
  "test -d \$HOME/.codeium/windsurf"
  "command -v code >/dev/null 2>&1"
  "test -f \$HOME/.continue/config.json || test -d \$HOME/.continue"
  "test -d \$HOME/.config/zed"
  "true"
  "test -d \$HOME/.gemini"
)

TOOL_COUNT=${#TOOL_NAMES[@]}

API_URL="${KANON_API_URL:-http://localhost:${KANON_API_PORT:-3000}}"
MCP_PKG="$ROOT_DIR/packages/mcp/dist/index.js"

# ── Flag parsing ──────────────────────────────────────────────────────────────
FLAG_ALL=false
FLAG_REMOVE=false
FLAG_TOOL=""
FLAG_HELP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)    FLAG_ALL=true; shift ;;
    --remove) FLAG_REMOVE=true; shift ;;
    --tool)
      [[ -z "${2:-}" ]] && fail "--tool requires a tool name. Run with --help for usage."
      FLAG_TOOL="$2"; shift 2 ;;
    --help|-h) FLAG_HELP=true; shift ;;
    *) fail "Unknown flag: $1. Run with --help for usage." ;;
  esac
done

# ── Help ──────────────────────────────────────────────────────────────────────
show_help() {
  echo -e "${BOLD}Kanon MCP Setup${NC} — Configure the Kanon MCP server for AI coding tools."
  echo ""
  echo -e "${BOLD}USAGE${NC}"
  echo "  pnpm setup:mcp [flags]"
  echo ""
  echo -e "${BOLD}FLAGS${NC}"
  echo "  --all            Configure all detected tools (no prompting)"
  echo "  --tool <name>    Configure a specific tool by name"
  echo "  --remove         Remove kanon config instead of adding it"
  echo "                   (combine with --all or --tool)"
  echo "  --help, -h       Show this help message"
  echo ""
  echo -e "${BOLD}SUPPORTED TOOLS${NC}"
  echo "  claude-code      ~/.claude.json"
  echo "  cursor           ~/.cursor/mcp.json"
  echo "  windsurf         ~/.codeium/windsurf/mcp_config.json"
  echo "  vscode           .vscode/mcp.json (project-local)"
  echo "  continue         ~/.continue/config.json"
  echo "  zed              ~/.config/zed/settings.json"
  echo "  opencode         opencode.json (project-local)"
  echo "  antigravity      ~/.gemini/antigravity/mcp_config.json"
  echo ""
  echo -e "${BOLD}EXAMPLES${NC}"
  echo "  pnpm setup:mcp                    # Interactive: detect tools, select from list"
  echo "  pnpm setup:mcp --all              # Configure all detected tools at once"
  echo "  pnpm setup:mcp --tool cursor      # Configure only Cursor"
  echo "  pnpm setup:mcp --remove --all     # Remove kanon from all tool configs"
  echo "  pnpm setup:mcp --remove --tool zed  # Remove kanon from Zed only"
  echo ""
  exit 0
}

[[ "$FLAG_HELP" == true ]] && show_help

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || fail "node is required but not installed."

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[[ "$NODE_MAJOR" -ge 20 ]] || fail "Node >= 20 required (found v$(node -v))"

# ── Detection ─────────────────────────────────────────────────────────────────
detect_tools() {
  DETECTED_INDICES=()
  for (( i=0; i<TOOL_COUNT; i++ )); do
    if eval "${TOOL_DETECTS[$i]}" >/dev/null 2>&1; then
      DETECTED_INDICES+=("$i")
    fi
  done
}

detect_tools

# Helper: find index by tool name
tool_index_by_name() {
  local name="$1"
  for (( i=0; i<TOOL_COUNT; i++ )); do
    if [[ "${TOOL_NAMES[$i]}" == "$name" ]]; then
      echo "$i"
      return 0
    fi
  done
  return 1
}

# Helper: check if index is in detected list
is_detected() {
  local idx="$1"
  for d in "${DETECTED_INDICES[@]}"; do
    [[ "$d" == "$idx" ]] && return 0
  done
  return 1
}

# ── Tool selection ────────────────────────────────────────────────────────────
SELECTED_INDICES=()

if [[ -n "$FLAG_TOOL" ]]; then
  # --tool <name> mode
  idx=$(tool_index_by_name "$FLAG_TOOL") || fail "Unknown tool: '$FLAG_TOOL'. Run with --help for supported tools."
  if ! is_detected "$idx"; then
    fail "'${FLAG_TOOL}' was not detected on this system. Is it installed?"
  fi
  SELECTED_INDICES=("$idx")

elif [[ "$FLAG_ALL" == true ]]; then
  # --all mode
  if [[ ${#DETECTED_INDICES[@]} -eq 0 ]]; then
    fail "No supported tools detected. Install at least one supported AI coding tool."
  fi
  SELECTED_INDICES=("${DETECTED_INDICES[@]}")

else
  # Interactive mode
  if [[ ${#DETECTED_INDICES[@]} -eq 0 ]]; then
    fail "No supported tools detected. Install at least one supported AI coding tool."
  fi

  echo ""
  echo -e "${BOLD}Detected AI coding tools:${NC}"
  echo ""
  for (( j=0; j<${#DETECTED_INDICES[@]}; j++ )); do
    idx="${DETECTED_INDICES[$j]}"
    echo -e "  ${CYAN}$((j+1)))${NC} ${TOOL_NAMES[$idx]}"
  done
  echo ""

  if [[ "$FLAG_REMOVE" == true ]]; then
    echo -e "Select tools to ${RED}remove${NC} kanon from (comma-separated numbers, or ${BOLD}all${NC}):"
  else
    echo -e "Select tools to configure (comma-separated numbers, or ${BOLD}all${NC}):"
  fi
  read -rp "> " SELECTION

  [[ -z "$SELECTION" ]] && { info "No selection made. Exiting."; exit 0; }

  if [[ "$SELECTION" == "all" ]]; then
    SELECTED_INDICES=("${DETECTED_INDICES[@]}")
  else
    IFS=',' read -ra PICKS <<< "$SELECTION"
    for pick in "${PICKS[@]}"; do
      pick=$(echo "$pick" | tr -d ' ')
      if [[ "$pick" =~ ^[0-9]+$ ]] && (( pick >= 1 && pick <= ${#DETECTED_INDICES[@]} )); then
        SELECTED_INDICES+=("${DETECTED_INDICES[$((pick-1))]}")
      else
        warn "Ignoring invalid selection: '$pick'"
      fi
    done
  fi

  if [[ ${#SELECTED_INDICES[@]} -eq 0 ]]; then
    info "No valid tools selected. Exiting."
    exit 0
  fi
fi

# ── Auth & API key (skip for --remove) ────────────────────────────────────────
API_KEY=""

if [[ "$FLAG_REMOVE" != true ]]; then
  # Check API is running
  curl -sf --max-time 3 "${API_URL}/health" >/dev/null 2>&1 \
    || fail "API is not running at ${API_URL}. Start it first with: pnpm dev:start"

  # Build MCP package
  info "Building @kanon/mcp..."
  pnpm --filter @kanon/mcp build > "$ROOT_DIR/.setup-mcp-build.log" 2>&1 \
    || fail "MCP build failed — see .setup-mcp-build.log"
  ok "MCP package built"

  # Login
  info "Authenticating..."
  LOGIN_RESP=$(curl -sf --max-time 10 \
    -X POST "${API_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"dev@kanon.io","password":"Password1!","workspaceId":"kanon-dev"}' \
    2>&1) || fail "Login failed. Is the database seeded? Run: pnpm db:seed"

  ACCESS_TOKEN=$(node -e "
    const data = JSON.parse(process.argv[1]);
    if (!data.accessToken) { process.exit(1); }
    process.stdout.write(data.accessToken);
  " "$LOGIN_RESP") || fail "Could not extract accessToken from login response"
  ok "Logged in"

  # Generate API key
  info "Generating API key..."
  APIKEY_RESP=$(curl -sf --max-time 10 \
    -X POST "${API_URL}/api/auth/api-key" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    2>&1) || fail "API key generation failed"

  API_KEY=$(node -e "
    const data = JSON.parse(process.argv[1]);
    if (!data.apiKey) { process.exit(1); }
    process.stdout.write(data.apiKey);
  " "$APIKEY_RESP") || fail "Could not extract apiKey from response"
  ok "API key generated"
fi

# ── Config functions ──────────────────────────────────────────────────────────

# merge_config <file> <root_key>
# Merges the kanon-mcp entry into the tool's JSON config under the given root key.
merge_config() {
  local file="$1"
  local root_key="$2"

  node -e "
    const fs = require('fs');
    const path = require('path');

    const file = process.argv[1];
    const rootKey = process.argv[2];
    const mcpPkg = process.argv[3];
    const apiUrl = process.argv[4];
    const apiKey = process.argv[5];

    let config = {};
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

    if (!config[rootKey]) config[rootKey] = {};
    config[rootKey]['kanon-mcp'] = {
      command: 'node',
      args: [mcpPkg],
      env: {
        KANON_API_URL: apiUrl,
        KANON_API_KEY: apiKey
      }
    };

    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  " "$file" "$root_key" "$MCP_PKG" "$API_URL" "$API_KEY"
}

# merge_zed_config <file>
# Zed uses a nested context_servers structure with command.path instead of command + args.
merge_zed_config() {
  local file="$1"

  node -e "
    const fs = require('fs');
    const path = require('path');

    const file = process.argv[1];
    const mcpPkg = process.argv[2];
    const apiUrl = process.argv[3];
    const apiKey = process.argv[4];

    let config = {};
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

    if (!config.context_servers) config.context_servers = {};
    config.context_servers['kanon-mcp'] = {
      command: {
        path: 'node',
        args: [mcpPkg],
        env: {
          KANON_API_URL: apiUrl,
          KANON_API_KEY: apiKey
        }
      },
      settings: {}
    };

    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  " "$file" "$MCP_PKG" "$API_URL" "$API_KEY"
}

# remove_config <file> <root_key>
# Removes the kanon-mcp entry from the tool's config.
remove_config() {
  local file="$1"
  local root_key="$2"

  if [[ ! -f "$file" ]]; then
    warn "Config file not found: $file — nothing to remove"
    return 0
  fi

  node -e "
    const fs = require('fs');

    const file = process.argv[1];
    const rootKey = process.argv[2];

    let config;
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { process.exit(0); }

    if (config[rootKey] && config[rootKey]['kanon-mcp']) {
      delete config[rootKey]['kanon-mcp'];
      fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
      process.stdout.write('removed');
    } else {
      process.stdout.write('not_found');
    }
  " "$file" "$root_key"
}

# ── Apply configuration ──────────────────────────────────────────────────────
echo ""
if [[ "$FLAG_REMOVE" == true ]]; then
  echo -e "${BOLD}Removing kanon-mcp from selected tools...${NC}"
else
  echo -e "${BOLD}Configuring kanon-mcp for selected tools...${NC}"
fi
echo ""

SUCCESS_COUNT=0
FAIL_COUNT=0
# shellcheck disable=SC2317 — arithmetic increment helper avoids set -e trap on (( 0++ ))
inc_success() { SUCCESS_COUNT=$((SUCCESS_COUNT + 1)); }
inc_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); }

for idx in "${SELECTED_INDICES[@]}"; do
  name="${TOOL_NAMES[$idx]}"
  config_file="${TOOL_CONFIGS[$idx]}"
  root_key="${TOOL_ROOT_KEYS[$idx]}"

  if [[ "$FLAG_REMOVE" == true ]]; then
    result=$(remove_config "$config_file" "$root_key") || true
    if [[ "$result" == "removed" ]]; then
      ok "Removed kanon-mcp from ${BOLD}${name}${NC} (${config_file})"
      inc_success
    elif [[ "$result" == "not_found" ]]; then
      warn "kanon-mcp not found in ${name} config — nothing to remove"
    else
      warn "Config file not found for ${name}"
    fi
  else
    if [[ "$name" == "zed" ]]; then
      if merge_zed_config "$config_file"; then
        ok "Configured ${BOLD}${name}${NC} (${config_file})"
        inc_success
      else
        echo -e "${RED}  ✗${NC} Failed to configure ${name}"
        inc_fail
      fi
    else
      if merge_config "$config_file" "$root_key"; then
        ok "Configured ${BOLD}${name}${NC} (${config_file})"
        inc_success
      else
        echo -e "${RED}  ✗${NC} Failed to configure ${name}"
        inc_fail
      fi
    fi
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [[ "$FLAG_REMOVE" == true ]]; then
  if [[ $SUCCESS_COUNT -gt 0 ]]; then
    echo -e "${GREEN}✓ Removed kanon-mcp from ${SUCCESS_COUNT} tool(s).${NC}"
  else
    echo -e "${YELLOW}⚠ No configs were modified.${NC}"
  fi
else
  if [[ $SUCCESS_COUNT -gt 0 ]]; then
    echo -e "${GREEN}✓ Kanon MCP server configured for ${SUCCESS_COUNT} tool(s)!${NC}"
    echo ""
    echo -e "  API URL: ${CYAN}${API_URL}${NC}"
    echo -e "  Entry:   ${CYAN}${MCP_PKG}${NC}"
    echo ""
    echo -e "  ${YELLOW}Restart your AI coding tool(s) to pick up the new configuration.${NC}"
  fi
  if [[ $FAIL_COUNT -gt 0 ]]; then
    echo -e "${RED}✗ ${FAIL_COUNT} tool(s) failed to configure. Check errors above.${NC}"
  fi
fi
echo ""
