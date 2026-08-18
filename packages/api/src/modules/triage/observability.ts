/**
 * Triage observability helpers (KAN-193 PR12).
 *
 * Privacy-safe structured logging, correlation IDs, and SQL boundaries.
 */

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
