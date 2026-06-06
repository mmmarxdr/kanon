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
#   3. Sha256 mismatch: corrupt checksum → non-zero exit, NO binary written, honest error
#   4. Setup-invocation path: fixture with 2 index.js matches, no SKIP_SETUP →
#      locate_setup_bin resolves correctly (proves F1 SIGPIPE fix non-vacuous)
#   5. Idempotent re-run without SKIP_SETUP → exec_setup via locate_setup_bin
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

# ── Build fixtures ────────────────────────────────────────────────────────────

FIXTURE_DIR="$(mktemp -d)"
INSTALL_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$FIXTURE_DIR" "$INSTALL_DIR"
}
trap cleanup EXIT

# ── Fixture A: standard tarball (T1, T2, T3)
# Includes setup/dist/index.js so F2 integrity check (binary-present gate)
# passes on the idempotency path (T2) without re-downloading.
FIXTURE_PKG_DIR="$FIXTURE_DIR/pkg/kanon-mcp-${KANON_MCP_VERSION}"
mkdir -p "$FIXTURE_PKG_DIR/setup/dist"
cat >"$FIXTURE_PKG_DIR/package.json" <<PKGJSON
{
  "name": "@kanon/mcp",
  "version": "${KANON_MCP_VERSION}"
}
PKGJSON

# setup stub: just exits 0 (not invoked in T1/T2/T3 due to SKIP_SETUP=1)
cat >"$FIXTURE_PKG_DIR/setup/dist/index.js" <<'SETUPSTUB'
process.exit(0);
SETUPSTUB

# Build Fixture A tarball
(cd "$FIXTURE_DIR/pkg" && tar -czf "$FIXTURE_DIR/${ASSET_NAME}" "kanon-mcp-${KANON_MCP_VERSION}")

# Generate correct sha256 for Fixture A
CORRECT_HASH="$(shasum -a 256 "$FIXTURE_DIR/${ASSET_NAME}" | awk '{print $1}')"
echo "${CORRECT_HASH}  ${ASSET_NAME}" >"$FIXTURE_DIR/${ASSET_NAME}.sha256"

# ── Fixture B: two-index tarball (T4 — proves locate_setup_bin SIGPIPE fix)
# Two distinct files matching */setup/*/index.js so head -1 must survive SIGPIPE.
FIXTURE_B_PKG_DIR="$FIXTURE_DIR/pkgb/kanon-mcp-${KANON_MCP_VERSION}"
mkdir -p "$FIXTURE_B_PKG_DIR/setup/dist"
mkdir -p "$FIXTURE_B_PKG_DIR/setup/extra"

# Primary stub: prints a marker line so T4 can assert invocation
cat >"$FIXTURE_B_PKG_DIR/setup/dist/index.js" <<'SETUPB'
console.log("kanon-setup-invoked");
process.exit(0);
SETUPB

# Second stub: also exits 0; find may pick either one — both are valid
cat >"$FIXTURE_B_PKG_DIR/setup/extra/index.js" <<'SETUPB2'
console.log("kanon-setup-invoked");
process.exit(0);
SETUPB2

cat >"$FIXTURE_B_PKG_DIR/package.json" <<PKGJSON2
{
  "name": "@kanon/mcp",
  "version": "${KANON_MCP_VERSION}"
}
PKGJSON2

FIXTURE_B_ASSET="$FIXTURE_DIR/b-${ASSET_NAME}"
(cd "$FIXTURE_DIR/pkgb" && tar -czf "$FIXTURE_B_ASSET" "kanon-mcp-${KANON_MCP_VERSION}")
FIXTURE_B_HASH="$(shasum -a 256 "$FIXTURE_B_ASSET" | awk '{print $1}')"
# Fixture B is served as the same ASSET_NAME — copy into a separate dir
FIXTURE_B_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_B_DIR"' EXIT
cp "$FIXTURE_B_ASSET" "$FIXTURE_B_DIR/${ASSET_NAME}"
echo "${FIXTURE_B_HASH}  ${ASSET_NAME}" >"$FIXTURE_B_DIR/${ASSET_NAME}.sha256"

# ── Test 1: Happy path ────────────────────────────────────────────────────────

echo "Test 1: Happy path — correct sha256 → extract succeeds"

OUTPUT_1="$(
  KANON_INSTALL_BASE_URL="file://$FIXTURE_DIR" \
    KANON_INSTALL_DIR="$INSTALL_DIR/happy" \
    KANON_INSTALL_SKIP_SETUP=1 \
    bash "$INSTALL_SH" 2>&1
)"
EXIT_1=$?
true

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
)"
EXIT_2=$?
true

assert_exit_zero "idempotent re-run" "$EXIT_2"
assert_output_contains "idempotent message" "$OUTPUT_2" "already installed"

echo ""

# ── Test 3: Sha256 mismatch → non-zero exit, NO binary written ────────────────

echo "Test 3: Sha256 mismatch — corrupt checksum → abort, no extract"

# Write a corrupt checksum file
echo "0000000000000000000000000000000000000000000000000000000000000000  ${ASSET_NAME}" \
  >"$FIXTURE_DIR/${ASSET_NAME}.sha256.corrupt"

cp "$FIXTURE_DIR/${ASSET_NAME}.sha256.corrupt" "$FIXTURE_DIR/${ASSET_NAME}.sha256"

OUTPUT_3="$(
  KANON_INSTALL_BASE_URL="file://$FIXTURE_DIR" \
    KANON_INSTALL_DIR="$INSTALL_DIR/corrupt" \
    KANON_INSTALL_SKIP_SETUP=1 \
    bash "$INSTALL_SH" 2>&1
)"
EXIT_3=$?
true

assert_exit_nonzero "sha256 mismatch exit" "$EXIT_3"
assert_file_absent "no binary written on mismatch" "$INSTALL_DIR/corrupt"
assert_output_contains "honest abort message (corruption not tamper)" "$OUTPUT_3" "corrupted"

echo ""

# ── Test 4: setup-invocation path (F4 — exercises locate_setup_bin) ──────────
# Fixture B has TWO files matching */setup/*/index.js so locate_setup_bin must
# survive SIGPIPE from `find ... | head -1` — this is the non-vacuous proof of F1.
# KANON_INSTALL_SKIP_SETUP is intentionally NOT set so exec flows into setup.
# Stdin is redirected from /dev/null to prevent interactive TTY read hang.

echo "Test 4: setup-invocation path — locate_setup_bin invoked (proves F1 SIGPIPE fix)"

OUTPUT_4="$(
  KANON_INSTALL_BASE_URL="file://$FIXTURE_B_DIR" \
    KANON_INSTALL_DIR="$INSTALL_DIR/setup-invoke" \
    bash "$INSTALL_SH" </dev/null 2>&1
)"
EXIT_4=$?
true

assert_exit_zero "setup-invocation path" "$EXIT_4"
assert_file_exists "version file written" "$INSTALL_DIR/setup-invoke/version"
assert_output_contains "setup stub invoked (locate_setup_bin found binary)" "$OUTPUT_4" "kanon-setup-invoked"

echo ""

# ── Test 5: idempotent re-run hits exec_setup via locate_setup_bin (F1 idempotency path) ──
# Re-run with the same INSTALL_DIR (already has version file + setup binary).
# SKIP_SETUP is NOT set — the idempotency branch must reach node via locate_setup_bin.

echo "Test 5: idempotent re-run — exec_setup via locate_setup_bin (proves F1 fix on idempotency path)"

OUTPUT_5="$(
  KANON_INSTALL_BASE_URL="file://$FIXTURE_B_DIR" \
    KANON_INSTALL_DIR="$INSTALL_DIR/setup-invoke" \
    bash "$INSTALL_SH" </dev/null 2>&1
)"
EXIT_5=$?
true

assert_exit_zero "idempotent setup-invoke re-run" "$EXIT_5"
assert_output_contains "already installed message" "$OUTPUT_5" "already installed"
assert_output_contains "setup stub invoked on idempotency path" "$OUTPUT_5" "kanon-setup-invoked"

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

exit 0
