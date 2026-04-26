#!/usr/bin/env bash
# ─── verify-assets.sh ────────────────────────────────────────────────────────
# Asserts that all required asset directories and key files exist and are
# non-empty. Called by prepublishOnly and CI to gate publishing.
# Exit 0 = all assets present. Exit 1 = one or more assets missing.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETUP_DIR="$(dirname "$SCRIPT_DIR")"
ASSETS_DIR="$SETUP_DIR/assets"

MISSING=()

# Assert a directory exists and contains at least one file
assert_dir_nonempty() {
  local label="$1"
  local dir="$2"
  if [ ! -d "$dir" ] || [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
    MISSING+=("$label ($dir)")
  fi
}

# Assert a specific file exists and is non-empty
assert_file() {
  local label="$1"
  local file="$2"
  if [ ! -s "$file" ]; then
    MISSING+=("$label ($file)")
  fi
}

# Required directories
assert_dir_nonempty "assets/skills/"    "$ASSETS_DIR/skills"
assert_dir_nonempty "assets/agents/"    "$ASSETS_DIR/agents"
assert_dir_nonempty "assets/templates/" "$ASSETS_DIR/templates"
assert_dir_nonempty "assets/workflows/" "$ASSETS_DIR/workflows"

# Required key files
assert_file "assets/skills/kanon-mcp/SKILL.md" "$ASSETS_DIR/skills/kanon-mcp/SKILL.md"
assert_file "assets/agents/kanon.md"            "$ASSETS_DIR/agents/kanon.md"

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "✓ All assets verified."
  exit 0
else
  echo "Asset verification failed. MISSING:"
  for item in "${MISSING[@]}"; do
    echo "  - $item"
  done
  exit 1
fi
