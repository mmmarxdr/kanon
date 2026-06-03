#!/usr/bin/env bash
# ─── smoke-install.sh ─────────────────────────────────────────────────────────
# Smoke tests for install.sh bootstrap script (KAN-35).
#
# Strategy: build a local fixture tarball + .sha256, run install.sh with
# KANON_INSTALL_BASE_URL pointing at the fixture dir (test seam C2), and
# KANON_INSTALL_DIR pointing at a temp dir (no real ~/.kanon pollution).
# KANON_INSTALL_SKIP_SETUP=1 prevents the final `node setup` invocation so
# the smoke stays hermetic (the setup package itself is tested by vitest).
#
# Tests:
#   1. Happy path: correct sha256 → exit 0, tarball extracted
#   2. Idempotent: re-run → "already installed" message, exit 0
#   3. Sha256 mismatch: corrupt checksum → non-zero exit, NO binary written
#
# Exit 0 = all assertions passed. Exit 1 = at least one failure.
#
# NOTE: A true RED is only possible once install.sh exists. Before that,
# this script exits 1 because INSTALL_SH is not found (documented in
# apply-progress as the pre-install.sh RED state).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
INSTALL_SH="$REPO_ROOT/install.sh"

KANON_MCP_VERSION="0.4.0"
ASSET_NAME="kanon-mcp-${KANON_MCP_VERSION}.tar.gz"

PASS=0
FAIL=0

# ── Helpers ──────────────────────────────────────────────────────────────────

pass() {
  echo "  ✓ $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "  ✗ $1"
  FAIL=$((FAIL + 1))
}

assert_exit_zero() {
  local label="$1"
  local code="$2"
  if [ "$code" -eq 0 ]; then
    pass "$label — exit 0"
  else
    fail "$label — expected exit 0, got $code"
  fi
}

assert_exit_nonzero() {
  local label="$1"
  local code="$2"
  if [ "$code" -ne 0 ]; then
    pass "$label — exit non-zero ($code)"
  else
    fail "$label — expected non-zero exit, got 0"
  fi
}

assert_file_exists() {
  local label="$1"
  local file="$2"
  if [ -f "$file" ]; then
    pass "$label — file exists: $file"
  else
    fail "$label — expected file to exist: $file"
  fi
}

assert_file_absent() {
  local label="$1"
  local dir="$2"
  if [ ! -d "$dir" ] && [ ! -f "$dir" ]; then
    pass "$label — path absent: $dir"
  else
    fail "$label — expected path to be absent: $dir"
  fi
}

assert_output_contains() {
  local label="$1"
  local output="$2"
  local pattern="$3"
  if echo "$output" | grep -qi "$pattern"; then
    pass "$label — output contains: $pattern"
  else
    fail "$label — expected output to contain: $pattern"
    echo "    Actual output: $output"
  fi
}

# ── Pre-flight: install.sh must exist ─────────────────────────────────────────

if [ ! -f "$INSTALL_SH" ]; then
  echo "SKIP: $INSTALL_SH not found — install.sh not yet created (expected RED state before task 4.1)"
  exit 1
fi

echo "smoke-install.sh — testing install.sh with fixture assets"
echo ""

# ── Build fixture ─────────────────────────────────────────────────────────────

FIXTURE_DIR="$(mktemp -d)"
INSTALL_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$FIXTURE_DIR" "$INSTALL_DIR"
}
trap cleanup EXIT

# Create a minimal tarball structure: kanon-mcp-<ver>/package.json
FIXTURE_PKG_DIR="$FIXTURE_DIR/pkg/kanon-mcp-${KANON_MCP_VERSION}"
mkdir -p "$FIXTURE_PKG_DIR"
cat > "$FIXTURE_PKG_DIR/package.json" <<PKGJSON
{
  "name": "@kanon/mcp",
  "version": "${KANON_MCP_VERSION}"
}
PKGJSON

# Build the tarball
(cd "$FIXTURE_DIR/pkg" && tar -czf "$FIXTURE_DIR/${ASSET_NAME}" "kanon-mcp-${KANON_MCP_VERSION}")

# Generate correct sha256
CORRECT_HASH="$(shasum -a 256 "$FIXTURE_DIR/${ASSET_NAME}" | awk '{print $1}')"
echo "${CORRECT_HASH}  ${ASSET_NAME}" > "$FIXTURE_DIR/${ASSET_NAME}.sha256"

# ── Test 1: Happy path ────────────────────────────────────────────────────────

echo "Test 1: Happy path — correct sha256 → extract succeeds"

OUTPUT_1="$(
  KANON_INSTALL_BASE_URL="file://$FIXTURE_DIR" \
  KANON_INSTALL_DIR="$INSTALL_DIR/happy" \
  KANON_INSTALL_SKIP_SETUP=1 \
  bash "$INSTALL_SH" 2>&1
)"; EXIT_1=$?; true

assert_exit_zero "happy path" "$EXIT_1"
assert_file_exists "marker version file" "$INSTALL_DIR/happy/version"

echo ""

# ── Test 2: Idempotency ───────────────────────────────────────────────────────

echo "Test 2: Idempotency — re-run → 'already installed', exit 0"

OUTPUT_2="$(
  KANON_INSTALL_BASE_URL="file://$FIXTURE_DIR" \
  KANON_INSTALL_DIR="$INSTALL_DIR/happy" \
  KANON_INSTALL_SKIP_SETUP=1 \
  bash "$INSTALL_SH" 2>&1
)"; EXIT_2=$?; true

assert_exit_zero "idempotent re-run" "$EXIT_2"
assert_output_contains "idempotent message" "$OUTPUT_2" "already installed"

echo ""

# ── Test 3: Sha256 mismatch → non-zero exit, NO binary written ────────────────

echo "Test 3: Sha256 mismatch — corrupt checksum → abort, no extract"

# Write a corrupt checksum file
echo "0000000000000000000000000000000000000000000000000000000000000000  ${ASSET_NAME}" \
  > "$FIXTURE_DIR/${ASSET_NAME}.sha256.corrupt"

cp "$FIXTURE_DIR/${ASSET_NAME}.sha256.corrupt" "$FIXTURE_DIR/${ASSET_NAME}.sha256"

OUTPUT_3="$(
  KANON_INSTALL_BASE_URL="file://$FIXTURE_DIR" \
  KANON_INSTALL_DIR="$INSTALL_DIR/corrupt" \
  KANON_INSTALL_SKIP_SETUP=1 \
  bash "$INSTALL_SH" 2>&1
)"; EXIT_3=$?; true

assert_exit_nonzero "sha256 mismatch exit" "$EXIT_3"
assert_file_absent "no binary written on mismatch" "$INSTALL_DIR/corrupt"

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

exit 0
