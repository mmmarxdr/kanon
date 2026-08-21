import { z } from "zod";
import { issuePrioritySchema, issueStateSchema } from "./issue.js";

export const integrationLifecycleSchema = z.enum([
  "draft",
  "active",
  "pausing",
  "paused",
  "disabled",
]);

export const integrationCredentialStatusSchema = z.enum([
  "missing",
  "unknown",
  "valid",
  "invalid",
  "revoked",
]);

export const integrationCredentialSchema = z.object({
  connected: z.boolean(),
  status: integrationCredentialStatusSchema,
  externalUserId: z.string().nullable(),
  externalLogin: z.string().nullable(),
  lastValidatedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const integrationDiscoverySchema = z.object({
  statuses: z.array(
    z.object({ id: z.string(), name: z.string(), writable: z.boolean() }),
  ),
  priorities: z.array(z.object({ id: z.string(), name: z.string() })),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  timeEntryActivities: z.array(
    z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() }),
  ),
});

export const integrationConnectionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  provider: z.string(),
  baseUrl: z.string(),
  lifecycle: integrationLifecycleSchema,
  lifecycleEpoch: z.number().int(),
  serviceFallbackEnabled: z.boolean(),
  serviceCredentialStatus: integrationCredentialStatusSchema,
  serviceCredentialIsCaller: z.boolean(),
  syncHealth: z.object({
    status: z.enum(["healthy", "inactive", "credential_blocked", "attention_required"]),
    blockedWork: z
      .object({
        total: z.number().int().nonnegative(),
        items: z
          .array(
            z.object({
              id: z.string().uuid(),
              entityType: z.string().min(1),
              entityId: z.string().uuid(),
              operation: z.enum(["create", "update", "delete", "close"]),
              state: z.enum(["dead", "ambiguous"]),
              reason: z.enum(["credential_invalid", "private-comment-write-uncertain"]),
              updatedAt: z.string(),
            }),
          )
          .max(20),
      })
      .nullable(),
  }),
  discoveredStatuses: integrationDiscoverySchema.shape.statuses.nullable(),
  providerMaps: z
    .object({
      readMap: z.record(z.string(), issueStateSchema).nullable(),
      writeMap: z.record(z.string(), z.string()).nullable(),
      priorityReadMap: z.record(z.string(), issuePrioritySchema).nullable(),
      priorityWriteMap: z.record(issuePrioritySchema, z.string()).nullable(),
      timeActivityId: z.string().nullable(),
    })
    .nullable(),
  privacyRecovery: z
    .array(
      z.object({
        projectId: z.string().uuid(),
        remoteProjectId: z.string().min(1),
        status: z.enum(["draining", "released"]),
      }),
    )
    .nullable()
    .default(null),
  bindings: z.array(
    z.object({
      id: z.string().uuid(),
      projectId: z.string().uuid(),
      remoteProjectId: z.string(),
      readMap: z.record(z.string(), issueStateSchema),
      writeMap: z.record(z.string(), z.string()),
      timeActivityId: z.string().nullable(),
      lifecycle: integrationLifecycleSchema,
      lifecycleEpoch: z.number().int(),
      commentCaptureEnabled: z.boolean(),
      commentDispatchEnabled: z.boolean(),
      releasePending: z.boolean(),
    }),
  ),
  callerCredential: integrationCredentialSchema,
  connectedMemberIds: z.array(z.string().uuid()),
  counts: z.object({
    workspaceMembers: z.number().int().nonnegative(),
    validCredentials: z.number().int().nonnegative(),
    externalIdentities: z.number().int().nonnegative(),
  }),
});

export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;
export type IntegrationDiscovery = z.infer<typeof integrationDiscoverySchema>;

/** Owner-safe audit state; it never carries provider content or enumeration detail. */
export const integrationAuditHealthSchema = z.object({
  state: z.enum(["complete", "partial", "failed", "stale", "unknown"]),
  completedAt: z.string().nullable(),
  validUntil: z.string().nullable(),
  fresh: z.boolean(),
  reasonCode: z.enum(["timeout", "unauthorized", "rate_limited", "malformed_response", "pagination_drift", "detail_drift", "provider_failure", "scope_or_fence_changed", "did_not_converge", "unknown"]).nullable(),
});
export type IntegrationAuditHealth = z.infer<typeof integrationAuditHealthSchema>;

const reconciliationUuid = z.string().uuid();
const reconciliationRemoteId = z.string().regex(/^\d+$/).max(64);
const reconciliationHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const reconciliationCount = z.number().int().nonnegative();
export const redmineReconciliationPreviewModeSchema = z.enum(["full", "future_only"]);
export const redmineReconciliationPreviewRequestSchema = z.object({ mode: redmineReconciliationPreviewModeSchema }).strict();
export const redmineReconciliationMaterializeTargetSchema = z
  .object({ remoteIssueId: reconciliationRemoteId, candidateIssueId: reconciliationUuid.optional() })
  .strict();
export const redmineReconciliationRecommendationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
    state: z.enum(["pending", "accepted", "rejected"]).default("pending"),
  })
  .strict();
const checkpointSchema = z.object({ updatedAt: z.string().datetime(), remoteId: reconciliationRemoteId, pageToken: z.string().max(512).nullable() }).strict();
export const redmineReconciliationPreviewProgressSchema = z
  .object({
    previewIdentity: reconciliationUuid,
    mode: redmineReconciliationPreviewModeSchema,
    cutoff: z.preprocess((value) => value instanceof Date ? value.toISOString() : value, z.string().datetime()),
    checkpoint: checkpointSchema.nullable(),
    complete: z.boolean(),
    scannedCount: reconciliationCount,
    remainingCount: reconciliationCount,
    eligibleUnlinkedCount: reconciliationCount,
    excludedPrivateCount: reconciliationCount,
    linkedCount: reconciliationCount,
    mappingGaps: z.object({
      statusIds: z.array(reconciliationRemoteId).max(10_000),
      priorityIds: z.array(reconciliationRemoteId).max(10_000),
      assigneeRemoteUserIds: z.array(reconciliationRemoteId).max(10_000),
    }),
  })
  .strict();
export const redmineReconciliationFactorEvidenceSchema = z
  .object({
    scorerVersion: z.literal("redmine-reconciliation-score.v1"),
    projectEligible: z.literal(true),
    titleContribution: z.number().int().min(0).max(50),
    descriptionContribution: z.number().int().min(0).max(25),
    dateComparable: z.boolean(),
    dateContribution: z.number().int().min(0).max(10),
    assigneeComparable: z.boolean(),
    assigneeContribution: z.union([z.literal(0), z.literal(10)]),
    stateComparable: z.boolean(),
    stateContribution: z.union([z.literal(0), z.literal(5)]),
    score: z.number().int().min(0).max(100),
    localFingerprint: reconciliationHash,
    remoteFingerprint: reconciliationHash,
  })
  .strict()
  .superRefine((value, context) => {
    const total = value.titleContribution + value.descriptionContribution + value.dateContribution + value.assigneeContribution + value.stateContribution;
    if (value.score !== total || (!value.dateComparable && value.dateContribution) || (!value.assigneeComparable && value.assigneeContribution) || (!value.stateComparable && value.stateContribution)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid reconciliation factors" });
  });
const recommendationSchema = z
  .object({
    id: reconciliationUuid,
    bindingId: reconciliationUuid,
    remoteIssueId: reconciliationRemoteId,
    remoteSourceVersion: reconciliationHash,
    candidateIssueId: reconciliationUuid,
    score: z.number().int().min(0).max(100),
    scoringVersion: z.literal("redmine-reconciliation-score.v1"),
    factorEvidence: redmineReconciliationFactorEvidenceSchema,
    localFingerprint: reconciliationHash,
    remoteFingerprint: reconciliationHash,
    decisionState: z.enum(["pending", "accepted", "rejected"]),
    decisionKind: z.string().max(64).nullable(),
    decidedById: reconciliationUuid.nullable(),
    decidedAt: z.string().datetime().nullable(),
    acceptedRefId: reconciliationUuid.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const redmineReconciliationRecommendationPageSchema = z
  .object({ items: z.array(recommendationSchema).max(50), nextCursor: z.string().max(512).nullable() })
  .strict();
export const redmineReconciliationDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reject"), recommendationId: reconciliationUuid }).strict(),
  z.object({ kind: z.literal("reject-all") }).strict(),
  z.object({ kind: z.literal("accept"), recommendationId: reconciliationUuid }).strict(),
  z.object({ kind: z.literal("manual-link"), candidateIssueId: reconciliationUuid, localFingerprint: reconciliationHash, remoteFingerprint: reconciliationHash }).strict(),
]);
const hydratedLocalIssueSchema = z.object({ id: reconciliationUuid, key: z.string(), title: z.string() }).strict();
const scoredLocalIssueShape = { score: z.number().int().min(0).max(100), factorEvidence: redmineReconciliationFactorEvidenceSchema, localIssue: hydratedLocalIssueSchema };
const hydratedRecommendationSchema = z.object({
  id: reconciliationUuid,
  ...scoredLocalIssueShape,
  decisionState: z.enum(["pending", "accepted", "rejected"]),
  decisionKind: z.string().max(64).nullable(),
  decidedById: reconciliationUuid.nullable(),
  decidedAt: z.string().datetime().nullable(),
  acceptedRefId: reconciliationUuid.nullable(),
}).strict();
export const redmineReconciliationMaterializeResultSchema = z.object({
  remote: z.object({ id: reconciliationRemoteId, title: z.string().nullable(), sourceVersion: reconciliationHash }).strict(),
  recommendations: z.array(hydratedRecommendationSchema).max(3),
  manualCandidate: z.object(scoredLocalIssueShape).strict().nullable(),
}).strict();
export const redmineReconciliationDecisionResultSchema = z.union([
  z.object({ remoteIssueId: reconciliationRemoteId, recommendationId: reconciliationUuid.optional(), rejectedCount: reconciliationCount, replayed: z.boolean() }).strict(),
  z.object({ remoteIssueId: reconciliationRemoteId, candidateIssueId: reconciliationUuid, recommendationId: reconciliationUuid, refId: reconciliationUuid, replayed: z.boolean() }).strict(),
]);
export const redmineReconciliationActivationProgressSchema = z.object({ importedCount: reconciliationCount, issueKeys: z.array(z.string().min(1).max(64)).max(10), replayed: z.boolean(), complete: z.boolean(), processedCount: reconciliationCount, remainingCount: reconciliationCount }).strict();
