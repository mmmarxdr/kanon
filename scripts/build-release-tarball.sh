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
#     setup/package.json         (setup version source)
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

info() { echo "[build-tarball] $*"; }
abort() {
  echo "[build-tarball] error: $*" >&2
  exit 1
}

# ─── Version ──────────────────────────────────────────────────────────────────

VERSION="${1:-}"
MCP_PACKAGE_VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$REPO_ROOT/packages/mcp/package.json','utf8')).version)")"
SETUP_PACKAGE_VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$REPO_ROOT/packages/setup/package.json','utf8')).version)")"
if [ -z "$VERSION" ]; then
  # Extract version from packages/mcp/package.json
  if command -v node >/dev/null 2>&1; then
    VERSION="$MCP_PACKAGE_VERSION"
  else
    abort "node not found; pass VERSION as first argument"
  fi
fi

if [ "$VERSION" != "$MCP_PACKAGE_VERSION" ] || [ "$VERSION" != "$SETUP_PACKAGE_VERSION" ]; then
  abort "version $VERSION must match MCP ($MCP_PACKAGE_VERSION) and setup ($SETUP_PACKAGE_VERSION) package versions"
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

info "building MCP and setup from source..."
pnpm --filter @kanon/mcp build
pnpm --filter @kanon-pm/setup build

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
cp "$REPO_ROOT/packages/setup/package.json" "$STAGE/setup/package.json"

# ─── Copy: mcp/package.json → mcp/package.json ──────────────────────────────
# version.ts single-sources the server version from ../package.json at runtime
# (KAN-19); the bundle at mcp/dist/index.js resolves it to mcp/package.json.

info "copying mcp/package.json..."
cp "$REPO_ROOT/packages/mcp/package.json" "$STAGE/mcp/package.json"

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
    sha256sum "$ASSET_NAME" >"$ASSET_NAME.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$ASSET_NAME" >"$ASSET_NAME.sha256"
  else
    abort "no sha256 tool found (sha256sum or shasum required)"
  fi
)

HASH_VALUE="$(awk '{print $1}' "$SHA256_FILE")"
info "sha256: $HASH_VALUE"
info "created: $SHA256_FILE"

# ─── Boot smoke (KAN-20) ──────────────────────────────────────────────────────
# Extract the ACTUAL tarball and boot the bundled server. The bundle layout
# differs from the dev layout (no node_modules, different relative paths) —
# this gate catches "works in dist/, dead in the tarball" before it ships.

info "boot smoke: extracting tarball to temp dir..."
SMOKE_DIR="$(mktemp -d)"
SMOKE_SERVER_PID=""
cleanup_smoke() {
  if [ -n "$SMOKE_SERVER_PID" ]; then
    kill "$SMOKE_SERVER_PID" 2>/dev/null || true
    wait "$SMOKE_SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$SMOKE_DIR"
}
trap cleanup_smoke EXIT
tar -xzf "$OUTPUT_DIR/$ASSET_NAME" -C "$SMOKE_DIR" --strip-components=1

info "boot smoke: starting bundled MCP server..."
SMOKE_LOG="$SMOKE_DIR/boot.log"
KANON_API_URL="http://127.0.0.1:1" KANON_API_KEY="kn_smoke_dummy" \
  timeout 10 node "$SMOKE_DIR/mcp/dist/index.js" </dev/null >/dev/null 2>"$SMOKE_LOG" &
SMOKE_PID=$!
# Banner appears on stderr right after connect; poll briefly.
BOOT_OK=false
for _ in $(seq 1 20); do
  if grep -q "Kanon MCP ${VERSION} — " "$SMOKE_LOG" 2>/dev/null; then
    BOOT_OK=true
    break
  fi
  if ! kill -0 "$SMOKE_PID" 2>/dev/null; then
    break # process died — banner will never come
  fi
  sleep 0.25
done
kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
if [ "$BOOT_OK" != true ]; then
  echo "[build-tarball] boot smoke FAILED — bundled server never announced itself. stderr:" >&2
  cat "$SMOKE_LOG" >&2
  abort "bundled server failed to boot from tarball layout"
fi
info "boot smoke: OK — bundled server announced 'Kanon MCP ${VERSION}'"

info "setup smoke: checking packaged setup version..."
PACKAGED_SETUP_VERSION="$(node "$SMOKE_DIR/setup/dist/index.js" --version)"
if [ "$PACKAGED_SETUP_VERSION" != "$VERSION" ]; then
  abort "packaged setup reported $PACKAGED_SETUP_VERSION, expected $VERSION"
fi

info "tool parity smoke: comparing source build and packaged runtime..."
TOOL_LIST_SCRIPT="$REPO_ROOT/packages/mcp/scripts/list-tools.mjs"
SOURCE_TOOLS="$(node "$TOOL_LIST_SCRIPT" "$REPO_ROOT/packages/mcp/dist/index.js")"
PACKAGED_TOOLS="$(node "$TOOL_LIST_SCRIPT" "$SMOKE_DIR/mcp/dist/index.js")"
if [ "$SOURCE_TOOLS" != "$PACKAGED_TOOLS" ]; then
  echo "source:   $SOURCE_TOOLS" >&2
  echo "packaged: $PACKAGED_TOOLS" >&2
  abort "source and packaged MCP tool lists differ"
fi
TOOL_COUNT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).length))' "$PACKAGED_TOOLS")"
info "tool parity smoke: OK — ${TOOL_COUNT} tools match"

info "onboarding smoke: running packaged setup against a local invite..."
SMOKE_HOME="$SMOKE_DIR/home"
PORT_FILE="$SMOKE_DIR/onboard-port"
mkdir -p "$SMOKE_HOME/.cursor"
node "$REPO_ROOT/scripts/onboarding-smoke-server.mjs" "$PORT_FILE" &
SMOKE_SERVER_PID=$!
for _ in $(seq 1 40); do
  [ -s "$PORT_FILE" ] && break
  kill -0 "$SMOKE_SERVER_PID" 2>/dev/null || abort "onboarding smoke server exited early"
  sleep 0.1
done
[ -s "$PORT_FILE" ] || abort "onboarding smoke server did not publish a port"
SMOKE_PORT="$(cat "$PORT_FILE")"
HOME="$SMOKE_HOME" \
KANON_INSTALL_DIR="$SMOKE_DIR" \
KANON_ONBOARD_LINK="kanon://127.0.0.1:${SMOKE_PORT}/onboard?token=release.smoke.token.123456" \
  node "$SMOKE_DIR/setup/dist/index.js" >"$SMOKE_DIR/onboard.log"
kill "$SMOKE_SERVER_PID" 2>/dev/null || true
wait "$SMOKE_SERVER_PID" 2>/dev/null || true
SMOKE_SERVER_PID=""

node - "$SMOKE_HOME" "$SMOKE_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [home, installDir] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8"));
const entry = config.mcpServers?.["kanon"];
if (entry?.type !== "stdio") throw new Error("packaged onboarding did not install Cursor stdio MCP");
if (entry.args?.[0] !== path.join(installDir, "mcp", "dist", "wrapper-cli.js")) {
  throw new Error("packaged onboarding did not use the release wrapper");
}
if (entry.env?.KANON_CLIENT_IDENTITY !== "cursor" || !entry.env?.KANON_WORKSPACE_ID) {
  throw new Error("packaged onboarding omitted Cursor identity or workspace");
}
for (const skill of ["kanon-agent", "kanon-init", "kanon-onboard"]) {
  if (!fs.existsSync(path.join(home, ".cursor", "skills", skill, "SKILL.md"))) {
    throw new Error(`packaged onboarding omitted ${skill}`);
  }
}
const agent = fs.readFileSync(path.join(home, ".cursor", "agents", "kanon.md"), "utf8");
if (agent.includes("allowed-tools") || agent.includes("\nmodel:")) {
  throw new Error("packaged Cursor agent contains host-incompatible frontmatter");
}
NODE
info "onboarding smoke: OK — packaged MCP, skills, and Cursor agent installed"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
info "=== Build complete ==="
info "  Tarball : $OUTPUT_DIR/$ASSET_NAME"
info "  SHA256  : $OUTPUT_DIR/${ASSET_NAME}.sha256"
info "  Hash    : $HASH_VALUE"
echo ""
info "To test locally:"
info "  KANON_INSTALL_BASE_URL=file://$OUTPUT_DIR KANON_INSTALL_DIR=/tmp/kanon-test KANON_INSTALL_SKIP_SETUP=1 KANON_INSTALL_ALLOW_UNPINNED_LOCAL=1 bash install.sh"
