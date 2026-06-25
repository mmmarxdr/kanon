/**
 * Schedule timeline service (KAN-105 PR1, KAN-153, KAN-161).
 *
 * Provides per-project three-plane schedule data (baseline + plan + forecast)
 * for issues in a project, used by the Gantt timeline in PR2.
 *
 * Design decisions:
 * - LEFT-JOIN semantics: issues with no IssueSchedule or IssueForecast row are
 *   still included when returned; their date/numeric fields are null.
 * - Lazy forecast bootstrap (KAN-161): if the project has issues but fewer
 *   IssueForecast rows than issues, a one-time rebuild is triggered before the
 *   read returns. This write-on-read is intentionally limited (suppressSideEffects):
 *   McpProposal creation is skipped, milestone status updates are skipped (flipping
 *   Milestone.status on a GET can fire notifications), and ppm.forecast.updated is
 *   not emitted. ONLY IssueForecast rows are written — the Gantt reads those and
 *   needs them on first load. If the bootstrap throws, the service degrades
 *   gracefully to plan-only (forecast fields will be null this request; the
 *   rebuild succeeds next time).
 * - Decimal convention: no Decimal fields on this response (progress is Int,
 *   slipDays/floatDays are Int). Date → .toISOString() ?? null.
 *
 * KAN-153: Added scoping logic (cycle, date window, default), 1-hop neighbor
 * expansion, hard cap at 250, and envelope response {rows, total, truncated}.
 */

import { prisma } from "../../config/prisma.js";
import { rebuildProjectForecast } from "../forecast/service.js";
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

  // ── 0. Lazy forecast bootstrap (KAN-161) ─────────────────────────────────
  // IssueForecast rows are normally created by a debounced rebuild fired off ~8
  // domain events. A freshly onboarded / seeded project (or one that added issues
  // without triggering a rebuild) has fewer forecast rows than issues, so the Gantt
  // would render plan bars with null forecast/critical/slip. If forecastCount <
  // issueCount we rebuild before reading so every issue gets a row. IssueForecast
  // has 1:1 cardinality per issue, so once forecastCount === issueCount we never
  // rebuild on read again — self-limiting.
  //
  // Concurrency note: two concurrent first-reads could both rebuild; the rebuild is
  // idempotent (inputsHash + createMany skipDuplicates), so the worst case is one
  // redundant recompute, not corruption.
  //
  // suppressSideEffects: McpProposal creation, milestone status updates, and
  // ppm.forecast.updated emission are SKIPPED on this read path. ONLY IssueForecast
  // rows are written — the Gantt reads those directly and needs them on first load.
  //
  // Degrade: if the rebuild throws, log and continue with plan-only data (forecast
  // fields will be null this request; the bootstrap succeeds on the next read).
  //
  // issueCount is reused below in the small-project escape hatch to avoid a
  // second prisma.issue.count call for the same value.
  const [issueCount, forecastCount] = await Promise.all([
    prisma.issue.count({ where: { projectId } }),
    prisma.issueForecast.count({ where: { issue: { projectId } } }),
  ]);
  if (issueCount > 0 && forecastCount < issueCount) {
    try {
      await rebuildProjectForecast(projectId, { suppressSideEffects: true });
    } catch (err) {
      // Degrade gracefully: forecast fields will be null this read; next read retries.
      console.error("[timeline] lazy forecast bootstrap failed — degrading to plan-only", err);
    }
  }

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

    // Small-project escape hatch: if total count <= SMALL_PROJECT_THRESHOLD, return everything.
    // Reuse issueCount from step 0 — no second DB round-trip needed.
    if (issueCount <= SMALL_PROJECT_THRESHOLD) {
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

  // Find all dep edges where source OR target is in-scope. Both queries also
  // constrain the OUT-of-scope end to the same project so a cross-project edge
  // (the schema permits one — the FK is on Issue.id only) can never surface a
  // foreign issue as a neighbor (KAN-162).
  const [outgoingEdges, incomingEdges] = await Promise.all([
    // Edges where a scoped issue is the source; the target stays in-project
    prisma.issueDependency.findMany({
      where: { sourceId: { in: [...scopedIds] }, target: { projectId } },
      select: { sourceId: true, targetId: true },
    }),
    // Edges where a scoped issue is the target; the source stays in-project
    prisma.issueDependency.findMany({
      where: { targetId: { in: [...scopedIds] }, source: { projectId } },
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
