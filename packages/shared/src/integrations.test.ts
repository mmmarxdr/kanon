import { describe, expect, it } from "vitest";
import {
  integrationConnectionSchema,
  redmineReconciliationActivationProgressSchema,
  redmineReconciliationDecisionSchema,
  redmineReconciliationFactorEvidenceSchema,
  redmineReconciliationMaterializeResultSchema,
  redmineReconciliationMaterializeTargetSchema,
  redmineReconciliationPreviewProgressSchema,
  redmineReconciliationPreviewRequestSchema,
  redmineReconciliationRecommendationPageSchema,
  redmineReconciliationRecommendationQuerySchema,
  redmineReconciliationReviewPageRequestSchema,
  redmineReconciliationReviewPageResultSchema,
} from "./integrations.js";

const credential = {
  connected: true,
  status: "valid",
  externalUserId: "remote-user",
  externalLogin: "alice",
  lastValidatedAt: "2026-08-02T18:00:00.000Z",
  revokedAt: null,
} as const;

const connection = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  provider: "redmine",
  baseUrl: "https://redmine.example.test",
  lifecycle: "active",
  lifecycleEpoch: 1,
  serviceFallbackEnabled: false,
  serviceCredentialStatus: "invalid",
  serviceCredentialIsCaller: true,
  syncHealth: {
    status: "credential_blocked",
    blockedWork: {
      total: 1,
      items: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          entityType: "issue",
          entityId: "77777777-7777-4777-8777-777777777777",
          operation: "update",
          state: "dead",
          reason: "credential_invalid",
          updatedAt: "2026-08-04T10:00:00.000Z",
        },
      ],
    },
  },
  discoveredStatuses: [{ id: "1", name: "New", writable: true }],
  providerMaps: {
    readMap: { "1": "backlog" },
    writeMap: { backlog: "1" },
    priorityReadMap: { "4": "high" },
    priorityWriteMap: { critical: "4", high: "4", medium: "3", low: "2" },
    timeActivityId: "9",
  },
  bindings: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      projectId: "44444444-4444-4444-8444-444444444444",
      remoteProjectId: "5",
      readMap: { "1": "backlog" },
      writeMap: { backlog: "1" },
      timeActivityId: "9",
      lifecycle: "active",
      lifecycleEpoch: 1,
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
      releasePending: false,
      inboundReady: true,
      reconciliationRequired: true,
    },
  ],
  callerCredential: credential,
  connectedMemberIds: ["55555555-5555-4555-8555-555555555555"],
  counts: { workspaceMembers: 1, validCredentials: 1, externalIdentities: 1 },
} as const;

describe("integrationConnectionSchema", () => {
  it("parses the workspace connection and member coverage contract", () => {
    const result = integrationConnectionSchema.parse(connection);

    expect(result.connectedMemberIds).toEqual(["55555555-5555-4555-8555-555555555555"]);
    expect(result.bindings[0]?.readMap).toEqual({ "1": "backlog" });
    expect(result.bindings[0]).toMatchObject({
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
      reconciliationRequired: true,
    });
    expect(result.providerMaps?.priorityReadMap).toEqual({ "4": "high" });
    expect(result.serviceCredentialStatus).toBe("invalid");
    expect(result.serviceCredentialIsCaller).toBe(true);
    expect(result.syncHealth).toMatchObject({
      status: "credential_blocked",
      blockedWork: { total: 1, items: [{ state: "dead" }] },
    });
  });

  it("rejects unknown mapped issue states", () => {
    const result = integrationConnectionSchema.safeParse({
      ...connection,
      bindings: [
        {
          ...connection.bindings[0],
          readMap: { "1": "shipped" },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-boolean binding rollout gates", () => {
    const result = integrationConnectionSchema.safeParse({
      ...connection,
      bindings: [{ ...connection.bindings[0], commentDispatchEnabled: "true" }],
    });

    expect(result.success).toBe(false);
  });

  it("parses owner-visible private comment uncertainty", () => {
    const result = integrationConnectionSchema.parse({
      ...connection,
      syncHealth: {
        status: "attention_required",
        blockedWork: {
          total: 1,
          items: [
            {
              ...connection.syncHealth.blockedWork.items[0],
              reason: "private-comment-write-uncertain",
            },
          ],
        },
      },
    });

    expect(result.syncHealth).toMatchObject({
      status: "attention_required",
      blockedWork: {
        items: [{ reason: "private-comment-write-uncertain" }],
      },
    });
  });

  it("parses owner-visible privacy recovery descriptors without exposing a binding id", () => {
    const result = integrationConnectionSchema.parse({
      ...connection,
      privacyRecovery: [
        {
          projectId: "44444444-4444-4444-8444-444444444444",
          remoteProjectId: "5",
          status: "released",
        },
      ],
    });

    expect(result.privacyRecovery).toEqual([
      {
        projectId: "44444444-4444-4444-8444-444444444444",
        remoteProjectId: "5",
        status: "released",
      },
    ]);
    expect(JSON.stringify(result.privacyRecovery)).not.toContain("33333333-3333-4333-8333-333333333333");
  });

  it("rejects more than 20 auth-blocked work details", () => {
    const item = connection.syncHealth.blockedWork.items[0];
    const result = integrationConnectionSchema.safeParse({
      ...connection,
      syncHealth: {
        status: "credential_blocked",
        blockedWork: {
          total: 21,
          items: Array.from({ length: 21 }, (_, index) => ({
            ...item,
            id: `${String(index + 1).padStart(8, "0")}-6666-4666-8666-666666666666`,
          })),
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

it("accepts only bounded owner-safe audit health", async () => {
  const { integrationAuditHealthSchema } = await import("./integrations.js");
  expect(integrationAuditHealthSchema.parse({
    state: "complete",
    completedAt: "2026-08-13T12:00:00.000Z",
    validUntil: "2026-08-13T12:05:00.000Z",
    fresh: true,
    reasonCode: null,
  })).toMatchObject({ state: "complete", fresh: true });
  expect(integrationAuditHealthSchema.safeParse({
    state: "complete",
    completedAt: null,
    validUntil: null,
    fresh: false,
    reasonCode: "provider response with secrets",
  }).success).toBe(false);
});

it("exports owner-safe audit health through the public shared contract", async () => {
  const { integrationAuditHealthSchema } = await import("./index.js");
  expect(integrationAuditHealthSchema.parse({
    state: "unknown",
    completedAt: null,
    validUntil: null,
    fresh: false,
    reasonCode: null,
  })).toMatchObject({ state: "unknown", fresh: false });
});

describe("Redmine reconciliation contracts", () => {
  const hash = `sha256:${"a".repeat(64)}`;
  const evidence = { scorerVersion: "redmine-reconciliation-score.v1", projectEligible: true, titleContribution: 50, descriptionContribution: 25, dateComparable: true, dateContribution: 10, assigneeComparable: true, assigneeContribution: 10, stateComparable: true, stateContribution: 5, score: 100, localFingerprint: hash, remoteFingerprint: hash } as const;

  it("accepts bounded preview, target, query, decision, and progress inputs", () => {
    expect(redmineReconciliationPreviewRequestSchema.parse({ mode: "full" })).toEqual({ mode: "full" });
    expect(redmineReconciliationMaterializeTargetSchema.parse({ remoteIssueId: "42" })).toEqual({ remoteIssueId: "42" });
    expect(redmineReconciliationRecommendationQuerySchema.parse({ limit: "50" })).toMatchObject({ limit: 50, state: "pending" });
    expect(redmineReconciliationDecisionSchema.parse({ kind: "manual-link", candidateIssueId: "11111111-1111-4111-8111-111111111111", localFingerprint: hash, remoteFingerprint: hash })).toMatchObject({ kind: "manual-link" });
    expect(redmineReconciliationPreviewProgressSchema.parse({ previewIdentity: "22222222-2222-4222-8222-222222222222", mode: "future_only", cutoff: new Date("2026-08-21T12:00:00.000Z"), checkpoint: null, complete: true, scannedCount: 3, remainingCount: 0, eligibleUnlinkedCount: 0, excludedPrivateCount: 1, linkedCount: 2, mappingGaps: { statusIds: [], priorityIds: [], assigneeRemoteUserIds: [] } })).toMatchObject({ complete: true, mode: "future_only" });
    expect(redmineReconciliationActivationProgressSchema.parse({ importedCount: 1, issueKeys: ["KAN-1"], replayed: false, complete: false, processedCount: 10, remainingCount: 1 })).toMatchObject({ complete: false, remainingCount: 1 });
    expect(redmineReconciliationMaterializeTargetSchema.parse({ remoteIssueId: "42", candidateIssueId: "11111111-1111-4111-8111-111111111111" })).toMatchObject({ candidateIssueId: "11111111-1111-4111-8111-111111111111" });
  });

  it("accepts only strict content-safe hydrated materialization results", () => {
    const recommendation = { id: "11111111-1111-4111-8111-111111111111", score: 100, factorEvidence: evidence, decisionState: "pending", decisionKind: null, decidedById: null, decidedAt: null, acceptedRefId: null, localIssue: { id: "22222222-2222-4222-8222-222222222222", key: "KAN-1", title: "Local title" } };
    const result = { remote: { id: "42", title: "Remote title", sourceVersion: hash }, recommendations: [recommendation], manualCandidate: { score: 100, factorEvidence: evidence, localIssue: recommendation.localIssue } };
    expect(redmineReconciliationMaterializeResultSchema.parse(result)).toEqual(result);
    expect(redmineReconciliationMaterializeResultSchema.safeParse({ ...result, remote: { ...result.remote, description: "secret" } }).success).toBe(false);
    expect(redmineReconciliationMaterializeResultSchema.safeParse({ ...result, recommendations: [{ ...recommendation, description: "secret" }] }).success).toBe(false);
    expect(redmineReconciliationMaterializeResultSchema.safeParse({ ...result, recommendations: Array(4).fill(recommendation) }).success).toBe(false);
    expect(redmineReconciliationMaterializeResultSchema.safeParse({ ...result, providerMetadata: {} }).success).toBe(false);
  });

  it("bounds strict review-page requests and content-safe responses", async () => {
    const recommendation = { id: "11111111-1111-4111-8111-111111111111", score: 100, factorEvidence: evidence, decisionState: "pending", decisionKind: null, decidedById: null, decidedAt: null, acceptedRefId: null, localIssue: { id: "22222222-2222-4222-8222-222222222222", key: "KAN-1", title: "Local" } };
    const item = { remote: { id: "42", title: "Remote", sourceVersion: hash }, recommendations: [recommendation], manualCandidate: null };
    const page = { previewIdentity: "33333333-3333-4333-8333-333333333333", processedCandidateCount: 1, remainingCandidateCount: 0, hiddenCount: 0, linkedCount: 0, items: [item], nextCursor: null };
    expect(redmineReconciliationReviewPageRequestSchema.parse({})).toEqual({ limit: 5 });
    expect(redmineReconciliationReviewPageResultSchema.parse(page)).toEqual(page);
    expect(redmineReconciliationReviewPageRequestSchema.safeParse({ limit: 6 }).success).toBe(false);
    expect(redmineReconciliationReviewPageRequestSchema.safeParse({ cursor: "bad+cursor" }).success).toBe(false);
    expect(redmineReconciliationReviewPageResultSchema.safeParse({ ...page, items: Array(6).fill(item), processedCandidateCount: 6 }).success).toBe(false);
    expect(redmineReconciliationReviewPageResultSchema.safeParse({ ...page, items: [{ ...item, remote: { ...item.remote, description: "secret" } }] }).success).toBe(false);
    expect(redmineReconciliationReviewPageResultSchema.safeParse({ ...page, hiddenCount: 1 }).success).toBe(false);
    expect((await import("./index.js")).redmineReconciliationReviewPageRequestSchema).toBe(redmineReconciliationReviewPageRequestSchema);
    expect((await import("./index.js")).redmineReconciliationReviewPageResultSchema).toBe(redmineReconciliationReviewPageResultSchema);
  });

  it("rejects malformed, unbounded, or content-bearing reconciliation data", () => {
    expect(redmineReconciliationPreviewRequestSchema.safeParse({ mode: "all" }).success).toBe(false);
    expect(redmineReconciliationMaterializeTargetSchema.safeParse({ remoteIssueId: "issue-42" }).success).toBe(false);
    expect(redmineReconciliationMaterializeTargetSchema.safeParse({ remoteIssueId: "42", candidateIssueId: "bad" }).success).toBe(false);
    expect(redmineReconciliationRecommendationQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(redmineReconciliationRecommendationQuerySchema.safeParse({ cursor: "x".repeat(513) }).success).toBe(false);
    expect(redmineReconciliationDecisionSchema.safeParse({ kind: "manual-link", candidateIssueId: "11111111-1111-4111-8111-111111111111", localFingerprint: "bad", remoteFingerprint: hash }).success).toBe(false);
    expect(redmineReconciliationRecommendationPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(redmineReconciliationFactorEvidenceSchema.safeParse({ ...evidence, title: "secret" }).success).toBe(false);
  });
});
