import { describe, it, expect } from "vitest";
import * as observabilityModule from "./observability.js";
import {
  TRIAGE_PINO_REDACT_PATHS,
  TRIAGE_SQL_BOUNDARIES,
  isCorrelationUuid,
} from "./observability.js";

describe("triage observability — retired metrics API", () => {
  it("does not export the retired triage metrics surface", () => {
    expect(observabilityModule).not.toHaveProperty("registerTriageMetrics");
    expect(observabilityModule).not.toHaveProperty("observeSearch");
    expect(observabilityModule).not.toHaveProperty("observePreview");
    expect(observabilityModule).not.toHaveProperty("observeProposalOp");
    expect(observabilityModule).not.toHaveProperty("assertSafeLabelValue");
  });
});

describe("triage observability — redaction and correlation", () => {
  it("lists pino redaction paths for preview/suggestion bodies", () => {
    expect(TRIAGE_PINO_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        "req.body.suggestions",
        "req.body.preview",
        "res.body.evidence",
        "res.body.contextToken",
      ]),
    );
  });

  it("validates correlation UUIDs", () => {
    expect(isCorrelationUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isCorrelationUuid("not-a-uuid")).toBe(false);
  });
});

describe("triage SQL boundaries constants", () => {
  it("documents LIMIT 11 / LIMIT 51 and visibility-first rules", () => {
    expect(TRIAGE_SQL_BOUNDARIES.searchFetchLimitMax).toBe(11);
    expect(TRIAGE_SQL_BOUNDARIES.listFetchLimitMax).toBe(51);
    expect(TRIAGE_SQL_BOUNDARIES.searchVisibilityBeforePredicates).toBe(true);
    expect(TRIAGE_SQL_BOUNDARIES.listNoContentTableFetch).toBe(true);
  });
});
