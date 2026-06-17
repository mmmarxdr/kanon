# Exploration: Codex CLI Integration (KAN-128)

## Goal

Add first-class **OpenAI Codex CLI** support to `packages/setup` (`kanon-setup`), matching the OpenCode pattern: MCP server entry (wrapper mode), product skills install/remove, registry detection, and test harness parity — without touching API/MCP server code unless strictly required.

Parent tracker: KAN-127. Subtask: KAN-128.

---

## Current State

### Setup pipeline (unchanged for Codex today)

```
kanon:// onboarding link
        │
        ▼
install.sh  → ~/.kanon/mcp
        │
        ▼
kanon-setup  (packages/setup/dist/index.js)
        │
        ├── detectTools()     registry.ts — codex NOT registered
        ├── mergeConfig()     mcp-config.ts — JSON only
        ├── installSkills()   skills.ts — generic, works for any skillDir
        └── per-tool branches in index.ts (template/agents/commands)
```

**Supported tools today:** `claude-code`, `cursor`, `antigravity`, `opencode` (beta). Codex is absent from `toolRegistry` and `docs/AI_TOOLS.md`.

### MCP config layer — JSON-only blocker (confirmed)

`mergeConfig()` / `removeConfig()` in `mcp-config.ts` always:

1. `fs.readFileSync` → `JSON.parse`
2. Merge/delete `config[rootKey]["kanon-mcp"]`
3. `JSON.stringify` write-back

`extractExistingAuth()` and `extractExistingWorkspaceId()` also assume JSON. **Codex cannot use this path without a TOML adapter.**

`formatMcpEntry()` handles two JSON shapes only:

| `rootKey` | Shape |
|-----------|-------|
| `mcpServers` | `{ command, args, env? }` (Claude/Cursor/Antigravity) |
| `mcp` | `{ type: "local", command: string[], environment? }` (OpenCode) |

Codex uses a third on-disk format (TOML tables).

### Codex on-disk layout (verified locally + official docs)

| Surface | Path | Notes |
|---------|------|-------|
| Config | `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`) | TOML; respects `CODEX_HOME` env |
| MCP servers | `[mcp_servers.<name>]` tables | stdio: `command` + `args`; HTTP: `url` |
| MCP env | `[mcp_servers.<name>.env]` subtable | **Not** inline `env` key — nested TOML table |
| Skills | `$CODEX_HOME/skills/<skill>/SKILL.md` | Confirmed on machine (`kanon-*` not installed yet) |
| Personal harness | `$CODEX_HOME/AGENTS.md` | **Exists on machine — MUST NOT be written by installer** |
| Agents dir | None | No `~/.codex/agents/` convention |
| Commands dir | None | Unlike OpenCode's `commands/` |

**Local `~/.codex/config.toml` excerpt (verified):**

```toml
[mcp_servers.engram]
command = "engram"
args = ["mcp", "--tools=agent"]

[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"
```

**`codex mcp add` output shape (verified via `CODEX_HOME` temp dir):**

```toml
[mcp_servers.kanon-mcp-test]
command = "node"
args = ["/fake/wrapper.js", "--server", "https://test.example"]

[mcp_servers.kanon-mcp-test.env]
KANON_API_KEY = "testkey"
KANON_API_URL = "https://test.example"
```

`codex mcp remove <name>` cleanly removes the table + `.env` subtable. CLI version on machine: **0.140.0** at `~/.local/bin/codex`.

### Closest analogue: OpenCode

OpenCode integration established the pattern Codex should follow:

- `OPENCODE_PATHS` const shared across `darwin`/`linux`/`wsl`
- No `template`, no `agents` — product surface only
- `leakage-guard.test.ts` forbids personal harness writes
- `opencode-install-smoke.test.ts` — composed primitives (not `run()`)
- `registry.test.ts` G5 contract tests

Codex differs in **config format (TOML)** and **MCP entry shape** (flat `command`/`args` + `.env` subtable, not OpenCode's `type: "local"` array form).

---

## Affected Areas

| File | Why affected |
|------|--------------|
| `packages/setup/src/registry.ts` | Add `codex` `ToolDefinition` + `CODEX_PATHS` (detect, config, skills) |
| `packages/setup/src/mcp-config.ts` | TOML merge/remove; `formatMcpEntry` codex variant; `extractExistingAuth` TOML branch |
| `packages/setup/src/types.ts` | Optional `configFormat: "json" \| "toml"` on `ToolDefinition` (or parallel flag) |
| `packages/setup/src/index.ts` | Route codex through TOML merge/remove; update `--tool` help string |
| `packages/setup/package.json` | Add TOML parse/stringify dependency if approach A |
| `packages/setup/src/__tests__/registry.test.ts` | G5-style codex contract tests |
| `packages/setup/src/__tests__/codex-install-smoke.test.ts` | New — mirror `opencode-install-smoke.test.ts` |
| `packages/setup/src/__tests__/leakage-guard.test.ts` | Extend for codex (`AGENTS.md` forbidden) |
| `packages/setup/src/__tests__/mcp-config.test.ts` | TOML merge/remove + auth extraction tests |
| `docs/AI_TOOLS.md` | Add Codex row + paths table |
| `packages/setup/assets/skills/kanon-onboard/SKILL.md` | Codex troubleshooting section |

**Out of scope:** `packages/api`, `packages/mcp` (wrapper-cli already tool-agnostic), web UI.

---

## Approaches

### 1. TOML parse/merge library (recommended)

Add a small TOML dependency (`smol-toml` or `@iarna/toml`). Implement `mergeTomlMcpConfig` / `removeTomlMcpConfig` that:

- Parse `config.toml` → object
- Upsert/delete `mcp_servers.kanon-mcp` + `mcp_servers.kanon-mcp.env`
- Stringify back (preserve top-level keys; comment loss acceptable if documented)

Wire via `configFormat: "toml"` on the codex registry entry; `index.ts` dispatches to TOML functions instead of `mergeConfig`.

- **Pros:** Testable with temp dirs (no `codex` binary required); matches existing `mergeConfig`/`removeConfig` pattern; works when codex CLI not on PATH; deterministic idempotent upsert
- **Cons:** New dependency; round-trip may drop TOML comments; must track official schema changes manually
- **Effort:** Medium (~200–350 LOC including tests)

### 2. Shell out to `codex mcp add` / `codex mcp remove`

Use official CLI for install/remove; pass `CODEX_HOME` when testing.

- **Pros:** Always matches Codex's canonical writer; no TOML library; schema drift handled by Codex
- **Cons:** Requires `codex` on PATH at setup time; harder to unit-test (spawn mocking or integration-only); `extractExistingAuth` still needs TOML read path; inconsistent with JSON direct-write pattern used by all other tools
- **Effort:** Medium–High (spawn plumbing + dual read path + flaky-test risk)

### 3. Hybrid (CLI write, TOML read)

CLI for merge/remove; TOML library only for auth extraction.

- **Pros:** Canonical writes + testable reads
- **Cons:** Two code paths for one tool; highest maintenance; worst of both worlds for remove idempotency
- **Effort:** High

---

## Recommendation

**Approach 1 (TOML parse/merge)** — mirror OpenCode's direct-file pattern, using the verified `codex mcp add` output as the canonical on-disk shape target.

### Proposed registry entry (sketch)

```typescript
const CODEX_PATHS: PlatformPaths = {
  detect: async (ctx) =>
    commandExists("codex", ctx.platform) ||
    fs.existsSync(resolveCodexHome(ctx, "config.toml")),
  config: (ctx) => resolveCodexHome(ctx, "config.toml"),
  skills: (ctx) => resolveCodexHome(ctx, "skills"),
  mcpMode: "direct",
  // NO template, agents, commands, workflows
};

{
  name: "codex",
  displayName: "Codex",
  rootKey: "mcp_servers",      // logical key; TOML uses dotted tables
  configFormat: "toml",        // new discriminator
  templateSource: "",
  templateMode: "marker-inject",
  platforms: { darwin: CODEX_PATHS, linux: CODEX_PATHS, wsl: CODEX_PATHS },
}
```

`resolveCodexHome(ctx, ...segments)`: `process.env.CODEX_HOME ?? path.join(ctx.homedir, ".codex")`.

### Proposed MCP entry shape

**Wrapper mode (primary — matches onboarding flow):**

```toml
[mcp_servers.kanon-mcp]
command = "<nodeBin>"
args = ["<wrapper-cli.js>", "--server", "<canonicalUrl>"]

[mcp_servers.kanon-mcp.env]
KANON_WORKSPACE_ID = "<id>"   # only when re-run preserves binding
```

**Static-key mode (legacy/direct):**

```toml
[mcp_servers.kanon-mcp.env]
KANON_API_URL = "..."
KANON_API_KEY = "..."
```

`formatMcpEntry("mcp_servers", entry)` returns `{ command, args, env }` for TOML writer (distinct from OpenCode's array form).

### Install steps for Codex

| Step | Action |
|------|--------|
| MCP | `mergeTomlMcpConfig(configPath, "kanon-mcp", entry)` |
| Skills | `installSkills(~/.codex/skills, assets)` — 3 product skills |
| Template | **Skip** (no template path) |
| Agents | **Skip** (no agents dir) |
| Commands | **Skip** (Codex has no global commands dir) |

### Platforms

`darwin`, `linux`, `wsl` — **no `win32`**. Codex CLI follows OpenCode's cross-platform CLI model; no Windows-native registry branch unless verified later.

### Leakage guard (extend OpenCode pattern)

Forbidden basenames for codex: `AGENTS.md` (lives at `$CODEX_HOME/AGENTS.md`, not under skills). Registry must not declare `template` or `agents`.

---

## Risks

- **TOML comment/format loss** on round-trip — mitigate by only touching `mcp_servers.kanon-mcp` keys; document limitation
- **`extractExistingAuth` gap** until TOML branch ships — re-runs on codex-only machines won't find prior static-key creds (wrapper mode unaffected via credential store)
- **`CODEX_HOME` override** — registry path resolver must respect env var or installs land in wrong directory
- **Schema drift** — Codex may add `transport = { type = "stdio", ... }` nested form (seen in Mintlify docs); verify against 0.140.0 flat `command`/`args` before implement (flat form confirmed working)
- **400-line PR budget** — likely Low risk if scoped to setup package only; smoke + registry + TOML module fits one PR

---

## Ready for Proposal

**Yes.** Orchestrator should run `sdd-propose` for `codex-cli-integration`.

Tell the user:

1. Codex is a natural sibling to OpenCode — skills-only product surface, no personal harness writes.
2. The real work is a **TOML config adapter** in `mcp-config.ts`; registry/skills wiring is straightforward.
3. Recommend **TOML library approach** over `codex mcp` CLI shell-out for testability and consistency.
4. Suggested PR scope: registry + TOML merge/remove + auth extraction + smoke/leakage/registry tests + docs. No API/MCP changes.
