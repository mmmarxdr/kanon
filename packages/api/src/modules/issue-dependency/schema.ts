import { z } from "zod";

/**
 * URL param carrying an issue key (e.g. "KAN-12").
 */
export const IssueKeyParam = z.object({
  key: z.string(),
});
export type IssueKeyParam = z.infer<typeof IssueKeyParam>;

/**
 * URL param carrying a dependency UUID.
 */
export const DependencyIdParam = z.object({
  id: z.string().uuid(),
});
export type DependencyIdParam = z.infer<typeof DependencyIdParam>;

/**
 * Body for POST /api/issues/:key/dependencies.
 * type: all 5 scheduling dependency types; defaults to "blocks".
 * lagDays: non-negative integer offset in days; defaults to 0.
 */
export const CreateDependencyBody = z.object({
  /** Issue key that this issue should block (the target). */
  targetKey: z.string(),
  type: z.enum(["blocks", "FS", "SS", "FF", "SF"]).default("blocks"),
  /** Scheduling lag in days. Must be >= 0. Defaults to 0. */
  lagDays: z.number().int().min(0).default(0),
});
export type CreateDependencyBody = z.infer<typeof CreateDependencyBody>;
