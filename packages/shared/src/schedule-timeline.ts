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
 *
 * KAN-153: Added query schema, envelope response, and isNeighbor flag.
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

  // KAN-153: neighbor flag — true when this issue is outside the scoped set but
  // referenced by an in-scope dependency edge (1-hop only). Defaulted so older
  // payloads (pre-KAN-153) still parse.
  isNeighbor: z.boolean().default(false),
});

export type ScheduleTimelineRow = z.infer<typeof scheduleTimelineRowSchema>;

/**
 * KAN-153: Query parameters for the schedule-timeline endpoint.
 * All fields are optional — omitting all triggers the default scoping logic.
 */
export const scheduleTimelineQuerySchema = z.object({
  cycleId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(250),
});

export type ScheduleTimelineQuery = z.infer<typeof scheduleTimelineQuerySchema>;

/**
 * KAN-153: Full response schema: envelope with rows, total, and truncated flag.
 * Replaces the bare array from KAN-105 PR1.
 *
 * total    = count of in-scope rows BEFORE neighbor expansion and BEFORE cap.
 * truncated = true when the scoped+neighbor set was capped at 250.
 * rows     = up to 250 rows (in-scope + neighbor rows flagged with isNeighbor).
 */
export const scheduleTimelineResponseSchema = z.object({
  rows: z.array(scheduleTimelineRowSchema),
  total: z.number().int(),
  truncated: z.boolean(),
});

export type ScheduleTimelineResponse = z.infer<typeof scheduleTimelineResponseSchema>;
