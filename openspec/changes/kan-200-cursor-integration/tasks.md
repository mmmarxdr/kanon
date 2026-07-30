# Tasks: Cursor Full-Fidelity Integration (KAN-200)

## Phase 0: Confirm Baseline

- [x] Audit current source, local Cursor IDE/CLI config, and installed runtimes.
- [x] Verify the earlier Cursor implementation was never committed.
- [x] Compare current public Cursor MCP, hooks, permissions, skills, rules,
  subagents, and Cloud capabilities.
- [ ] Reconfirm exact hook config paths and JSON schema against the Cursor
  version used for manual acceptance.

## PR 1: Setup and Runtime Parity

- [x] Add a failing test showing invite onboarding installs only MCP.
- [x] Route onboarding and explicit setup through one per-tool install function.
- [x] Add Cursor registry/path contracts for Linux, macOS, WSL IDE, and WSL CLI.
- [x] Install both WSL Cursor targets without duplicate user-facing tool names.
- [x] Fail closed on malformed existing MCP config.
- [x] Keep format-specific config handling in the onboarding path.
- [x] Emit `KANON_CLIENT_IDENTITY=cursor` and workspace identity in both modes.
- [x] Render current Cursor agent frontmatter; preserve other host output.
- [x] Restrict agent cleanup to exact product-owned files.
- [x] Stop silently adding broad Cursor MCP allowlist entries.
- [x] Correct stale tool names, schemas, states, and cycle dispositions in assets.
- [x] Add source/tarball/installed list-tools parity check.
- [x] Add a real packaged onboarding smoke test.
- [x] Update Cursor and native Windows support documentation.
- [x] Add a pinned native Windows PowerShell installer for the same tarball.
- [x] Protect win32 credentials with a tested current-user ACL.
- [x] Gate releases on matching MCP/setup versions, tests, builds, and parity.
- [x] Pin resolved native Windows `node.exe` and `tar.exe` paths before use.
- [x] Repair same-version Unix installs missing setup, MCP, or wrapper runtime.
- [x] Serialize releases by version and roll back only tag/release resources
  created by the current workflow run.
- [x] Run `pnpm --filter @kanon-pm/setup test`.
- [x] Run `pnpm --filter @kanon/mcp test`.
- [ ] Verify Cursor IDE and Cursor CLI expose the same current tools after restart.

## PR 2: Local Work Lifecycle

- [ ] Specify an idempotent API lease keyed by Cursor `conversation_id`.
- [ ] Test duplicate start/end events and two conversations on one issue.
- [ ] Add a small hook bridge that reads JSON from stdin and exits quickly.
- [ ] Resolve issue key only from explicit config or branch naming.
- [ ] Add debounced activity heartbeat.
- [ ] Keep `stop` unmapped to `kanon_stop_work`.
- [ ] Keep child subagent events attached to the parent lease.
- [ ] Test crash recovery and missing `sessionEnd` through server TTL.
- [ ] Make hook installation opt-in and removal idempotent.
- [ ] Add manual IDE and CLI lifecycle verification.

## Later: Cloud Agents

- [ ] Decide whether Cursor's beta Cloud Agents API is an acceptable dependency.
- [ ] Design Streamable HTTP MCP auth and Team MCP distribution.
- [ ] Verify Cloud-specific hook support and terminal run states.
- [ ] Create a separate issue and SDD before implementation.

## Explicitly Skipped

- [ ] No custom tool deferral layer; Cursor already provides it.
- [ ] No custom modes integration.
- [ ] No duplicate slash commands for existing skills.
- [ ] No MCP resources/prompts/Apps until a product workflow requires them.
- [ ] No broad `kanon_*` autoapproval.
