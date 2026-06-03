#!/usr/bin/env bash
# ─── Kanon MCP Installer ──────────────────────────────────────────────────────
# Fetches the pinned Kanon MCP release, verifies sha256 BEFORE extracting,
# installs to ~/.kanon/mcp, then invokes `node setup` to configure your tools.
#
# Usage (KAN-35 — install form):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmmarxdr/kanon/main/install.sh)"
#
# The bash -c "$(curl ...)" invocation evaluates the script as a string, which
# frees stdin from the curl pipe so the script can `read` the kanon:// link
# interactively from the user's TTY (KAN-36).
#
# ── Environment overrides (test seams / advanced use) ────────────────────────
#   KANON_INSTALL_BASE_URL   Override download base URL (e.g. file:///fixtures)
#   KANON_INSTALL_DIR        Override install directory (default: ~/.kanon/mcp)
#   KANON_INSTALL_SKIP_SETUP Set to 1 to skip the final `node setup` invocation
#   KANON_REPO               Override the GitHub owner/repo (default: mmmarxdr/kanon)
#
# ── Asset contract (C3 — matches PR5 release workflow) ───────────────────────
#   Tag:    mcp-v<VERSION>
#   Assets: kanon-mcp-<VERSION>.tar.gz
#           kanon-mcp-<VERSION>.tar.gz.sha256
#
# sha256 is verified BEFORE any extraction (C4). On mismatch: non-zero exit,
# nothing written to INSTALL_DIR.
#
# ── Idempotency ───────────────────────────────────────────────────────────────
# If INSTALL_DIR already contains the pinned version, the download is skipped.

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────

KANON_MCP_VERSION="0.4.0"
KANON_REPO="${KANON_REPO:-mmmarxdr/kanon}"
DEFAULT_BASE_URL="https://github.com/${KANON_REPO}/releases/download/mcp-v${KANON_MCP_VERSION}"
BASE_URL="${KANON_INSTALL_BASE_URL:-$DEFAULT_BASE_URL}"
INSTALL_DIR="${KANON_INSTALL_DIR:-$HOME/.kanon/mcp}"
ASSET_NAME="kanon-mcp-${KANON_MCP_VERSION}.tar.gz"
ASSET_URL="${BASE_URL}/${ASSET_NAME}"
SHA256_URL="${BASE_URL}/${ASSET_NAME}.sha256"
VERSION_FILE="${INSTALL_DIR}/version"

# ─── Helpers ──────────────────────────────────────────────────────────────────

info()  { echo "[kanon] $*"; }
warn()  { echo "[kanon] warn: $*" >&2; }
abort() { echo "[kanon] error: $*" >&2; exit 1; }

# Portable sha256 verification: prefer sha256sum (Linux), fall back to shasum (macOS)
sha256_check() {
  local file="$1"
  local checksum_file="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$checksum_file" --status 2>/dev/null
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "$checksum_file" --status 2>/dev/null
  else
    abort "no sha256 tool found (sha256sum or shasum required)"
  fi
}

# Portable download: prefer curl, fall back to wget
download() {
  local url="$1"
  local dest="$2"
  if [[ "$url" == file://* ]]; then
    # file:// URI — strip prefix and copy directly (test seam)
    local src="${url#file://}"
    cp "$src" "$dest"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL --output "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    abort "no download tool found (curl or wget required)"
  fi
}

# ─── Idempotency check ────────────────────────────────────────────────────────

if [ -f "$VERSION_FILE" ]; then
  installed_version="$(cat "$VERSION_FILE")"
  if [ "$installed_version" = "$KANON_MCP_VERSION" ]; then
    info "already installed: kanon-mcp v${KANON_MCP_VERSION} at ${INSTALL_DIR}"
    # Still proceed to setup unless skipped
    if [ "${KANON_INSTALL_SKIP_SETUP:-0}" = "1" ]; then
      exit 0
    fi
    # Jump straight to onboarding
    exec_setup() {
      local setup_bin
      setup_bin="$(find "$INSTALL_DIR" -name "index.js" -path "*/setup/*" | head -1)"
      [ -z "$setup_bin" ] && abort "setup binary not found in ${INSTALL_DIR}"
      info "running node setup..."
      # Read link from TTY and pipe to setup via stdin (KAN-36)
      if [ -t 0 ]; then
        printf "Paste your kanon:// onboarding link (or press Enter to skip): "
        read -r KANON_LINK </dev/tty || KANON_LINK=""
        if [ -n "$KANON_LINK" ]; then
          echo "$KANON_LINK" | node "$setup_bin"
        else
          node "$setup_bin"
        fi
      else
        node "$setup_bin"
      fi
    }
    exec_setup
    exit 0
  fi
fi

# ─── Download phase ───────────────────────────────────────────────────────────

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

info "downloading kanon-mcp v${KANON_MCP_VERSION}..."
download "$ASSET_URL"     "$WORK_DIR/$ASSET_NAME"
download "$SHA256_URL"    "$WORK_DIR/${ASSET_NAME}.sha256"

# ─── Sha256 verify BEFORE extract (C4) ───────────────────────────────────────
# The .sha256 file contains "HASH  FILENAME" where FILENAME is the bare asset
# name (no path). We cd into WORK_DIR so shasum can resolve the filename.

info "verifying sha256..."

# Normalize the checksum file: extract hash only, re-emit with bare filename
# so the check works regardless of what path the release workflow embedded.
HASH_ONLY="$(awk '{print $1}' "$WORK_DIR/${ASSET_NAME}.sha256")"
echo "${HASH_ONLY}  ${ASSET_NAME}" > "$WORK_DIR/${ASSET_NAME}.sha256.normalized"

(
  cd "$WORK_DIR"
  sha256_check "$ASSET_NAME" "${ASSET_NAME}.sha256.normalized"
) || abort "sha256 verification FAILED — installation aborted. The downloaded file may be corrupted or tampered with."

info "sha256 verified."

# ─── Extract ──────────────────────────────────────────────────────────────────

info "installing to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
tar -xzf "$WORK_DIR/$ASSET_NAME" -C "$INSTALL_DIR" --strip-components=1

# Write version marker
echo "$KANON_MCP_VERSION" > "$VERSION_FILE"

info "kanon-mcp v${KANON_MCP_VERSION} installed."

# ─── Skip setup if requested (test seam) ─────────────────────────────────────

if [ "${KANON_INSTALL_SKIP_SETUP:-0}" = "1" ]; then
  exit 0
fi

# ─── Invoke node setup (KAN-36 — stdin link pipe) ────────────────────────────
# The `bash -c "$(curl -fsSL ...)"` invocation form frees stdin from the curl
# pipe, so we can `read` interactively from the TTY here.

SETUP_BIN="$(find "$INSTALL_DIR" -name "index.js" -path "*/setup/*" | head -1 || true)"
if [ -z "$SETUP_BIN" ]; then
  # Fallback: setup may live at a well-known path relative to install dir
  SETUP_BIN="$INSTALL_DIR/setup/dist/index.js"
fi

if [ ! -f "$SETUP_BIN" ]; then
  abort "setup binary not found in ${INSTALL_DIR} — the release tarball may be missing the setup package"
fi

info "launching Kanon setup..."
echo ""

if [ -t 0 ]; then
  # Stdin is a TTY — prompt for the onboarding link, then pipe it to setup
  printf "Paste your kanon:// onboarding link (or press Enter for interactive setup): "
  read -r KANON_LINK </dev/tty || KANON_LINK=""
  echo ""
  if [ -n "$KANON_LINK" ]; then
    echo "$KANON_LINK" | node "$SETUP_BIN"
  else
    node "$SETUP_BIN"
  fi
else
  # Stdin is piped — pass it through directly (install.sh itself was piped, not
  # bash -c "$(curl)" form; setup's dispatch will read it)
  node "$SETUP_BIN"
fi
