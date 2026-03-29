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

# ── WSL Detection ────────────────────────────────────────────────────────────
IS_WSL=false
if grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=true
fi

# Windows-native tools that need special MCP command when running from WSL
WINDOWS_NATIVE_TOOLS="cursor windsurf vscode antigravity"

# ── Flag parsing ──────────────────────────────────────────────────────────────
FLAG_ALL=false
FLAG_REMOVE=false
FLAG_TOOL=""
FLAG_HELP=false
FLAG_WSL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)    FLAG_ALL=true; shift ;;
    --remove) FLAG_REMOVE=true; shift ;;
    --wsl)    FLAG_WSL=true; shift ;;
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
  echo "  --wsl            Configure Windows-native tools from WSL"
  echo "                   (auto-detected, uses wsl node command)"
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
  echo -e "${BOLD}WSL SUPPORT${NC}"
  echo "  WSL is auto-detected. Windows-native tools (Cursor, Windsurf,"
  echo "  Antigravity) will be configured at their Windows-side paths."
  echo "  The MCP entry uses 'wsl node' as the command so Windows apps"
  echo "  can invoke the server running inside WSL."
  echo "  Skills and workflows are also installed to Windows-side paths."
  echo ""
  exit 0
}

[[ "$FLAG_HELP" == true ]] && show_help

# ── WSL Mode Setup ───────────────────────────────────────────────────────────
WSL_MODE=false
WIN_USER=""
WIN_HOME=""

if [[ "$FLAG_WSL" == true ]]; then
  if [[ "$IS_WSL" != true ]]; then
    fail "--wsl flag requires running inside WSL."
  fi
  WSL_MODE=true
elif [[ "$IS_WSL" == true ]]; then
  if [[ "$FLAG_ALL" == true ]]; then
    # In --all mode, auto-enable WSL mode when detected
    WSL_MODE=true
  else
    # Interactive prompt
    echo ""
    echo -en "${YELLOW}WSL detected.${NC} Configure Windows-native tools? (y/N) "
    read -r WSL_ANSWER
    if [[ "$WSL_ANSWER" =~ ^[Yy]$ ]]; then
      WSL_MODE=true
    fi
  fi
fi

if [[ "$WSL_MODE" == true ]]; then
  WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r\n')
  if [[ -z "$WIN_USER" ]]; then
    fail "Could not detect Windows username. Is cmd.exe accessible from WSL?"
  fi
  WIN_HOME="/mnt/c/Users/$WIN_USER"
  if [[ ! -d "$WIN_HOME" ]]; then
    fail "Windows home directory not found: $WIN_HOME"
  fi
  info "WSL mode enabled — Windows user: ${BOLD}${WIN_USER}${NC}, home: ${CYAN}${WIN_HOME}${NC}"
fi

# Helper: check if a tool is Windows-native
is_windows_native() {
  [[ " $WINDOWS_NATIVE_TOOLS " == *" $1 "* ]]
}

# Helper: resolve config path (WSL override for Windows-native tools)
resolve_config_path() {
  local name="$1"
  local default_path="$2"

  if [[ "$WSL_MODE" == true ]] && is_windows_native "$name"; then
    case "$name" in
      antigravity) echo "$WIN_HOME/.gemini/antigravity/mcp_config.json" ;;
      cursor)      echo "$WIN_HOME/.cursor/mcp.json" ;;
      windsurf)    echo "$WIN_HOME/.codeium/windsurf/mcp_config.json" ;;
      vscode)      echo "$default_path" ;; # project-local, stays same
      *)           echo "$default_path" ;;
    esac
  else
    echo "$default_path"
  fi
}

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || fail "node is required but not installed."

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[[ "$NODE_MAJOR" -ge 20 ]] || fail "Node >= 20 required (found v$(node -v))"

# ── Detection ─────────────────────────────────────────────────────────────────
# WSL-aware detection for Windows-native tools
wsl_detect() {
  local name="$1"
  case "$name" in
    antigravity) test -d "$WIN_HOME/.gemini" ;;
    cursor)      test -d "$WIN_HOME/.cursor" ;;
    windsurf)    test -d "$WIN_HOME/.codeium/windsurf" ;;
    vscode)      command -v code.exe >/dev/null 2>&1 || command -v code >/dev/null 2>&1 ;;
    *)           return 1 ;;
  esac
}

detect_tools() {
  DETECTED_INDICES=()
  for (( i=0; i<TOOL_COUNT; i++ )); do
    local name="${TOOL_NAMES[$i]}"
    if [[ "$WSL_MODE" == true ]] && is_windows_native "$name"; then
      if wsl_detect "$name" >/dev/null 2>&1; then
        DETECTED_INDICES+=("$i")
      fi
    elif eval "${TOOL_DETECTS[$i]}" >/dev/null 2>&1; then
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

# merge_config <file> <root_key> [wsl]
# Merges the kanon-mcp entry into the tool's JSON config under the given root key.
# If third arg is "wsl", uses "wsl" as command with "node" prepended to args.
merge_config() {
  local file="$1"
  local root_key="$2"
  local use_wsl="${3:-}"
  local node_bin
  node_bin="$(which node)"

  node -e "
    const fs = require('fs');
    const path = require('path');

    const file = process.argv[1];
    const rootKey = process.argv[2];
    const mcpPkg = process.argv[3];
    const apiUrl = process.argv[4];
    const apiKey = process.argv[5];
    const useWsl = process.argv[6] === 'wsl';
    const nodeBin = process.argv[7];

    let config = {};
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

    if (!config[rootKey]) config[rootKey] = {};
    config[rootKey]['kanon-mcp'] = useWsl
      ? { command: 'wsl', args: ['env', 'KANON_API_URL=' + apiUrl, 'KANON_API_KEY=' + apiKey, nodeBin, mcpPkg] }
      : { command: nodeBin, args: [mcpPkg], env: { KANON_API_URL: apiUrl, KANON_API_KEY: apiKey } };

    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  " "$file" "$root_key" "$MCP_PKG" "$API_URL" "$API_KEY" "$use_wsl" "$node_bin"
}

# merge_zed_config <file>
# Zed uses a nested context_servers structure with command.path instead of command + args.
merge_zed_config() {
  local file="$1"
  local node_bin
  node_bin="$(which node)"

  node -e "
    const fs = require('fs');
    const path = require('path');

    const file = process.argv[1];
    const mcpPkg = process.argv[2];
    const apiUrl = process.argv[3];
    const apiKey = process.argv[4];
    const nodeBin = process.argv[5];

    let config = {};
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

    if (!config.context_servers) config.context_servers = {};
    config.context_servers['kanon-mcp'] = {
      command: {
        path: nodeBin,
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
  " "$file" "$MCP_PKG" "$API_URL" "$API_KEY" "$node_bin"
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
  config_file=$(resolve_config_path "$name" "${TOOL_CONFIGS[$idx]}")
  root_key="${TOOL_ROOT_KEYS[$idx]}"

  # Determine if this tool needs WSL command override
  wsl_arg=""
  if [[ "$WSL_MODE" == true ]] && is_windows_native "$name"; then
    wsl_arg="wsl"
  fi

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
      if merge_config "$config_file" "$root_key" "$wsl_arg"; then
        ok "Configured ${BOLD}${name}${NC} (${config_file})"
        inc_success
      else
        echo -e "${RED}  ✗${NC} Failed to configure ${name}"
        inc_fail
      fi
    fi
  fi
done

# ── Install / Remove Kanon skills and workflows ─────────────────────────────
# Portable skills live in packages/mcp/skills/ and workflows in packages/mcp/workflows/.
# Each tool has its own global directory structure for skills and workflows.

SKILLS_SRC="$ROOT_DIR/packages/mcp/skills"
WORKFLOWS_SRC="$ROOT_DIR/packages/mcp/workflows"

# skill_dest <tool-name> → prints the global skills directory (empty = not supported)
skill_dest() {
  case "$1" in
    claude-code)    echo "$HOME/.claude/skills" ;;
    antigravity)
      if [[ "$WSL_MODE" == true && -n "$WIN_HOME" ]]; then
        echo "$WIN_HOME/.gemini/antigravity/skills"
      else
        echo "$HOME/.gemini/antigravity/skills"
      fi ;;
    cursor)
      if [[ "$IS_WSL" == true && -n "$WIN_HOME" ]]; then
        echo "$WIN_HOME/.cursor/skills"
      else
        echo "$HOME/.cursor/skills"
      fi ;;
    opencode)       echo "$HOME/.config/opencode/skills" ;;
    *)              echo "" ;;
  esac
}

# workflow_dest <tool-name> → prints the global workflows directory (empty = not supported)
workflow_dest() {
  case "$1" in
    antigravity)
      if [[ "$WSL_MODE" == true && -n "$WIN_HOME" ]]; then
        echo "$WIN_HOME/.gemini/antigravity/global_workflows"
      else
        echo "$HOME/.gemini/antigravity/global_workflows"
      fi ;;
    cursor)         echo "" ;; # Cursor has no global workflows — only project-level .cursor/rules/
    windsurf)
      if [[ "$WSL_MODE" == true && -n "$WIN_HOME" ]]; then
        echo "$WIN_HOME/.codeium/windsurf/global_workflows"
      else
        echo "$HOME/.codeium/windsurf/global_workflows"
      fi ;;
    *)              echo "" ;;
  esac
}

install_skills_and_workflows() {
  local name="$1"
  local s_dest w_dest
  s_dest=$(skill_dest "$name")
  w_dest=$(workflow_dest "$name")

  local installed=false

  # Install skills
  if [[ -n "$s_dest" && -d "$SKILLS_SRC" ]]; then
    for skill_dir in "$SKILLS_SRC"/kanon-*/; do
      [[ -d "$skill_dir" ]] || continue
      local skill_name
      skill_name=$(basename "$skill_dir")
      local dest_dir="$s_dest/$skill_name"
      mkdir -p "$dest_dir"
      cp "$skill_dir"SKILL.md "$dest_dir/SKILL.md" 2>/dev/null && installed=true
    done
  fi

  # Install workflows
  if [[ -n "$w_dest" && -d "$WORKFLOWS_SRC" ]]; then
    mkdir -p "$w_dest"
    for wf_file in "$WORKFLOWS_SRC"/kanon-*.md; do
      [[ -f "$wf_file" ]] || continue
      cp "$wf_file" "$w_dest/" 2>/dev/null && installed=true
    done
  fi

  if [[ "$installed" == true ]]; then
    ok "Installed Kanon skills/workflows for ${BOLD}${name}${NC}"
    [[ -n "$s_dest" ]] && echo -e "      Skills:    ${CYAN}${s_dest}/kanon-*/${NC}"
    [[ -n "$w_dest" ]] && echo -e "      Workflows: ${CYAN}${w_dest}/kanon-*.md${NC}"
  fi
}

remove_skills_and_workflows() {
  local name="$1"
  local s_dest w_dest
  s_dest=$(skill_dest "$name")
  w_dest=$(workflow_dest "$name")

  local removed=false

  # Remove skills
  if [[ -n "$s_dest" ]]; then
    for skill_dir in "$s_dest"/kanon-*/; do
      [[ -d "$skill_dir" ]] || continue
      rm -rf "$skill_dir" && removed=true
    done
  fi

  # Remove workflows
  if [[ -n "$w_dest" ]]; then
    for wf_file in "$w_dest"/kanon-*.md; do
      [[ -f "$wf_file" ]] || continue
      rm "$wf_file" && removed=true
    done
  fi

  if [[ "$removed" == true ]]; then
    ok "Removed Kanon skills/workflows from ${BOLD}${name}${NC}"
  fi
}

echo ""
if [[ "$FLAG_REMOVE" == true ]]; then
  echo -e "${BOLD}Removing Kanon skills and workflows...${NC}"
else
  echo -e "${BOLD}Installing Kanon skills and workflows...${NC}"
fi
echo ""

for idx in "${SELECTED_INDICES[@]}"; do
  name="${TOOL_NAMES[$idx]}"
  if [[ "$FLAG_REMOVE" == true ]]; then
    remove_skills_and_workflows "$name"
  else
    install_skills_and_workflows "$name"
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

  # WSL advisory for Windows-native tools
  if [[ "$IS_WSL" == true ]]; then
    # Check if any selected tools are Windows-native
    HAS_WIN_TOOL=false
    for idx in "${SELECTED_INDICES[@]}"; do
      name="${TOOL_NAMES[$idx]}"
      if [[ " $WINDOWS_NATIVE_TOOLS " == *" $name "* ]]; then
        HAS_WIN_TOOL=true
        break
      fi
    done
    if [[ "$HAS_WIN_TOOL" == true && "$WSL_MODE" == true ]]; then
      echo ""
      echo -e "${GREEN}  WSL mode:${NC} Windows-native tools were configured at Windows-side paths"
      echo "  using 'wsl node' as the MCP command. Skills/workflows were also installed"
      echo "  to Windows-side directories. No manual steps needed."
      echo ""
    elif [[ "$HAS_WIN_TOOL" == true ]]; then
      echo ""
      echo -e "${YELLOW}  WSL detected${NC} but WSL mode was not enabled."
      echo "  Windows-native tools (Antigravity, Cursor, Windsurf) were configured at"
      echo "  Linux paths. Re-run with ${BOLD}--wsl${NC} or ${BOLD}--all${NC} to auto-configure Windows paths."
      echo ""
    fi
  fi
fi
echo ""
