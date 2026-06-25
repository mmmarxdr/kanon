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
    .regex(
      /^\d{1,6}(\.\d{1,2})?$/,
      "hours must be a non-negative decimal with up to 2 decimal places and max 999999.99",
    ),
  reason: z.string().max(500).optional(),
});
export type ReviseEstimateBody = z.infer<typeof ReviseEstimateBody>;

/** URL param for issue-key routes. */
export const IssueKeyParam = z.object({
  key: z.string(),
});
export type IssueKeyParam = z.infer<typeof IssueKeyParam>;

/** URL param for project-key routes (KAN-105 PR1). */
export const ProjectKeyParam = z.object({
  key: z.string(),
});
export type ProjectKeyParam = z.infer<typeof ProjectKeyParam>;

/**
 * Body for PUT /api/projects/:key/schedule-config — KAN-147 (ADR-0007).
 * Sets the project's working-day calendar.
 *   - workDays: non-empty subset of 0..6 (0=Sun..6=Sat). Duplicates rejected.
 *   - holidays: ISO YYYY-MM-DD (UTC) date strings.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "holidays must be YYYY-MM-DD dates")
  .refine(
    // Round-trip check: JS rolls over invalid days (e.g. 2026-02-30 → Mar 2,
    // 2026-06-31 → Jul 1) so !isNaN passes for impossible dates. We parse and
    // re-serialise; if the resulting YYYY-MM-DD differs from the input the date
    // rolled over and must be rejected. Wrap in try/catch: truly invalid dates
    // (e.g. month 13) throw from toISOString() — treat those as invalid too.
    (s) => {
      try {
        return new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s;
      } catch {
        return false;
      }
    },
    "holidays must be valid calendar dates (no rolled-over days)",
  );

export const ScheduleConfigBody = z.object({
  workDays: z
    .array(z.number().int().min(0).max(6))
    .min(1, "workDays must be a non-empty subset of 0..6")
    .refine((d) => new Set(d).size === d.length, "workDays must not contain duplicates"),
  holidays: z.array(isoDate).default([]),
});
export type ScheduleConfigBody = z.infer<typeof ScheduleConfigBody>;
