#!/usr/bin/env bash
# ─── Prebuild: Copy skills, templates, and workflows into assets/ ────────────
# Runs before `tsc` so assets are available at compile time.
# Only copies the 5 PRODUCT skills (kanon-mcp, kanon-init, kanon-create-issue, kanon-roadmap, kanon-orchestrator-hooks).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETUP_DIR="$(dirname "$SCRIPT_DIR")"
MCP_DIR="$SETUP_DIR/../mcp"
ASSETS_DIR="$SETUP_DIR/assets"

# Clean previous assets (except .gitkeep)
find "$ASSETS_DIR" -mindepth 1 ! -name '.gitkeep' -exec rm -rf {} + 2>/dev/null || true

# Copy product skills
mkdir -p "$ASSETS_DIR/skills"
for skill in kanon-mcp kanon-init kanon-create-issue kanon-roadmap kanon-orchestrator-hooks; do
  if [ -d "$MCP_DIR/skills/$skill" ]; then
    cp -r "$MCP_DIR/skills/$skill" "$ASSETS_DIR/skills/"
  fi
done

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
cp "$MCP_DIR/agents/kanon"*.md "$ASSETS_DIR/agents/" || { echo "ERROR: no agents found in $MCP_DIR/agents/"; exit 1; }

echo "Assets copied to $ASSETS_DIR"
