<!-- kanon-mcp-start -->
## Kanon Project Management (installed by pnpm setup:mcp)

Kanon MCP tools (kanon_*) are available for project management.

Available workflows:
- `/kanon-init` — Scan codebase, create project, seed issues and roadmap items
- `/kanon-create-issue` — Create an issue from natural language description

Available skills (auto-loaded when relevant):
- kanon-mcp — Issue management, board updates, state transitions
- kanon-roadmap — Capture deferred work as roadmap items
- kanon-orchestrator-hooks — SDD phase launches

When creating issues:
- Title format: `[Area] Verb phrase`
- Check available groups first: `kanon_list_groups(projectKey)`
- Assign groupKey when a matching group exists
<!-- kanon-mcp-end -->
