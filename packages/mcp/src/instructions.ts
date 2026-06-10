// ─── MCP Server Instructions — Deferred Tool Declarations ───────────────────
//
// Claude Code (and compatible MCP hosts) read the `instructions` field from the
// MCP `initialize` response. Tools that are rarely needed in hot-path flows are
// declared here so the host can hide them behind a ToolSearch step rather than
// surfacing them eagerly in every turn's context.
//
// The server still registers all 31 tools normally — hosts that ignore
// `instructions` simply surface every tool. No SDK feature detection needed.
// See design ADR-1 and ADR-2 for rationale.
// 5 admin/rare tools + 3 document tools (rare-path, design-coherent) = 8 deferred.

/**
 * The 8 admin/rare tools that should be deferred behind ToolSearch.
 * Canonical list — consumed by index.ts and instructions.test.ts.
 * Document tools are deferred: most issues need none; propose before creating.
 */
export const DEFERRED_TOOLS = [
  "kanon_create_project",
  "kanon_update_project",
  "kanon_delete_cycle",
  "kanon_delete_roadmap_item",
  "kanon_who_is_working",
  "kanon_create_document",
  "kanon_list_documents",
  "kanon_get_document",
] as const;

/**
 * Instructions block passed to `new McpServer({ instructions })`.
 * DEFERRED TOOLS section lists tools the host should hide from eager context;
 * CORE TOOLS section names always-on tools.
 */
export const SERVER_INSTRUCTIONS = `
## PM Persona

Senior PM assistant. Cards readable by new teammates.

TITLE FORMAT (required): [Area] Imperative verb phrase
  Good: [Auth] Fix OAuth redirect | [API] Add rate limiting
  Bad: fix thing | sdd/change/path | KAN-42
DESCRIPTION (recommended): ## Context / ## Acceptance Criteria / ## Notes.
Design records: most issues need none; propose before creating.

Before kanon_create_issue: kanon_list_groups(projectKey) -> assign groupKey.
Before kanon_update_issue: kanon_get_issue first — never overwrite blindly.
Lists: format: compact, limit: 10. Writes: format: ack.
Deferred work (later/someday) -> roadmap, not backlog.

## DEFERRED TOOLS (use ToolSearch when needed)

Retrieve via ToolSearch only when explicitly requested:

- ${DEFERRED_TOOLS.join("\n- ")}

## CORE TOOLS (always available)

Standard issue and project management flows use these tools:
kanon_list_issues, kanon_get_issue, kanon_create_issue, kanon_update_issue,
kanon_transition_issue, kanon_batch_transition, kanon_list_groups,
kanon_start_work, kanon_stop_work,
kanon_list_workspaces, kanon_list_projects, kanon_get_project,
kanon_list_roadmap, kanon_create_roadmap_item, kanon_update_roadmap_item,
kanon_promote_roadmap_item, kanon_add_dependency, kanon_remove_dependency,
kanon_list_cycles, kanon_get_cycle,
kanon_create_cycle, kanon_attach_issues_to_cycle, kanon_close_cycle
`.trim();
