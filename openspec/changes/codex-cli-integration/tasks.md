# Tasks: Codex CLI Integration (KAN-128)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (prod) | 180–280 |
| Estimated test lines | 300–420 |
| 400-line budget risk | **Medium** |
| Chained PRs recommended | No (single PR) |
| Suggested split | Optional: PR1 TOML+registry+dispatch, PR2 smoke+docs — only if review stalls |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: **No**
Chained PRs recommended: **No**
Chain strategy: **pending**
400-line budget risk: **Medium**

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full codex install parity | PR 1 (single) | setup + docs only; no API/web |

---

## Strict TDD — RED before GREEN on every code task.

Runner: `pnpm --filter @kanon-pm/setup test`

---

## Phase A — TOML MCP adapter

_Spec req: TOML MCP merge and remove; auth/workspace extraction_

- [x] A1. **(RED)** `mcp-config.test.ts`: add `describe("mergeTomlMcpConfig")` — fresh/missing file upsert; preserves other `mcp_servers.*`; env → `[mcp_servers.kanon-mcp.env]` subtable; deletes legacy `kanon` key; idempotent re-merge.
- [x] A2. **(RED)** `mcp-config.test.ts`: add `describe("removeTomlMcpConfig")` — removes table + `.env` subtable; preserves unrelated servers; returns `true`/`false`; missing file no-op.
- [x] A3. **(GREEN)** Add `smol-toml` to `packages/setup/package.json`; add `configFormat?: "json" | "toml"` to `types.ts` (default `"json"`).
- [x] A4. **(GREEN)** Implement `formatCodexMcpEntry`, `mergeTomlMcpConfig`, `removeTomlMcpConfig` in `mcp-config.ts` (flat `command`/`args` + nested `.env` subtable).
- [x] A5. **(RED)** `mcp-config.test.ts`: TOML fixtures for `extractExistingAuth` (static-key `.env` subtable) and `extractExistingWorkspaceId` (`KANON_WORKSPACE_ID` in `.env`).
- [x] A6. **(GREEN)** Add TOML branches in `extractExistingAuth` / `extractExistingWorkspaceId` in `mcp-config.ts`.

---

## Phase B — Registry entry

_Spec req: Codex registry entry; Tool detection; CODEX_HOME override_

- [x] B1. **(RED)** `registry.test.ts`: add `describe("registry — codex")` — `rootKey === "mcp_servers"`, `configFormat === "toml"`, platforms `[darwin, linux, wsl, win32]`, all `mcpMode === "direct"`, no `template`/`agents`/`commands`.
- [x] B2. **(RED)** `registry.test.ts`: path resolvers — default `{homedir}/.codex/config.toml` + `skills/`; with `CODEX_HOME` env → paths under override dir.
- [x] B3. **(RED)** `registry.test.ts`: `detect` true when `codex` on PATH OR `{codexHome}/config.toml` exists.
- [x] B4. **(GREEN)** Add `resolveCodexHome(ctx, ...segments)`, `CODEX_PATHS`, and `codex` entry in `registry.ts`.

---

## Phase C — Index dispatch

_Spec req: Product surface install (skills only); idempotent install/remove_

- [x] C1. **(RED)** Add dispatch coverage (unit or smoke stub): tool with `configFormat: "toml"` must call TOML merge/remove, not `mergeConfig`/`removeConfig`.
- [x] C2. **(GREEN)** `index.ts`: branch install/remove on `tool.configFormat === "toml"` → `mergeTomlMcpConfig` / `removeTomlMcpConfig` with `formatCodexMcpEntry`; keep `installSkills` only (skip template/agents/commands when paths absent).
- [x] C3. **(GREEN)** `index.ts`: extend `--tool` help string to include `codex`; wire `extractExistingWorkspaceId` TOML path for codex re-runs.

---

## Phase D — Smoke and leakage

_Spec req: Test harness parity; Leakage guard; Idempotent install and remove_

- [x] D1. **(RED)** Create `codex-install-smoke.test.ts` (mirror OpenCode) — temp `CODEX_HOME`, composed `mergeTomlMcpConfig` + `installSkills` + remove; assert `config.toml` `[mcp_servers.kanon-mcp]`, 3 product skills, other servers preserved, `CODEX_HOME` override, idempotent re-run + clean `--remove`.
- [x] D2. **(RED)** Extend `leakage-guard.test.ts` for `codex` — forbid `AGENTS.md`; registry must not declare template/agents/commands paths.
- [x] D3. **(GREEN)** Fix any wiring gaps surfaced by D1 (should pass after A–C).

---

## Phase E — Documentation

_Spec req: Onboarding documentation_

- [x] E1. `docs/AI_TOOLS.md`: add **Codex CLI** row — `$CODEX_HOME`, `config.toml`, `skills/`, `kanon-setup --tool codex`, TOML comment-loss note.
- [x] E2. `packages/setup/assets/skills/kanon-onboard/SKILL.md`: Codex troubleshooting — `CODEX_HOME`, `[mcp_servers.kanon-mcp]` shape, re-run idempotency, manual rollback.

---

## Phase F — Verify gate

- [x] F1. `pnpm --filter @kanon-pm/setup test` green.
- [ ] F2. Manual smoke: `node packages/setup/dist/index.js --tool codex -y` → verify `$CODEX_HOME/config.toml` + skills (optional; record in verify-report if run).

---

## Dependency order

A → B → C (C depends on A exports + B registry). D validates A–C together. E after D green. F last.
