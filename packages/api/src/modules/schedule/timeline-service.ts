/**
 * Schedule timeline service (KAN-105 PR1).
 *
 * Provides per-project three-plane schedule data (baseline + plan + forecast)
 * for all issues in a project, used by the Gantt timeline in PR2.
 *
 * Design decisions:
 * - LEFT-JOIN semantics: issues with no IssueSchedule or IssueForecast row are
 *   still included; their date/numeric fields are null. Do NOT drop bare issues.
 * - Read-only, no mutations, no events.
 * - Decimal convention: no Decimal fields on this response (progress is Int,
 *   slipDays/floatDays are Int). Date → .toISOString() ?? null.
 */

import { prisma } from "../../config/prisma.js";
import type { ScheduleTimelineRow } from "@kanon/shared";

// ── Types for internal mapping ────────────────────────────────────────────

interface ScheduleSlice {
  startDate: Date | null;
  dueDate: Date | null;
  progress: number;
  baselineStart: Date | null;
  baselineEnd: Date | null;
}

interface ForecastSlice {
  forecastStart: Date | null;
  forecastEnd: Date | null;
  slipDays: number;
  critical: boolean;
  floatDays: number | null;
}

interface IssueWithRelations {
  id: string;
  key: string;
  title: string;
  state: string;
  type: string;
  schedule: ScheduleSlice | null;
  forecast: ForecastSlice | null;
}

// ── Serializer (exported for unit-testing) ────────────────────────────────

/**
 * Map a Prisma issue row (with optional schedule + forecast) to a
 * ScheduleTimelineRow. Pure function, no DB calls.
 *
 * Null-safety contract:
 *  - schedule === null → plan/baseline fields all null, progress = 0
 *  - forecast === null → forecast fields all null
 *  - individual date fields inside schedule/forecast may also be null
 */
export function serializeTimelineRow(issue: IssueWithRelations): ScheduleTimelineRow {
  const s = issue.schedule;
  const f = issue.forecast;

  return {
    issueId: issue.id,
    issueKey: issue.key,
    title: issue.title,
    state: issue.state,
    type: issue.type,

    // Plan plane
    startDate: s?.startDate?.toISOString() ?? null,
    dueDate: s?.dueDate?.toISOString() ?? null,
    progress: s?.progress ?? 0,

    // Baseline plane
    baselineStart: s?.baselineStart?.toISOString() ?? null,
    baselineEnd: s?.baselineEnd?.toISOString() ?? null,

    // Forecast plane — null when no forecast row exists
    forecastStart: f?.forecastStart?.toISOString() ?? null,
    forecastEnd: f?.forecastEnd?.toISOString() ?? null,
    slipDays: f != null ? f.slipDays : null,
    critical: f != null ? f.critical : null,
    floatDays: f != null ? f.floatDays : null,
  };
}

// ── getProjectScheduleTimeline ────────────────────────────────────────────

/**
 * Fetch all issues for a project (by middleware-resolved projectId) and return
 * their three-plane schedule data.
 *
 * The caller must pass the projectId already resolved and authorized by the
 * requireProjectMember/requireProjectRole middleware — no additional project
 * lookup is performed here.
 */
export async function getProjectScheduleTimeline(
  projectId: string,
): Promise<ScheduleTimelineRow[]> {
  const issues = await prisma.issue.findMany({
    where: { projectId },
    select: {
      id: true,
      key: true,
      title: true,
      state: true,
      type: true,
      schedule: {
        select: {
          startDate: true,
          dueDate: true,
          progress: true,
          baselineStart: true,
          baselineEnd: true,
        },
      },
      forecast: {
        select: {
          forecastStart: true,
          forecastEnd: true,
          slipDays: true,
          critical: true,
          floatDays: true,
        },
      },
    },
    orderBy: { sequenceNum: "asc" },
  });

  return issues.map(serializeTimelineRow);
}
