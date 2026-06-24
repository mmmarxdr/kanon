/**
 * Shared response schemas for the schedule-timeline endpoint (KAN-105 PR1).
 *
 * Three-plane schedule data per issue:
 *   - Plan plane:     startDate, dueDate, progress (from IssueSchedule)
 *   - Baseline plane: baselineStart, baselineEnd    (from IssueSchedule)
 *   - Forecast plane: forecastStart, forecastEnd, slipDays, critical, floatDays
 *                     (from IssueForecast)
 *
 * Issues with no schedule or forecast row still appear in the response
 * (LEFT-JOIN semantics) — all date/numeric fields are nullable.
 *
 * Decimal convention (inherited from schedule.ts):
 *   No Decimal fields on this response. All numeric fields (progress, slipDays,
 *   floatDays) are plain integers or nullable integers.
 */

import { z } from "zod";

/**
 * KAN-149: a typed dependency edge originating from this row's issue.
 * `targetIssueId` is the successor; `type`/`lagDays` mirror the forecast engine
 * (IssueDependency). Used to draw dependency arrows between Gantt bars.
 */
export const scheduleDepEdgeSchema = z.object({
  targetIssueId: z.string().uuid(),
  type: z.enum(["FS", "SS", "FF", "SF", "blocks"]),
  lagDays: z.number().int(),
});
export type ScheduleDepEdge = z.infer<typeof scheduleDepEdgeSchema>;

/**
 * One row of the schedule-timeline response.
 * Combines identity fields with all three schedule planes.
 */
export const scheduleTimelineRowSchema = z.object({
  // Issue identity
  issueId: z.string().uuid(),
  issueKey: z.string(),
  title: z.string(),
  state: z.string(),
  type: z.string(),

  // Cycle / sprint membership (for the Gantt cycle filter). Defaulted so older
  // payloads (pre-cycle-filter) still parse.
  cycleId: z.string().uuid().nullable().default(null),
  cycleName: z.string().nullable().default(null),

  // Plan plane (IssueSchedule)
  startDate: z.string().datetime().nullable(),
  dueDate: z.string().datetime().nullable(),
  progress: z.number().int().min(0).max(100),

  // Baseline plane (IssueSchedule)
  baselineStart: z.string().datetime().nullable(),
  baselineEnd: z.string().datetime().nullable(),

  // Forecast plane (IssueForecast)
  forecastStart: z.string().datetime().nullable(),
  forecastEnd: z.string().datetime().nullable(),
  slipDays: z.number().int().nullable(),
  critical: z.boolean().nullable(),
  floatDays: z.number().int().nullable(),

  // Dependency edges (KAN-149) — outgoing edges where this issue is the source.
  // Defaulted so older payloads (pre-KAN-149) still parse instead of throwing.
  deps: z.array(scheduleDepEdgeSchema).default([]),
});

export type ScheduleTimelineRow = z.infer<typeof scheduleTimelineRowSchema>;

/**
 * Full response schema: array of timeline rows.
 * Returns [] for a project with no issues.
 */
export const scheduleTimelineResponseSchema = z.array(scheduleTimelineRowSchema);
export type ScheduleTimelineResponse = z.infer<typeof scheduleTimelineResponseSchema>;
