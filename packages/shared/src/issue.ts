/**
 * Shared Zod schemas for Issue-related API responses.
 *
 * These are the authoritative parse-boundary schemas for:
 *   - GET /api/projects/:key/issues          → issueSchema / Issue
 *   - GET /api/projects/:key/issues/groups   → groupSummarySchema / GroupSummary
 *   - GET /api/issues/:key                   → issueDetailSchema / IssueDetail
 *
 * All types are derived via z.infer<> — no parallel TypeScript interfaces.
 * Web consumers MUST use these schemas at the fetch boundary (fetchApiValidated)
 * so invalid API responses surface a typed ApiValidationError, not a downstream
 * TypeError in render.
 */

import { z } from "zod";

// ─── Enums ──────────────────────────────────────────────────────────────────

// KAN-99 PR1: "analysis" added at index 1 (between backlog and todo).
export const issueStateSchema = z.enum([
  "backlog",
  "analysis",
  "todo",
  "in_progress",
  "review",
  "done",
]);
export type IssueState = z.infer<typeof issueStateSchema>;

export const issueTypeSchema = z.enum(["feature", "bug", "task", "spike"]);
export type IssueType = z.infer<typeof issueTypeSchema>;

export const issuePrioritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
]);
export type IssuePriority = z.infer<typeof issuePrioritySchema>;

// ─── ActiveWorker ────────────────────────────────────────────────────────────

export const activeWorkerSchema = z.object({
  userId: z.string(),
  memberId: z.string(),
  username: z.string(),
  isAgent: z.boolean(),
  startedAt: z.string(),
  source: z.string(),
});
export type ActiveWorker = z.infer<typeof activeWorkerSchema>;

// ─── Issue ───────────────────────────────────────────────────────────────────

/**
 * Slim child-issue shape returned by GET /api/issues/:key.
 *
 * The detail endpoint selects children with only { id, key, title, state, labels }
 * (see packages/api/src/modules/issue/service.ts getIssue). The full issueSchema
 * cannot be reused here because the child select omits type/priority/projectId/
 * createdAt/updatedAt — those fields are required by the base schema.
 */
export const childIssueSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  state: issueStateSchema,
  labels: z.array(z.string()),
});
export type ChildIssueSummary = z.infer<typeof childIssueSummarySchema>;

/**
 * Base issue shape matching GET /api/projects/:key/issues response items.
 * Children are recursively typed (lazy ref).
 *
 * Nullability notes (aligned to the real API contract):
 *  - assigneeId: nullable — Prisma returns null when no assignee is set
 *  - assignee:   nullable — the included relation is null when assigneeId is null
 */
export const issueSchema: z.ZodType<Issue> = z.lazy(() =>
  z.object({
    id: z.string(),
    key: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    type: issueTypeSchema,
    priority: issuePrioritySchema,
    state: issueStateSchema,
    labels: z.array(z.string()),
    assigneeId: z.string().nullable().optional(),
    assignee: z.object({ username: z.string() }).nullable().optional(),
    parentId: z.string().nullable().optional(),
    groupKey: z.string().nullable().optional(),
    projectId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    children: z.array(issueSchema).optional(),
    activeWorkers: z.array(activeWorkerSchema).optional(),
  }),
);

export type Issue = {
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
};

// ─── GroupSummary ─────────────────────────────────────────────────────────────

export const groupSummarySchema = z.object({
  groupKey: z.string(),
  count: z.number().int(),
  latestState: issueStateSchema,
  title: z.string(),
  updatedAt: z.string(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

// ─── IssueDependencyEdge ──────────────────────────────────────────────────────

const issueSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  state: issueStateSchema,
});

export const issueDependencyEdgeSchema = z.object({
  id: z.string(),
  type: z.literal("blocks"),
  createdAt: z.string(),
  source: issueSummarySchema.optional(),
  target: issueSummarySchema.optional(),
});
export type IssueDependencyEdge = z.infer<typeof issueDependencyEdgeSchema>;

// ─── IssueDetail ─────────────────────────────────────────────────────────────

/**
 * Extended issue shape returned by GET /api/issues/:key.
 * Includes nested assignee with email, project details, and cycle relation.
 *
 * Defined as a standalone z.object (not .and() intersection) so that the
 * `children` field can use the slim childIssueSummarySchema without fighting
 * the base issueSchema's full-object children validator inside an intersection.
 *
 * Nullability notes:
 *  - assignee: nullable — detail endpoint returns null when unassigned.
 *    email is nested under user: { email } to match the Prisma include select.
 *  - children: childIssueSummarySchema[] — the detail select returns only
 *    { id, key, title, state, labels }, not the full issue shape.
 *  - cycle: nullable — issue may not belong to a cycle.
 */
export const issueDetailSchema = z.object({
  // ── fields shared with issueSchema ─────────────────────────────────────────
  id: z.string(),
  key: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  type: issueTypeSchema,
  priority: issuePrioritySchema,
  state: issueStateSchema,
  labels: z.array(z.string()),
  assigneeId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  groupKey: z.string().nullable().optional(),
  projectId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  activeWorkers: z.array(activeWorkerSchema).optional(),
  // ── detail-only fields ─────────────────────────────────────────────────────
  assignee: z
    .object({
      id: z.string(),
      username: z.string(),
      user: z.object({ email: z.string() }),
    })
    .nullable()
    .optional(),
  project: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  children: z.array(childIssueSummarySchema).optional(),
  blocks: z.array(issueDependencyEdgeSchema).optional(),
  blockedBy: z.array(issueDependencyEdgeSchema).optional(),
  cycle: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  subscribed: z.boolean().optional(),
});
export type IssueDetail = z.infer<typeof issueDetailSchema>;

// ─── Array schemas ────────────────────────────────────────────────────────────

export const issueListSchema = z.array(issueSchema);
export const groupSummaryListSchema = z.array(groupSummarySchema);
