# Research: Cursor Integration Audit (KAN-200)

## Status

Date: 2026-07-30

This audit compares the current Kanon source, the locally installed Cursor
surfaces, and Cursor's current public documentation. The earlier untracked
`cursor-full-integration` change is evidence only; none of it is shipped.

## Current Baseline

| Surface | Observed state |
|---|---|
| Kanon source | 44 MCP tools |
| Local ignored `packages/mcp/dist` | 40 MCP tools and older heartbeat behavior |
| Cursor CLI in WSL | Installed Kanon 0.6.3 with 33 cached tools |
| Cursor IDE on Windows via WSL | Points at the checkout's stale `dist` |
| Git branch | No committed Cursor full-integration implementation |

The previous change marked setup tasks and verification as complete, but its
production edits are absent. Only partial tests, `cli-config.ts`, and OpenSpec
artifacts remain untracked in the original checkout.

## Current Kanon Flow

1. `onboardFromLink()` exchanges the invite and writes credentials.
2. Its default writer detects tools and installs only the MCP entry.
3. A later `kanon-setup --tool cursor -y` run is required to install skills,
   the agent, and the Cursor rule.
4. On WSL, the registry targets the Windows Cursor home only. Cursor CLI inside
   WSL reads a separate Linux home and is not configured by that run.
5. The installed `kanon` agent is copied with Claude-only frontmatter.
6. No Cursor hooks are installed.

## Cursor Capability Matrix

| Capability | Cursor support | Kanon action |
|---|---|---|
| Global MCP config | `~/.cursor/mcp.json` | Correct paths and runtime selection |
| Project MCP config | `.cursor/mcp.json` | Keep manual/project-owned |
| Dynamic tool discovery | Tool names first; schemas loaded on demand | No custom deferral layer |
| Tool approvals | IDE permissions and CLI `Mcp(server:tool)` | Do not autoapprove all Kanon tools |
| MCP tools | IDE, CLI, and Cloud | Verify IDE and CLI first |
| MCP prompts/resources/roots/elicitation | Publicly supported in general | Defer until a concrete workflow needs them |
| MCP Apps | Supported with non-interactive fallback | Defer; tools and web UI already cover current needs |
| Rules | Project, user, team, `AGENTS.md` | Do not claim unsupported global file behavior |
| Skills | Progressive discovery and `/skill-name` | Primary reusable workflow surface |
| Custom agents | Foreground/background, local and Cloud | Install valid Cursor frontmatter |
| Hooks | Session, tools, MCP, shell, compact, stop, subagents | Use only where semantics are deterministic |
| Custom modes | Historical beta; no stable current distribution contract | Do not target |
| Cloud Agents | Remote VM with separate MCP/hook configuration | Separate delivery using HTTP MCP |

## Cursor Hook Semantics

| Event | Useful for Kanon | Important limitation |
|---|---|---|
| `sessionStart` | Bind a preselected issue and start a lease | Fire-and-forget; no initial prompt or issue key |
| `postToolUse` | Activity heartbeat with debounce | Runs often and must be idempotent |
| `sessionEnd` | Best-effort cleanup | Fire-and-forget; not guaranteed on crash |
| `stop` | End of one agent loop | Not the end of a conversation or work session |
| `beforeMCPExecution` | Security policy for an existing call | Cannot originate an MCP call |
| `subagentStart` / `subagentStop` | Preserve parent activity | Must not create independent work sessions |
| `preCompact` | Persist or restore concise issue context | Not a work lifecycle boundary |

Cursor does not document a hook response that invokes an MCP tool. Reliable
automation must call a Kanon API/helper directly or remain best effort through
model instructions.

## Findings

### P0

1. The claimed Cursor implementation is not committed or released.
2. Invite onboarding installs MCP only, not the full product surface.
3. WSL needs two targets: Windows IDE through `wsl`, and Cursor CLI directly
   inside WSL.
4. Runtime artifacts drift between source, `dist`, and installed releases.
5. Native Windows needs a release-pinned PowerShell installer and a credential
   ACL because POSIX modes do not protect refresh tokens on win32.
6. Work sessions opened by issue transitions do not register local MCP
   heartbeat state.

### P1

1. Cursor receives Claude-only agent frontmatter.
2. The previous permission proposal used a broad wildcard and obsolete syntax.
3. `KANON_CLIENT_IDENTITY=cursor` is never set, and WSL bridge drops workspace
   identity.
4. Invalid JSON is treated as an empty config and may overwrite other servers.
5. The onboarding writer bypasses format-specific MCP installation, which can
   corrupt non-JSON tool configs such as Codex TOML.
6. Installed skills, commands, and agent text contain obsolete tool contracts.

### P2

1. The global Cursor rule path is not a reliable substitute for project rules
   or User Rules managed by Cursor.
2. No Cursor hooks, subagent lifecycle integration, or Cloud MCP path exists.
3. Setup cleanup removes any `kanon*.md` agent, including user-owned files.

## No-Code Conclusions

- Cursor already performs MCP schema/tool description deferral. Kanon only
  needs accurate, concise tool metadata.
- Skills are the stable workflow surface; new slash commands are unnecessary.
- Custom modes are not a distribution target.
- Rules and skills can encourage `kanon_start_work`, but cannot guarantee it.
- Autoapproving every `kanon_*` tool is unsafe because the server includes
  destructive and approval operations.

## Official References

- MCP: https://cursor.com/docs/mcp
- Dynamic context discovery: https://cursor.com/blog/dynamic-context-discovery
- Hooks: https://cursor.com/docs/hooks
- Permissions: https://cursor.com/docs/reference/permissions
- CLI permissions: https://cursor.com/docs/cli/reference/permissions
- Skills: https://cursor.com/docs/skills
- Rules: https://cursor.com/docs/rules
- Subagents: https://cursor.com/docs/subagents
- Cloud Agents: https://cursor.com/docs/cloud-agent
- Cloud Agents API: https://cursor.com/docs/cloud-agent/api/endpoints
