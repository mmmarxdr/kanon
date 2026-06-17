# Tasks: Antigravity CLI Integration (KAN-130)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (prod) | 60–100 |
| Estimated test lines | 250–350 |
| Total estimated lines | 310–450 |
| 400-line budget risk | **Low** |
| Chained PRs recommended | No (single PR) |
| Suggested split | None — smaller than Codex (KAN-128); no TOML adapter |
| Delivery strategy | single PR |
| Chain strategy | none |

Decision needed before apply: **No**
Chained PRs recommended: **No**
Chain strategy: **none**
400-line budget risk: **Low**

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full antigravity-cli install parity | PR 1 (single) | setup + docs only; no API/web/mcp |

---

## Strict TDD — RED before GREEN on every code task.

Runner: `pnpm --filter @kanon-pm/setup test`

---

## Phase 1 — Test scaffolding (RED)

_Spec req: Registry contract; install smoke harness; leakage guard rules_

- [x] 1.1 **(RED)** `registry.test.ts`: add `describe("registry — antigravity-cli")` — registers `antigravity-cli` `ToolDefinition`; `rootKey === "mcpServers"`; **no** `configFormat: "toml"`; declares `darwin`, `linux`, `wsl`, `win32`; all `mcpMode === "direct"`; no `template`, `agents`, `commands`, or `workflows` on any platform.
- [x] 1.2 **(RED)** `registry.test.ts`: path resolvers — config at `{homedir}/.gemini/antigravity-cli/mcp_config.json`; skills at `{homedir}/.gemini/antigravity-cli/skills`; skills path MUST NOT resolve under `antigravity/skills` (IDE dir).
- [x] 1.3 **(RED)** `registry.test.ts`: `detect` returns true when `mcp_config.json` exists under temp homedir (no `agy` binary required).
- [x] 1.4 **(RED)** Create `antigravity-cli-install-smoke.test.ts` (mirror `opencode-install-smoke.test.ts`) — composed primitives: `getToolByName("antigravity-cli")` + temp-homedir `PlatformContext`; `mergeConfig` asserts `mcpServers.kanon-mcp` object form; `installSkills` / `removeSkills` for 3 product skills; `removeConfig` preserves other MCP servers; idempotent re-install; leakage walk forbids `settings.json`, `GEMINI.md`, `keybindings.json` under temp HOME.
- [x] 1.5 **(RED)** Extend `leakage-guard.test.ts`: add `describe("antigravity-cli — personal-config leakage guard")` — config path must not end with `settings.json`, `GEMINI.md`, or `keybindings.json`; no `template`, `agents`, `commands`, `workflows`; skills path must be under `antigravity-cli/skills`, not `antigravity/skills`.

---

## Phase 2 — Registry (GREEN)

_Spec req: ANTIGRAVITY_CLI_PATHS; antigravity-cli ToolDefinition; --tool flag_

- [x] 2.1 **(GREEN)** Add `ANTIGRAVITY_CLI_PATHS` const in `registry.ts` — `detect` (`commandExists("agy")` + config dir fallbacks), `config`, `skills`, `mcpMode: "direct"`.
- [x] 2.2 **(GREEN)** Add `antigravity-cli` entry to `toolRegistry` in `registry.ts` — `displayName: "Antigravity CLI"`, `rootKey: "mcpServers"`, shared paths on all four platforms; no `template`/`agents`/`workflows`/`commands` resolvers.
- [x] 2.3 **(GREEN)** `index.ts`: extend `--tool` help string to include `antigravity-cli` (alongside `claude-code`, `cursor`, `antigravity`, `opencode`, `codex`).

---

## Phase 3 — Smoke validation (GREEN)

_Spec req: Composed install/remove idempotency; MCP + skills product surface_

- [x] 3.1 **(GREEN)** Confirm `antigravity-cli-install-smoke.test.ts` passes after Phase 2 — fix any wiring gaps (path resolver, assets dir, `formatMcpEntry` shape).
- [x] 3.2 **(GREEN)** Confirm registry G5 tests (1.1–1.3) pass.

---

## Phase 4 — Leakage validation (GREEN)

_Spec req: No personal-config writes; IDE path isolation_

- [x] 4.1 **(GREEN)** Confirm `leakage-guard.test.ts` antigravity-cli block (1.5) passes.
- [x] 4.2 **(GREEN)** Confirm existing IDE `antigravity` G5 and leakage tests unchanged (regression).

---

## Phase 5 — Documentation

_Spec req: AI_TOOLS.md paths; kanon-onboard CLI troubleshooting_

- [x] 5.1 `docs/AI_TOOLS.md`: add **Antigravity CLI** row — binary `agy`, paths (`~/.gemini/antigravity-cli/mcp_config.json`, `skills/`), `kanon-setup --tool antigravity-cli`, IDE vs CLI distinction, WSL `direct` vs IDE `wsl-bridge`, Windows `%LOCALAPPDATA%\agy\bin` PATH note.
- [x] 5.2 `packages/setup/assets/skills/kanon-onboard/SKILL.md`: Antigravity CLI troubleshooting — IDE (`antigravity`) vs CLI (`antigravity-cli`) paths, re-run idempotency, manual rollback, binary-not-on-PATH fallback.

---

## Phase 6 — Verify gate

- [x] 6.1 `pnpm --filter @kanon-pm/setup test` green.
- [ ] 6.2 Manual smoke (optional): `node packages/setup/dist/index.js --tool antigravity-cli -y` → verify `~/.gemini/antigravity-cli/mcp_config.json` + skills; record in verify-report if run.

---

## Dependency order

Phase 1 (RED) → Phase 2 (GREEN registry) → Phases 3–4 validate tests → Phase 5 docs after green → Phase 6 last.

No `mcp-config.ts` or `index.ts` dispatch changes expected beyond help string — JSON merge path is pre-existing.
