# Exploration: Antigravity CLI Integration (KAN-130)

## Goal

Add first-class **Antigravity CLI** (`agy`) support to `packages/setup` (`kanon-setup`), mirroring the **OpenCode / Codex product-surface pattern**: MCP server entry (wrapper mode), product skills install/remove, registry detection, and test harness parity — without touching API/MCP server code.

Parent tracker: **KAN-127**. Subtask: **KAN-130**.

The existing registry entry `antigravity` targets the **Antigravity IDE** (desktop app) at `~/.gemini/antigravity/`. This change adds a **separate** entry for the **CLI** at `~/.gemini/antigravity-cli/`. Both can coexist on one machine without path collision.

---

## Current Architecture

### Setup pipeline (unchanged for Antigravity CLI today)

```
kanon:// onboarding link
        │
        ▼
install.sh  → ~/.kanon/mcp
        │
        ▼
kanon-setup  (packages/setup/dist/index.js)
        │
        ├── detectTools()     registry.ts — antigravity-cli NOT registered
        ├── installToolMcpConfig()  mcp-config.ts — JSON mergeConfig (default)
        ├── installSkills()   skills.ts — generic, works for any skillDir
        └── per-tool branches in index.ts (template/agents/workflows — skipped when absent)
```

**Supported tools today:** `claude-code`, `cursor`, `antigravity` (IDE), `opencode` (beta), `codex` (CLI). Antigravity CLI is absent from `toolRegistry`, `docs/AI_TOOLS.md`, and `kanon-onboard` troubleshooting.

### MCP config layer — JSON path already works

Unlike Codex (KAN-128), Antigravity CLI uses **JSON** with `rootKey: "mcpServers"` — the same shape as the IDE `antigravity` entry. Existing `mergeConfig()` / `removeConfig()` / `formatMcpEntry()` handle this without a new adapter:

| `rootKey` | Shape | Tools |
|-----------|-------|-------|
| `mcpServers` | `{ command, args, env? }` | Claude, Cursor, Antigravity IDE, **Antigravity CLI** |
| `mcp` | `{ type: "local", command: string[], environment? }` | OpenCode |
| `mcp_servers` (TOML) | flat `command`/`args` + `.env` subtable | Codex |

`installToolMcpConfig()` already dispatches: TOML only when `configFormat === "toml"`; otherwise JSON `mergeConfig`. **No TOML dependency or new format adapter required.**

### Closest analogue: OpenCode (product surface, JSON)

OpenCode established the pattern Antigravity CLI should follow:

- Shared `PlatformPaths` const across platforms
- No `template`, no `agents`, no `workflows`, no `commands`
- `leakage-guard.test.ts` forbids personal harness writes
- `*-install-smoke.test.ts` — composed primitives (not `run()`)
- `registry.test.ts` G5 contract tests

Antigravity CLI differs from OpenCode in **config format** (JSON `mcpServers` object form, not OpenCode's `mcp` array form) and **path layout** (`~/.gemini/antigravity-cli/`). It is **closer to the IDE `antigravity` entry** for MCP shape, but **must not reuse IDE paths or harness surfaces**.

---

## Gap Analysis: IDE `antigravity` vs CLI `antigravity-cli`

| Dimension | IDE `antigravity` | CLI `antigravity-cli` (proposed) |
|-----------|-------------------|----------------------------------|
| Registry `name` | `antigravity` | `antigravity-cli` |
| Display name | Antigravity | Antigravity CLI |
| Binary | Desktop app (no CLI detect) | `agy` |
| Config | `~/.gemini/antigravity/mcp_config.json` | `~/.gemini/antigravity-cli/mcp_config.json` |
| Skills | `~/.gemini/antigravity/skills/` | `~/.gemini/antigravity-cli/skills/` |
| Workflows | `global_workflows/` | **None** (verified absent) |
| Agents dir | `~/.gemini/agents/` | **None** (verified absent) |
| Template | `~/.gemini/GEMINI.md` (marker-inject) | **None** — product surface only |
| Settings | N/A (IDE-managed) | `settings.json` — **MUST NOT write** (MCP moved out per Gemini CLI migration) |
| `rootKey` | `mcpServers` | `mcpServers` (same) |
| `configFormat` | json (default) | json (default) |
| WSL `mcpMode` | `wsl-bridge` → Windows `%USERPROFILE%\.gemini\` | **`direct`** → WSL Linux homedir (CLI runs in WSL, not Windows host) |
| Platforms | `win32`, `wsl`, `linux` (no `darwin`) | `darwin`, `linux`, `wsl`, `win32` (CLI is cross-platform) |

### Path collision risks

| Risk | Assessment |
|------|------------|
| Config file overlap | **None** — `antigravity/` vs `antigravity-cli/` are sibling dirs under `~/.gemini/` |
| Skills dir overlap | **None** — separate `skills/` trees |
| Shared `~/.gemini/GEMINI.md` | **Leakage risk** — IDE entry writes here; CLI entry must **not** declare `template` |
| Shared `~/.gemini/agents/` | IDE only; CLI has no agents dir — registry must not declare `agents` |
| `--tool` flag ambiguity | **Medium** — users may type `--tool antigravity` expecting CLI; docs must distinguish IDE vs CLI |
| Dual detection on WSL | **Low** — IDE detects Windows `.gemini` via `winHome`; CLI detects WSL homedir + `agy` on PATH. A WSL user with only CLI installed gets CLI only; IDE-only Windows user gets IDE only |
| Both installed | **Supported** — `detectTools()` returns both; installer patches each independently |

---

## Verified Config Paths (per platform)

### Linux / WSL (verified on dev machine — WSL2)

| Surface | Path | Verified |
|---------|------|----------|
| Binary | `~/.local/bin/agy` | Yes — v1.0.9 |
| Global MCP | `~/.gemini/antigravity-cli/mcp_config.json` | Yes — `mcpServers` root |
| Skills | `~/.gemini/antigravity-cli/skills/` | Yes — 22 skills present |
| Settings | `~/.gemini/antigravity-cli/settings.json` | Yes — UI prefs only, no MCP |
| Keybindings | `~/.gemini/antigravity-cli/keybindings.json` | Yes — personal, out of scope |
| Workspace MCP | `.agents/mcp_config.json` | Documented — **out of scope** (project-local) |
| `global_workflows/` | — | **Absent** |
| `agents/` | — | **Absent** at CLI level |

**Local `mcp_config.json` excerpt (verified):**

```json
{
  "mcpServers": {
    "context7": {
      "serverUrl": "https://mcp.context7.com/mcp"
    },
    "engram": {
      "args": ["mcp"],
      "command": "engram"
    }
  }
}
```

Note: HTTP MCP servers use `serverUrl` (not `url`). Kanon wrapper entry uses stdio `command`/`args` — same object form as Claude/Cursor/IDE Antigravity.

### macOS (`darwin`) — inferred from official/community docs, not verified locally

| Surface | Path |
|---------|------|
| Binary | `agy` on PATH (installer adds to shell rc) |
| Global MCP | `~/.gemini/antigravity-cli/mcp_config.json` |
| Skills | `~/.gemini/antigravity-cli/skills/` |
| Settings | `~/.gemini/antigravity-cli/settings.json` |

Sources: [Antigravity CLI docs](https://antigravity.google/docs/cli-using), Mem0 MCP guide, GitHub `github-mcp-server` issue #2529.

### Windows (`win32`) — inferred from migration docs, not verified locally

| Surface | Path |
|---------|------|
| Binary | `%LOCALAPPDATA%\agy\bin\agy.exe` (PATH must include `%LOCALAPPDATA%\agy\bin`) |
| Global MCP | `%USERPROFILE%\.gemini\antigravity-cli\mcp_config.json` |
| Skills | `%USERPROFILE%\.gemini\antigravity-cli\skills\` |
| Settings | `%USERPROFILE%\.gemini\antigravity-cli\settings.json` |

### WSL platform semantics

On WSL, the **IDE** `antigravity` entry bridges to the Windows host (`ctx.winHome/.gemini/antigravity/`, `mcpMode: "wsl-bridge"`). The **CLI** entry should use:

- `ctx.homedir` paths: `~/.gemini/antigravity-cli/...`
- `mcpMode: "direct"` — `agy` runs natively inside WSL, not via Windows host bridge
- Detection: `commandExists("agy", "wsl")` OR config dir under WSL homedir

**Rationale:** User verified `agy` at `~/.local/bin/agy` inside WSL with config at WSL `~/.gemini/antigravity-cli/`. Writing to Windows `%USERPROFILE%\.gemini\` from WSL setup would miss the CLI runtime.

### Config path migration note (open question)

GitHub issue #60 on `google-antigravity/antigravity-cli` mentions a CHANGELOG migration toward `~/.gemini/config/mcp_config.json` for Antigravity 2.0 GUI, while the **CLI binary** still reads `~/.gemini/antigravity-cli/mcp_config.json`. Kanon should target the **CLI app-data path** confirmed on v1.0.9. Revisit if a future `agy` release moves the canonical path.

---

## Detection Strategy

### Recommended detect function

```typescript
const ANTIGRAVITY_CLI_PATHS: PlatformPaths = {
  detect: async (ctx) =>
    commandExists("agy", ctx.platform) ||
    fs.existsSync(path.join(ctx.homedir, ".gemini", "antigravity-cli", "mcp_config.json")) ||
    fs.existsSync(path.join(ctx.homedir, ".gemini", "antigravity-cli")),
  config: (ctx) =>
    path.join(ctx.homedir, ".gemini", "antigravity-cli", "mcp_config.json"),
  skills: (ctx) =>
    path.join(ctx.homedir, ".gemini", "antigravity-cli", "skills"),
  mcpMode: "direct",
};
```

### Detection priority

1. **`commandExists("agy")`** — strongest signal; works before first MCP config exists
2. **`mcp_config.json` exists** — fallback for machines where `agy` is on PATH but `which` fails (rare)
3. **`antigravity-cli/` dir exists** — weakest fallback; avoids false positive from empty dir alone (pair with config or binary check)

### What NOT to detect

- `~/.gemini/antigravity/` — that is IDE, handled by existing `antigravity` entry
- `settings.json` — not an MCP indicator
- `.agents/mcp_config.json` — workspace-scoped, out of scope for global install

### No home override env var (unlike Codex)

Codex respects `CODEX_HOME`. Antigravity CLI docs do not document an equivalent override for `~/.gemini/antigravity-cli/`. **No `resolveAntigravityCliHome()` needed** unless official docs add one during implement.

---

## Install Surface

Product surface only — **MCP + skills**, mirroring OpenCode/Codex:

| Step | Action | Notes |
|------|--------|-------|
| MCP | `installToolMcpConfig(configPath, tool, entry)` → `mergeConfig` | `mcpServers.kanon-mcp` object form |
| Skills | `installSkills(~/.gemini/antigravity-cli/skills, assets)` | 3 product skills (`kanon-agent`, `kanon-init`, `kanon-onboard`) |
| Template | **Skip** | No `template` path in registry |
| Agents | **Skip** | No `agents` dir |
| Workflows | **Skip** | No `global_workflows` |
| Commands | **Skip** | No global commands dir (unlike OpenCode) |

### Proposed MCP entry shape (wrapper mode)

```json
{
  "mcpServers": {
    "kanon-mcp": {
      "command": "<nodeBin>",
      "args": ["<wrapper-cli.js>", "--server", "<canonicalUrl>"],
      "env": {
        "KANON_WORKSPACE_ID": "<id>"
      }
    }
  }
}
```

`env` block only when re-run preserves workspace binding; wrapper-primary flow matches other tools.

### Proposed registry entry (sketch)

```typescript
{
  name: "antigravity-cli",
  displayName: "Antigravity CLI",
  rootKey: "mcpServers",
  // configFormat omitted → json default
  templateSource: "",
  templateMode: "marker-inject",
  platforms: {
    darwin: ANTIGRAVITY_CLI_PATHS,
    linux: ANTIGRAVITY_CLI_PATHS,
    wsl: ANTIGRAVITY_CLI_PATHS,
    win32: ANTIGRAVITY_CLI_PATHS,
  },
}
```

Reuse a single `ANTIGRAVITY_CLI_PATHS` const — path layout is identical across platforms (only `homedir` resolution differs via `PlatformContext`).

---

## Reuse of Existing JSON `mergeConfig`

**Confirmed — no new adapter needed.**

- `formatMcpEntry("mcpServers", entry)` returns `{ command, args, env? }` — correct for CLI
- `mergeConfig` / `removeConfig` handle JSON read/write/idempotent upsert
- `extractExistingAuth` / `extractExistingWorkspaceId` already parse JSON `mcpServers.kanon-mcp`
- `installToolMcpConfig` / `removeToolMcpConfig` in `index.ts` work without `configFormat: "toml"` branch

**Implement scope is registry + tests + docs only** — the heaviest Codex work (TOML adapter) does not apply here.

---

## `mcpMode` Evaluation

| Platform | Recommended `mcpMode` | Rationale |
|----------|----------------------|-----------|
| `linux` | `direct` | `agy` and `node` wrapper run in same environment |
| `darwin` | `direct` | Same as linux |
| `wsl` | `direct` | CLI runs in WSL Linux; **not** Windows host bridge (unlike IDE `antigravity`) |
| `win32` | `direct` | Native Windows `agy.exe` + `node` |

No `wsl-bridge` variant needed. `buildMcpEntry` / `buildWrapperMcpEntry` already produce direct-mode entries when `mcpMode !== "wsl-bridge"`.

---

## Affected Areas

| File | Why affected |
|------|--------------|
| `packages/setup/src/registry.ts` | Add `antigravity-cli` entry + `ANTIGRAVITY_CLI_PATHS` |
| `packages/setup/src/index.ts` | Update `--tool` help string |
| `packages/setup/src/__tests__/registry.test.ts` | G5 contract tests for `antigravity-cli` |
| `packages/setup/src/__tests__/antigravity-cli-install-smoke.test.ts` | New — mirror `opencode-install-smoke.test.ts` (MCP + skills only) |
| `packages/setup/src/__tests__/leakage-guard.test.ts` | Extend — forbid `settings.json`, `GEMINI.md` writes; no template/agents |
| `docs/AI_TOOLS.md` | Add Antigravity CLI row + paths table |
| `packages/setup/assets/skills/kanon-onboard/SKILL.md` | CLI troubleshooting section (distinct from IDE Antigravity) |

**Out of scope:** `packages/api`, `packages/mcp`, `mcp-config.ts` core changes (unless auth-extraction edge case found), workspace `.agents/mcp_config.json`, IDE `antigravity` entry changes.

---

## Risks and Open Questions

| Risk / question | Severity | Mitigation |
|-----------------|----------|------------|
| `--tool antigravity` vs `--tool antigravity-cli` naming confusion | Medium | Docs + onboard skill; consider alias later (not in initial scope) |
| Official docs mix IDE and CLI paths | Medium | Pin to verified CLI path; cite `antigravity-cli` subdir explicitly in docs |
| Future path migration to `~/.gemini/config/` | Low | Monitor `agy` CHANGELOG; detection can add fallback read path if needed |
| `serverUrl` vs `url` for HTTP MCP | Low | Kanon uses stdio wrapper — unaffected; document for manual HTTP entries |
| WSL user expects Windows-path install | Low | Document that CLI-on-WSL uses Linux homedir; IDE uses Windows bridge |
| `settings.json` accidental write | Medium | Leakage guard + no `template` path; registry must not reference settings |
| Shared `~/.gemini/GEMINI.md` with IDE | Medium | CLI entry must not declare `template`; leakage guard asserts no GEMINI.md target |
| Binary not on PATH after install | Low | Config-dir fallback in `detect`; onboard skill mentions `%LOCALAPPDATA%\agy\bin` on Windows |
| Both IDE + CLI on same machine | Low | Independent entries; installer may configure both — expected behavior |

### Open questions for propose phase

1. Should `displayName` be **"Antigravity CLI"** or **"AGY CLI"**? (Recommend: "Antigravity CLI" — matches product page.)
2. Should we add `--tool agy` as a hidden alias? (Defer — YAGNI unless user feedback.)
3. Does `darwin` need a separate smoke fixture or is shared const sufficient? (Shared const — paths are homedir-relative.)
4. Confirm win32 `homedir` resolution via `PlatformContext` matches `%USERPROFILE%\.gemini\antigravity-cli\` in implement verify.

---

## Test Plan Sketch

### G5 — Registry contract (`registry.test.ts`)

Mirror `codex` / `opencode` blocks:

- Registers `antigravity-cli` `ToolDefinition`
- Uses `mcpServers` rootKey, **no** `configFormat: "toml"`
- Declares `darwin`, `linux`, `wsl`, `win32`
- Every platform uses `mcpMode: "direct"`
- Does NOT declare `template`, `agents`, `commands`, `workflows`
- Resolves config/skills under `~/.gemini/antigravity-cli/`
- `detect` returns true when `mcp_config.json` exists (temp dir, no `agy` required)

### Install smoke (`antigravity-cli-install-smoke.test.ts`)

Composed primitives pattern (NOT `run()`):

1. `getToolByName("antigravity-cli")` + temp-homedir `PlatformContext`
2. `mergeConfig(configPath, "mcpServers", entry)` — assert `kanon-mcp` key, object form
3. `installSkills` / `removeSkills` — 3 product skills
4. **Leakage assertions** — walk temp HOME; forbid `settings.json`, `GEMINI.md`, `keybindings.json` writes
5. `removeConfig` — idempotent remove; other MCP servers preserved
6. Re-install idempotency

### Leakage guard (`leakage-guard.test.ts`)

New `describe("antigravity-cli — personal-config leakage guard")`:

- Config path must not end with `settings.json` or `GEMINI.md`
- No `template`, `agents`, `commands`, `workflows` on any platform
- Optional: assert skills path is under `antigravity-cli/skills`, not `antigravity/skills`

### Regression

- Existing `antigravity` (IDE) G5 tests unchanged
- Full suite: `pnpm --filter @kanon-pm/setup test`

---

## Estimated Scope / Line Budget

| Category | Estimate |
|----------|----------|
| Production LOC | **60–100** (registry const + entry, index help string, docs, onboard skill section) |
| Test LOC | **250–350** (registry G5, smoke, leakage guard) |
| New dependencies | **None** |
| 400-line PR budget risk | **Low** — no TOML adapter; smaller than Codex (KAN-128) |
| Chained PRs | **No** — single PR like OpenCode parity |

### Comparison to KAN-128 (Codex)

| | Codex (KAN-128) | Antigravity CLI (KAN-130) |
|--|-----------------|---------------------------|
| Config adapter | TOML (`smol-toml`, ~150 LOC) | **None** — reuse JSON |
| Registry | `CODEX_PATHS` + `configFormat: "toml"` | `ANTIGRAVITY_CLI_PATHS`, json default |
| Install surface | MCP + skills | MCP + skills |
| Complexity | Medium | **Low** |

---

## Ready for Proposal

**Yes.** Orchestrator should run `sdd-propose` for `antigravity-cli-integration`.

Key takeaways for the user:

1. Antigravity CLI is a **low-complexity sibling to OpenCode** — JSON `mcpServers` reuse means no config adapter work (unlike Codex TOML).
2. **Separate registry entry** `antigravity-cli` is required — IDE paths (`antigravity/`) and CLI paths (`antigravity-cli/`) do not collide, but WSL semantics differ (`wsl-bridge` vs `direct`).
3. Install surface is **MCP + skills only** — no template, agents, workflows; `settings.json` and `GEMINI.md` are leakage risks.
4. Suggested PR scope: registry + tests + docs + onboard skill. No API/MCP package changes.
