/**
 * Schedule timeline service (KAN-105 PR1, KAN-153).
 *
 * Provides per-project three-plane schedule data (baseline + plan + forecast)
 * for issues in a project, used by the Gantt timeline in PR2.
 *
 * Design decisions:
 * - LEFT-JOIN semantics: issues with no IssueSchedule or IssueForecast row are
 *   still included when returned; their date/numeric fields are null.
 * - Read-only, no mutations, no events.
 * - Decimal convention: no Decimal fields on this response (progress is Int,
 *   slipDays/floatDays are Int). Date → .toISOString() ?? null.
 *
 * KAN-153: Added scoping logic (cycle, date window, default), 1-hop neighbor
 * expansion, hard cap at 250, and envelope response {rows, total, truncated}.
 */

import { prisma } from "../../config/prisma.js";
import type {
  ScheduleTimelineRow,
  ScheduleDepEdge,
  ScheduleTimelineQuery,
  ScheduleTimelineResponse,
} from "@kanon/shared";

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

interface DepSlice {
  targetId: string;
  type: ScheduleDepEdge["type"];
  lagDays: number;
}

interface IssueWithRelations {
  id: string;
  key: string;
  title: string;
  state: string;
  type: string;
  cycleId?: string | null;
  cycle?: { name: string } | null;
  schedule: ScheduleSlice | null;
  forecast: ForecastSlice | null;
  /** Outgoing dependency edges (this issue is the source). Optional for unit tests. */
  blocks?: DepSlice[];
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
 *
 * KAN-153: isNeighbor param (default false) marks cross-boundary dependency rows.
 */
export function serializeTimelineRow(
  issue: IssueWithRelations,
  isNeighbor = false,
): ScheduleTimelineRow {
  const s = issue.schedule;
  const f = issue.forecast;

  return {
    issueId: issue.id,
    issueKey: issue.key,
    title: issue.title,
    state: issue.state,
    type: issue.type,

    // Cycle / sprint membership
    cycleId: issue.cycleId ?? null,
    cycleName: issue.cycle?.name ?? null,

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

    // Dependency edges (KAN-149)
    deps: (issue.blocks ?? []).map((d) => ({
      targetIssueId: d.targetId,
      type: d.type,
      lagDays: d.lagDays,
    })),

    // KAN-153: neighbor flag
    isNeighbor,
  };
}

// ── Internal select shape ─────────────────────────────────────────────────

const ISSUE_SELECT = {
  id: true,
  key: true,
  title: true,
  state: true,
  type: true,
  cycleId: true,
  cycle: { select: { name: true } },
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
  // KAN-149: outgoing typed dependency edges for arrow rendering.
  blocks: {
    select: {
      targetId: true,
      type: true,
      lagDays: true,
    },
  },
} as const;

// ── Overlap helper ────────────────────────────────────────────────────────

/**
 * Build a Prisma OR filter that matches issues whose plan span OR forecast span
 * overlaps [windowStart, windowEnd]. Issues with null plan AND null forecast
 * dates do NOT match (they require an explicit cycleId or small-project path).
 */
function overlapFilter(windowStart: Date, windowEnd: Date) {
  return {
    OR: [
      // Plan span overlaps window: startDate <= windowEnd AND dueDate >= windowStart
      {
        schedule: {
          startDate: { lte: windowEnd },
          dueDate: { gte: windowStart },
        },
      },
      // Forecast span overlaps window: forecastStart <= windowEnd AND forecastEnd >= windowStart
      {
        forecast: {
          forecastStart: { lte: windowEnd },
          forecastEnd: { gte: windowStart },
        },
      },
    ],
  };
}

// ── getProjectScheduleTimeline ────────────────────────────────────────────

const CAP = 250;
/** Small projects (≤ this count) return ALL issues on the default path. */
const SMALL_PROJECT_THRESHOLD = 60;

/**
 * Fetch scoped issues for a project and return their three-plane schedule data.
 *
 * KAN-153 scoping contract:
 *   1. cycleId provided → filter by that cycle
 *   2. from/to provided → overlap filter on plan or forecast span
 *   3. Default:
 *      a. Escape hatch: if total project issue count <= SMALL_PROJECT_THRESHOLD (60) → return ALL issues
 *      b. If project has an active cycle → use that cycle
 *      c. Else → date window [today-14d, today+42d] with overlap filter
 *
 * After scoping: pull 1-hop neighbor issues (dep edges referencing out-of-scope
 * issues in the same project), cap at 250 total, set truncated if needed.
 *
 * total = in-scope count BEFORE neighbor expansion and BEFORE cap.
 * SMALL_PROJECT_THRESHOLD (60) and CAP (250) are intentionally different:
 *   SMALL_PROJECT_THRESHOLD → "return everything" escape hatch for tiny projects
 *   CAP → hard truncation ceiling applied after neighbor expansion
 */
export async function getProjectScheduleTimeline(
  projectId: string,
  query: ScheduleTimelineQuery = { limit: CAP },
): Promise<ScheduleTimelineResponse> {
  const { cycleId, from, to } = query;

  // ── 1. Resolve scoped issue IDs ──────────────────────────────────────────

  let scopedWhere: Record<string, unknown>;

  if (cycleId) {
    // Explicit cycle filter
    scopedWhere = { projectId, cycleId };
  } else if (from || to) {
    // Explicit date window
    const windowStart = from ? new Date(from) : new Date(0);
    const windowEnd = to ? new Date(to) : new Date(8640000000000000);
    scopedWhere = { projectId, ...overlapFilter(windowStart, windowEnd) };
  } else {
    // Default scoping: active cycle or date window, with small-project escape hatch

    // Small-project escape hatch: if total count <= SMALL_PROJECT_THRESHOLD, return everything
    const totalCount = await prisma.issue.count({ where: { projectId } });
    if (totalCount <= SMALL_PROJECT_THRESHOLD) {
      const issues = await prisma.issue.findMany({
        where: { projectId },
        select: ISSUE_SELECT,
        orderBy: { sequenceNum: "asc" },
      });
      return {
        rows: issues.map((i) => serializeTimelineRow(i)),
        total: issues.length,
        truncated: false,
      };
    }

    // Check for active cycle
    const activeCycle = await prisma.cycle.findFirst({
      where: { projectId, state: "active" },
      select: { id: true },
    });

    if (activeCycle) {
      scopedWhere = { projectId, cycleId: activeCycle.id };
    } else {
      // Date window: today-14d … today+42d
      const now = new Date();
      const windowStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + 42 * 24 * 60 * 60 * 1000);
      scopedWhere = { projectId, ...overlapFilter(windowStart, windowEnd) };
    }
  }

  // ── 2. Fetch scoped issues ───────────────────────────────────────────────

  const scopedIssues = await prisma.issue.findMany({
    where: scopedWhere,
    select: ISSUE_SELECT,
    orderBy: { sequenceNum: "asc" },
  });

  const total = scopedIssues.length;
  const scopedIds = new Set(scopedIssues.map((i) => i.id));

  // ── 3. 1-hop neighbor expansion ──────────────────────────────────────────

  // Find all dep edges where source OR target is in-scope
  const [outgoingEdges, incomingEdges] = await Promise.all([
    // Edges where a scoped issue is the source (target may be out-of-scope)
    prisma.issueDependency.findMany({
      where: { sourceId: { in: [...scopedIds] } },
      select: { sourceId: true, targetId: true },
    }),
    // Edges where a scoped issue is the target (source may be out-of-scope)
    prisma.issueDependency.findMany({
      where: { targetId: { in: [...scopedIds] } },
      select: { sourceId: true, targetId: true },
    }),
  ]);

  // Collect neighbor IDs: referenced issues not already in the scoped set
  const neighborIds = new Set<string>();
  for (const edge of [...outgoingEdges, ...incomingEdges]) {
    if (!scopedIds.has(edge.targetId)) neighborIds.add(edge.targetId);
    if (!scopedIds.has(edge.sourceId)) neighborIds.add(edge.sourceId);
  }

  // Fetch neighbors (must be in same project)
  let neighborIssues: (typeof scopedIssues)[number][] = [];
  if (neighborIds.size > 0) {
    neighborIssues = await prisma.issue.findMany({
      where: { projectId, id: { in: [...neighborIds] } },
      select: ISSUE_SELECT,
      orderBy: { sequenceNum: "asc" },
    });
  }

  // ── 4. Cap at 250 (prefer in-scope over neighbors) ───────────────────────

  const allRows: ScheduleTimelineRow[] = [];
  let truncated = false;

  for (const issue of scopedIssues) {
    if (allRows.length >= CAP) {
      truncated = true;
      break;
    }
    allRows.push(serializeTimelineRow(issue, false));
  }

  if (!truncated) {
    for (const issue of neighborIssues) {
      if (allRows.length >= CAP) {
        truncated = true;
        break;
      }
      allRows.push(serializeTimelineRow(issue, true));
    }
  }

  return { rows: allRows, total, truncated };
}
