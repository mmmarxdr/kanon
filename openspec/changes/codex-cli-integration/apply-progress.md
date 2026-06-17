# Apply Progress: codex-cli-integration (KAN-128)

**Status**: Complete — ready for verify
**Mode**: Strict TDD
**Branch**: feat/kan-128-codex-antigravity-agents
**Date**: 2026-06-17

## Completed Phases

### Phase A — TOML MCP adapter ✅
- [x] A1. RED: `mergeTomlMcpConfig` tests
- [x] A2. RED: `removeTomlMcpConfig` tests
- [x] A3. GREEN: `smol-toml` + `configFormat` on `ToolDefinition`
- [x] A4. GREEN: `formatCodexMcpEntry`, `mergeTomlMcpConfig`, `removeTomlMcpConfig`
- [x] A5. RED: TOML fixtures for auth/workspace extraction
- [x] A6. GREEN: TOML branches in `extractExistingAuth` / `extractExistingWorkspaceId`

### Phase B — Registry entry ✅
- [x] B1. RED: `registry — codex` contract tests
- [x] B2. RED: path resolvers + `CODEX_HOME` override
- [x] B3. RED: detect via config.toml
- [x] B4. GREEN: `resolveCodexHome`, `CODEX_PATHS`, `codex` entry

### Phase C — Index dispatch ✅
- [x] C1. RED: `installToolMcpConfig` / `removeToolMcpConfig` dispatch tests
- [x] C2. GREEN: `index.ts` branches on `configFormat === "toml"`
- [x] C3. GREEN: `--tool` help includes `codex`; TOML workspace extraction wired

### Phase D — Smoke and leakage ✅
- [x] D1. RED/GREEN: `codex-install-smoke.test.ts`
- [x] D2. RED/GREEN: `leakage-guard.test.ts` codex section
- [x] D3. GREEN: wiring validated by smoke

### Phase E — Documentation ✅
- [x] E1. `docs/AI_TOOLS.md` Codex CLI row + paths
- [x] E2. `kanon-onboard/SKILL.md` Codex troubleshooting

### Phase F — Verify gate ✅
- [x] F1. `pnpm --filter @kanon-pm/setup test` — 381 tests green
- [ ] F2. Manual smoke (optional — not run in apply)

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|------|-----|-------|----------|
| A1-A2 mergeToml/removeToml | mcp-config.test.ts describe blocks | mcp-config.ts TOML functions | — |
| A5-A6 auth/workspace TOML | TOML fixture tests | extractExistingAuth/WorkspaceId branches | — |
| B1-B3 registry codex | registry.test.ts describe | registry.ts CODEX_PATHS | — |
| C1 dispatch | installToolMcpConfig tests | index.ts + dispatch helpers | — |
| D1 smoke | codex-install-smoke.test.ts | composed install/remove | — |
| D2 leakage | leakage-guard codex section | registry has no template/agents/commands | — |

## Files Changed

| File | Action |
|------|--------|
| `packages/setup/package.json` | Modified — added `smol-toml` |
| `packages/setup/src/types.ts` | Modified — `configFormat` field |
| `packages/setup/src/mcp-config.ts` | Modified — TOML merge/remove, dispatch helpers, auth branches |
| `packages/setup/src/registry.ts` | Modified — `resolveCodexHome`, `codex` entry |
| `packages/setup/src/index.ts` | Modified — TOML dispatch, `--tool codex` help |
| `packages/setup/src/__tests__/mcp-config.test.ts` | Modified — TOML + dispatch tests |
| `packages/setup/src/__tests__/registry.test.ts` | Modified — codex G5 block |
| `packages/setup/src/__tests__/codex-install-smoke.test.ts` | Created |
| `packages/setup/src/__tests__/leakage-guard.test.ts` | Modified — codex leakage guard |
| `docs/AI_TOOLS.md` | Modified — Codex CLI section |
| `packages/setup/assets/skills/kanon-onboard/SKILL.md` | Modified — Codex troubleshooting |

## Deviations from Design

None — implementation matches design. Added `installToolMcpConfig` / `removeToolMcpConfig` in `mcp-config.ts` as the testable dispatch layer (design specified branching in `index.ts`; helpers keep index thin and enable C1 unit coverage).

## Issues Found

None.

## Workload / PR Boundary

- Mode: single PR
- Estimated review budget: Medium (~180–280 prod + ~300 test lines)
- All phases A–F delivered in one work unit
