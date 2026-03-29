// ─── Standalone Zod Schemas for MCP Tool Inputs ─────────────────────────────
// These are intentionally independent of @prisma/client to avoid coupling.

import { z } from "zod";

// ─── Constants ──────────────────────────────────────────────────────────────

export const ISSUE_TYPES = ["feature", "bug", "task", "spike"] as const;
export const ISSUE_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const ISSUE_STATES = [
  "backlog",
  "explore",
  "propose",
  "design",
  "spec",
  "tasks",
  "apply",
  "verify",
  "archived",
] as const;

export const HORIZONS = ["now", "next", "later", "someday"] as const;
export const ROADMAP_STATUSES = ["idea", "planned", "in_progress", "done"] as const;

// ─── Shared Optional Params ─────────────────────────────────────────────────

export const FormatParam = z.enum(["slim", "full", "compact"]).default("slim")
  .describe("Response format: slim (default, fewer tokens), full (raw API response), or compact (markdown table)");

export const ListFormatParam = z.enum(["slim", "full", "compact"]).default("compact")
  .describe("Response format for lists: compact (default, markdown table), slim (JSON), or full (raw API response)");

export const LimitParam = z.number().int().min(1).max(100).default(20)
  .describe("Max items to return (default 20, max 100)");

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
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
  format: FormatParam.optional(),
});

/** kanon_list_issues */
export const ListIssuesInput = z.object({
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
  state: z.enum(ISSUE_STATES).optional().describe("Filter by issue state"),
  type: z.enum(ISSUE_TYPES).optional().describe("Filter by issue type"),
  priority: z.enum(ISSUE_PRIORITIES).optional().describe("Filter by priority"),
  assigneeId: z.string().optional().describe("Filter by assignee ID"),
  sprintId: z.string().optional().describe("Filter by sprint ID"),
  label: z.string().optional().describe("Filter by label"),
  groupKey: z.string().optional().describe("Filter by group key"),
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
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
  format: ListFormatParam.optional(),
  limit: LimitParam.optional(),
  offset: OffsetParam.optional(),
});

/** kanon_create_issue */
export const CreateIssueInput = z.object({
  projectKey: z.string().describe("Project key to create the issue in"),
  title: z.string().min(1, "Title must not be empty").describe("Issue title"),
  description: z.string().optional().describe("Issue description (markdown)"),
  type: z.enum(ISSUE_TYPES).optional().describe("Issue type"),
  priority: z.enum(ISSUE_PRIORITIES).optional().describe("Issue priority"),
  labels: z.array(z.string()).optional().describe("Labels to attach"),
  groupKey: z.string().optional().describe("Group key to assign"),
  assigneeId: z.string().optional().describe("Assignee member ID"),
  sprintId: z.string().optional().describe("Sprint ID"),
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
  title: z.string().min(1).optional().describe("New title"),
  description: z.string().nullable().optional().describe("New description"),
  priority: z.enum(ISSUE_PRIORITIES).optional().describe("New priority"),
  labels: z.array(z.string()).optional().describe("New labels"),
  assigneeId: z.string().nullable().optional().describe("New assignee ID"),
  sprintId: z.string().nullable().optional().describe("New sprint ID"),
  dueDate: z.string().nullable().optional().describe("New due date"),
  roadmapItemId: z.string().nullable().optional().describe("Roadmap item ID to link (UUID, null to unlink)"),
  format: FormatParam.optional(),
});

/** kanon_transition_issue */
export const TransitionIssueInput = z.object({
  issueKey: z.string().describe("Issue key (e.g. 'KAN-42')"),
  state: z.enum(ISSUE_STATES).describe("Target state"),
  format: FormatParam.optional(),
});

/** kanon_batch_transition */
export const BatchTransitionInput = z.object({
  projectKey: z.string().describe("Project key"),
  groupKey: z.string().describe("Group key to transition"),
  state: z.enum(ISSUE_STATES).describe("Target state for all issues in group"),
  format: FormatParam.optional(),
});

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
  format: FormatParam.optional(),
});

/** kanon_update_project */
export const UpdateProjectInput = z.object({
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
  name: z.string().min(1).max(100).optional().describe("New name"),
  description: z.string().max(500).nullable().optional().describe("New description"),
  engramNamespace: z.string().max(100).nullable().optional().describe("Engram namespace"),
  format: FormatParam.optional(),
});

// ─── Roadmap Tool Input Schemas ─────────────────────────────────────────────

/** kanon_list_roadmap */
export const ListRoadmapInput = z.object({
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
  horizon: z.enum(HORIZONS).optional().describe("Filter by horizon"),
  status: z.enum(ROADMAP_STATUSES).optional().describe("Filter by roadmap status"),
  label: z.string().optional().describe("Filter by label"),
  format: ListFormatParam.optional(),
  limit: LimitParam.optional(),
  offset: OffsetParam.optional(),
});

/** kanon_create_roadmap_item */
export const CreateRoadmapItemInput = z.object({
  projectKey: z.string().describe("Project key to create the roadmap item in"),
  title: z.string().min(1, "Title must not be empty").describe("Roadmap item title"),
  description: z.string().optional().describe("Item description (markdown)"),
  horizon: z.enum(HORIZONS).optional().describe("Planning horizon (default: later)"),
  status: z.enum(ROADMAP_STATUSES).optional().describe("Initial status (default: idea)"),
  effort: z.number().int().min(1).max(5).optional().describe("Effort estimate (1-5)"),
  impact: z.number().int().min(1).max(5).optional().describe("Impact estimate (1-5)"),
  labels: z.array(z.string()).optional().describe("Labels to attach"),
  sortOrder: z.number().optional().describe("Sort order (float, default 0)"),
  targetDate: z.string().optional().describe("Target date (ISO 8601)"),
  format: FormatParam.optional(),
});

/** kanon_update_roadmap_item */
export const UpdateRoadmapItemInput = z.object({
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
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
  format: FormatParam.optional(),
});

/** kanon_delete_roadmap_item */
export const DeleteRoadmapItemInput = z.object({
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
  itemId: z.string().describe("Roadmap item ID to delete (UUID)"),
});

/** kanon_promote_roadmap_item */
export const PromoteRoadmapItemInput = z.object({
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
  itemId: z.string().describe("Roadmap item ID to promote"),
  title: z.string().optional().describe("Override issue title (defaults to roadmap item title)"),
  type: z.enum(ISSUE_TYPES).optional().describe("Issue type (default: task)"),
  priority: z.enum(ISSUE_PRIORITIES).optional().describe("Issue priority"),
  labels: z.array(z.string()).optional().describe("Issue labels"),
  groupKey: z.string().optional().describe("Group key to assign"),
});

// ─── Dependency Tool Input Schemas ──────────────────────────────────────────

export const DEPENDENCY_TYPES = ["blocks"] as const;

/** kanon_add_dependency */
export const AddDependencyInput = z.object({
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
  sourceItemId: z.string().describe("Source roadmap item ID (the item that blocks)"),
  targetItemId: z.string().describe("Target roadmap item ID (the item being blocked)"),
  type: z.enum(DEPENDENCY_TYPES).optional().describe("Dependency type (default: blocks)"),
});

/** kanon_remove_dependency */
export const RemoveDependencyInput = z.object({
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
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
  format: FormatParam.optional(),
});
