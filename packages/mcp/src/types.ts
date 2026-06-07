// ─── Standalone Zod Schemas for MCP Tool Inputs ─────────────────────────────
// These are intentionally independent of @prisma/client to avoid coupling.

import { z } from "zod";

// ─── Constants ──────────────────────────────────────────────────────────────

export const ISSUE_TYPES = ["feature", "bug", "task", "spike"] as const;
export const ISSUE_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const ISSUE_STATES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;

export const HORIZONS = ["now", "next", "later", "someday"] as const;
export const ROADMAP_STATUSES = ["idea", "planned", "in_progress", "done"] as const;

// ─── IssueTitle — shared schema with coaching refine ─────────────────────────

export const TITLE_PATTERN = /^\[.+\] .{3,}/;
export const TITLE_COACHING =
  "Title must follow '[Area] Verb phrase' — e.g. '[Auth] Fix OAuth redirect'. " +
  "Vague titles ('fix thing') or internal paths cost the team time.";
export const IssueTitle = z
  .string()
  .min(1, "Title must not be empty")
  .refine((v) => TITLE_PATTERN.test(v), { message: TITLE_COACHING });

// ─── Shared Optional Params ─────────────────────────────────────────────────

/**
 * Write-tool response tier. Defaults to `ack` at the handler level (minimal
 * `{ ok, id, key }` shape). Pass `slim` for the legacy slim entity view, or
 * `full` for the raw API entity (byte-identical pre-change shape).
 *
 * Consumers compose this on tool input shapes via `WriteFormatField`.
 */
export const FormatEnum = z.enum(["ack", "slim", "full"]);

/**
 * Spread into a write-tool input shape to add `format?: "ack" | "slim" | "full"`.
 * Default is applied in the handler (`input.format ?? "ack"`) — keeping the
 * field optional in zod preserves backward-compatible parsing.
 */
export const WriteFormatField = { format: FormatEnum.optional() };

export const FormatParam = z.enum(["slim", "full", "compact"]).default("slim")
  .describe("Response format: slim (default, fewer tokens), full (raw API response), or compact (markdown table)");

export const ListFormatParam = z.enum(["slim", "full", "compact"]).default("compact")
  .describe("Response format for lists: compact (default, markdown table), slim (JSON), or full (raw API response)");

export const LimitParam = z.number().int().min(1).max(100).default(10)
  .describe("Max items to return (default 10, max 100). Pass limit explicitly for bulk listings.");

export const OffsetParam = z.number().int().min(0).default(0)
  .describe("Number of items to skip for pagination");

// ─── Tool Input Schemas ─────────────────────────────────────────────────────

/** kanon_list_projects */
export const ListProjectsInput = z.object({
  workspaceId: z.string().describe("Workspace ID to list projects for"),
  format: ListFormatParam.optional(),
  limit: LimitParam.optional(),
  offset: OffsetParam.optional(),
});

/** kanon_get_project */
export const GetProjectInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  format: FormatParam.optional(),
});

/** kanon_list_issues */
export const ListIssuesInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  state: z.enum(ISSUE_STATES).optional().describe("Filter by issue state"),
  type: z.enum(ISSUE_TYPES).optional().describe("Filter by issue type"),
  priority: z.enum(ISSUE_PRIORITIES).optional().describe("Filter by priority"),
  assigneeId: z.string().optional().describe("Filter by assignee ID"),
  cycleId: z.string().uuid().optional().describe("Filter by cycle ID"),
  label: z.string().optional().describe("Filter by label"),
  groupKey: z.string().optional().describe("Filter by group key"),
  keys: z.array(z.string()).optional().describe("Fetch specific issues by key (e.g. ['KAN-1','KAN-2'])"),
  format: ListFormatParam.optional(),
  limit: LimitParam.optional(),
  offset: OffsetParam.optional(),
});

/** kanon_get_issue */
export const GetIssueInput = z.object({
  issueKey: z.string().describe("Issue key (e.g. 'KAN-42')"),
  format: FormatParam.optional(),
});

/** kanon_list_groups */
export const ListGroupsInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  format: ListFormatParam.optional(),
  limit: LimitParam.optional(),
  offset: OffsetParam.optional(),
});

/** kanon_create_issue */
export const CreateIssueInput = z.object({
  projectKey: z.string().optional().describe("Project key to create the issue in. Resolved from .kanon if omitted."),
  title: IssueTitle,
  description: z.string().optional().describe("Issue description (markdown)"),
  type: z.enum(ISSUE_TYPES).optional().describe("Issue type"),
  priority: z.enum(ISSUE_PRIORITIES).optional().describe("Issue priority"),
  labels: z.array(z.string()).optional().describe("Labels to attach"),
  groupKey: z.string().optional().describe("Group key to assign"),
  assigneeId: z.string().optional().describe("Assignee member ID"),
  cycleId: z.string().uuid().optional().describe("Cycle ID to attach on create"),
  parentId: z.string().optional().describe("Parent issue ID"),
  dueDate: z.string().optional().describe("Due date (ISO 8601)"),
  template: z
    .enum(["bug-report", "feature-request", "task", "spike"])
    .optional()
    .describe("Issue template key to pre-fill type, priority, labels, and description"),
  format: FormatParam.optional(),
});

/** kanon_update_issue */
export const UpdateIssueInput = z.object({
  issueKey: z.string().describe("Issue key (e.g. 'KAN-42')"),
  title: IssueTitle.optional(),
  description: z.string().nullable().optional().describe("New description"),
  priority: z.enum(ISSUE_PRIORITIES).optional().describe("New priority"),
  labels: z.array(z.string()).optional().describe("New labels"),
  assigneeId: z.string().nullable().optional().describe("New assignee ID"),
  cycleId: z.string().uuid().nullable().optional().describe("Cycle ID to attach (or null to detach)"),
  dueDate: z.string().nullable().optional().describe("New due date"),
  roadmapItemId: z.string().nullable().optional().describe("Roadmap item ID to link (UUID, null to unlink)"),
  ...WriteFormatField,
});

/** kanon_transition_issue */
export const TransitionIssueInput = z.object({
  issueKey: z.string().describe("Issue key (e.g. 'KAN-42')"),
  state: z.enum(ISSUE_STATES).describe("Target state"),
  ...WriteFormatField,
});

/** kanon_batch_transition (raw shape — used for MCP server.tool registration) */
export const BatchTransitionInputShape = z.object({
  projectKey: z.string().optional().describe("Project key. Resolved from .kanon if omitted."),
  groupKey: z.string().optional().describe("Group key to transition (mutually exclusive with keys)"),
  keys: z.array(z.string()).optional().describe("Specific issue keys to transition (mutually exclusive with groupKey)"),
  state: z.enum(ISSUE_STATES).describe("Target state for all issues"),
  ...WriteFormatField,
});

/** kanon_batch_transition (refined — used for runtime safeParse validation) */
export const BatchTransitionInput = BatchTransitionInputShape.refine(
  (d) => Boolean(d.groupKey) !== Boolean(d.keys?.length),
  { message: "Exactly one of groupKey or keys must be provided" },
);

// ─── Workspace Tool Input Schemas ───────────────────────────────────────────

/** kanon_list_workspaces */
export const ListWorkspacesInput = z.object({
  format: ListFormatParam.optional(),
});

// ─── Project Creation / Update Schemas ─────────────────────────────────────

/** kanon_create_project */
export const CreateProjectInput = z.object({
  workspaceId: z.string().uuid().describe("Workspace ID"),
  key: z.string().min(1).max(6).regex(/^[A-Z][A-Z0-9]*$/)
    .describe("Project key (uppercase, 1-6 chars, e.g. 'KAN')"),
  name: z.string().min(1).max(100).describe("Project name"),
  description: z.string().max(500).optional().describe("Project description"),
  ...WriteFormatField,
});

/** kanon_update_project */
export const UpdateProjectInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  name: z.string().min(1).max(100).optional().describe("New name"),
  description: z.string().max(500).nullable().optional().describe("New description"),
  engramNamespace: z.string().max(100).nullable().optional().describe("Engram namespace"),
  ...WriteFormatField,
});

// ─── Roadmap Tool Input Schemas ─────────────────────────────────────────────

/** kanon_list_roadmap */
export const ListRoadmapInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  horizon: z.enum(HORIZONS).optional().describe("Filter by horizon"),
  status: z.enum(ROADMAP_STATUSES).optional().describe("Filter by roadmap status"),
  label: z.string().optional().describe("Filter by label"),
  format: ListFormatParam.optional(),
  limit: LimitParam.optional(),
  offset: OffsetParam.optional(),
});

/** kanon_create_roadmap_item */
export const CreateRoadmapItemInput = z.object({
  projectKey: z.string().optional().describe("Project key to create the roadmap item in. Resolved from .kanon if omitted."),
  title: z.string().min(1, "Title must not be empty").describe("Roadmap item title"),
  description: z.string().optional().describe("Item description (markdown)"),
  horizon: z.enum(HORIZONS).optional().describe("Planning horizon (default: later)"),
  status: z.enum(ROADMAP_STATUSES).optional().describe("Initial status (default: idea)"),
  effort: z.number().int().min(1).max(5).optional().describe("Effort estimate (1-5)"),
  impact: z.number().int().min(1).max(5).optional().describe("Impact estimate (1-5)"),
  labels: z.array(z.string()).optional().describe("Labels to attach"),
  sortOrder: z.number().optional().describe("Sort order (float, default 0)"),
  targetDate: z.string().optional().describe("Target date (ISO 8601)"),
  ...WriteFormatField,
});

/** kanon_update_roadmap_item */
export const UpdateRoadmapItemInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  itemId: z.string().describe("Roadmap item ID (UUID)"),
  title: z.string().min(1).optional().describe("New title"),
  description: z.string().nullable().optional().describe("New description"),
  horizon: z.enum(HORIZONS).optional().describe("New horizon"),
  status: z.enum(ROADMAP_STATUSES).optional().describe("New status"),
  effort: z.number().int().min(1).max(5).nullable().optional().describe("New effort (1-5)"),
  impact: z.number().int().min(1).max(5).nullable().optional().describe("New impact (1-5)"),
  labels: z.array(z.string()).optional().describe("New labels"),
  sortOrder: z.number().optional().describe("New sort order"),
  targetDate: z.string().nullable().optional().describe("New target date (ISO 8601)"),
  ...WriteFormatField,
});

/** kanon_delete_roadmap_item */
export const DeleteRoadmapItemInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  itemId: z.string().describe("Roadmap item ID to delete (UUID)"),
});

/** kanon_promote_roadmap_item */
export const PromoteRoadmapItemInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  itemId: z.string().describe("Roadmap item ID to promote"),
  title: z.string().optional().describe("Override issue title (defaults to roadmap item title)"),
  type: z.enum(ISSUE_TYPES).optional().describe("Issue type (default: task)"),
  priority: z.enum(ISSUE_PRIORITIES).optional().describe("Issue priority"),
  labels: z.array(z.string()).optional().describe("Issue labels"),
  groupKey: z.string().optional().describe("Group key to assign"),
  ...WriteFormatField,
});

// ─── Dependency Tool Input Schemas ──────────────────────────────────────────

export const DEPENDENCY_TYPES = ["blocks"] as const;

/** kanon_add_dependency */
export const AddDependencyInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  sourceItemId: z.string().describe("Source roadmap item ID (the item that blocks)"),
  targetItemId: z.string().describe("Target roadmap item ID (the item being blocked)"),
  type: z.enum(DEPENDENCY_TYPES).optional().describe("Dependency type (default: blocks)"),
  ...WriteFormatField,
});

/** kanon_remove_dependency */
export const RemoveDependencyInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  sourceItemId: z.string().describe("Roadmap item ID that owns the dependency"),
  dependencyId: z.string().describe("Dependency ID to remove (UUID)"),
});

// ─── Context Tool Input Schemas ─────────────────────────────────────────────

/** kanon_get_issue_context */
export const GetIssueContextInput = z.object({
  issueKey: z.string().describe("Issue key (e.g. 'KAN-42')"),
  limit: z.number().int().min(1).max(10).default(5).optional()
    .describe("Max sessions to return (default 5)"),
});

// ─── Comment Tool Input Schemas ─────────────────────────────────────────────

export const COMMENT_SOURCES = ["human", "mcp", "engram_sync", "system"] as const;

/** kanon_sync_observation */
export const SyncObservationInput = z.object({
  issueKey: z.string().describe("Issue key (e.g. 'KAN-42')"),
  title: z.string().min(1).describe("Observation title"),
  content: z.string().min(1).describe("Observation body content"),
  observationType: z.string().optional()
    .describe("Observation type (e.g. 'decision', 'bugfix', 'architecture', 'discovery')"),
  observationId: z.number().int().optional()
    .describe("Engram observation ID — included in comment footer for traceability"),
  topicKey: z.string().optional()
    .describe("Engram topic key (e.g. 'sdd/my-change/design')"),
  ...WriteFormatField,
});

// ─── Cycle Tool Input Schemas ───────────────────────────────────────────────

export const CYCLE_STATES = ["upcoming", "active", "done"] as const;
export const CYCLE_DISPOSITIONS = ["move_to_next", "move_to_backlog", "leave"] as const;

/** kanon_list_cycles */
export const ListCyclesInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  format: ListFormatParam.optional(),
});

/** kanon_get_cycle */
export const GetCycleInput = z.object({
  cycleId: z.string().uuid().describe("Cycle ID (UUID)"),
  includeAllScopeEvents: z.boolean().optional()
    .describe("When true, returns all scope events instead of just the most recent ones"),
  format: FormatParam.optional(),
});

/** kanon_create_cycle */
export const CreateCycleInput = z.object({
  projectKey: z.string().optional().describe("Project key (e.g. 'KAN'). Resolved from .kanon if omitted."),
  name: z.string().min(1).max(200).describe("Cycle name (e.g. 'Sprint 12')"),
  goal: z.string().optional().describe("Cycle goal / one-line objective"),
  startDate: z.string().describe("Start date — accepts YYYY-MM-DD or full ISO datetime"),
  endDate: z.string().describe("End date — accepts YYYY-MM-DD or full ISO datetime"),
  state: z.enum(CYCLE_STATES).optional()
    .describe("Initial state (default 'upcoming'). Setting 'active' demotes any other active cycle."),
  attachIssueKeys: z.array(z.string()).optional()
    .describe("Issue keys to attach to the cycle immediately on creation (e.g. ['KAN-1','KAN-2'])"),
  ...WriteFormatField,
});

/** kanon_attach_issues_to_cycle */
export const AttachIssuesToCycleShape = {
  cycleId: z.string().uuid().describe("Cycle ID (UUID)"),
  add: z.array(z.string()).optional().describe("Issue keys to attach (e.g. ['KAN-12','KAN-13'])"),
  remove: z.array(z.string()).optional().describe("Issue keys to detach"),
  reason: z.string().optional()
    .describe("Reason for the scope change — surfaces in the audit trail"),
  ...WriteFormatField,
};
export const AttachIssuesToCycleInput = z.object(AttachIssuesToCycleShape).refine(
  (d) => (d.add?.length ?? 0) + (d.remove?.length ?? 0) > 0,
  { message: "add or remove must contain at least one issue key" },
);

/** kanon_delete_cycle */
export const DeleteCycleShape = {
  cycleId: z.string().uuid().describe("Cycle ID to delete (UUID)"),
  force: z.boolean().optional()
    .describe("When true, bypasses the non-terminal issue guard. Active cycles are always refused."),
  reason: z.string().min(1).max(500).optional()
    .describe("Reason for deletion — stored in the audit log"),
  ...WriteFormatField,
};

/** kanon_close_cycle (raw shape — refine is applied at the schema level below) */
export const CloseCycleShape = {
  cycleId: z.string().uuid().describe("Cycle ID (UUID)"),
  disposition: z.enum(CYCLE_DISPOSITIONS).describe(
    "What to do with incomplete (non-done) issues: 'move_to_next' (next upcoming cycle), 'move_to_backlog' (detach), 'leave' (keep attached)",
  ),
  projectKey: z.string().optional().describe(
    "Project key (e.g. 'KAN'). Required when disposition='move_to_next' so the next upcoming cycle can be located.",
  ),
  reason: z.string().optional().describe("Reason for the disposition — surfaces in audit trail"),
  ...WriteFormatField,
};
