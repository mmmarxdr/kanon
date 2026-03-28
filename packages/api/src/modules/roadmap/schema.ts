import { z } from "zod";
import {
  HORIZONS,
  ISSUE_TYPES,
  ISSUE_PRIORITIES,
  ROADMAP_STATUSES,
  DEPENDENCY_TYPES,
} from "../../shared/constants.js";

/**
 * Create roadmap item request body.
 */
export const CreateRoadmapItemBody = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Title must be at most 200 characters"),
  description: z.string().max(50000).optional(),
  horizon: z.enum(HORIZONS).default("later"),
  status: z.enum(ROADMAP_STATUSES).default("idea"),
  effort: z.number().int().min(1).max(5).optional(),
  impact: z.number().int().min(1).max(5).optional(),
  labels: z.array(z.string()).default([]),
  sortOrder: z.number().default(0),
  targetDate: z.coerce.date().optional(),
});
export type CreateRoadmapItemBody = z.infer<typeof CreateRoadmapItemBody>;

/**
 * Update roadmap item request body.
 */
export const UpdateRoadmapItemBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(50000).nullable().optional(),
  horizon: z.enum(HORIZONS).optional(),
  status: z.enum(ROADMAP_STATUSES).optional(),
  effort: z.number().int().min(1).max(5).nullable().optional(),
  impact: z.number().int().min(1).max(5).nullable().optional(),
  labels: z.array(z.string()).optional(),
  sortOrder: z.number().optional(),
  targetDate: z.coerce.date().nullable().optional(),
});
export type UpdateRoadmapItemBody = z.infer<typeof UpdateRoadmapItemBody>;

/**
 * Roadmap item list query filters.
 *
 * NOTE: Query params use snake_case to follow URL convention.
 */
export const RoadmapFilterQuery = z.object({
  horizon: z.enum(HORIZONS).optional(),
  status: z.enum(ROADMAP_STATUSES).optional(),
  label: z.string().optional(),
});
export type RoadmapFilterQuery = z.infer<typeof RoadmapFilterQuery>;

/**
 * Promote roadmap item to issue body.
 */
export const PromoteBody = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  labels: z.array(z.string()).optional(),
  groupKey: z.string().max(200).optional(),
});
export type PromoteBody = z.infer<typeof PromoteBody>;

/**
 * Project key param.
 */
export const ProjectKeyParam = z.object({
  key: z.string(),
});

/**
 * Roadmap item ID param.
 */
export const RoadmapItemIdParam = z.object({
  key: z.string(),
  id: z.string().uuid(),
});

/**
 * Add dependency request body.
 */
export const AddDependencyBody = z.object({
  targetId: z.string().uuid(),
  type: z.enum(DEPENDENCY_TYPES).default("blocks"),
});
export type AddDependencyBody = z.infer<typeof AddDependencyBody>;

/**
 * Dependency ID param (extends RoadmapItemIdParam with depId).
 */
export const DependencyIdParam = z.object({
  key: z.string(),
  id: z.string().uuid(),
  depId: z.string().uuid(),
});
