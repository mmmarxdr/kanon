import { describe, it, expect } from "vitest";
import client from "prom-client";
import {
  registerTriageMetrics,
  FORBIDDEN_TRIAGE_LABEL_NAMES,
  TRIAGE_PINO_REDACT_PATHS,
  TRIAGE_SQL_BOUNDARIES,
  assertSafeLabelValue,
  buildStageTrace,
  isCorrelationUuid,
  observeSearch,
  observePreview,
  observeProposalOp,
} from "./observability.js";

describe("triage observability — metrics registry", () => {
  it("registers low-cardinality triage metrics on the injected registry", async () => {
    const registry = new client.Registry();
    const metrics = registerTriageMetrics(registry);
    observeSearch(
      metrics,
      { scope: "project", completeness: "complete", outcome: "success" },
      0.12,
      { logicalScanned: 11, returned: 10 },
    );
    observePreview(
      metrics,
      { phase: "prepare", outcome: "success", ai_contributed: "false" },
      0.2,
      ["candidate_timeout"],
    );
    observeProposalOp(
      metrics,
      { operation: "list", outcome: "success" },
      0.15,
      { state_filter: "current", count: 20 },
    );

    const body = await registry.metrics();
    expect(body).toContain("kanon_triage_search_duration_seconds");
    expect(body).toContain("kanon_triage_search_rows");
    expect(body).toContain("kanon_triage_preview_duration_seconds");
    expect(body).toContain("kanon_triage_degradation_total");
    expect(body).toContain("kanon_triage_proposal_requests_total");
    expect(body).toContain("kanon_triage_proposal_duration_seconds");
    expect(body).toContain("kanon_triage_proposal_list_rows");
    expect(body).toContain('measure="returned"');
    expect(body).toContain('operation="list"');
  });

  it("reuses metrics for the same registry (no duplicate registration)", () => {
    const registry = new client.Registry();
    const a = registerTriageMetrics(registry);
    const b = registerTriageMetrics(registry);
    expect(a).toBe(b);
  });

  it("forbids high-cardinality / sensitive label names", () => {
    expect(FORBIDDEN_TRIAGE_LABEL_NAMES).toEqual(
      expect.arrayContaining([
        "query",
        "cursor",
        "model",
        "issueKey",
        "projectId",
        "workspaceId",
        "proposalId",
        "evidence",
      ]),
    );
  });

  it("rejects unsafe label values", () => {
    expect(() => assertSafeLabelValue("success")).not.toThrow();
    expect(() => assertSafeLabelValue("prompt=drop tables")).toThrow(/Unsafe/);
  });
});

describe("triage observability — privacy traces and redaction", () => {
  it("builds stage traces without forbidden detail keys", () => {
    const trace = buildStageTrace({
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
      operation: "preview",
      stage: "policy",
      durationMs: 12,
      outcome: "success",
      details: {
        policyVersion: "v1",
        issueKey: "KAN-42",
        model: "gpt",
        rowsReturned: 3,
      },
    });
    expect(trace.details).toEqual({ policyVersion: "v1", rowsReturned: 3 });
    expect(trace.details).not.toHaveProperty("issueKey");
    expect(trace.details).not.toHaveProperty("model");
  });

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
