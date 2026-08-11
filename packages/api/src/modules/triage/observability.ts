/**
 * Triage observability helpers (KAN-193 PR12).
 *
 * Low-cardinality Prometheus metrics + privacy-safe stage traces.
 * No label may contain query/prompt/evidence/user/proposal/issue/project/
 * workspace/cursor/model string values.
 */

import client from "prom-client";

/** Forbidden substrings in metric label *values* (defense in depth). */
export const FORBIDDEN_METRIC_LABEL_PATTERNS = [
  /prompt/i,
  /evidence/i,
  /cursor=/i,
  /eyJ[A-Za-z0-9_-]+/, // JWT-ish
] as const;

/** Label names that must never appear on triage metrics. */
export const FORBIDDEN_TRIAGE_LABEL_NAMES = [
  "query",
  "prompt",
  "output",
  "evidence",
  "user",
  "member",
  "userId",
  "memberId",
  "proposal",
  "proposalId",
  "issue",
  "issueId",
  "issueKey",
  "project",
  "projectId",
  "projectKey",
  "workspace",
  "workspaceId",
  "cursor",
  "model",
  "provider",
  "modelVersion",
] as const;

export const TRIAGE_SEARCH_SCOPES = ["project", "workspace"] as const;
export const TRIAGE_COMPLETENESS = ["complete", "bounded", "timed_out", "degraded"] as const;
export const TRIAGE_OUTCOMES = [
  "success",
  "validation",
  "not_found_or_not_visible",
  "authorization",
  "source_conflict",
  "immutable_content_conflict",
  "terminal_lifecycle",
  "temporary_unavailability",
  "unsupported_non_executable",
  "degraded_success",
  "error",
] as const;
export const TRIAGE_PREVIEW_PHASES = ["prepare", "validate"] as const;
export const TRIAGE_PROPOSAL_OPERATIONS = [
  "persist",
  "get",
  "list",
  "dismiss",
  "expire",
  "retain",
  "rejected_apply",
] as const;
export const TRIAGE_ROW_MEASURES = ["logical_scanned", "returned"] as const;
export const TRIAGE_LIST_STATE_FILTERS = [
  "current",
  "superseded",
  "dismissed",
  "expired",
  "disposed",
  "all",
] as const;

/** Pino redaction paths for triage request/response bodies (defense in depth). */
export const TRIAGE_PINO_REDACT_PATHS = [
  "req.body.suggestions",
  "req.body.preview",
  "req.body.hostOutcome",
  "req.body.contextToken",
  "req.body.previewSeal",
  "res.body.evidence",
  "res.body.recommendations",
  "res.body.candidates",
  "res.body.contextToken",
  "res.body.previewSeal",
] as const;

export interface TriageMetrics {
  searchDuration: client.Histogram<"scope" | "completeness" | "outcome">;
  searchRows: client.Histogram<"measure">;
  previewDuration: client.Histogram<"phase" | "outcome" | "ai_contributed">;
  degradationTotal: client.Counter<"reason">;
  proposalRequests: client.Counter<"operation" | "outcome">;
  proposalDuration: client.Histogram<"operation" | "outcome">;
  proposalListRows: client.Histogram<"state_filter">;
}

const registries = new WeakMap<client.Registry, TriageMetrics>();

function assertSafeLabelNames(labelNames: readonly string[]): void {
  for (const name of labelNames) {
    if ((FORBIDDEN_TRIAGE_LABEL_NAMES as readonly string[]).includes(name)) {
      throw new Error(`Forbidden triage metric label name: ${name}`);
    }
  }
}

/**
 * Register (or reuse) triage metrics on an existing prom-client Registry.
 * Never creates a second global registry.
 */
export function registerTriageMetrics(registry: client.Registry): TriageMetrics {
  const existing = registries.get(registry);
  if (existing) return existing;

  const searchDurationLabels = ["scope", "completeness", "outcome"] as const;
  const previewDurationLabels = ["phase", "outcome", "ai_contributed"] as const;
  const proposalLabels = ["operation", "outcome"] as const;
  assertSafeLabelNames(searchDurationLabels);
  assertSafeLabelNames(previewDurationLabels);
  assertSafeLabelNames(proposalLabels);
  assertSafeLabelNames(["measure"]);
  assertSafeLabelNames(["reason"]);
  assertSafeLabelNames(["state_filter"]);

  const metrics: TriageMetrics = {
    searchDuration: new client.Histogram({
      name: "kanon_triage_search_duration_seconds",
      help: "Bounded issue-search duration by scope/completeness/outcome",
      labelNames: searchDurationLabels,
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    searchRows: new client.Histogram({
      name: "kanon_triage_search_rows",
      help: "Authorized logical rows scanned/evaluated and rows returned",
      labelNames: ["measure"],
      buckets: [0, 1, 2, 5, 10, 20, 50, 100],
      registers: [registry],
    }),
    previewDuration: new client.Histogram({
      name: "kanon_triage_preview_duration_seconds",
      help: "Triage preview duration by phase/outcome/ai_contributed",
      labelNames: previewDurationLabels,
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    degradationTotal: new client.Counter({
      name: "kanon_triage_degradation_total",
      help: "Triage degradation reasons (low cardinality)",
      labelNames: ["reason"],
      registers: [registry],
    }),
    proposalRequests: new client.Counter({
      name: "kanon_triage_proposal_requests_total",
      help: "Triage proposal operations by outcome",
      labelNames: proposalLabels,
      registers: [registry],
    }),
    proposalDuration: new client.Histogram({
      name: "kanon_triage_proposal_duration_seconds",
      help: "Triage proposal operation duration",
      labelNames: proposalLabels,
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    proposalListRows: new client.Histogram({
      name: "kanon_triage_proposal_list_rows",
      help: "Returned authorized list rows by state_filter",
      labelNames: ["state_filter"],
      buckets: [0, 1, 5, 10, 20, 50],
      registers: [registry],
    }),
  };

  registries.set(registry, metrics);
  return metrics;
}

/** Validate a label value does not embed high-cardinality or sensitive material. */
export function assertSafeLabelValue(value: string): void {
  for (const pattern of FORBIDDEN_METRIC_LABEL_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(`Unsafe triage metric label value: ${value.slice(0, 40)}`);
    }
  }
  if (value.length > 64) {
    throw new Error("Triage metric label value exceeds 64 chars");
  }
}

export interface StageTrace {
  correlationId: string;
  operation: string;
  stage: string;
  durationMs: number;
  outcome: (typeof TRIAGE_OUTCOMES)[number];
  /** Bounded structured fields — never prompt/evidence bodies. */
  details?: Record<string, string | number | boolean | null>;
}

/** Build a privacy-safe stage trace (for structured logs under correlationId). */
export function buildStageTrace(input: StageTrace): StageTrace {
  const details = input.details ? { ...input.details } : undefined;
  if (details) {
    for (const key of Object.keys(details)) {
      if ((FORBIDDEN_TRIAGE_LABEL_NAMES as readonly string[]).includes(key)) {
        delete details[key];
      }
    }
  }
  return {
    correlationId: input.correlationId,
    operation: input.operation,
    stage: input.stage,
    durationMs: input.durationMs,
    outcome: input.outcome,
    ...(details ? { details } : {}),
  };
}

/** UUID v4-ish check for inbound correlation headers. */
export function isCorrelationUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** SQL / query plan boundaries asserted by performance profiles. */
export const TRIAGE_SQL_BOUNDARIES = {
  searchFetchLimitMax: 11, // limit 10 + 1
  listFetchLimitMax: 51, // limit 50 + 1
  searchVisibilityBeforePredicates: true,
  listVisibilityBeforePredicates: true,
  listNoContentTableFetch: true,
  searchNoMcpFullList: true,
} as const;

export function observeSearch(
  metrics: TriageMetrics,
  labels: {
    scope: (typeof TRIAGE_SEARCH_SCOPES)[number];
    completeness: (typeof TRIAGE_COMPLETENESS)[number];
    outcome: (typeof TRIAGE_OUTCOMES)[number];
  },
  durationSeconds: number,
  rows: { logicalScanned: number | null; returned: number },
): void {
  assertSafeLabelValue(labels.scope);
  assertSafeLabelValue(labels.completeness);
  assertSafeLabelValue(labels.outcome);
  metrics.searchDuration.observe(labels, durationSeconds);
  if (rows.logicalScanned !== null) {
    metrics.searchRows.observe({ measure: "logical_scanned" }, rows.logicalScanned);
  }
  metrics.searchRows.observe({ measure: "returned" }, rows.returned);
}

export function observePreview(
  metrics: TriageMetrics,
  labels: {
    phase: (typeof TRIAGE_PREVIEW_PHASES)[number];
    outcome: (typeof TRIAGE_OUTCOMES)[number];
    ai_contributed: "true" | "false";
  },
  durationSeconds: number,
  degradationReasons: string[] = [],
): void {
  assertSafeLabelValue(labels.phase);
  assertSafeLabelValue(labels.outcome);
  assertSafeLabelValue(labels.ai_contributed);
  metrics.previewDuration.observe(labels, durationSeconds);
  for (const reason of degradationReasons.slice(0, 8)) {
    assertSafeLabelValue(reason);
    metrics.degradationTotal.inc({ reason });
  }
}

export function observeProposalOp(
  metrics: TriageMetrics,
  labels: {
    operation: (typeof TRIAGE_PROPOSAL_OPERATIONS)[number];
    outcome: (typeof TRIAGE_OUTCOMES)[number];
  },
  durationSeconds: number,
  listReturnedRows?: { state_filter: (typeof TRIAGE_LIST_STATE_FILTERS)[number]; count: number },
): void {
  assertSafeLabelValue(labels.operation);
  assertSafeLabelValue(labels.outcome);
  metrics.proposalRequests.inc(labels);
  metrics.proposalDuration.observe(labels, durationSeconds);
  if (listReturnedRows) {
    assertSafeLabelValue(listReturnedRows.state_filter);
    metrics.proposalListRows.observe(
      { state_filter: listReturnedRows.state_filter },
      listReturnedRows.count,
    );
  }
}

export function triageOutcome(error: unknown): (typeof TRIAGE_OUTCOMES)[number] {
  const value = error && typeof error === "object"
    ? error as { code?: unknown; statusCode?: unknown }
    : {};
  const code = typeof value.code === "string" ? value.code : "";
  if (value.statusCode === 404) return "not_found_or_not_visible";
  if (value.statusCode === 401 || value.statusCode === 403) return "authorization";
  if (value.statusCode === 400) return "validation";
  if (value.statusCode === 503) return "temporary_unavailability";
  if (code === "CONCURRENCY_ERROR") return "temporary_unavailability";
  if (/SOURCE|POLICY|CONTEXT/.test(code)) return "source_conflict";
  if (value.statusCode === 409) return "terminal_lifecycle";
  return "error";
}
