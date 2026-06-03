#!/usr/bin/env bash
# ─── build-release-tarball.sh ─────────────────────────────────────────────────
# Bundles the Kanon MCP server, wrapper-cli, and setup package into a single
# release tarball with the pinned layout install.sh expects.
#
# Usage:
#   bash scripts/build-release-tarball.sh [VERSION]
#
# VERSION defaults to the @kanon/mcp package version (packages/mcp/package.json).
# Output: dist/release/kanon-mcp-<VERSION>.tar.gz
#          dist/release/kanon-mcp-<VERSION>.tar.gz.sha256
#
# ── Pinned tarball layout (--strip-components=1 yields under ~/.kanon/mcp) ────
#   kanon-mcp-<VERSION>/
#     setup/dist/index.js        (esbuild-bundled setup entry)
#     setup/assets/              (copied verbatim — skills/agents/templates/workflows)
#     mcp/dist/index.js          (esbuild-bundled MCP server)
#     mcp/dist/wrapper-cli.js    (esbuild-bundled wrapper bin)
#     mcp/bin/kanon-mcp.js       (thin loader → ../dist/index.js)
#
# This layout satisfies:
#   - install.sh locate_setup_bin: find .../setup/dist/index.js
#   - resolveWrapperPath(): dirname(import.meta.url)/../../mcp/dist/wrapper-cli.js
#   - getAssetsDir(): dirname(import.meta.url)/../assets → setup/assets/
#   - wrapper getMcpServerPath(): dirname(import.meta.url)/index.js → mcp/dist/index.js
#
# ── Prerequisites ──────────────────────────────────────────────────────────────
#   - esbuild installed (root devDependencies)
#   - pnpm install already run (node_modules populated)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# ─── Helpers ──────────────────────────────────────────────────────────────────

info()  { echo "[build-tarball] $*"; }
abort() { echo "[build-tarball] error: $*" >&2; exit 1; }

# ─── Version ──────────────────────────────────────────────────────────────────

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  # Extract version from packages/mcp/package.json
  if command -v node >/dev/null 2>&1; then
    VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$REPO_ROOT/packages/mcp/package.json','utf8')).version)")"
  else
    abort "node not found; pass VERSION as first argument"
  fi
fi

info "building release tarball for kanon-mcp v${VERSION}"

# ─── Paths ────────────────────────────────────────────────────────────────────

MCP_SRC="$REPO_ROOT/packages/mcp/src"
SETUP_SRC="$REPO_ROOT/packages/setup/src"
SETUP_ASSETS="$REPO_ROOT/packages/setup/assets"
MCP_BIN_SRC="$REPO_ROOT/packages/mcp/bin/kanon-mcp.js"

OUTPUT_DIR="$REPO_ROOT/dist/release"
ROOT_DIR_NAME="kanon-mcp-${VERSION}"
STAGE="$OUTPUT_DIR/${ROOT_DIR_NAME}"
ASSET_NAME="kanon-mcp-${VERSION}.tar.gz"

# ─── esbuild binary ──────────────────────────────────────────────────────────

# Prefer the locally installed esbuild (root node_modules/.bin)
ESBUILD="$REPO_ROOT/node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  if command -v esbuild >/dev/null 2>&1; then
    ESBUILD="esbuild"
  else
    abort "esbuild not found; run: pnpm install"
  fi
fi

# CJS-compat banner for ESM bundles: supplies a real `require()` so any
# dependency that uses dynamic require() (e.g. commander, chalk internals)
# works at runtime. esbuild's own shim uses __require, not bare require, so
# there is no collision. import.meta.url continues to work in ESM output.
CJS_COMPAT_BANNER='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'

# ─── Stage directory ─────────────────────────────────────────────────────────

info "preparing staging directory..."
rm -rf "$STAGE"
mkdir -p \
  "$STAGE/setup/dist" \
  "$STAGE/mcp/dist" \
  "$STAGE/mcp/bin"

# ─── Bundle: mcp/src/index.ts → mcp/dist/index.js ────────────────────────────

info "bundling mcp/src/index.ts..."
"$ESBUILD" \
  "$MCP_SRC/index.ts" \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node20 \
  --packages=bundle \
  --banner:js="$CJS_COMPAT_BANNER" \
  --outfile="$STAGE/mcp/dist/index.js"

# ─── Bundle: mcp/src/wrapper-cli.ts → mcp/dist/wrapper-cli.js ────────────────

info "bundling mcp/src/wrapper-cli.ts..."
"$ESBUILD" \
  "$MCP_SRC/wrapper-cli.ts" \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node20 \
  --packages=bundle \
  --banner:js="$CJS_COMPAT_BANNER" \
  --outfile="$STAGE/mcp/dist/wrapper-cli.js"

# ─── Bundle: setup/src/index.ts → setup/dist/index.js ───────────────────────
# NOTE: setup uses commander (CJS dep with dynamic require). The CJS_COMPAT_BANNER
# supplies a real require() so commander's dynamic require("node:events") works
# at runtime in ESM output. import.meta.url is unaffected (needed by mcp-config.ts).

info "bundling setup/src/index.ts..."
"$ESBUILD" \
  "$SETUP_SRC/index.ts" \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node20 \
  --packages=bundle \
  --banner:js="$CJS_COMPAT_BANNER" \
  --outfile="$STAGE/setup/dist/index.js"

# ─── Copy: setup/assets/ → setup/assets/ ────────────────────────────────────
# Assets are JSON/Markdown files referenced at runtime via getAssetsDir().
# They MUST be copied verbatim — not bundleable.

info "copying setup/assets/..."
if [ ! -d "$SETUP_ASSETS" ]; then
  abort "setup/assets not found at $SETUP_ASSETS — run: pnpm --filter @kanon-pm/setup build first (runs copy-assets.sh)"
fi
cp -r "$SETUP_ASSETS" "$STAGE/setup/assets"

# ─── Copy: mcp/bin/kanon-mcp.js → mcp/bin/kanon-mcp.js ──────────────────────

info "copying mcp/bin/kanon-mcp.js..."
cp "$MCP_BIN_SRC" "$STAGE/mcp/bin/kanon-mcp.js"

# ─── Tar ──────────────────────────────────────────────────────────────────────

info "creating tarball..."
mkdir -p "$OUTPUT_DIR"
# Use -C OUTPUT_DIR and name the root dir so --strip-components=1 yields the
# flat layout directly under the install directory.
(cd "$OUTPUT_DIR" && tar -czf "$ASSET_NAME" "$ROOT_DIR_NAME")

info "created: $OUTPUT_DIR/$ASSET_NAME"

# ─── sha256 ───────────────────────────────────────────────────────────────────

info "computing sha256..."
SHA256_FILE="$OUTPUT_DIR/${ASSET_NAME}.sha256"

(
  cd "$OUTPUT_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$ASSET_NAME" > "$ASSET_NAME.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$ASSET_NAME" > "$ASSET_NAME.sha256"
  else
    abort "no sha256 tool found (sha256sum or shasum required)"
  fi
)

HASH_VALUE="$(awk '{print $1}' "$SHA256_FILE")"
info "sha256: $HASH_VALUE"
info "created: $SHA256_FILE"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
info "=== Build complete ==="
info "  Tarball : $OUTPUT_DIR/$ASSET_NAME"
info "  SHA256  : $OUTPUT_DIR/${ASSET_NAME}.sha256"
info "  Hash    : $HASH_VALUE"
echo ""
info "To test locally:"
info "  KANON_INSTALL_BASE_URL=file://$OUTPUT_DIR KANON_INSTALL_DIR=/tmp/kanon-test KANON_INSTALL_SKIP_SETUP=1 bash install.sh"
