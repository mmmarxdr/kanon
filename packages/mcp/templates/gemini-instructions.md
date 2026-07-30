<!-- kanon-mcp-start -->
## Kanon Project Management (installed by pnpm setup:mcp)

Kanon MCP tools (kanon_*) are available for project management.

Available workflows:
- `/kanon-init` — Scan codebase, create project, seed issues and roadmap items
- `/kanon-create-issue` — Create an issue from natural language description

Available skills (auto-loaded when relevant):
- kanon-agent — Issue management, board updates, roadmap capture, cycles, and SDD phase hooks (core + on-demand sections)
- kanon-onboard — Team invites and pinned release onboarding per machine

When creating issues:
- Title format: `[Area] Verb phrase`
- Check available groups first: `kanon_list_groups(projectKey)`
- Assign groupKey when a matching group exists
<!-- kanon-mcp-end -->
