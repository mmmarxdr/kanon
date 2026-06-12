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

export const issueStateSchema = z.enum([
  "backlog",
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
  memberId: z.string(),
  username: z.string(),
  isAgent: z.boolean(),
  startedAt: z.string(),
  source: z.string(),
});
export type ActiveWorker = z.infer<typeof activeWorkerSchema>;

// ─── Issue ───────────────────────────────────────────────────────────────────

/**
 * Base issue shape matching GET /api/projects/:key/issues response items.
 * Children are recursively typed (lazy ref).
 */
export const issueSchema: z.ZodType<Issue> = z.lazy(() =>
  z.object({
    id: z.string(),
    key: z.string(),
    title: z.string(),
    description: z.string().optional(),
    type: issueTypeSchema,
    priority: issuePrioritySchema,
    state: issueStateSchema,
    labels: z.array(z.string()),
    assigneeId: z.string().optional(),
    assignee: z.object({ username: z.string() }).optional(),
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
 */
export const issueDetailSchema = issueSchema.and(
  z.object({
    assignee: z
      .object({ id: z.string(), username: z.string(), email: z.string() })
      .optional(),
    project: z.object({ id: z.string(), key: z.string(), name: z.string() }),
    children: z.array(issueSchema).optional(),
    blocks: z.array(issueDependencyEdgeSchema).optional(),
    blockedBy: z.array(issueDependencyEdgeSchema).optional(),
    cycle: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
    subscribed: z.boolean().optional(),
  }),
);
export type IssueDetail = z.infer<typeof issueDetailSchema>;

// ─── Array schemas ────────────────────────────────────────────────────────────

export const issueListSchema = z.array(issueSchema);
export const groupSummaryListSchema = z.array(groupSummarySchema);
