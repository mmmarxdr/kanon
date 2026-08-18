/**
 * Shared helpers for versioned triage performance profiles (KAN-193 PR12).
 *
 * Synthetic fixtures aggregate samples only; they are not live performance evidence.
 */

export interface LatencySample {
  durationMs: number;
  outputBytes: number;
  outcome: "success" | "degraded" | "timeout" | "source_conflict" | "error";
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
  typedDegradationPct: number;
  errorCount: number;
  unexpectedErrorPct: number;
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
  const errorCount = samples.filter((s) => s.outcome === "error").length;
  return {
    count: samples.length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxOutputBytes: samples.reduce((m, s) => Math.max(m, s.outputBytes), 0),
    successCount: samples.filter((s) => s.outcome === "success").length,
    timeoutCount: samples.filter((s) => s.outcome === "timeout").length,
    sourceConflictCount: samples.filter((s) => s.outcome === "source_conflict").length,
    typedDegradationPct: samples.length === 0 ? 0 : (samples.filter((s) => s.outcome === "degraded" || s.outcome === "timeout").length / samples.length) * 100,
    errorCount,
    unexpectedErrorPct: samples.length === 0 ? 0 : (errorCount / samples.length) * 100,
  };
}

export const REFERENCE_RUNTIME = {
  postgresMajor: 16,
  nodeMajor: 20,
  vCpu: 4,
  memoryGiB: 8,
  warmups: 100,
  measuredCallsMin: 1000,
  concurrency: 16,
} as const;
