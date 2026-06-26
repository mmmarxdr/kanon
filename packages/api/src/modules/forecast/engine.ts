import type {
  ForecastNode,
  ForecastEdge,
  ForecastGraphInput,
  ForecastResult,
  IssueForecastEntry,
  MilestoneRollup,
  IssueSlip,
} from "./types.js";

// ─── Private helpers ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * KAN-147 (ADR-0007): a working-day calendar injected into the engine.
 * The engine stays pure — the calendar is a parameter, never a global.
 *
 *  - workDays: UTC weekday indices that are working days (0=Sun..6=Sat).
 *              Default Mon–Fri = [1,2,3,4,5].
 *  - holidays: ISO "YYYY-MM-DD" (UTC) strings that are NOT working days even
 *              when their weekday is a normal working day.
 */
export interface WorkingCalendar {
  workDays: number[];
  holidays: Set<string>;
}

/** Step cap to guarantee addWorkingDays never loops forever (ADR-0007). */
const MAX_WORKING_STEP_DAYS = 100_000;

/** Clone date and shift by N calendar days (DST-safe). */
function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/** ISO YYYY-MM-DD (UTC) of a date — the holiday-set key format. */
function utcISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * KAN-147: true when `date` falls on a working day for `calendar` — its UTC
 * weekday is in workDays AND its UTC YYYY-MM-DD is not a holiday.
 */
export function isWorkingDay(date: Date, calendar: WorkingCalendar): boolean {
  const workSet =
    calendar.workDays.length > 0 ? calendar.workDays : [0, 1, 2, 3, 4, 5, 6];
  if (!workSet.includes(date.getUTCDay())) return false;
  if (calendar.holidays.has(utcISODate(date))) return false;
  return true;
}

/**
 * KAN-147 (ADR-0007 decision #3): step forward `n` WORKING days from `date`.
 *
 *  - n = 0   → snap forward to the next working day (date itself if already one).
 *  - n > 0   → advance, counting only working days.
 *  - n < 0   → step backward, counting only working days (FF/SF backward cases).
 *
 * GUARD: an empty workDays or all-holiday calendar would loop forever; we treat
 * empty workDays as all-days, and apply a hard step cap so the engine NEVER
 * hangs even on a pathological holiday set.
 */
export function addWorkingDays(
  date: Date,
  n: number,
  calendar: WorkingCalendar,
): Date {
  // Empty-calendar fallback: behave like plain calendar-day arithmetic so a
  // misconfigured calendar can never hang the engine (validated at write time).
  if (calendar.workDays.length === 0) {
    return addDays(date, n);
  }

  let current = new Date(date);
  let steps = 0;

  if (n >= 0) {
    // Snap forward to the first working day, then count remaining working days.
    let remaining = n;
    while (!isWorkingDay(current, calendar)) {
      current = addDays(current, 1);
      if (++steps > MAX_WORKING_STEP_DAYS) return addDays(date, n);
    }
    while (remaining > 0) {
      current = addDays(current, 1);
      if (isWorkingDay(current, calendar)) remaining--;
      if (++steps > MAX_WORKING_STEP_DAYS) return addDays(date, n);
    }
  } else {
    let remaining = -n;
    while (remaining > 0) {
      current = addDays(current, -1);
      if (isWorkingDay(current, calendar)) remaining--;
      if (++steps > MAX_WORKING_STEP_DAYS) return addDays(date, n);
    }
  }

  return current;
}

/**
 * KAN-147: count of WORKING days between `start` and `end` — the inverse of
 * addWorkingDays.
 *
 * CRITICAL (ADR-0007 correctness): both this function and addWorkingDays snap a
 * non-working-day anchor to the next working day BEFORE stepping. Without this
 * snap the two functions disagree — addWorkingDays(Sat, 1) = Tue (snaps to Mon
 * then +1) but a naive workingDaysBetween(Sat, Tue) counts Mon+Tue = 2 ≠ 1.
 * Snapping `start` here (and in every place that stores forecastStart) makes the
 * round-trip hold: workingDaysBetween(start, addWorkingDays(start, n)) === n.
 *
 * For the all-days fallback (workDays=[]) snap is a no-op (addDays(d,0)=d), so
 * legacy engine tests are unaffected.
 */
export function workingDaysBetween(
  start: Date,
  end: Date,
  calendar: WorkingCalendar,
): number {
  if (calendar.workDays.length === 0) {
    return Math.round((end.getTime() - start.getTime()) / DAY_MS);
  }

  // Snap both anchors forward to the next working day so the step-counting
  // starts from the same reference point addWorkingDays uses.
  const snappedStart = addWorkingDays(start, 0, calendar);
  const snappedEnd = addWorkingDays(end, 0, calendar);

  const startMs = snappedStart.getTime();
  const endMs = snappedEnd.getTime();
  if (endMs === startMs) return 0;

  let count = 0;
  let steps = 0;

  if (endMs > startMs) {
    let cursor = new Date(snappedStart);
    while (cursor.getTime() < endMs) {
      cursor = addDays(cursor, 1);
      if (isWorkingDay(cursor, calendar)) count++;
      if (++steps > MAX_WORKING_STEP_DAYS) break;
    }
    return count;
  }

  let cursor = new Date(snappedStart);
  while (cursor.getTime() > endMs) {
    cursor = addDays(cursor, -1);
    if (isWorkingDay(cursor, calendar)) count--;
    if (++steps > MAX_WORKING_STEP_DAYS) break;
  }
  return count;
}

/**
 * KAN-147: default calendar used when computeForecast is called WITHOUT a
 * calendar. workDays empty ⇒ addWorkingDays/workingDaysBetween fall back to
 * plain calendar-day arithmetic, so every pre-existing engine test (which does
 * not pass a calendar) keeps its exact previous behaviour.
 */
const ALL_DAYS_CALENDAR: WorkingCalendar = {
  workDays: [],
  holidays: new Set<string>(),
};

/** Return the later of two dates. */
function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

/** Clone date floored to start of day (UTC midnight, timezone-stable). */
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/** Convert hours to whole days (ceiling). */
function days(hours: number, hoursPerDay: number): number {
  return Math.ceil(hours / hoursPerDay);
}

/**
 * Remaining work hours under the KAN-146 trust model: reported progress reduces
 * the remaining work (logging is optional, so progress is the primary signal).
 * progress=100 on a non-done node is treated as 99% so it never reads as zero.
 * Returns 0 when there is no estimate (callers guard that case separately).
 */
function remainingHours(node: ForecastNode): number {
  if (node.estimateHours === null) return 0;
  const effProgress =
    node.progress === 100 && node.state !== "done" ? 99 : node.progress;
  return node.estimateHours * (1 - effProgress / 100);
}

/**
 * Whole-day forecast span of a node: logged hours already spent plus the
 * remaining work, in days, extended by any interruption days. Used by both the
 * isolated forecast (forecastEndFor) and CPM edge propagation (applyEdge) so a
 * progress-reduced node keeps the same span whether or not a predecessor
 * constrains it (KAN-146 consistency).
 */
function spanDays(node: ForecastNode, hoursPerDay: number): number {
  return days(node.loggedH + remainingHours(node), hoursPerDay) + node.interruptedDays;
}

// ─── Exported pure functions ──────────────────────────────────────────────────

/**
 * The start date the forecast computes from. KAN-145/KAN-167: any non-terminal
 * work (state NOT in {done, cancelled}) whose plan start is already in the past
 * is anchored to `now`, so overdue work is forecast to finish from today instead
 * of in the past. Terminal states and the case where `now` is not supplied keep
 * the plan start unchanged.
 */
export function effectiveStartFor(node: ForecastNode, now?: Date): Date | null {
  if (node.startDate === null) return null;
  if (
    now !== undefined &&
    node.state !== "done" &&
    node.state !== "cancelled" &&
    node.startDate.getTime() < now.getTime()
  ) {
    // Clone so callers can't mutate the shared `now` through the return value.
    return new Date(now);
  }
  return node.startDate;
}

/**
 * Compute the forecast end date for a single node.
 * `now` anchors overdue in_progress work to the current date (KAN-145).
 */
export function forecastEndFor(
  node: ForecastNode,
  hoursPerDay: number,
  now?: Date,
  calendar: WorkingCalendar = ALL_DAYS_CALENDAR,
): Date | null {
  // 1. No start → cannot schedule
  if (node.startDate === null) return null;

  // 2. Done with completedAt → use actual completion date
  if (node.state === "done" && node.completedAt !== null) {
    return node.completedAt;
  }

  // 3. No estimate → fall back to dueDate (may be null)
  if (node.estimateHours === null) return node.dueDate;

  // KAN-145: anchor overdue in_progress work to today.
  const rawStart = effectiveStartFor(node, now) ?? node.startDate;

  // KAN-147 (ADR-0007 decision #3): snap forecastStart to the next working day
  // so the anchor passed to addWorkingDays is always a working day. This keeps
  // workingDaysBetween(forecastStart, forecastEnd) === spanDays (the round-trip
  // invariant). For the all-days fallback snap is a no-op.
  const start = addWorkingDays(rawStart, 0, calendar);

  // Span = logged + remaining work (KAN-146 trust model) + interruption days
  // (KAN-103), computed once so the isolated forecast and CPM propagation agree.
  // KAN-147: the span is a count of WORKING days, applied with addWorkingDays so
  // a span crossing weekends/holidays lands on the correct calendar date.
  let end = addWorkingDays(start, spanDays(node, hoursPerDay), calendar);

  // Clamp: end must be at least 1 working day after start.
  if (end.getTime() <= start.getTime()) {
    end = addWorkingDays(start, 1, calendar);
  }

  return end;
}

/** Internal mutable state per node during forward/backward passes. */
interface NodeState {
  forecastStart: Date;
  forecastEnd: Date;
  lateStart?: Date;
  lateFinish?: Date;
  floatDays?: number;
  critical?: boolean;
}

/**
 * Apply a scheduling edge constraint to the successor node state.
 * Mutates succState in-place.
 */
export function applyEdge(
  edge: ForecastEdge,
  _predNode: ForecastNode,
  predState: { forecastStart: Date; forecastEnd: Date },
  succNode: ForecastNode,
  succState: { forecastStart: Date; forecastEnd: Date },
  hoursPerDay: number,
  calendar: WorkingCalendar = ALL_DAYS_CALENDAR,
): void {
  if (edge.type === "blocks") return;

  // KAN-147: lag is interpreted as WORKING days too (ADR-0007 decision #3), so
  // an FS+2d lag means two working days, consistent with duration.
  const L = edge.lagDays;

  // Duration is the successor's own forecast span (logged + remaining work +
  // interruptions), matching forecastEndFor so a progress-reduced node is not
  // silently re-expanded to its full estimate when a predecessor constrains it
  // (KAN-146 consistency). Falls back to the current span when there is no
  // estimate to compute from.
  // KAN-147: the fallback measures the existing span in WORKING days (not
  // calendar days), because forecastEnd was produced with addWorkingDays and the
  // calendar diff no longer equals the working-day count once weekends are
  // crossed.
  const durDays =
    succNode.estimateHours !== null
      ? spanDays(succNode, hoursPerDay)
      : workingDaysBetween(
          succState.forecastStart,
          succState.forecastEnd,
          calendar,
        );

  switch (edge.type) {
    case "FS": {
      // Successor starts no earlier than pred.end + lag
      succState.forecastStart = laterOf(
        succState.forecastStart,
        addWorkingDays(predState.forecastEnd, L, calendar),
      );
      succState.forecastEnd = addWorkingDays(
        succState.forecastStart,
        durDays,
        calendar,
      );
      break;
    }
    case "SS": {
      // Successor starts no earlier than pred.start + lag
      succState.forecastStart = laterOf(
        succState.forecastStart,
        addWorkingDays(predState.forecastStart, L, calendar),
      );
      succState.forecastEnd = addWorkingDays(
        succState.forecastStart,
        durDays,
        calendar,
      );
      break;
    }
    case "FF": {
      // Successor finishes no earlier than pred.end + lag
      succState.forecastEnd = laterOf(
        succState.forecastEnd,
        addWorkingDays(predState.forecastEnd, L, calendar),
      );
      succState.forecastStart = addWorkingDays(
        succState.forecastEnd,
        -durDays,
        calendar,
      );
      break;
    }
    case "SF": {
      // Successor finishes no earlier than pred.start + lag
      succState.forecastEnd = laterOf(
        succState.forecastEnd,
        addWorkingDays(predState.forecastStart, L, calendar),
      );
      succState.forecastStart = addWorkingDays(
        succState.forecastEnd,
        -durDays,
        calendar,
      );
      break;
    }
  }

  // Clamp: forecastEnd must not be before forecastStart
  if (succState.forecastEnd.getTime() < succState.forecastStart.getTime()) {
    succState.forecastEnd = addWorkingDays(succState.forecastStart, 1, calendar);
  }
}

/**
 * Kahn's topological sort. Only structural edges (FS/SS/FF/SF) count.
 * Cycle nodes are excluded from the result. Never throws.
 */
export function topoSort(nodes: ForecastNode[], edges: ForecastEdge[]): string[] {
  const structuralEdges = edges.filter((e) => e.type !== "blocks");

  // Build adjacency and in-degree maps
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.issueId, 0);
    outEdges.set(n.issueId, []);
  }

  for (const e of structuralEdges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    const list = outEdges.get(e.source);
    if (list !== undefined) list.push(e.target);
  }

  // Queue all zero-in-degree nodes
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    order.push(u);
    for (const v of outEdges.get(u) ?? []) {
      const newDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    }
  }

  // Nodes still with in-degree > 0 are in a cycle — excluded from order
  return order;
}

/**
 * CPM backward pass. Mutates nodeStates with lateStart/lateFinish/floatDays/critical.
 */
export function backwardPass(
  ordered: string[],
  nodeStates: Map<string, NodeState>,
  edges: ForecastEdge[],
  calendar: WorkingCalendar = ALL_DAYS_CALENDAR,
): void {
  if (ordered.length === 0) return;

  const structuralEdges = edges.filter((e) => e.type !== "blocks");

  // Build reverse-edge map (target → [{source, type, lagDays}]).
  // Edge type is kept: the backward constraint differs per type (see below).
  const inEdges = new Map<
    string,
    Array<{ source: string; type: ForecastEdge["type"]; lagDays: number }>
  >();
  for (const id of ordered) {
    inEdges.set(id, []);
  }
  for (const e of structuralEdges) {
    const list = inEdges.get(e.target);
    if (list !== undefined) {
      list.push({ source: e.source, type: e.type, lagDays: e.lagDays });
    }
  }

  // Find project end (latest forecastEnd)
  let projectEnd: Date | null = null;
  for (const id of ordered) {
    const s = nodeStates.get(id);
    if (s === undefined) continue;
    if (projectEnd === null || s.forecastEnd.getTime() > projectEnd.getTime()) {
      projectEnd = s.forecastEnd;
    }
  }
  if (projectEnd === null) return;

  // Initialize lateFinish for all nodes to projectEnd
  for (const id of ordered) {
    const s = nodeStates.get(id);
    if (s !== undefined) {
      s.lateFinish = new Date(projectEnd);
    }
  }

  // Backward pass in reverse topo order
  for (let i = ordered.length - 1; i >= 0; i--) {
    const id = ordered[i]!;
    const s = nodeStates.get(id);
    if (s === undefined) continue;

    const lateFinish = s.lateFinish ?? projectEnd;
    // KAN-147: durations are measured and re-applied in WORKING days, since
    // forecastStart/forecastEnd were produced with addWorkingDays.
    const dur = workingDaysBetween(s.forecastStart, s.forecastEnd, calendar);
    const lateStart = addWorkingDays(lateFinish, -dur, calendar);
    s.lateStart = lateStart;

    // Propagate the late-finish constraint backward to each predecessor.
    // The constraint is the dual of the forward edge semantics, so it depends
    // on the edge type (succ.LS = lateStart, succ.LF = lateFinish):
    //   FS  succ.start ≥ pred.end + lag   → pred.LF = succ.LS − lag
    //   SS  succ.start ≥ pred.start + lag → pred.LS = succ.LS − lag → pred.LF = pred.LS + predDur
    //   FF  succ.end   ≥ pred.end + lag   → pred.LF = succ.LF − lag
    //   SF  succ.end   ≥ pred.start + lag → pred.LS = succ.LF − lag → pred.LF = pred.LS + predDur
    for (const { source, type, lagDays } of inEdges.get(id) ?? []) {
      const predState = nodeStates.get(source);
      if (predState === undefined) continue;

      // Start-anchored constraints (SS/SF) bound pred.LS; convert to pred.LF by
      // adding the predecessor's own duration.
      // KAN-147: predDur in WORKING days, constraint dates stepped with
      // addWorkingDays so the backward pass mirrors the forward working-day math.
      const predDur = workingDaysBetween(
        predState.forecastStart,
        predState.forecastEnd,
        calendar,
      );

      let constraintEnd: Date;
      switch (type) {
        case "SS":
          constraintEnd = addWorkingDays(lateStart, predDur - lagDays, calendar);
          break;
        case "FF":
          constraintEnd = addWorkingDays(lateFinish, -lagDays, calendar);
          break;
        case "SF":
          constraintEnd = addWorkingDays(lateFinish, predDur - lagDays, calendar);
          break;
        case "FS":
        default:
          constraintEnd = addWorkingDays(lateStart, -lagDays, calendar);
          break;
      }

      // pred.lateFinish = min(pred.lateFinish, constraintEnd)
      if (
        predState.lateFinish === undefined ||
        constraintEnd.getTime() < predState.lateFinish.getTime()
      ) {
        predState.lateFinish = constraintEnd;
      }
    }

    // Compute float and critical
    // KAN-147: float is the working-day slack between forecastStart and lateStart.
    s.floatDays = workingDaysBetween(s.forecastStart, lateStart, calendar);
    s.critical = s.floatDays <= 0;
  }
}

/**
 * Full forecast computation. Pure — no I/O, no Prisma.
 */
export function computeForecast(
  input: ForecastGraphInput,
  opts?: {
    hoursPerDay?: number;
    atRiskBufferDays?: number;
    now?: Date;
    /**
     * KAN-147 (ADR-0007): the working-day calendar. OPTIONAL — when absent the
     * engine falls back to the all-days calendar (every calendar day is a
     * working day → plain addDays), preserving pre-KAN-147 behaviour for all
     * existing call sites and tests.
     */
    calendar?: WorkingCalendar;
  },
): ForecastResult {
  const hoursPerDay = opts?.hoursPerDay ?? 8;
  const atRiskBufferDays = opts?.atRiskBufferDays ?? 3;
  const calendar = opts?.calendar ?? ALL_DAYS_CALENDAR;
  // KAN-145: anchor overdue in_progress work to "today" (injectable for tests).
  // Floored to start-of-day so repeated recomputes on the same day are stable —
  // a millisecond-precision anchor would make forecastEnd jitter every call and
  // defeat the inputsHash dedup.
  const now = opts?.now ?? startOfDay(new Date());

  const nodeMap = new Map<string, ForecastNode>();
  for (const n of input.nodes) {
    nodeMap.set(n.issueId, n);
  }

  // Step 1: Base forecast per node
  const nodeStates = new Map<string, NodeState>();
  for (const n of input.nodes) {
    if (n.startDate === null) continue; // will be handled as null-start below
    const fEnd = forecastEndFor(n, hoursPerDay, now, calendar);
    if (fEnd === null) continue; // no forecastEnd means can't schedule
    // KAN-147 (ADR-0007 decision #3): snap forecastStart to the next working day
    // so it matches the snapped anchor used inside forecastEndFor. This ensures
    // workingDaysBetween(forecastStart, forecastEnd) === spanDays everywhere in
    // applyEdge and backwardPass. For the all-days fallback snap is a no-op.
    const rawStart = effectiveStartFor(n, now) ?? n.startDate;
    const snappedStart = addWorkingDays(rawStart, 0, calendar);
    nodeStates.set(n.issueId, {
      forecastStart: snappedStart,
      forecastEnd: fEnd,
    });
  }

  // Step 2: Topological sort + forward pass
  // Compute structuralEdges once — used by topoSort, forward pass, and backwardPass.
  const structuralEdges = input.edges.filter((e) => e.type !== "blocks");
  const order = topoSort(input.nodes, structuralEdges);

  // Build successor adjacency map once: O(E) — avoids O(V·E) inner scan.
  const succEdges = new Map<string, ForecastEdge[]>();
  for (const e of structuralEdges) {
    let list = succEdges.get(e.source);
    if (list === undefined) {
      list = [];
      succEdges.set(e.source, list);
    }
    list.push(e);
  }

  for (const uid of order) {
    const uState = nodeStates.get(uid);
    if (uState === undefined) continue;
    const uNode = nodeMap.get(uid);
    if (uNode === undefined) continue;

    for (const edge of succEdges.get(uid) ?? []) {
      const vState = nodeStates.get(edge.target);
      const vNode = nodeMap.get(edge.target);
      if (vState === undefined || vNode === undefined) continue;
      applyEdge(edge, uNode, uState, vNode, vState, hoursPerDay, calendar);
    }
  }

  // Step 3: Backward pass (CPM)
  backwardPass(order, nodeStates, structuralEdges, calendar);

  // Step 4: Build result
  const computedAt = new Date();
  const forecasts = new Map<string, IssueForecastEntry>();

  for (const n of input.nodes) {
    const s = nodeStates.get(n.issueId);

    if (s === undefined) {
      // null-start or unschedulable node
      const fEnd =
        n.startDate !== null ? forecastEndFor(n, hoursPerDay, now, calendar) : null;
      // KAN-166: a node reaches this branch only when it has NO nodeState, i.e.
      // forecastEndFor returned null (startDate null, or estimateHours null AND
      // dueDate null). So fEnd is always null here. If it were ever non-null it
      // would be the inclusive dueDate fallback — NOT an exclusive span — so no
      // -1 conversion is applied.
      const fEndInclusive = fEnd;
      const slipDays =
        n.dueDate !== null && fEndInclusive !== null
          ? Math.max(
              0,
              Math.round((fEndInclusive.getTime() - n.dueDate.getTime()) / DAY_MS),
            )
          : 0;
      forecasts.set(n.issueId, {
        forecastStart: null,
        forecastEnd: null,
        critical: false,
        floatDays: null,
        slipDays,
        computedAt,
      });
    } else {
      // KAN-166: the internal CPM uses an EXCLUSIVE end convention
      // (forecastEnd = forecastStart + spanDays working days). The plan/baseline
      // plane uses an INCLUSIVE end convention (dueDate = last working day).
      // Convert to inclusive here — at the result-build seam only — so that
      // slipDays and the stored forecastEnd align with dueDate/baselineEnd.
      // The internal nodeStates remain exclusive so CPM math is unaffected.
      //
      // CRITICAL: only the SPAN-COMPUTED path is exclusive. forecastEndFor has
      // two other paths that already return an inclusive/actual date and must
      // NOT be shifted:
      //   - done + completedAt → the real completion date (verbatim ONLY when the
      //     node's forecastEnd was not overwritten by CPM applyEdge; for done+completedAt
      //     nodes that ARE constrained dependency successors the stored end remains the
      //     exclusive CPM value — known limitation, follow-up KAN-177)
      //   - estimateHours === null → the plan dueDate (already inclusive)
      // Applying -1 to those produced a spurious 1-day-early forecastEnd (e.g.
      // a no-estimate issue's dueDate-fallback landing a working day before its
      // own dueDate). Detect those paths and pass the end through unchanged.
      const endIsActual =
        (n.state === "done" && n.completedAt !== null) || n.estimateHours === null;
      const rawInclusive = endIsActual
        ? s.forecastEnd
        : addWorkingDays(s.forecastEnd, -1, calendar);
      // Guard: inclusive end must never be before forecastStart (e.g. a 0h task
      // where exclusive end == start+1 → inclusive end == start, which is valid).
      const forecastEndInclusive =
        rawInclusive.getTime() >= s.forecastStart.getTime()
          ? rawInclusive
          : new Date(s.forecastStart);

      const slipDays =
        n.dueDate !== null
          ? Math.max(
              0,
              Math.round(
                (forecastEndInclusive.getTime() - n.dueDate.getTime()) / DAY_MS,
              ),
            )
          : 0;
      forecasts.set(n.issueId, {
        forecastStart: s.forecastStart,
        forecastEnd: forecastEndInclusive,
        critical: s.critical ?? false,
        floatDays: s.floatDays ?? null,
        slipDays,
        computedAt,
      });
    }
  }

  // Step 5: Stats
  let criticalCount = 0;
  let worstSlipDays = 0;
  for (const entry of forecasts.values()) {
    if (entry.critical) criticalCount++;
    if (entry.slipDays > worstSlipDays) worstSlipDays = entry.slipDays;
  }

  // Step 6: Slips
  const slips: IssueSlip[] = [];
  for (const [issueId, entry] of forecasts) {
    if (entry.slipDays > 0) {
      slips.push({ issueId, slipDays: entry.slipDays, critical: entry.critical });
    }
  }

  // Step 7: Milestone rollups
  const milestoneRollups: MilestoneRollup[] = [];
  for (const m of input.milestones) {
    if (m.target === null) {
      milestoneRollups.push({
        milestoneId: m.id,
        currentStatus: m.status,
        computedStatus: "upcoming",
      });
      continue;
    }
    const riskThreshold = addDays(m.target, -atRiskBufferDays);
    const anyAtRisk = m.deliverableIssueIds.some((id) => {
      const entry = forecasts.get(id);
      return (
        entry !== undefined &&
        entry.forecastEnd !== null &&
        entry.forecastEnd.getTime() >= riskThreshold.getTime()
      );
    });
    milestoneRollups.push({
      milestoneId: m.id,
      currentStatus: m.status,
      computedStatus: anyAtRisk ? "at_risk" : "upcoming",
    });
  }

  return {
    forecasts,
    milestoneRollups,
    slips,
    stats: {
      issueCount: input.nodes.length,
      criticalCount,
      worstSlipDays,
    },
  };
}
