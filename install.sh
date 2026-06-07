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

# Hardcoded trust-root checksum for the pinned release.
# EMPTY = fall back to the downloaded .sha256 (detects corruption; full
# tamper-resistance requires this value shipped in the script itself).
# PR5 fills this with the real sha256 of the published kanon-mcp-0.4.0.tar.gz;
# until then we rely on the downloaded .sha256 for corruption detection only —
# NOT tamper-resistance (both the tarball and its checksum come from the same
# origin, so a compromised origin can serve a matching pair).
EXPECTED_SHA256="fa5fd64e446051d85878e4f86dc0ab03f4a64c5c30052ece5c9da76f6736c849"

KANON_MCP_VERSION="0.6.3"
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

# Locate the setup binary under INSTALL_DIR.
# Echoes the path if found, empty string if not. Never aborts on its own.
# Used by both the main flow and the idempotency path so they stay in sync.
locate_setup_bin() {
  local found
  found="$(find "$INSTALL_DIR" -name "index.js" -path "*/setup/*" 2>/dev/null | head -1 || true)"
  if [ -z "$found" ] && [ -f "$INSTALL_DIR/setup/dist/index.js" ]; then
    found="$INSTALL_DIR/setup/dist/index.js"
  fi
  printf '%s' "$found"
}

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
    # F2: verify the setup binary is actually present before trusting the version file.
    # If the version file says installed but the binary is missing (partial install),
    # fall through to re-download rather than silently skipping.
    IDEMPOTENT_BIN="$(locate_setup_bin)"
    if [ -z "$IDEMPOTENT_BIN" ]; then
      warn "version file present but setup binary missing — re-downloading (delete ${INSTALL_DIR} and retry if this loops)"
      # Fall through to the download phase below
    else
      # Binary confirmed present — skip download and proceed to setup (or exit)
      if [ "${KANON_INSTALL_SKIP_SETUP:-0}" = "1" ]; then
        exit 0
      fi
      info "running node setup..."
      if [ -t 0 ]; then
        printf "Paste your kanon:// onboarding link (or press Enter to skip): "
        read -r KANON_LINK </dev/tty || KANON_LINK=""
        if [ -n "$KANON_LINK" ]; then
          echo "$KANON_LINK" | node "$IDEMPOTENT_BIN"
        else
          node "$IDEMPOTENT_BIN"
        fi
      else
        node "$IDEMPOTENT_BIN"
      fi
      exit 0
    fi
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

if [ -n "$EXPECTED_SHA256" ]; then
  # Pinned trust-root path: verify against the hardcoded hash embedded in this script.
  # The script itself is the trust root — a compromised origin cannot substitute a
  # matching checksum because the expected value is not fetched from the network.
  echo "${EXPECTED_SHA256}  ${ASSET_NAME}" > "$WORK_DIR/${ASSET_NAME}.sha256.pinned"
  (
    cd "$WORK_DIR"
    sha256_check "$ASSET_NAME" "${ASSET_NAME}.sha256.pinned"
  ) || abort "sha256 verification FAILED — installation aborted. The tarball does not match the pinned checksum in this installer (tamper or corruption detected)."
else
  # Fallback: verify against the .sha256 downloaded from the release server.
  # This detects corruption (bit-rot, partial download, CDN glitch) but NOT
  # tampering — a compromised origin can serve a matching tarball+checksum pair.
  # Full tamper-resistance requires EXPECTED_SHA256 to be set (filled by PR5).
  (
    cd "$WORK_DIR"
    sha256_check "$ASSET_NAME" "${ASSET_NAME}.sha256.normalized"
  ) || abort "sha256 verification FAILED — installation aborted. The downloaded file appears to be corrupted (checksum verified against release server; tamper-resistance requires the pinned hash shipped in a future release)."
fi

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

SETUP_BIN="$(locate_setup_bin)"

if [ -z "$SETUP_BIN" ] || [ ! -f "$SETUP_BIN" ]; then
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
