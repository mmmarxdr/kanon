# Proposal: Codex CLI Integration (KAN-128)

## Intent

Codex CLI is absent from `kanon-setup` today. Developers using OpenAI Codex cannot run the standard `install.sh` → `kanon://` onboarding flow and get Kanon MCP + product skills. The blocker is JSON-only config merge in `mcp-config.ts`; Codex stores MCP servers in `$CODEX_HOME/config.toml` (TOML).

**Win:** Developer with Codex CLI runs `install.sh`, pastes a `kanon://` link, and gets `kanon-mcp` in `config.toml` plus Kanon skills under `~/.codex/skills/` — no manual TOML editing.

## Motivation

- Parent tracker KAN-127; this subtask (KAN-128) closes the Codex gap in the multi-tool installer.
- OpenCode (KAN-55) established the product-surface pattern: MCP + skills only, leakage guards, smoke tests — Codex is the natural sibling with a TOML config format instead of JSON.
- `docs/AI_TOOLS.md` and registry omit Codex; `mergeConfig()` cannot write TOML tables (`[mcp_servers.kanon-mcp]` + `.env` subtable).
- Verified local shape matches `codex mcp add` output (CLI 0.140.0): flat `command`/`args` + nested `[mcp_servers.<name>.env]`.

## Scope

### In Scope

1. **Registry entry `codex`** — `CODEX_PATHS` with `resolveCodexHome()` (`CODEX_HOME` env or `~/.codex`); platforms `darwin`, `linux`, `wsl`, `win32`; `mcpMode: direct`; `rootKey: mcp_servers`; `configFormat: "toml"`.
2. **TOML MCP adapter** — `mergeTomlMcpConfig` / `removeTomlMcpConfig`; `formatMcpEntry` codex variant; TOML branch in `extractExistingAuth` / workspace-id preservation.
3. **Product surface only** — MCP merge + `installSkills` to `$CODEX_HOME/skills`; skip template, agents, commands.
4. **Tests** — `codex-install-smoke.test.ts`, registry G5 contract, `mcp-config.test.ts` TOML cases, leakage guard (`AGENTS.md` forbidden).
5. **Docs** — `docs/AI_TOOLS.md` Codex row; `kanon-onboard` troubleshooting section.

### Out of Scope

- API or MCP server tool changes (`packages/api`, `packages/mcp` wrapper is already tool-agnostic).
- Antigravity / Gemini integration (KAN-130).
- Project-scoped `.codex/config.toml` (global `$CODEX_HOME` only).
- Writing `$CODEX_HOME/AGENTS.md` or any personal harness file.
- Shell-out to `codex mcp add`/`remove` as primary install path.

## Capabilities

### New Capabilities

- `codex-install-parity`: verified Kanon installer wiring for Codex CLI (TOML MCP entry, skills install/remove, registry detection, test harness parity).

### Modified Capabilities

- `kanon-onboard-skill`: Codex-specific troubleshooting (`CODEX_HOME`, config.toml shape, re-run idempotency).

## Approach

**Approach 1 (recommended): TOML parse/merge library** — mirror OpenCode's direct-file pattern, using verified `codex mcp add` output as canonical on-disk shape.

| Step | Action |
|------|--------|
| 1 | Add TOML dependency (`smol-toml` or equivalent); extend `ToolDefinition` with `configFormat: "json" \| "toml"` |
| 2 | Implement TOML merge/remove + auth extraction; wire `index.ts` dispatch |
| 3 | Add `codex` registry entry + `resolveCodexHome` |
| 4 | Smoke, registry contract, leakage guard, mcp-config tests |
| 5 | Update `AI_TOOLS.md` + onboard skill |

**MCP entry shape (wrapper mode):**

```toml
[mcp_servers.kanon-mcp]
command = "<node>"
args = ["<wrapper-cli.js>", "--server", "<url>"]

[mcp_servers.kanon-mcp.env]
KANON_WORKSPACE_ID = "<id>"   # when re-run preserves binding
```

## Affected Areas

| Area | Impact |
|------|--------|
| `packages/setup/src/registry.ts` | +`codex` entry, `CODEX_PATHS` |
| `packages/setup/src/mcp-config.ts` | TOML merge/remove, format + auth |
| `packages/setup/src/types.ts` | `configFormat` discriminator |
| `packages/setup/src/index.ts` | TOML routing; `--tool` help |
| `packages/setup/package.json` | TOML dependency |
| `packages/setup/src/__tests__/*` | smoke, registry, leakage, mcp-config |
| `docs/AI_TOOLS.md` | Codex paths table |
| `packages/setup/assets/skills/kanon-onboard/SKILL.md` | Codex section |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| TOML round-trip drops comments | Med | Touch only `mcp_servers.kanon-mcp` keys; document limitation |
| `CODEX_HOME` ignored | Med | Central `resolveCodexHome`; test with env override |
| Schema drift (nested `transport`) | Low | Target flat `command`/`args` verified on 0.140.0 |
| Auth extraction gap on re-run | Low | TOML branch for static-key mode; wrapper uses credential store |

## Rollback Plan

Revert setup-package changes and remove `codex` from registry. Users who ran install: delete `[mcp_servers.kanon-mcp]` (+ `.env` subtable) from `config.toml` and remove `kanon-*` dirs under `$CODEX_HOME/skills`. No API or server rollback needed.

## Proposal Assumptions

Confirmed by exploration unless noted:

| Assumption | Status |
|------------|--------|
| TOML library (`smol-toml` or similar), not CLI shell-out | Confirmed |
| No `AGENTS.md`, template, agents, or commands writes | Confirmed |
| `CODEX_HOME` env respected for all paths | Confirmed |
| Single registry entry `codex` (not `codex-cli`) | Confirmed |
| Platforms: `darwin`, `linux`, `wsl`, `win32` with `mcpMode: direct` | Confirmed (orchestrator; exploration deferred win32) |
| Comment loss on TOML stringify acceptable | Confirmed |

## Success Criteria

- [ ] `pnpm --filter @kanon/setup test` green with codex registry, smoke, TOML, leakage tests
- [ ] `kanon-setup --tool codex -y` writes valid `[mcp_servers.kanon-mcp]` + skills under `$CODEX_HOME/skills`
- [ ] Re-run is idempotent; `--remove` cleans MCP table and skills
- [ ] `AGENTS.md` never written; leakage guard passes
- [ ] `docs/AI_TOOLS.md` documents Codex install paths accurately

## Size / Review Workload

Estimated ~200–350 LOC (TOML module + registry + tests + docs). **400-line budget: Low.** Fits one PR scoped to `packages/setup` + docs.

## Dependencies

TOML parse/stringify npm package. Ships in setup package bundled with next MCP tarball. No API/MCP server release dependency.
