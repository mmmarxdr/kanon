# Design: Cursor Full-Fidelity Integration (KAN-200)

## Status

Draft, 2026-07-30.

## Decisions

| Area | Decision | Rationale |
|---|---|---|
| Setup flow | Share one per-tool installer between onboarding and explicit setup | Fixes the root cause instead of duplicating missing steps |
| WSL | Install local CLI first; add Windows IDE only when its `.cursor` exists | Avoids phantom Windows configs while keeping both real runtimes aligned |
| MCP runtime | Point generated config at the packaged installed runtime | Avoids stale checkout `dist` and release drift |
| Tool deferral | Use Cursor's native dynamic discovery | No second lazy-loading protocol is needed |
| Agent | Render only documented Cursor fields | Claude frontmatter is not portable |
| Skills | Keep as the primary workflow surface | Cursor loads skills progressively and supports manual invocation |
| Rules | Project rule only through explicit project initialization | Global `.cursor/rules` behavior is not a safe installer contract |
| Permissions | Preserve user policy; do not add `kanon_*` wildcard | Kanon has destructive tools |
| Lifecycle | Activity heartbeat plus server TTL; start/stop require issue ownership | Cursor session events are not exact work boundaries |
| Cloud | Separate HTTP MCP delivery | Local stdio paths and hooks do not move into Cloud VMs |
| Native Windows | PowerShell installs transactionally and credentials use a SID-only protected DACL | Keeps one release/runtime without partial installs or broadly readable refresh tokens |

## Setup Architecture

```text
invite or explicit setup
        |
        v
installToolSurface(tool, platform context, auth/workspace)
        |
        +-- MCP config through format-aware installer
        +-- skills
        +-- custom agent rendered for host
        +-- project rule only when project init requested
        +-- host-specific verification summary
```

`onboardFromLink()` and `run()` must call the same operation. The invite flow
must not call raw JSON `mergeConfig()` directly.

### Cursor Targets

| Host | Config | Invocation |
|---|---|---|
| Linux IDE/CLI | `$HOME/.cursor/mcp.json` | direct |
| macOS IDE/CLI | `$HOME/.cursor/mcp.json` | direct |
| Windows IDE from WSL | `<winHome>/.cursor/mcp.json` | `wsl env ... node wrapper-cli.js` |
| Cursor CLI inside WSL | `$HOME/.cursor/mcp.json` | direct |
| Native Windows IDE/CLI | `%USERPROFILE%/.cursor/mcp.json` | direct |

For WSL, setup can resolve two internal targets without exposing a second tool
name to users. It always processes the local target first and includes the
Windows target only when `<winHome>/.cursor` exists. Wrapper reuse reads the
workspace ID from either target and writes it to both. Generic registry behavior
remains unchanged for other tools.

Native Windows migrates only `mcpServers.kanon-mcp` from the historical
`%APPDATA%/Cursor/User/mcp.json` location. Install and remove also delete only
the exact legacy `~/.cursor/rules/kanon.mdc`; unrelated servers and rules remain.

### Native Windows Release

The tagged release carries `install.sh` for Unix/WSL and `install.ps1` for
native Windows. Both scripts have the same version and tarball SHA-256 stamped
into their tag-only commit, download the same tarball, verify it before
extraction, install under the user's `.kanon/mcp`, and invoke packaged setup.

`install.ps1` protects its work and staging directories before writing content.
It extracts only after hash verification, validates setup, MCP, and wrapper,
then swaps staging into place with an existing-install backup and rollback.
Unstamped scripts accept only an explicit test opt-in with a local non-UNC
`file:` source.

`FileCredentialStore` remains the shared setup/wrapper format on Linux, macOS,
WSL, and Windows. POSIX hosts use mode `0700`/`0600`; Windows removes inherited
and explicit foreign ACEs by replacing the DACL with one full-control rule for
the current user SID. The store invokes the fully-qualified system PowerShell,
protects the directory before secret bytes, protects the temp file before atomic
rename, and preserves the prior credential file on ACL or rename failure.

Release publication has a required `windows-latest` fixture gate and serializes
runs by version. Before installing cleanup traps it fails closed if the remote
tag or release already exists. The traps remove only a tag or release created by
that run, while `--verify-tag` prevents release creation from recreating a tag.

### MCP Entry

The generated Cursor entry must:

- Use explicit `stdio` type if accepted by the current Cursor schema.
- Point to the installed release, not a development checkout.
- Set `KANON_CLIENT_IDENTITY=cursor`.
- Preserve `KANON_WORKSPACE_ID` in direct and WSL bridge modes.
- Preserve unrelated MCP servers.
- Reject malformed existing JSON with an actionable error.

### Cursor Agent

Render a Cursor-specific header from the canonical body:

```yaml
---
name: kanon
description: Project management operations through Kanon
readonly: false
is_background: false
---
```

Omit host-specific model identifiers and `allowed-tools`. Cursor custom agents
inherit MCP tools from their parent; the prompt must not claim hard isolation.

Cleanup must remove only the exact Kanon-owned agent filenames.

## Permissions

Setup must not add `Mcp(kanon-mcp:kanon_*)` automatically. Default Cursor
approval remains intact. Documentation may show narrow opt-in entries for
trusted lifecycle tools, but existing deny rules always win.

## Work Lifecycle

### Local Phase

```text
sessionStart
    +-- resolve explicit issue or branch key
    +-- optional idempotent start/lease

postToolUse / afterMCPExecution / subagent activity
    +-- debounced heartbeat for the parent issue

sessionEnd
    +-- best-effort release only when this conversation owns the lease

missing hook or crash
    +-- server TTL closes effective activity at last heartbeat
```

The hook process must call a Kanon API/helper directly. Returning prompt text
that asks the model to call MCP is not deterministic.

### Required Lease Semantics

Before automatic stop is enabled, the API must distinguish the conversation
that acquired a work lease. Otherwise one of two Cursor conversations could
stop the other's work. The contract must be idempotent on `conversation_id` and
must tolerate duplicate start/end events.

Until that contract exists:

- Explicit `kanon_start_work` remains the start operation.
- Issue transition to review/done remains the reliable stop operation.
- Hooks may heartbeat an already-owned session, but must not stop it.

### Subagents

`subagentStart` and `subagentStop` can refresh parent activity and add optional
diagnostics. They must not create separate Kanon sessions or time entries.

### Cloud Agents

Cloud lacks local editor session boundaries and does not inherit local MCP or
user hooks. A future Cloud design should use Streamable HTTP MCP and terminal
run states. It must not reuse this local hook contract without a separate
verification gate.

## Verification

1. Unit contracts for paths, frontmatter, safe config merge, identity, and WSL
   dual targets.
2. A real onboarding smoke that drives the same function production uses.
3. Tarball smoke that installs to a temporary home and invokes the packaged
   setup/runtime.
4. Runtime handshake/list-tools check with exact source/tarball parity.
5. Native Windows fixture gate covering install, idempotency, and partial-runtime repair.
6. Manual Cursor IDE and CLI checks after restart.
7. Hook tests with duplicate events, concurrent conversations, crash/TTL, and
   subagent activity before automatic lifecycle is enabled.

## Rollout

1. Ship setup/runtime parity for Unix/WSL and native Windows and require a
   Cursor restart.
2. Run manual IDE and CLI acceptance gates on WSL and native Windows.
3. Offer lifecycle hooks as opt-in until lease telemetry proves reliable.
4. Design Cloud integration independently.
