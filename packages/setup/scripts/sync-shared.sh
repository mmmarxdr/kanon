#!/usr/bin/env bash
# ─── Prebuild: Sync shared source files from @kanon/shared ───────────────────
# Copies pure utility modules from packages/shared/src into this package's src.
# This keeps @kanon-pm/setup self-contained at publish time (no workspace:* runtime dep).
# The @kanon/shared package is the canonical test+source location — edit there first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETUP_DIR="$(dirname "$SCRIPT_DIR")"
SHARED_SRC="$SETUP_DIR/../shared/src"
SETUP_SRC="$SETUP_DIR/src"

copy_shared() {
  local file="$1"
  if [ ! -f "$SHARED_SRC/$file" ]; then
    echo "ERROR: shared source not found: $SHARED_SRC/$file"
    exit 1
  fi
  cp "$SHARED_SRC/$file" "$SETUP_SRC/$file"
  echo "Synced: $file → $SETUP_SRC/$file"
}

copy_shared "canonical-url.ts"

echo "Shared sync complete."
