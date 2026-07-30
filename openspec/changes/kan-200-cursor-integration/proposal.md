# Proposal: Cursor Full-Fidelity Integration (KAN-200)

## Intent

Make Kanon's documented Cursor support true for Cursor IDE and Cursor CLI,
including WSL, before adding optional lifecycle hooks or Cloud integration.

The installer must produce one current MCP runtime, install the complete
supported Cursor surface in one pass, and never depend on the model for
security-sensitive or time-accounting guarantees.

## Scope

### Slice 1: Installation and Runtime Parity

1. Use one shared installation path from invite onboarding and explicit setup.
2. Install MCP, skills, and the Cursor agent in the same successful run.
3. Resolve WSL as two Cursor targets when present:
   - Windows IDE via WSL bridge and Windows home.
   - Cursor CLI directly via the WSL home.
4. Use `~/.cursor/mcp.json` for supported native Cursor environments.
5. Emit Cursor-valid agent frontmatter while preserving other hosts.
6. Set Cursor client identity and preserve workspace identity through WSL.
7. Fail closed on malformed existing config instead of overwriting it.
8. Verify the packaged runtime, source tool list, and installed runtime agree.
9. Update obsolete Kanon agent/skill contracts encountered by the smoke test.
10. Ship the same pinned release on native Windows through PowerShell and
    protect the shared credential file with a current-user ACL.

### Slice 2: Work Lifecycle Integration

1. Add an opt-in Cursor hook bridge only after issue binding is deterministic.
2. Bind in this order: explicit `KANON_ISSUE_KEY`, then a branch issue key.
3. Use activity hooks for debounced heartbeat.
4. Treat `sessionEnd` as best-effort cleanup, never as the sole source of truth.
5. Keep server TTL and issue-state transitions authoritative.
6. Do not map Cursor `stop` directly to `kanon_stop_work`.
7. Do not let child subagents own independent work sessions.

### Slice 3: Cloud Agents

Define separately after local verification:

1. Streamable HTTP MCP with OAuth or scoped credentials.
2. Team/Cloud MCP configuration distinct from local user config.
3. Run lifecycle tracking through the Cloud Agents API only if its beta
   stability is acceptable.

## Out of Scope

- Reimplementing Cursor's dynamic MCP context discovery.
- Autoapproving all Kanon tools.
- Cursor custom modes.
- New slash commands that duplicate skills.
- MCP resources, prompts, or Apps without a concrete product use case.
- Treating local config as Cloud Agent configuration.

## Success Criteria

- One onboarding command installs the complete supported Cursor surface.
- Cursor IDE and Cursor CLI expose the same current `kanon_*` tool set.
- WSL IDE and WSL CLI configs are both installed and independently tested.
- Existing MCP servers and permission denies survive install/remove.
- Cursor agent frontmatter passes a current contract test.
- No broad Kanon tool wildcard is silently autoapproved.
- Work duration remains correct after crashes and missing `sessionEnd` hooks.
- Source, tarball, and installed runtime parity is checked in CI.
- Tagged GitHub releases provide pinned Unix/WSL and native Windows installers
  for the same tarball.

## Delivery

Use separate reviewable PRs:

1. Setup/runtime parity.
2. Optional local lifecycle hook bridge and API contract.
3. Cloud HTTP MCP, only after an explicit product decision.
