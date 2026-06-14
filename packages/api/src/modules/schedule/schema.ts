import { z } from "zod";

/**
 * Body for PUT /api/issues/:key/schedule — upsert plan fields.
 * All fields optional: callers may update any combination.
 */
export const UpsertPlanBody = z.object({
  startDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  /** 0-100 integer representing completion percentage. */
  progress: z.number().int().min(0).max(100).optional(),
});
export type UpsertPlanBody = z.infer<typeof UpsertPlanBody>;

/**
 * Body for POST /api/issues/:key/estimate — revise estimate.
 * hours accepts a non-negative decimal string with up to 2 decimal places.
 * This regex mirrors the Decimal(8,2) precision constraint.
 */
export const ReviseEstimateBody = z.object({
  hours: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "hours must be a non-negative decimal with up to 2 decimal places"),
  reason: z.string().max(500).optional(),
});
export type ReviseEstimateBody = z.infer<typeof ReviseEstimateBody>;

/** URL param for issue-key routes. */
export const IssueKeyParam = z.object({
  key: z.string(),
});
export type IssueKeyParam = z.infer<typeof IssueKeyParam>;
