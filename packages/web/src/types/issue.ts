import type { IssueState } from "@/stores/board-store";
import type { DocumentKind } from "@kanon/shared";

export type IssueType = "feature" | "bug" | "task" | "spike" | "incident";
export type IssuePriority = "critical" | "high" | "medium" | "low";

/**
 * Issue shape matching the API response from
 * GET /api/projects/:key/issues
 *
 * Nullability notes (aligned to real API contract, KAN-91 fix):
 *  - description: nullable — Prisma returns null for unset text fields
 *  - assigneeId:  nullable — null when no assignee is set
 *  - assignee:    nullable — the included relation object is null when assigneeId is null
 */
export interface Issue {
  id: string;
  key: string;
  title: string;
  description?: string | null;
  type: IssueType;
  priority: IssuePriority;
  state: IssueState;
  labels: string[];
  assigneeId?: string | null;
  assignee?: { username: string } | null;
  parentId?: string | null;
  groupKey?: string | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  children?: Issue[];
  activeWorkers?: ActiveWorker[];
  /** Distinct document kinds attached to this issue (from server, KAN-111). */
  documentKinds?: DocumentKind[];
}

/**
 * Active worker on an issue, returned by the API in issue responses.
 */
export interface ActiveWorker {
  userId: string;
  memberId: string;
  username: string;
  isAgent: boolean;
  startedAt: string;
  /** Source of the work session: web | mcp | claude-code | cursor | etc. */
  source: string;
}

/**
 * Slim child-issue shape returned inside GET /api/issues/:key.
 *
 * The detail endpoint selects children with only { id, key, title, state, labels }
 * (not the full issue shape). Matches childIssueSummarySchema in @kanon/shared.
 */
export interface ChildIssueSummary {
  id: string;
  key: string;
  title: string;
  state: IssueState;
  labels: string[];
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
  type: "blocks" | "FS" | "SS" | "FF" | "SF";
  lagDays?: number;
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
 *
 * Nullability notes (KAN-91 fix):
 *  - assignee: nullable — also null when unassigned on the detail endpoint.
 *    The email is nested under `user` to match Prisma's include select shape
 *    ({ id, username, user: { email } }).
 *  - children: ChildIssueSummary[] — detail endpoint selects a slim shape,
 *    not the full Issue shape.
 */
export interface IssueDetail extends Omit<Issue, "children" | "assignee"> {
  assignee?: { id: string; username: string; user: { email: string } } | null;
  project: { id: string; key: string; name: string };
  children?: ChildIssueSummary[];
  blocks?: IssueDependencyEdge[];
  blockedBy?: IssueDependencyEdge[];
  /** Cycle this issue is attached to. Null when unassigned. */
  cycle?: { id: string; name: string } | null;
  /**
   * Whether the currently-authenticated member is subscribed to this issue.
   * Populated by GET /api/issues/:key (per-member, computed server-side).
   * Optional for backward compat with cached data from before KAN-38.
   */
  subscribed?: boolean;
}

export type CommentSource = "human" | "mcp" | "engram_sync" | "system" | "adr";
export type RemoteActor = { provider: string; displayName: string };

// Re-export DocumentKind from shared so file-local usage is consistent.
export type { DocumentKind };

/**
 * Design record attached to an issue.
 * Returned by GET /api/issues/:key/documents.
 */
export interface IssueDocument {
  id: string;
  kind: DocumentKind;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  issueId: string;
  author?: { id: string; username: string };
}

/**
 * Comment on an issue, returned by GET /api/issues/:key/comments.
 */
export interface Comment {
  id: string;
  body: string;
  source: CommentSource;
  author: { id: string; username: string } | null;
  remoteAuthor?: RemoteActor | null;
  /** Provenance: tool that created this comment. Null for pre-KAN-30 rows. */
  via: string | null;
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
  /** Provenance: tool that created this activity. Null for pre-KAN-30 rows. */
  via: string | null;
  actor: { id: string; username: string } | null;
  remoteActor?: RemoteActor | null;
  createdAt: string;
}
