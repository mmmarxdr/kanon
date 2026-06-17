# Proposal: Antigravity CLI Integration (KAN-130)

## Intent

Antigravity CLI (`agy`) is absent from `kanon-setup` today. Developers using the CLI cannot run the standard `install.sh` → `kanon://` onboarding flow and get Kanon MCP + product skills. The existing registry entry `antigravity` targets the **Antigravity IDE** at `~/.gemini/antigravity/` — a separate product surface with different paths, WSL semantics, and install steps.

**Win:** A developer with Antigravity CLI runs `install.sh`, pastes a `kanon://` link, and gets `kanon-mcp` in `~/.gemini/antigravity-cli/mcp_config.json` plus Kanon skills under `~/.gemini/antigravity-cli/skills/` — no manual JSON editing or confusion with the IDE install.

**Persona:** Developer (primary) onboarding to a Kanon workspace via Antigravity CLI; PM/Director benefit indirectly when teammates can self-serve the same installer flow as Claude Code, Cursor, OpenCode, and Codex.

## Motivation

- **Parent tracker KAN-127** (multi-tool installer parity); **KAN-130** closes the Antigravity CLI gap as a sibling subtask to KAN-128 (Codex).
- **OpenCode (KAN-55)** and **Codex (KAN-128)** established the product-surface pattern: MCP + skills only, registry G5 contract tests, install smoke tests, leakage guards — Antigravity CLI follows the same playbook with lower complexity than Codex (JSON `mcpServers`, no TOML adapter).
- `docs/AI_TOOLS.md`, `toolRegistry`, and `kanon-onboard` omit Antigravity CLI; users typing `--tool antigravity` get the IDE entry, not the CLI.
- Verified locally (agy v1.0.9, WSL2): config at `~/.gemini/antigravity-cli/mcp_config.json` uses `mcpServers` object form — existing `mergeConfig()` / `removeConfig()` already handle this shape.

## Scope

### In Scope

1. **Registry entry `antigravity-cli`** — `ANTIGRAVITY_CLI_PATHS` const shared across platforms; `name: "antigravity-cli"`, `displayName: "Antigravity CLI"`; `rootKey: "mcpServers"` (JSON default); platforms `darwin`, `linux`, `wsl`, `win32`; `mcpMode: "direct"` (including WSL — CLI runs in Linux homedir, not Windows bridge).
2. **Detection** — `commandExists("agy")` OR `~/.gemini/antigravity-cli/mcp_config.json` OR `antigravity-cli/` dir under homedir; must not match IDE `~/.gemini/antigravity/` paths.
3. **Product surface only** — MCP merge via existing JSON path + `installSkills` to `~/.gemini/antigravity-cli/skills/` (three product skills: `kanon-agent`, `kanon-init`, `kanon-onboard`).
4. **Tests** — `antigravity-cli-install-smoke.test.ts` (composed primitives, mirror OpenCode); registry G5 contract in `registry.test.ts`; leakage guard extensions (forbid `settings.json`, `GEMINI.md`, `keybindings.json` writes).
5. **Docs** — `docs/AI_TOOLS.md` Antigravity CLI row + paths table; `kanon-onboard` troubleshooting section distinct from IDE Antigravity.
6. **`--tool` help string** — update `index.ts` to list `antigravity-cli`.

### Out of Scope

- **IDE `antigravity` entry changes** — existing IDE registry, WSL bridge, template (`GEMINI.md`), agents, and workflows remain untouched.
- **Workspace `.agents/mcp_config.json`** — project-local MCP config; global install only.
- **`settings.json` writes** — CLI UI prefs live here; MCP moved out per Gemini CLI migration; installer must never touch this file.
- **`~/.gemini/GEMINI.md` template injection** — IDE-only surface; CLI entry must not declare `template`.
- **Agents, workflows, commands** — verified absent at CLI level; no registry fields for these surfaces.
- **API or MCP server changes** (`packages/api`, `packages/mcp`) — wrapper is tool-agnostic.
- **`mcp-config.ts` core changes** — reuse existing JSON merge unless auth-extraction edge case discovered during implement.
- **`--tool agy` alias** — defer unless user feedback (YAGNI).
- **Future path migration** to `~/.gemini/config/mcp_config.json` — monitor `agy` CHANGELOG; not in initial scope.

## Capabilities

### New Capabilities

- `antigravity-cli-install-parity`: verified Kanon installer wiring for Antigravity CLI (JSON `mcpServers` entry, skills install/remove, registry detection, test harness parity, leakage guards).

### Modified Capabilities

- `kanon-onboard-skill`: Antigravity CLI troubleshooting — IDE vs CLI path distinction, WSL `direct` vs IDE `wsl-bridge`, Windows `%LOCALAPPDATA%\agy\bin` PATH note, re-run idempotency, manual rollback.

## Approach

Follow the **OpenCode playbook** (registry → smoke → leakage tests → docs). Unlike Codex, **no new config adapter** — JSON `mergeConfig` / `formatMcpEntry` already produce the correct `mcpServers.kanon-mcp` object form.

| Step | Action |
|------|--------|
| 1 | Add `ANTIGRAVITY_CLI_PATHS` + `antigravity-cli` registry entry |
| 2 | Registry G5 contract tests |
| 3 | Install smoke test (MCP + skills; leakage assertions) |
| 4 | Extend leakage guard |
| 5 | Update `AI_TOOLS.md` + `kanon-onboard` skill |

**Separate registry entry required:** IDE (`antigravity/`) and CLI (`antigravity-cli/`) are sibling dirs under `~/.gemini/` with no path collision. Both may be detected and configured independently on one machine.

**WSL semantics:** CLI uses `ctx.homedir` + `mcpMode: "direct"`; IDE uses `ctx.winHome` + `mcpMode: "wsl-bridge"`. Do not reuse IDE path constants.

**MCP entry shape (wrapper mode):**

```json
{
  "mcpServers": {
    "kanon-mcp": {
      "command": "<nodeBin>",
      "args": ["<wrapper-cli.js>", "--server", "<canonicalUrl>"],
      "env": { "KANON_WORKSPACE_ID": "<id>" }
    }
  }
}
```

## Affected Areas

| Area | Impact |
|------|--------|
| `packages/setup/src/registry.ts` | +`antigravity-cli` entry, `ANTIGRAVITY_CLI_PATHS` |
| `packages/setup/src/index.ts` | `--tool` help string |
| `packages/setup/src/__tests__/registry.test.ts` | G5 contract for `antigravity-cli` |
| `packages/setup/src/__tests__/antigravity-cli-install-smoke.test.ts` | New |
| `packages/setup/src/__tests__/leakage-guard.test.ts` | Extend — CLI leakage rules |
| `docs/AI_TOOLS.md` | Antigravity CLI row + paths |
| `packages/setup/assets/skills/kanon-onboard/SKILL.md` | CLI troubleshooting section |

**Affected packages:** `packages/setup` only (plus repo-root `docs/AI_TOOLS.md`).

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `--tool antigravity` vs `--tool antigravity-cli` naming confusion | Med | Docs + onboard skill distinguish IDE vs CLI; defer alias |
| Official docs mix IDE and CLI paths | Med | Pin to verified CLI subdir `antigravity-cli/`; cite in docs |
| `settings.json` or `GEMINI.md` accidental write | Med | No `template` in registry; leakage guard asserts forbidden paths |
| WSL user expects Windows-path CLI install | Low | Document CLI-on-WSL uses Linux homedir; IDE uses Windows bridge |
| Future path migration to `~/.gemini/config/` | Low | Monitor `agy` CHANGELOG; add fallback detection later if needed |
| Binary not on PATH after install (esp. Windows) | Low | Config-dir fallback in `detect`; onboard mentions `%LOCALAPPDATA%\agy\bin` |
| Both IDE + CLI installed — dual detection | Low | Independent entries; installer configures each — expected behavior |
| win32 `homedir` resolution vs `%USERPROFILE%\.gemini\` | Low | Verify via `PlatformContext` in implement phase |

## Rollback Plan

Revert setup-package changes and **remove `antigravity-cli` from registry**. Users who ran install:

1. Delete `mcpServers.kanon-mcp` from `~/.gemini/antigravity-cli/mcp_config.json` (or remove file if Kanon was the only entry).
2. Remove `kanon-agent`, `kanon-init`, `kanon-onboard` dirs under `~/.gemini/antigravity-cli/skills/`.

No Prisma migrations, no API/MCP server rollback. IDE `antigravity` entry unaffected.

## Proposal Assumptions

Confirmed by exploration unless noted:

| Assumption | Status |
|------------|--------|
| JSON `mergeConfig` sufficient — no TOML or new adapter | Confirmed |
| No `template`, `agents`, `workflows`, `commands` writes | Confirmed |
| No `settings.json`, `GEMINI.md`, or `keybindings.json` writes | Confirmed |
| Single registry entry `antigravity-cli` (not reuse `antigravity`) | Confirmed |
| `displayName`: "Antigravity CLI" (not "AGY CLI") | Recommended |
| Platforms: `darwin`, `linux`, `wsl`, `win32` with `mcpMode: direct` | Confirmed |
| WSL CLI uses Linux homedir, not Windows bridge | Confirmed (local verify) |
| No `CODEX_HOME`-style home override env var for CLI paths | Confirmed |
| win32 paths via `PlatformContext.homedir` | To verify in implement |

## Success Criteria

- [ ] `pnpm --filter @kanon-pm/setup test` green with antigravity-cli registry, smoke, leakage tests
- [ ] `kanon-setup --tool antigravity-cli -y` writes valid `mcpServers.kanon-mcp` + skills under `~/.gemini/antigravity-cli/skills/`
- [ ] Re-run is idempotent; `--remove` cleans MCP entry and skills without touching other MCP servers
- [ ] `settings.json`, `GEMINI.md`, `keybindings.json` never written; leakage guard passes
- [ ] Existing IDE `antigravity` G5 tests unchanged
- [ ] `docs/AI_TOOLS.md` documents Antigravity CLI paths; onboard skill covers IDE vs CLI distinction

## Size / Review Workload

Estimated ~60–100 LOC production + ~250–350 LOC tests. **400-line budget: Low.** Single PR scoped to `packages/setup` + docs — smaller than Codex (KAN-128); no chained PRs expected.

## Dependencies

None external. Ships in setup package bundled with next MCP tarball. No API/MCP server release dependency.
