# Delta for antigravity-cli-install-parity

## ADDED Requirements

### Requirement: Antigravity CLI registry entry

The setup package MUST register a single tool entry `antigravity-cli` (not `antigravity`, not `agy`) with `displayName: "Antigravity CLI"`, `rootKey: "mcpServers"`, and JSON config format (default — `configFormat` MUST NOT be `"toml"`).

The entry MUST declare platforms `darwin`, `linux`, `wsl`, and `win32`. All four platforms MUST share one `ANTIGRAVITY_CLI_PATHS` constant with identical homedir-relative layout.

Path resolvers MUST target:

- MCP config: `{homedir}/.gemini/antigravity-cli/mcp_config.json`
- Skills: `{homedir}/.gemini/antigravity-cli/skills`

Every platform MUST set `mcpMode: "direct"`. The CLI entry MUST NOT use `mcpMode: "wsl-bridge"` or `ctx.winHome` path resolvers.

The registry MUST NOT declare `template`, `agents`, `workflows`, or `commands` paths for `antigravity-cli`. The entry MUST remain independent of the existing IDE `antigravity` registry entry.

#### Scenario: Registry contract

- GIVEN `getToolByName("antigravity-cli")`
- WHEN the entry is inspected
- THEN `name === "antigravity-cli"`, `displayName === "Antigravity CLI"`, and `rootKey === "mcpServers"`
- AND `configFormat` is undefined or `"json"` (not `"toml"`)
- AND platforms `darwin`, `linux`, `wsl`, and `win32` are all present
- AND each platform's `mcpMode === "direct"`
- AND path resolvers target `~/.gemini/antigravity-cli/mcp_config.json` and `~/.gemini/antigravity-cli/skills`
- AND `template`, `agents`, `workflows`, and `commands` are absent on every platform

#### Scenario: Distinct from IDE antigravity entry

- GIVEN both `getToolByName("antigravity")` and `getToolByName("antigravity-cli")`
- WHEN path resolvers are compared on the same `PlatformContext`
- THEN IDE config resolves to `~/.gemini/antigravity/mcp_config.json`
- AND CLI config resolves to `~/.gemini/antigravity-cli/mcp_config.json`
- AND the two entries do not share config or skills directories

---

### Requirement: Tool detection

The `antigravity-cli` detect resolver MUST return true when any of the following is true on the current platform:

1. `agy` exists on PATH (`commandExists("agy", ctx.platform)`), OR
2. `{homedir}/.gemini/antigravity-cli/mcp_config.json` exists, OR
3. `{homedir}/.gemini/antigravity-cli/` directory exists

Detection MUST NOT return true based solely on IDE paths under `~/.gemini/antigravity/`, `settings.json`, `keybindings.json`, or workspace-scoped `.agents/mcp_config.json`.

The installer MUST NOT require a home-override environment variable (no `CODEX_HOME`-style resolver for Antigravity CLI).

#### Scenario: Detect via CLI binary

- GIVEN `agy` is on PATH and no `mcp_config.json` exists yet
- WHEN `detectTools()` runs
- THEN `antigravity-cli` is included in detected tools

#### Scenario: Detect via config directory fallback

- GIVEN `agy` is not on PATH but `{homedir}/.gemini/antigravity-cli/mcp_config.json` exists
- WHEN `detectTools()` runs
- THEN `antigravity-cli` is included in detected tools

#### Scenario: IDE paths do not trigger CLI detection

- GIVEN only `~/.gemini/antigravity/` exists (IDE install) and `agy` is absent
- WHEN `detectTools()` runs
- THEN `antigravity-cli` is NOT included
- AND `antigravity` MAY still be included per existing IDE rules

---

### Requirement: WSL direct mode

On platform `wsl`, `antigravity-cli` MUST resolve all paths from `ctx.homedir` (WSL Linux home) and MUST use `mcpMode: "direct"`.

Setup MUST NOT write CLI MCP config or skills to Windows host paths (`ctx.winHome/.gemini/...`) for `antigravity-cli`.

#### Scenario: WSL CLI uses Linux homedir

- GIVEN a `PlatformContext` with `platform === "wsl"` and both `homedir` and `winHome` set
- WHEN `antigravity-cli` path resolvers run
- THEN config resolves under `ctx.homedir/.gemini/antigravity-cli/`
- AND `mcpMode === "direct"`
- AND resolved paths do not reference `ctx.winHome`

#### Scenario: WSL IDE bridge unchanged

- GIVEN the existing IDE `antigravity` entry on platform `wsl`
- WHEN its path resolvers run
- THEN IDE config still resolves under `ctx.winHome/.gemini/antigravity/`
- AND IDE `mcpMode === "wsl-bridge"`
- AND adding `antigravity-cli` does not alter IDE WSL behavior

---

### Requirement: JSON MCP merge and remove

For `antigravity-cli`, setup MUST install and remove MCP config via existing JSON `mergeConfig` / `removeConfig` (no new format adapter, no shell-out).

Install MUST write `mcpServers.kanon-mcp` as an object with `command`, `args`, and optional `env` (when workspace binding is preserved), matching the wrapper-mode shape used by Claude Code, Cursor, and IDE Antigravity.

Remove MUST delete only `mcpServers.kanon-mcp`. Other `mcpServers.*` entries (including HTTP `serverUrl` servers) MUST be preserved.

#### Scenario: Fresh install merges MCP

- GIVEN `mcp_config.json` with other MCP servers (e.g. `context7`, `engram`)
- WHEN `kanon-setup --tool antigravity-cli` completes
- THEN `mcpServers.kanon-mcp` exists with `command` and `args`
- AND other `mcpServers.*` entries are unchanged

#### Scenario: Remove cleans MCP entry only

- GIVEN a prior `antigravity-cli` install wrote `kanon-mcp`
- WHEN `kanon-setup --tool antigravity-cli --remove` runs
- THEN `mcpServers.kanon-mcp` is absent
- AND unrelated `mcpServers.*` entries remain

#### Scenario: Idempotent MCP merge and remove

- GIVEN a successful `antigravity-cli` install
- WHEN `kanon-setup --tool antigravity-cli` runs again
- THEN exactly one `mcpServers.kanon-mcp` entry exists (no duplicate keys or arrays)
- AND when `--remove` runs on an already-clean config
- THEN the command exits without error

---

### Requirement: Product surface install (MCP and skills only)

For `antigravity-cli`, setup MUST install MCP config and exactly three product skills under `{homedir}/.gemini/antigravity-cli/skills/`:

- `kanon-agent`
- `kanon-init`
- `kanon-onboard`

Each installed skill MUST include a `SKILL.md`.

Setup MUST NOT write or modify:

- `~/.gemini/GEMINI.md` (IDE template surface)
- `~/.gemini/agents/` (IDE agents surface)
- `global_workflows/` (IDE workflows surface)
- `settings.json` (CLI UI preferences)
- `keybindings.json` (CLI personal bindings)
- Workspace-scoped `.agents/mcp_config.json`

#### Scenario: Skills installed

- GIVEN `antigravity-cli` install completes
- WHEN skills are enumerated under `~/.gemini/antigravity-cli/skills/`
- THEN `kanon-agent`, `kanon-init`, and `kanon-onboard` each contain `SKILL.md`

#### Scenario: Skills removed on uninstall

- GIVEN a prior `antigravity-cli` install wrote product skills
- WHEN `kanon-setup --tool antigravity-cli --remove` runs
- THEN the three Kanon skill directories are absent under `~/.gemini/antigravity-cli/skills/`
- AND unrelated skills in that directory (if any) remain

#### Scenario: Re-run skills idempotency

- GIVEN a successful `antigravity-cli` install
- WHEN `kanon-setup --tool antigravity-cli` runs again
- THEN each product skill directory exists exactly once with valid `SKILL.md` content

---

### Requirement: Leakage guard

`antigravity-cli` install MUST NOT write or modify `settings.json`, `GEMINI.md`, or `keybindings.json` anywhere under the user's home directory.

Leakage-guard tests MUST assert:

- Config path does not end with `settings.json` or `GEMINI.md`
- No `template`, `agents`, `commands`, or `workflows` fields on any platform
- Skills path is under `antigravity-cli/skills`, not `antigravity/skills`

#### Scenario: No personal-config leakage

- GIVEN `antigravity-cli` install under a temp homedir
- WHEN all files written by the installer are enumerated
- THEN `settings.json`, `GEMINI.md`, and `keybindings.json` were not created or modified

---

### Requirement: `--tool antigravity-cli` targeting

`kanon-setup` MUST accept `--tool antigravity-cli` to target only the CLI registry entry.

The `--tool` help string in `index.ts` MUST list `antigravity-cli` alongside other supported tools.

`--tool antigravity` MUST continue to target the IDE entry only. Setup MUST NOT treat `antigravity` as an alias for `antigravity-cli`.

#### Scenario: Explicit CLI targeting

- GIVEN a machine with both IDE and CLI Antigravity surfaces present
- WHEN `kanon-setup --tool antigravity-cli -y` runs
- THEN only `~/.gemini/antigravity-cli/mcp_config.json` and `~/.gemini/antigravity-cli/skills/` are modified
- AND `~/.gemini/antigravity/` and `~/.gemini/GEMINI.md` are untouched

#### Scenario: Help documents CLI tool name

- GIVEN a developer runs `kanon-setup --help`
- WHEN the `--tool` option description is read
- THEN `antigravity-cli` appears in the supported tool list

---

### Requirement: Dual detection coexistence

When both IDE `antigravity` and CLI `antigravity-cli` are installed, `detectTools()` MAY return both entries. The installer MUST configure each entry independently without cross-contamination.

#### Scenario: Both products on one machine

- GIVEN `agy` on PATH and `~/.gemini/antigravity/mcp_config.json` exists
- WHEN `detectTools()` runs without `--tool` filter
- THEN both `antigravity` and `antigravity-cli` MAY be detected
- AND installing for one does not modify the other's config or skills paths

---

### Requirement: Test harness parity

The setup package MUST include:

1. Registry G5 contract tests for `antigravity-cli` in `registry.test.ts` (mirror `opencode` / `codex` blocks)
2. `antigravity-cli-install-smoke.test.ts` using composed primitives (NOT `run()`): MCP merge, skills install/remove, leakage assertions, idempotent re-run and remove
3. Leakage-guard extensions in `leakage-guard.test.ts` for CLI-specific forbidden paths

Existing IDE `antigravity` G5 tests MUST remain unchanged and passing.

#### Scenario: Smoke test passes

- GIVEN `pnpm --filter @kanon-pm/setup test`
- WHEN `antigravity-cli` registry, smoke, and leakage tests run
- THEN install writes `mcpServers.kanon-mcp` and three product skills
- AND remove cleans them without touching forbidden personal files
- AND IDE `antigravity` tests still pass

---

### Requirement: Onboarding documentation

`docs/AI_TOOLS.md` MUST document Antigravity CLI with:

- Registry name `antigravity-cli` and setup command `kanon-setup --tool antigravity-cli`
- Global MCP path `~/.gemini/antigravity-cli/mcp_config.json` (`mcpServers` root)
- Skills path `~/.gemini/antigravity-cli/skills/`
- Platform-specific binary locations (including Windows `%LOCALAPPDATA%\agy\bin` on PATH)
- Explicit distinction from IDE Antigravity (`antigravity` entry, `~/.gemini/antigravity/`)

The `kanon-onboard` skill MUST add an Antigravity CLI troubleshooting section covering:

- IDE vs CLI path distinction (`antigravity` vs `antigravity-cli`)
- WSL semantics: CLI uses Linux homedir with `direct` mode; IDE uses Windows bridge
- Re-run idempotency and `--remove` rollback steps
- Manual rollback: delete `mcpServers.kanon-mcp` and remove the three Kanon skill directories

#### Scenario: Docs reference Antigravity CLI

- GIVEN a developer reads `docs/AI_TOOLS.md`
- WHEN they look up Antigravity CLI
- THEN install paths, `--tool antigravity-cli`, and IDE-vs-CLI distinction are documented

#### Scenario: Onboard skill covers CLI troubleshooting

- GIVEN a developer follows `kanon-onboard` after `kanon-setup --tool antigravity-cli`
- WHEN they hit MCP or skills issues
- THEN the skill provides CLI-specific paths, WSL direct-mode guidance, and rollback steps distinct from IDE Antigravity
