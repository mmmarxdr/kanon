# Delta for codex-install-parity

## ADDED Requirements

### Requirement: Codex registry entry

The setup package MUST register a single tool entry `codex` (not `codex-cli`) with `rootKey: mcp_servers`, `configFormat: toml`, and `mcpMode: direct` on `darwin`, `linux`, `wsl`, and `win32`.

Path resolvers MUST use `resolveCodexHome(ctx, ...segments)` where home is `process.env.CODEX_HOME ?? path.join(ctx.homedir, ".codex")`. MCP config resolves to `{codexHome}/config.toml`; skills to `{codexHome}/skills`.

The registry MUST NOT declare `template`, `agents`, or `commands` paths for `codex`.

#### Scenario: Registry contract

- GIVEN `getToolByName("codex")`
- WHEN the entry is inspected
- THEN `rootKey === "mcp_servers"`, `configFormat === "toml"`, and all four platforms are present
- AND path resolvers target `$CODEX_HOME/config.toml` and `$CODEX_HOME/skills`

#### Scenario: CODEX_HOME override

- GIVEN `CODEX_HOME` points to a temp directory
- WHEN `kanon-setup --tool codex` runs
- THEN MCP config and skills are written under that directory

---

### Requirement: Tool detection

The `codex` detect resolver MUST return true when `codex` exists on PATH, OR when `{codexHome}/config.toml` exists.

#### Scenario: Detect via CLI or config

- GIVEN either `codex` on PATH or an existing `{codexHome}/config.toml`
- WHEN `detectTools()` runs
- THEN `codex` is included in detected tools

---

### Requirement: TOML MCP merge and remove

For `configFormat: toml`, setup MUST merge and remove via TOML parse/stringify (not `codex mcp add` shell-out).

Install MUST write flat `command`/`args` under `[mcp_servers.kanon-mcp]` and env vars under `[mcp_servers.kanon-mcp.env]`, matching verified `codex mcp add` output. Remove MUST delete both tables. Other `mcp_servers.*` entries MUST be preserved.

#### Scenario: Fresh install merges MCP

- GIVEN `config.toml` with other MCP servers
- WHEN `kanon-setup --tool codex` completes
- THEN `[mcp_servers.kanon-mcp]` exists with `command` and `args`
- AND other MCP server tables are unchanged

#### Scenario: Remove cleans MCP entry

- GIVEN a prior codex install wrote `kanon-mcp`
- WHEN `kanon-setup --tool codex --remove` runs
- THEN `kanon-mcp` table and `.env` subtable are absent
- AND unrelated `mcp_servers.*` tables remain

---

### Requirement: Product surface install (skills only)

For `codex`, setup MUST install MCP config and three product skills (`kanon-agent`, `kanon-init`, `kanon-onboard`) under `{codexHome}/skills`. Setup MUST NOT write template, agents, commands, or project-scoped config.

#### Scenario: Skills installed

- GIVEN codex install completes
- WHEN skills are enumerated under `{codexHome}/skills`
- THEN each product skill has a `SKILL.md`

---

### Requirement: Leakage guard

Codex install MUST NOT write or modify `$CODEX_HOME/AGENTS.md`. Leakage-guard tests MUST forbid `AGENTS.md` for `codex`.

#### Scenario: No AGENTS.md write

- GIVEN codex install under a temp `CODEX_HOME`
- WHEN written files are enumerated
- THEN `AGENTS.md` was not created or modified by the installer

---

### Requirement: Idempotent install and remove

Re-running `kanon-setup --tool codex` MUST not duplicate MCP tables, env keys, or skill directories. `--remove` MUST succeed when artifacts are already absent.

#### Scenario: Re-run and clean remove

- GIVEN a successful codex install, then re-run, then `--remove` on a clean state
- WHEN each command completes
- THEN exactly one `kanon-mcp` entry exists after re-run
- AND remove exits without error when already clean

---

### Requirement: Test harness parity

The setup package MUST include `codex-install-smoke.test.ts` (composed primitives, NOT `run()`), registry G5 contract tests, and `mcp-config.test.ts` TOML merge/remove cases.

#### Scenario: Smoke test passes

- GIVEN `pnpm --filter @kanon-pm/setup test`
- WHEN codex smoke and registry tests run
- THEN install writes MCP + skills and remove cleans them

---

### Requirement: Onboarding documentation

`docs/AI_TOOLS.md` MUST document Codex paths and `kanon-setup --tool codex`. The `kanon-onboard` skill MUST cover `CODEX_HOME`, `config.toml` shape, re-run idempotency, and manual rollback.

#### Scenario: Docs reference Codex

- GIVEN a developer reads `docs/AI_TOOLS.md`
- WHEN they look up Codex CLI
- THEN install paths and the setup command are documented
