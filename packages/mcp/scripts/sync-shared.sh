#!/usr/bin/env bash
# ─── Prebuild: Sync shared source files from @kanon/shared ───────────────────
# Copies pure utility modules from packages/shared/src into this package's src.
# This keeps @kanon/mcp self-contained at publish time (no workspace:* runtime dep).
# The @kanon/shared package is the canonical test+source location — edit there first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_DIR="$(dirname "$SCRIPT_DIR")"
SHARED_SRC="$MCP_DIR/../shared/src"
MCP_SRC="$MCP_DIR/src"

copy_shared() {
  local file="$1"
  if [ ! -f "$SHARED_SRC/$file" ]; then
    echo "ERROR: shared source not found: $SHARED_SRC/$file"
    exit 1
  fi
  cp "$SHARED_SRC/$file" "$MCP_SRC/$file"
  echo "Synced: $file → $MCP_SRC/$file"
}

copy_shared "canonical-url.ts"
copy_shared "kanon-binding.ts"

echo "Shared sync complete."
