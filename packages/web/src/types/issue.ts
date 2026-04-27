import type { IssueState } from "@/stores/board-store";

export type IssueType = "feature" | "bug" | "task" | "spike";
export type IssuePriority = "critical" | "high" | "medium" | "low";

/**
 * Issue shape matching the API response from
 * GET /api/projects/:key/issues
 */
export interface Issue {
  id: string;
  key: string;
  title: string;
  description?: string;
  type: IssueType;
  priority: IssuePriority;
  state: IssueState;
  labels: string[];
  assigneeId?: string;
  assignee?: { username: string };
  parentId?: string | null;
  groupKey?: string | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  children?: Issue[];
  activeWorkers?: ActiveWorker[];
}

/**
 * Active worker on an issue, returned by the API in issue responses.
 */
export interface ActiveWorker {
  memberId: string;
  username: string;
  isAgent: boolean;
  startedAt: string;
  /** Source of the work session: web | mcp | claude-code | cursor | etc. */
  source: string;
}

/**
 * Group summary returned by GET /api/projects/:key/issues/groups.
 */
export interface GroupSummary {
  groupKey: string;
  count: number;
  latestState: IssueState;
  title: string;
  updatedAt: string;
}

export interface IssueDependencyEdge {
  id: string;
  type: "blocks";
  createdAt: string;
  source?: { id: string; key: string; title: string; state: IssueState };
  target?: { id: string; key: string; title: string; state: IssueState };
}

/**
 * Extended issue shape returned by GET /api/issues/:key
 * Includes nested assignee with email, project details, and the cycle relation.
 *
 * NOTE: cycleId is available on the base Issue type via Prisma's scalar
 * inclusion. The `cycle` relation object is fetched via include and only
 * present on IssueDetail — do NOT add it to the base Issue interface.
 */
export interface IssueDetail extends Issue {
  assignee?: { id: string; username: string; email: string };
  project: { id: string; key: string; name: string };
  children?: Issue[];
  blocks?: IssueDependencyEdge[];
  blockedBy?: IssueDependencyEdge[];
  /** Cycle this issue is attached to. Null when unassigned. */
  cycle?: { id: string; name: string } | null;
}

export type CommentSource = "human" | "mcp" | "engram_sync" | "system";

/**
 * Comment on an issue, returned by GET /api/issues/:key/comments.
 */
export interface Comment {
  id: string;
  body: string;
  source: CommentSource;
  author: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
}

/**
 * Activity log entry, returned by GET /api/issues/:key/activity.
 */
export interface ActivityLog {
  id: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  actor: { id: string; username: string };
  createdAt: string;
}
