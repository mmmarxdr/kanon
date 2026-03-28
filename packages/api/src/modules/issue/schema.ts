import { z } from "zod";
import {
  ISSUE_TYPES,
  ISSUE_PRIORITIES,
  ISSUE_STATES,
} from "../../shared/constants.js";

/**
 * Create issue request body.
 */
export const CreateIssueBody = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Title must be at most 200 characters"),
  description: z.string().max(50000).optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  assigneeId: z.string().uuid().optional(),
  sprintId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  labels: z.array(z.string()).default([]),
  dueDate: z.string().datetime().optional(),
  groupKey: z.string().max(200).optional(),
  templateKey: z.string().optional(),
});
export type CreateIssueBody = z.infer<typeof CreateIssueBody>;

/**
 * Update issue request body.
 */
export const UpdateIssueBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(50000).nullable().optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  groupKey: z.string().max(200).nullable().optional(),
  roadmapItemId: z.string().uuid().nullable().optional(),
});
export type UpdateIssueBody = z.infer<typeof UpdateIssueBody>;

/**
 * Transition issue state body.
 */
export const TransitionBody = z.object({
  to_state: z.enum(ISSUE_STATES),
});
export type TransitionBody = z.infer<typeof TransitionBody>;

/**
 * Project key param.
 */
export const ProjectKeyParam = z.object({
  key: z.string(),
});

/**
 * Issue key param.
 */
export const IssueKeyParam = z.object({
  key: z.string(),
});

/**
 * Issue list query filters.
 *
 * NOTE: Query params use snake_case (assignee_id, sprint_id) to follow
 * URL convention, while Prisma model fields use camelCase (assigneeId,
 * sprintId). The mapping happens in issue/service.ts listIssues(), e.g.:
 *   if (filters.assignee_id) where.assigneeId = filters.assignee_id;
 */
export const IssueFilterQuery = z.object({
  state: z.enum(ISSUE_STATES).optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  assignee_id: z.string().uuid().optional(),
  sprint_id: z.string().uuid().optional(),
  label: z.string().optional(),
  parent_only: z.coerce.boolean().optional(),
  group_key: z.string().optional(),
});
export type IssueFilterQuery = z.infer<typeof IssueFilterQuery>;

/**
 * Group key param (URL-encoded group key in path).
 */
export const GroupKeyParam = z.object({
  key: z.string(),
  groupKey: z.string(),
});

/**
 * Batch transition body for transitioning all issues in a group.
 */
export const BatchTransitionBody = z.object({
  to_state: z.enum(ISSUE_STATES),
});
export type BatchTransitionBody = z.infer<typeof BatchTransitionBody>;

/**
 * Group summary response shape (for documentation; actual response is inferred from service).
 */
export const GroupSummaryResponse = z.object({
  groupKey: z.string(),
  count: z.number().int(),
  latestState: z.enum(ISSUE_STATES),
  title: z.string(),
  updatedAt: z.string().datetime(),
});
export type GroupSummaryResponse = z.infer<typeof GroupSummaryResponse>;
