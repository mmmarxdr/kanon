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
  startedAt: string;
  clientType: string;
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

/**
 * Extended issue shape returned by GET /api/issues/:key
 * Includes nested assignee with email and project details.
 */
export interface IssueDetail extends Issue {
  assignee?: { id: string; username: string; email: string };
  project: { id: string; key: string; name: string };
  children?: Issue[];
}

/**
 * Comment on an issue, returned by GET /api/issues/:key/comments.
 */
export interface Comment {
  id: string;
  body: string;
  source: "human" | "agent";
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
