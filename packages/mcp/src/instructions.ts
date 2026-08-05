// ─── MCP Server Instructions — Deferred Tool Declarations ───────────────────
//
// Claude Code (and compatible MCP hosts) read the `instructions` field from the
// MCP `initialize` response. Tools that are rarely needed in hot-path flows are
// declared here so the host can hide them behind a ToolSearch step rather than
// surfacing them eagerly in every turn's context.
//
// The server still registers every tool normally — hosts that ignore
// `instructions` simply surface every tool. No SDK feature detection needed.
// Exact inventory: 49 tools = 26 core + 23 deferred (KAN-193).

/** Exact post-change inventory (KAN-193). Do not re-anchor without design review. */
export const MCP_TOOL_COUNT = 49;
export const MCP_CORE_TOOL_COUNT = 26;
export const MCP_DEFERRED_TOOL_COUNT = 23;
/** Fixed instruction ceiling — unchanged by KAN-193. */
export const INSTRUCTION_CEILING_BYTES = 1950;
/** Fixed topline description ceiling (DESCRIPTION_BASELINE_BYTES − 300). */
export const DESCRIPTION_TOPLINE_CEILING_BYTES = 5350;

/**
 * The 23 admin/rare/PM-gated/occasion-only/resolution-helper/agent-comms/capture/triage tools deferred behind ToolSearch.
 * Canonical list — consumed by index.ts and instructions.test.ts.
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
  "preview_issue_triage",
  "persist_triage_proposal",
  "get_triage_proposal",
  "list_triage_proposals",
  "dismiss_triage_proposal",
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
DESCRIPTION: PM-facing ## Context / ## Acceptance Criteria / ## Notes.
Never include local paths/worktrees/branches, agent/model/session/memory IDs, or commands.
Repo-relative design refs only when useful.
Design records: most issues need none; propose before creating.

Before create_issue: list_groups(projectKey) -> assign groupKey.
If work starts now: list_members -> pass memberId as assigneeId before start_work.
Before update_issue: get_issue first — never overwrite blindly.
start_work sets a missing startDate to today. Never invent dueDate.
Lists: format: compact, limit: 10. Writes: format: ack.
Deferred → roadmap. Done + unconfirmed time → reconcile_time.

## Triage (ToolSearch)

Order: preview/search → get/list → persist/dismiss → retention.
preview_issue_triage prepare (none|host_assisted) → optional validate.
persist needs preview+seal. list_triage_proposals: one projectKey only
(project-only compact; no workspace-wide queue). dismiss needs reason.
Triage non-executable; legacy apply_proposal is not triage execution.

## DEFERRED TOOLS (use ToolSearch when needed)

Retrieve via ToolSearch only when explicitly requested:

- ${DEFERRED_TOOLS.join("\n- ")}

## CORE TOOLS (always available)

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
