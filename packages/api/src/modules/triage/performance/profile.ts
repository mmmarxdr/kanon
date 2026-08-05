/**
 * Shared helpers for versioned triage performance profiles (KAN-193 PR12).
 *
 * Full 1,000-sample reference runs require TRIAGE_PERF=1 (PG16/Node20,
 * 4 vCPU/8 GiB). Default CI exercises contract/boundary assertions only.
 */

export const TRIAGE_PERF_ENV = "TRIAGE_PERF";

export function isFullPerfEnabled(): boolean {
  return process.env[TRIAGE_PERF_ENV] === "1";
}

export interface LatencySample {
  durationMs: number;
  outputBytes: number;
  outcome: "success" | "timeout" | "source_conflict" | "error";
}

export interface LatencySummary {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxOutputBytes: number;
  successCount: number;
  timeoutCount: number;
  sourceConflictCount: number;
}

export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAscending.length) - 1),
  );
  return sortedAscending[rank]!;
}

export function summarizeLatencies(samples: LatencySample[]): LatencySummary {
  const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
  return {
    count: samples.length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxOutputBytes: samples.reduce((m, s) => Math.max(m, s.outputBytes), 0),
    successCount: samples.filter((s) => s.outcome === "success").length,
    timeoutCount: samples.filter((s) => s.outcome === "timeout").length,
    sourceConflictCount: samples.filter((s) => s.outcome === "source_conflict").length,
  };
}

/** Operator canary gates from design.md (rolling five-minute windows). */
export const CANARY_GATES = {
  minCompletedPerStage: 100,
  unexpectedErrorPagePct: 1,
  unexpectedErrorDisableAllPct: 5,
  typedDegradationHaltPct: 10,
  previewP95MaxMs: 3000,
  listP95TargetMs: 1500,
  dismissP95TargetMs: 1000,
  previewCompactMaxBytes: 16 * 1024,
  listMaxBytes: 32 * 1024,
  getMaxBytes: 64 * 1024,
  dismissMaxBytes: 8 * 1024,
} as const;

export const REFERENCE_RUNTIME = {
  postgresMajor: 16,
  nodeMajor: 20,
  vCpu: 4,
  memoryGiB: 8,
  warmups: 100,
  measuredCallsMin: 1000,
  concurrency: 16,
} as const;
