# Proposal: KAN-52 — Enforce the sha256 trust anchor in install.sh

## Intent
`install.sh` documents a "sha256-pinned MCP release" but the copy on `main` ships `EXPECTED_SHA256=""`. With an empty pin the script falls back to the `.sha256` downloaded from the **same release origin** — so a compromised origin serves a matching tarball+checksum pair and the check passes. The documented supply-chain protection is not actually enforced. Critical-severity finding (2026-06-09 architecture review): a documented-but-unenforced security promise is worse than none.

## Current state (verified)
- **AC1 already satisfied**: `release.yml` (steps "Read sha256" + "Stamp install.sh and create tag commit") computes the tarball sha256 and `sed`-stamps it into `EXPECTED_SHA256` (and `KANON_MCP_VERSION`) on a detached, tag-only commit (`mcp-v<VERSION>`). `main` intentionally stays floating with an empty pin. Tags `mcp-v0.4.0 … 0.6.3` exist on origin.
- **The vuln is the documented path**: `README.md` and the `install.sh` header point users at `…/main/install.sh` — the unpinned copy — so the one-liner everyone runs has no tamper-resistance.
- `smoke-install.sh` is wired into CI (`ci.yml`) and covers happy/idempotent/corrupt-checksum/setup paths — but NOT the same-origin tamper scenario.

## Approach (chosen: fail-hard + retarget docs; user-confirmed)
1. **install.sh — hard gate before download**: if `EXPECTED_SHA256` is empty AND the base URL is not `file://`, ABORT with guidance to the pinned, tagged installer (URL derived from `KANON_REPO` + `KANON_MCP_VERSION`). No silent fallback to the same-origin `.sha256` (AC2). `file://` (local dev/test seam, not a network origin) remains exempt and keeps the corruption-only check.
2. **Docs retarget**: `README.md` + `install.sh` header point to `…/mcp-v0.6.3/install.sh` (the pinned, stamped installer) with a note explaining why `main` is not used.
3. **smoke-install.sh — two new tests** (AC3): (6) pinned tamper rejection — stamp a temp install.sh with the good hash, serve a *different* tarball whose `.sha256` matches it (compromised-origin sim); the pinned check must reject. (7) unpinned + network origin → hard abort (guarded to skip on a pinned/tagged checkout).

### Rejected alternative
Bootstrap-redirect (main fetches the latest tag's installer and re-execs): more complex and does NOT satisfy "fails hard" — the redirected script is still fetched from the same origin, so the trust root is unchanged.

### Guardrail
No `EXPECTED_SHA256` env override, no proactive `KANON_INSTALL_ALLOW_UNPINNED` opt-out — every opt-out reopens the hole. The `file://` exemption alone is structurally safe.

## Scope
**In:** `install.sh` (gate + else-branch comment + header URL), `README.md` (install one-liner + note), `packages/setup/scripts/smoke-install.sh` (Tests 6 & 7).
**Out:** `release.yml` (AC1 already done — not touched), doc auto-bump of the version in README/header on release (noted as follow-up debt), any `EXPECTED_SHA256` env override.

## Acceptance Criteria (issue)
- [x] release.yml stamps the tarball sha256 into install.sh on the tagged commit (pre-existing).
- [x] install.sh fails hard when EXPECTED_SHA256 is empty over the network (no silent same-origin fallback).
- [x] Smoke test asserts a tampered tarball is rejected.

## Risks
- **Doc version drift**: README/header hardcode `mcp-v0.6.3`; a version bump must update them (release flow does not). Follow-up candidate.
- **Already-installed machines**: the gate sits after the idempotency short-circuit, so a previously-installed (possibly unpinned) machine re-running `main` does not re-verify — but no download occurs, so no new tamper exposure. Reinstall via the tagged installer to upgrade trust.
