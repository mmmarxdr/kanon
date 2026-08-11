import { describe, expect, it } from "vitest";
import {
  ConfidenceBandSchema,
  IssueSearchInputSchema,
  IssueSearchRowSchema,
  IssueSearchResponseSchema,
  PreviewEnvelopeSchema,
  ProposalEnvelopeSchema,
  SemanticErrorSchema,
  validatePreviewSeal,
} from "./contracts.js";

describe("strict triage v1 contracts", () => {
  it("accepts bounded search input and rejects unsupported keys", () => {
    const normalized = IssueSearchInputSchema.safeParse({ q: "  Ｄuplicate　issue  ", limit: 10 });
    expect(normalized.success && normalized.data.q).toBe("duplicate issue");
    expect(IssueSearchInputSchema.safeParse({ q: "duplicate", unsupported: true }).success).toBe(false);
    expect(IssueSearchInputSchema.safeParse({ q: "x", limit: 11 }).success).toBe(false);
    expect(IssueSearchInputSchema.safeParse({ q: "x", scope: { kind: "project" } }).success).toBe(true);
    expect(IssueSearchInputSchema.safeParse({ q: "x", scope: { kind: "workspace", workspaceId: "00000000-0000-4000-8000-000000000001" } }).success).toBe(true);
    expect(IssueSearchInputSchema.safeParse({ q: "x", scope: { kind: "project", workspaceId: "w1" } }).success).toBe(false);
    expect(IssueSearchInputSchema.safeParse({ q: "é".repeat(130) }).success).toBe(false);
    expect(IssueSearchInputSchema.safeParse({ q: Array.from({ length: 13 }, (_, i) => `t${i}`).join(" ") }).success).toBe(false);
    expect(IssueSearchRowSchema.safeParse({ issueId: "i", issueKey: "K-1", projectId: "p", projectKey: "P", title: "t", state: "todo", type: null, priority: null, labels: [], groupKey: null, assigneeId: null, cycleId: null, createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", rank: 1, sourceVersion: "isv1", sourceHash: "a".repeat(64) }).success).toBe(true);
  });
  it("accepts explained confidence bands but no numeric probability", () => {
    expect(ConfidenceBandSchema.safeParse("high").success).toBe(true);
    expect(ConfidenceBandSchema.safeParse(0.99).success).toBe(false);
  });
  it("validates a complete preview envelope with strict nested objects", () => {
    const result = PreviewEnvelopeSchema.safeParse({
      contractVersion: "triage-preview.v1",
      previewIdentity: "preview-1",
      previewSeal: "seal-1",
      target: {
        issueId: "i1", issueKey: "KAN-1", projectId: "p1", projectKey: "KAN", workspaceId: "w1",
        sourceVersion: "isv1.a", sourceHash: "a".repeat(64),
      },
      observedAt: "2025-01-01T00:00:00.000Z",
      generatedAt: "2025-01-01T00:00:01.000Z",
      authorizationPolicyVersion: "authz-policy.v1",
      effectiveScope: { kind: "project", projectId: "p1", workspaceId: "w1" },
      searchCompleteness: "complete",
      correlationId: "trace-1",
      policy: { id: "triage-policy", version: "1" },
      recommendations: [{ itemId: "i", state: "supported", normalized: { concept: "priority", operation: "set", value: "high", metadataOnly: false }, source: "deterministic_policy", reason: "r", evidence: [{ evidenceRefId: "e", sourceClass: "deterministic_fact", field: "priority", fact: "f" }], confidence: "low", confidenceBasis: "b", ruleVersion: "rule.v1" }], candidates: [], conflicts: [], unknowns: [], degradation: [],
    });
    expect(result.success).toBe(true);
    expect(PreviewEnvelopeSchema.safeParse(result.success ? { ...result.data, recommendations: [{ itemId: "i", state: "supported", normalized: { concept: "priority", operation: "recommend", value: {}, metadataOnly: false }, source: "deterministic_policy", reason: "r", evidence: [{ evidenceRefId: "e", sourceClass: "deterministic_fact", field: "priority", fact: "f" }], confidence: "low", confidenceBasis: "b" }] } : {}).success).toBe(false);
    expect(PreviewEnvelopeSchema.safeParse({
      contractVersion: "triage-preview.v1", previewIdentity: "p", previewSeal: "s",
    }).success).toBe(false);
  });

  it("requires a bounded normalized proposal payload and generator identity", () => {
    const proposal = { kind: "issue_triage_v1", contractVersion: "triage-proposal.v1", identityDigest: "a".repeat(64), target: { issueId: "i", issueKey: "K-1", projectId: "p", projectKey: "P", workspaceId: "w", sourceVersion: "isv1", sourceHash: "a".repeat(64) }, sourceSeal: "seal", authorizationPolicyVersion: "authz-policy.v1", effectiveScope: { kind: "project", projectId: "p", workspaceId: "w" }, provenance: {}, lifecycle: "pending", createdAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-01-08T00:00:00.000Z", nonExecutable: true };
    const valid = { ...proposal, normalizedPayload: { actions: [{ concept: "priority", operation: "set", value: "high", metadataOnly: false }], candidateIds: [] }, generator: { kind: "kanon_policy", id: "triage-preview", version: "1", policy: { id: "triage-policy", version: "1" } } };
    expect(ProposalEnvelopeSchema.safeParse(valid).success).toBe(true);
    expect(ProposalEnvelopeSchema.safeParse({ ...valid, normalizedPayload: { actions: [], candidateIds: [] } }).success).toBe(false);
    expect(ProposalEnvelopeSchema.safeParse({ ...valid, normalizedPayload: { nested: [] } }).success).toBe(false);
    expect(ProposalEnvelopeSchema.safeParse({ ...valid, generator: { kind: "host_ai_hybrid", id: "host", version: "1" } }).success).toBe(false);
  });

  it("rejects contradictory search pagination metadata", () => {
    const response = { contractVersion: "issue-search.v1", orderingVersion: "issue-search.v1", limit: 1, effectiveScope: { kind: "project", workspaceId: "w", projectId: "p" }, correlationId: "trace", degradation: [], rows: [] };
    expect(IssueSearchResponseSchema.safeParse({ ...response, completeness: "complete", returnedCount: 0, nextCursor: "c" }).success).toBe(false);
    expect(IssueSearchResponseSchema.safeParse({ ...response, completeness: "bounded", returnedCount: 0 }).success).toBe(false);
    expect(IssueSearchResponseSchema.safeParse({ ...response, completeness: "complete", returnedCount: 1 }).success).toBe(false);
  });
  it("keeps seal authenticity, freshness, and binding validation separate from identity", () => {
    const valid = validatePreviewSeal({ authenticated: true, expiresAt: "2030-01-01T00:00:00.000Z", now: new Date("2029-01-01T00:00:00.000Z"), actualBinding: { source: "a" }, expectedBinding: { source: "a" } });
    expect(valid).toEqual({ valid: true, authenticated: true, fresh: true, bound: true });
    expect(validatePreviewSeal({ authenticated: false, expiresAt: "2030-01-01T00:00:00.000Z", actualBinding: {}, expectedBinding: {} }).reason).toBe("unauthenticated");
    expect(validatePreviewSeal({ authenticated: true, expiresAt: "2020-01-01T00:00:00.000Z", actualBinding: {}, expectedBinding: {} }).reason).toBe("expired");
    expect(validatePreviewSeal({ authenticated: true, expiresAt: "2030-01-01T00:00:00.000Z", actualBinding: { source: "a" }, expectedBinding: { source: "b" } }).reason).toBe("binding_mismatch");
  });

  it("keeps semantic error categories and provenance typed", () => {
    const result = SemanticErrorSchema.safeParse({
      apiContractVersion: "triage-api.v1", category: "source_conflict", code: "SEARCH_SOURCE_CONFLICT",
      retry: "rerun_preview", message: "source changed", correlationId: "trace-1",
      provenance: { authorizationPolicyVersion: "authz-policy.v1", sourceVersion: "isv1.a" },
    });
    expect(result.success).toBe(true);
    expect(SemanticErrorSchema.safeParse({ ...result.success ? result.data : {}, extra: true }).success).toBe(false);
  });
});
