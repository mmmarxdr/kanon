// ─── MCP Server Instructions — Deferred Tool Declarations ───────────────────
//
// Claude Code (and compatible MCP hosts) read the `instructions` field from the
// MCP `initialize` response. Tools that are rarely needed in hot-path flows are
// declared here so the host can hide them behind a ToolSearch step rather than
// surfacing them eagerly in every turn's context.
//
// The server still registers every tool normally — hosts that ignore
// `instructions` simply surface every tool. No SDK feature detection needed.
// See design ADR-1 and ADR-2 for rationale.
// 5 admin/rare tools + 3 document tools (rare-path, design-coherent)
// + 2 PM-only timesheet tools (approve/reject)
// + 3 occasion-only tools (add/remove dependency, adjust time entry)
// + 1 resolution helper (list_members)
// + 1 agent communication tool (create_issue_comment)
// + 3 capture tools (report_incident, propose_estimate, apply_proposal) = 18 deferred.

/**
 * The 18 admin/rare/PM-gated/occasion-only/resolution-helper/agent-comms/capture tools deferred behind ToolSearch.
 * Canonical list — consumed by index.ts and instructions.test.ts.
 * Document tools are deferred: most issues need none; propose before creating.
 * Timesheet approve/reject are PM-only — keep dev-agent context lean.
 * Dependency and adjust tools are occasion-only — not part of daily board flow.
 * list_members is a resolution helper (assigneeId lookup, activity id→name) — not daily board flow.
 * create_issue_comment is agent communication — occasional, not daily board flow.
 * Capture tools are occasion-only: incident reporting and estimation proposals.
 */
export const DEFERRED_TOOLS = [
  "create_project",
  "update_project",
  "delete_cycle",
  "delete_roadmap_item",
  "list_active_workers",
  "create_design_record",
  "list_design_records",
  "get_design_record",
  "approve_time_entry",
  "reject_time_entry",
  "add_dependency",
  "remove_dependency",
  "adjust_time_entry",
  "list_members",
  "create_issue_comment",
  "report_incident",
  "propose_estimate",
  "apply_proposal",
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

Before create_issue: list_groups(projectKey) -> assign groupKey.
Before update_issue: get_issue first — never overwrite blindly.
Lists: format: compact, limit: 10. Writes: format: ack.
Deferred work (later/someday) -> roadmap, not backlog.
Done blocked by unconfirmed time -> reconcile_time, then retry.

## DEFERRED TOOLS (use ToolSearch when needed)

Retrieve via ToolSearch only when explicitly requested:

- ${DEFERRED_TOOLS.join("\n- ")}

## CORE TOOLS (always available)

Standard issue and project management flows use these tools:
list_issues, get_issue, create_issue, update_issue,
transition_issue, transition_issues, list_groups,
start_work, stop_work,
list_workspaces, list_projects, get_project,
list_roadmap, create_roadmap_item, update_roadmap_item,
promote_roadmap_item,
list_cycles, get_cycle,
create_cycle, update_cycle_scope, close_cycle,
list_my_worklogs, promote_worklog, update_time_entry,
submit_time_entry, reconcile_time
`.trim();
