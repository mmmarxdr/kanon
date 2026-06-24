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

/** Clone date and shift by N calendar days (DST-safe). */
function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

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
 * The start date the forecast computes from. KAN-145: in_progress work whose
 * plan start is already in the past is anchored to `now`, so overdue work is
 * forecast to finish from today instead of in the past. Other states (and the
 * case where `now` is not supplied) keep the plan start unchanged.
 */
export function effectiveStartFor(node: ForecastNode, now?: Date): Date | null {
  if (node.startDate === null) return null;
  if (
    now !== undefined &&
    node.state === "in_progress" &&
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
  const start = effectiveStartFor(node, now) ?? node.startDate;

  // Span = logged + remaining work (KAN-146 trust model) + interruption days
  // (KAN-103), computed once so the isolated forecast and CPM propagation agree.
  let end = addDays(start, spanDays(node, hoursPerDay));

  // Clamp: end must be at least 1 day after start.
  if (end.getTime() <= start.getTime()) {
    end = addDays(start, 1);
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
): void {
  if (edge.type === "blocks") return;

  const L = edge.lagDays;

  // Duration is the successor's own forecast span (logged + remaining work +
  // interruptions), matching forecastEndFor so a progress-reduced node is not
  // silently re-expanded to its full estimate when a predecessor constrains it
  // (KAN-146 consistency). Falls back to the current span when there is no
  // estimate to compute from.
  const durDays =
    succNode.estimateHours !== null
      ? spanDays(succNode, hoursPerDay)
      : Math.round(
          (succState.forecastEnd.getTime() - succState.forecastStart.getTime()) /
            DAY_MS,
        );

  switch (edge.type) {
    case "FS": {
      // Successor starts no earlier than pred.end + lag
      succState.forecastStart = laterOf(
        succState.forecastStart,
        addDays(predState.forecastEnd, L),
      );
      succState.forecastEnd = addDays(succState.forecastStart, durDays);
      break;
    }
    case "SS": {
      // Successor starts no earlier than pred.start + lag
      succState.forecastStart = laterOf(
        succState.forecastStart,
        addDays(predState.forecastStart, L),
      );
      succState.forecastEnd = addDays(succState.forecastStart, durDays);
      break;
    }
    case "FF": {
      // Successor finishes no earlier than pred.end + lag
      succState.forecastEnd = laterOf(
        succState.forecastEnd,
        addDays(predState.forecastEnd, L),
      );
      succState.forecastStart = addDays(succState.forecastEnd, -durDays);
      break;
    }
    case "SF": {
      // Successor finishes no earlier than pred.start + lag
      succState.forecastEnd = laterOf(
        succState.forecastEnd,
        addDays(predState.forecastStart, L),
      );
      succState.forecastStart = addDays(succState.forecastEnd, -durDays);
      break;
    }
  }

  // Clamp: forecastEnd must not be before forecastStart
  if (succState.forecastEnd.getTime() < succState.forecastStart.getTime()) {
    succState.forecastEnd = addDays(succState.forecastStart, 1);
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
    const dur = Math.round(
      (s.forecastEnd.getTime() - s.forecastStart.getTime()) / DAY_MS,
    );
    const lateStart = addDays(lateFinish, -dur);
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
      const predDur = Math.round(
        (predState.forecastEnd.getTime() - predState.forecastStart.getTime()) / DAY_MS,
      );

      let constraintEnd: Date;
      switch (type) {
        case "SS":
          constraintEnd = addDays(lateStart, predDur - lagDays);
          break;
        case "FF":
          constraintEnd = addDays(lateFinish, -lagDays);
          break;
        case "SF":
          constraintEnd = addDays(lateFinish, predDur - lagDays);
          break;
        case "FS":
        default:
          constraintEnd = addDays(lateStart, -lagDays);
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
    s.floatDays = Math.round(
      (lateStart.getTime() - s.forecastStart.getTime()) / DAY_MS,
    );
    s.critical = s.floatDays <= 0;
  }
}

/**
 * Full forecast computation. Pure — no I/O, no Prisma.
 */
export function computeForecast(
  input: ForecastGraphInput,
  opts?: { hoursPerDay?: number; atRiskBufferDays?: number; now?: Date },
): ForecastResult {
  const hoursPerDay = opts?.hoursPerDay ?? 8;
  const atRiskBufferDays = opts?.atRiskBufferDays ?? 3;
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
    const fEnd = forecastEndFor(n, hoursPerDay, now);
    if (fEnd === null) continue; // no forecastEnd means can't schedule
    nodeStates.set(n.issueId, {
      // KAN-145: forecastStart anchored alongside forecastEnd.
      forecastStart: effectiveStartFor(n, now) ?? n.startDate,
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
      applyEdge(edge, uNode, uState, vNode, vState, hoursPerDay);
    }
  }

  // Step 3: Backward pass (CPM)
  backwardPass(order, nodeStates, structuralEdges);

  // Step 4: Build result
  const computedAt = new Date();
  const forecasts = new Map<string, IssueForecastEntry>();

  for (const n of input.nodes) {
    const s = nodeStates.get(n.issueId);

    if (s === undefined) {
      // null-start or unschedulable node
      const fEnd = n.startDate !== null ? forecastEndFor(n, hoursPerDay, now) : null;
      const slipDays =
        n.dueDate !== null && fEnd !== null
          ? Math.max(
              0,
              Math.round((fEnd.getTime() - n.dueDate.getTime()) / DAY_MS),
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
      const slipDays =
        n.dueDate !== null
          ? Math.max(
              0,
              Math.round(
                (s.forecastEnd.getTime() - n.dueDate.getTime()) / DAY_MS,
              ),
            )
          : 0;
      forecasts.set(n.issueId, {
        forecastStart: s.forecastStart,
        forecastEnd: s.forecastEnd,
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
