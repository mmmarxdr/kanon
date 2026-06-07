#!/usr/bin/env bash
# ─── Prebuild: Copy templates, workflows, and agents into assets/ ─────────────
# Runs before `tsc` so assets are available at compile time.
# NOTE: assets/skills/ is the CANONICAL SOURCE — tracked in git, not copied.
# skills/ is NOT cleaned or overwritten by this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETUP_DIR="$(dirname "$SCRIPT_DIR")"
MCP_DIR="$SETUP_DIR/../mcp"
ASSETS_DIR="$SETUP_DIR/assets"

# Clean only derived assets (agents, templates, workflows) — preserve skills/
find "$ASSETS_DIR" -mindepth 1 \
  ! -name '.gitkeep' \
  ! -path "$ASSETS_DIR/skills" \
  ! -path "$ASSETS_DIR/skills/*" \
  -exec rm -rf {} + 2>/dev/null || true

# Copy templates
if [ -d "$MCP_DIR/templates" ]; then
  cp -r "$MCP_DIR/templates" "$ASSETS_DIR/"
fi

# Copy workflows
if [ -d "$MCP_DIR/workflows" ]; then
  cp -r "$MCP_DIR/workflows" "$ASSETS_DIR/"
fi

# Copy agents
# Fails fast with a clear message if no agent files exist — intentional hard failure.
# Post-copy integrity is validated by scripts/verify-assets.sh (called by prepublishOnly and CI).
mkdir -p "$ASSETS_DIR/agents"
cp "$MCP_DIR/agents/kanon"*.md "$ASSETS_DIR/agents/" || {
  echo "ERROR: no agents found in $MCP_DIR/agents/"
  exit 1
}

echo "Assets copied to $ASSETS_DIR"
