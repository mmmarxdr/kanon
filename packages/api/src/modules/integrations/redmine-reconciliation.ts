import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import {
  assertRedmineReconciliationFactorEvidence,
  rankRedmineReconciliationCandidates,
  REDMINE_RECONCILIATION_SCORER_VERSION,
} from "./redmine-reconciliation-score.js";
import { issueSyncMetadata } from "./issue-convergence.js";
import { reconciliationScopeFingerprint } from "./redmine-import.js";
import { ownedConnection, serviceCredential } from "./service.js";
const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const FullPreview = z
  .object({
    version: z.literal(2),
    complete: z.literal(true),
    mode: z.literal("full"),
    previewIdentity: z.string().uuid(),
    scopeFingerprint: Hash,
    candidates: z.array(z.object({ remoteId: z.string().regex(/^\d+$/), sourceVersion: Hash }).strict()),
    assigneeRemoteIds: z.array(z.string().regex(/^\d+$/)).default([]),
  })
  .passthrough();
const DecisionState = z.enum(["pending", "accepted", "rejected"]);
const Cursor = z.object({ score: z.number().int(), id: z.string().uuid() }).strict();
const ReviewCursor = z.object({ previewIdentity: z.string().uuid(), offset: z.number().int().nonnegative() }).strict();
const MAX_PAGE = 50;
const MAX_REVIEW_PAGE = 5;
type Database = Prisma.TransactionClient;
export type RedmineReconciliationRequest = Readonly<{ connectionId: string; bindingId: string; userId: string; remoteIssueId: string }>;
export type RedmineReconciliationMaterializeRequest = RedmineReconciliationRequest & Readonly<{ candidateIssueId?: string }>;
export interface RedmineReconciliationRemoteDetail {
  readonly remoteIssueId: string;
  readonly remoteProjectId: string;
  readonly sourceVersion: string;
  readonly previewIdentity: string;
  readonly scopeFingerprint: string;
  readonly visible: boolean;
  readonly title: string | null;
  readonly description?: string | null;
  readonly createdAt?: string | Date | null;
  readonly changedAt?: Date;
  readonly completedAt?: Date | null;
  readonly mappedAssigneeId?: string | null;
  readonly mappedState?: string | null;
  readonly mappedPriority?: string | null;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly progress?: number;
}
export type RedmineReconciliationDependencies = Readonly<{ loadRemoteIssue: (remoteIssueId: string) => Promise<RedmineReconciliationRemoteDetail>; allowedProjectIds?: string[] | null; workspaceId?: string }>;
type ScopeOptions = Readonly<{ allowedProjectIds?: string[] | null; workspaceId?: string }>;
async function bindingScope(database: Database, request: Pick<RedmineReconciliationRequest, "connectionId" | "bindingId" | "userId">, options: ScopeOptions) {
  const connection = await ownedConnection(database, request.connectionId, request.userId, options.workspaceId);
  if (connection.provider !== "redmine") {
    throw new AppError(400, "INVALID_INTEGRATION_PROVIDER", "Connection is not a Redmine integration");
  }
  const binding = await database.integrationProjectBinding.findFirst({
    where: {
      id: request.bindingId,
      connectionId: request.connectionId,
      releaseRequestedAt: null,
      releasedAt: null,
      project: { archived: false },
      ...(options.allowedProjectIds?.length ? { projectId: { in: options.allowedProjectIds } } : {}),
    },
  });
  if (!binding) {
    throw new AppError(404, "INTEGRATION_BINDING_NOT_FOUND", "Integration project binding not found");
  }
  if (
    !["draft", "paused"].includes(connection.lifecycle) ||
    !["draft", "paused"].includes(binding.lifecycle)
  ) {
    throw new AppError(409, "REDMINE_RECONCILIATION_LIFECYCLE", "Reconciliation requires a draft or paused binding");
  }
  const preview = FullPreview.safeParse(binding.bootstrapPageToken);
  if (binding.bootstrapState !== "previewed" || !preview.success) {
    throw new AppError(409, "REDMINE_RECONCILIATION_PREVIEW_REQUIRED", "Complete a full Redmine preview first");
  }
  return { connection, binding, preview: preview.data };
}
function validateRemoteIdentity(scope: Awaited<ReturnType<typeof bindingScope>>, requestedId: string, detail: RedmineReconciliationRemoteDetail) {
  const listed = scope.preview.candidates.find(
    ({ remoteId }) => remoteId === requestedId && detail.remoteIssueId === requestedId,
  );
  if (!listed) {
    throw new AppError(409, "REDMINE_RECONCILIATION_UNLISTED", "The Redmine issue is not in this preview");
  }
  if (detail.remoteProjectId !== scope.binding.remoteProjectId) {
    throw new AppError(409, "REDMINE_RECONCILIATION_PROJECT_MISMATCH", "The Redmine issue belongs to another project");
  }
  if (
    detail.previewIdentity !== scope.preview.previewIdentity ||
    detail.scopeFingerprint !== scope.preview.scopeFingerprint
  ) {
    throw new AppError(409, "REDMINE_RECONCILIATION_SCOPE_STALE", "The reconciliation scope changed");
  }
  return listed;
}
function validateRemote(scope: Awaited<ReturnType<typeof bindingScope>>, requestedId: string, detail: RedmineReconciliationRemoteDetail) {
  const listed = validateRemoteIdentity(scope, requestedId, detail);
  if (!detail.visible) {
    throw new AppError(409, "REDMINE_RECONCILIATION_NOT_VISIBLE", "The Redmine issue is not visible");
  }
  if (listed.sourceVersion !== detail.sourceVersion) {
    throw new AppError(409, "REDMINE_RECONCILIATION_SOURCE_STALE", "The Redmine issue changed after preview");
  }
}
export async function materializeRedmineReconciliationRecommendations(request: RedmineReconciliationMaterializeRequest, dependencies: RedmineReconciliationDependencies) {
  await bindingScope(prisma, request, dependencies);
  const detail = await dependencies.loadRemoteIssue(request.remoteIssueId);
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${request.bindingId}::uuid FOR UPDATE`);
    const scope = await bindingScope(transaction, request, dependencies);
    validateRemote(scope, request.remoteIssueId, detail);
    const linkedRemote = await transaction.externalRef.count({
      where: { connectionId: request.connectionId, entityType: "issue", externalId: request.remoteIssueId },
    });
    if (linkedRemote) {
      throw new AppError(409, "REDMINE_RECONCILIATION_ALREADY_LINKED", "The Redmine issue is already linked");
    }
    const issues = await transaction.issue.findMany({
      where: { projectId: scope.binding.projectId },
      select: { id: true, key: true, projectId: true, title: true, description: true, createdAt: true, assigneeId: true, state: true },
    });
    const linkedLocals = issues.length
      ? await transaction.externalRef.findMany({
          where: { connectionId: request.connectionId, entityType: "issue", entityId: { in: issues.map(({ id }) => id) } },
          select: { entityId: true },
        })
      : [];
    const linkedIds = new Set(linkedLocals.map(({ entityId }) => entityId));
    const remote = {
      id: detail.remoteIssueId, projectId: scope.binding.projectId, title: detail.title,
      description: detail.description, createdAt: detail.createdAt,
      mappedAssigneeId: detail.mappedAssigneeId, mappedState: detail.mappedState,
    };
    const manualIssue = request.candidateIssueId
      ? issues.find(({ id }) => id === request.candidateIssueId)
      : undefined;
    if (request.candidateIssueId && !manualIssue) {
      throw new AppError(409, "REDMINE_RECONCILIATION_CANDIDATE_INVALID", "The Kanon issue is not in the bound project");
    }
    if (manualIssue && linkedIds.has(manualIssue.id)) {
      throw new AppError(409, "REDMINE_RECONCILIATION_CANDIDATE_LINKED", "The Kanon issue is already linked to this connection");
    }
    const ranked = rankRedmineReconciliationCandidates(
      remote,
      issues.filter(({ id }) => !linkedIds.has(id)),
    );
    const manualScore = manualIssue
      ? rankRedmineReconciliationCandidates(remote, [manualIssue])[0]
      : undefined;
    ranked.forEach(({ evidence }) => assertRedmineReconciliationFactorEvidence(evidence));
    if (manualScore) assertRedmineReconciliationFactorEvidence(manualScore.evidence);
    const snapshots = ranked.map(({ candidateIssueId, evidence }) => ({
      remoteSourceVersion: detail.sourceVersion,
      candidateIssueId,
      scoringVersion: REDMINE_RECONCILIATION_SCORER_VERSION,
      localFingerprint: evidence.localFingerprint,
      remoteFingerprint: evidence.remoteFingerprint,
    }));
    await transaction.integrationReconciliationRecommendation.deleteMany({
      where: {
        bindingId: scope.binding.id,
        previewIdentity: scope.preview.previewIdentity,
        remoteIssueId: detail.remoteIssueId,
        decisionState: "pending",
        ...(snapshots.length ? { NOT: { OR: snapshots } } : {}),
      },
    });
    await transaction.integrationReconciliationRecommendation.createMany({
      data: ranked.map(({ candidateIssueId, score, evidence }) => ({
        bindingId: scope.binding.id,
        previewIdentity: scope.preview.previewIdentity,
        remoteIssueId: detail.remoteIssueId,
        remoteSourceVersion: detail.sourceVersion,
        candidateIssueId,
        score,
        scoringVersion: REDMINE_RECONCILIATION_SCORER_VERSION,
        factorEvidence: evidence as unknown as Prisma.InputJsonValue,
        localFingerprint: evidence.localFingerprint,
        remoteFingerprint: evidence.remoteFingerprint,
      })),
      skipDuplicates: true,
    });
    const current = snapshots.length
      ? await transaction.integrationReconciliationRecommendation.findMany({
          where: {
            bindingId: scope.binding.id,
            previewIdentity: scope.preview.previewIdentity,
            remoteIssueId: detail.remoteIssueId,
            remoteSourceVersion: detail.sourceVersion,
            scoringVersion: REDMINE_RECONCILIATION_SCORER_VERSION,
            OR: snapshots.map(({ candidateIssueId, localFingerprint, remoteFingerprint }) => ({ candidateIssueId, localFingerprint, remoteFingerprint })),
          },
          include: { candidateIssue: { select: { id: true, key: true, title: true } } },
        })
      : [];
    const byCandidate = new Map(current.map((row) => [row.candidateIssueId, row]));
    const recommendations = ranked.map(({ candidateIssueId }) => {
      const row = byCandidate.get(candidateIssueId);
      if (!row) throw new AppError(409, "REDMINE_RECONCILIATION_WRITE_CONFLICT", "The recommendation snapshot changed while materializing");
      try { assertRedmineReconciliationFactorEvidence(row.factorEvidence); } catch { throw new AppError(500, "REDMINE_RECONCILIATION_EVIDENCE_INVALID", "Invalid recommendation evidence"); }
      return { id: row.id, score: row.score, factorEvidence: row.factorEvidence, decisionState: row.decisionState, decisionKind: row.decisionKind, decidedById: row.decidedById, decidedAt: row.decidedAt, acceptedRefId: row.acceptedRefId, localIssue: row.candidateIssue };
    });
    return {
      remote: { id: detail.remoteIssueId, title: detail.title, sourceVersion: detail.sourceVersion },
      recommendations,
      manualCandidate: manualIssue && manualScore
        ? { score: manualScore.score, factorEvidence: manualScore.evidence, localIssue: { id: manualIssue.id, key: manualIssue.key, title: manualIssue.title } }
        : null,
    };
  });
}
function reviewOffset(value: string | undefined, previewIdentity: string, candidateCount: number) {
  if (value === undefined) return 0;
  if (value.length < 1 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new AppError(400, "REDMINE_RECONCILIATION_CURSOR_INVALID", "Invalid review cursor");
  let cursor: z.infer<typeof ReviewCursor> | null = null;
  try {
    const decoded = ReviewCursor.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (decoded.success) cursor = decoded.data;
  } catch { /* Use the bounded cursor error below. */ }
  if (!cursor) throw new AppError(400, "REDMINE_RECONCILIATION_CURSOR_INVALID", "Invalid review cursor");
  if (cursor.previewIdentity !== previewIdentity) throw new AppError(409, "REDMINE_RECONCILIATION_CURSOR_STALE", "The Redmine preview changed");
  if (cursor.offset >= candidateCount) throw new AppError(400, "REDMINE_RECONCILIATION_CURSOR_INVALID", "Invalid review cursor");
  return cursor.offset;
}
function encodeReviewCursor(previewIdentity: string, offset: number) {
  return Buffer.from(JSON.stringify({ previewIdentity, offset })).toString("base64url");
}
export async function reviewRedmineReconciliationPage(
  request: Pick<RedmineReconciliationRequest, "connectionId" | "bindingId" | "userId">,
  options: RedmineReconciliationDependencies & Readonly<{ cursor?: string; limit?: number }>,
) {
  const scope = await bindingScope(prisma, request, options);
  const limit = options.limit ?? MAX_REVIEW_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REVIEW_PAGE) throw new AppError(400, "REDMINE_RECONCILIATION_PAGE_INVALID", "Invalid review page");
  const offset = reviewOffset(options.cursor, scope.preview.previewIdentity, scope.preview.candidates.length);
  const candidates = scope.preview.candidates.slice(offset, offset + limit);
  const linked = candidates.length ? await prisma.externalRef.findMany({
    where: { connectionId: request.connectionId, entityType: "issue", externalId: { in: candidates.map(({ remoteId }) => remoteId) } },
    select: { externalId: true },
  }) : [];
  const linkedIds = new Set(linked.map(({ externalId }) => externalId));
  const items: Awaited<ReturnType<typeof materializeRedmineReconciliationRecommendations>>[] = [];
  let hiddenCount = 0;
  let linkedCount = 0;
  const skipped: Array<{ remoteId: string; sourceVersion: string; decisionKind: "system-not-visible" | "system-already-linked" }> = [];
  for (const candidate of candidates) {
    if (linkedIds.has(candidate.remoteId)) { linkedCount += 1; skipped.push({ ...candidate, decisionKind: "system-already-linked" }); continue; }
    const detail = await options.loadRemoteIssue(candidate.remoteId);
    validateRemoteIdentity(scope, candidate.remoteId, detail);
    if (!detail.visible) { hiddenCount += 1; skipped.push({ ...candidate, decisionKind: "system-not-visible" }); continue; }
    items.push(await materializeRedmineReconciliationRecommendations(
      { ...request, remoteIssueId: candidate.remoteId },
      { ...options, loadRemoteIssue: async () => detail },
    ));
  }
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${request.bindingId}::uuid FOR UPDATE`);
    const current = await bindingScope(transaction, request, options);
    if (current.preview.previewIdentity !== scope.preview.previewIdentity || current.preview.scopeFingerprint !== scope.preview.scopeFingerprint || JSON.stringify(current.preview.candidates) !== JSON.stringify(scope.preview.candidates)) throw new AppError(409, "REDMINE_RECONCILIATION_SCOPE_STALE", "The reconciliation scope changed");
    const decidedAt = new Date();
    for (const candidate of skipped) {
      await transaction.integrationReconciliationDisposition.updateMany({ where: { bindingId: scope.binding.id, previewIdentity: scope.preview.previewIdentity, remoteIssueId: candidate.remoteId, remoteSourceVersion: candidate.sourceVersion, state: "pending" }, data: { state: "skipped", decisionKind: candidate.decisionKind, decidedAt, acceptedRefId: null } });
      await transaction.integrationReconciliationRecommendation.updateMany({ where: { bindingId: scope.binding.id, previewIdentity: scope.preview.previewIdentity, remoteIssueId: candidate.remoteId, decisionState: "pending" }, data: { decisionState: "rejected", decisionKind: candidate.decisionKind, decidedAt, acceptedRefId: null } });
    }
  });
  const nextOffset = offset + candidates.length;
  const remainingCandidateCount = scope.preview.candidates.length - nextOffset;
  return {
    previewIdentity: scope.preview.previewIdentity,
    processedCandidateCount: candidates.length,
    remainingCandidateCount,
    hiddenCount,
    linkedCount,
    items,
    nextCursor: remainingCandidateCount ? encodeReviewCursor(scope.preview.previewIdentity, nextOffset) : null,
  };
}
function decodeCursor(value?: string) {
  if (!value) return null;
  try {
    const parsed = Cursor.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // Return the same bounded cursor error for malformed JSON and encoding.
  }
  throw new AppError(400, "REDMINE_RECONCILIATION_CURSOR_INVALID", "Invalid recommendation cursor");
}
export async function listRedmineReconciliationRecommendations(request: Pick<RedmineReconciliationRequest, "connectionId" | "bindingId" | "userId">, options: ScopeOptions & { readonly limit?: number; readonly cursor?: string; readonly state?: string } = {}) {
  const scope = await bindingScope(prisma, request, options);
  const limit = options.limit ?? 20;
  const state = DecisionState.safeParse(options.state ?? "pending");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE || !state.success) {
    throw new AppError(400, "REDMINE_RECONCILIATION_PAGE_INVALID", "Invalid recommendation page");
  }
  const cursor = decodeCursor(options.cursor);
  const rows = await prisma.integrationReconciliationRecommendation.findMany({
    where: {
      bindingId: scope.binding.id,
      previewIdentity: scope.preview.previewIdentity,
      decisionState: state.data,
      ...(cursor
        ? { OR: [{ score: { lt: cursor.score } }, { score: cursor.score, id: { lt: cursor.id } }] }
        : {}),
    },
    orderBy: [{ score: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => {
    try {
      assertRedmineReconciliationFactorEvidence(row.factorEvidence);
    } catch {
      throw new AppError(500, "REDMINE_RECONCILIATION_EVIDENCE_INVALID", "Invalid recommendation evidence");
    }
    return {
      id: row.id, bindingId: row.bindingId, remoteIssueId: row.remoteIssueId,
      remoteSourceVersion: row.remoteSourceVersion, candidateIssueId: row.candidateIssueId,
      score: row.score, scoringVersion: row.scoringVersion, factorEvidence: row.factorEvidence,
      localFingerprint: row.localFingerprint, remoteFingerprint: row.remoteFingerprint,
      decisionState: row.decisionState, decisionKind: row.decisionKind, decidedById: row.decidedById,
      decidedAt: row.decidedAt, acceptedRefId: row.acceptedRefId, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor: more && last
      ? Buffer.from(JSON.stringify({ score: last.score, id: last.id })).toString("base64url")
      : null,
  };
}

export type RedmineReconciliationDecision =
  | Readonly<{ kind: "reject"; recommendationId: string }>
  | Readonly<{ kind: "reject-all" }>
  | Readonly<{ kind: "accept"; recommendationId: string }>
  | Readonly<{ kind: "manual-link"; candidateIssueId: string; localFingerprint: string; remoteFingerprint: string }>;
export type RedmineReconciliationDecisionDependencies = ScopeOptions & Readonly<{ loadRemoteIssue?: (remoteIssueId: string) => Promise<RedmineReconciliationRemoteDetail>; now?: () => Date }>;
const ISSUE_STATES = new Set(["backlog", "analysis", "todo", "in_progress", "review", "done"]);
const ISSUE_PRIORITIES = new Set(["critical", "high", "medium", "low"]);
function decisionConflict(code = "REDMINE_RECONCILIATION_LINK_CONFLICT", message = "The Redmine or Kanon issue is already linked") {
  return new AppError(409, code, message);
}
function applicationKey(bindingId: string, remoteId: string, sourceVersion: string) {
  return createHash("sha256").update(`${bindingId}|issue|${remoteId}|${sourceVersion}`).digest("hex");
}
function remoteScoreInput(detail: RedmineReconciliationRemoteDetail, projectId: string) {
  return { id: detail.remoteIssueId, projectId, title: detail.title, description: detail.description, createdAt: detail.createdAt, mappedAssigneeId: detail.mappedAssigneeId, mappedState: detail.mappedState };
}
function linkSnapshot(detail: RedmineReconciliationRemoteDetail) {
  const date = detail.changedAt;
  const parsedCreatedAt = detail.createdAt instanceof Date ? detail.createdAt : typeof detail.createdAt === "string" && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(detail.createdAt) ? new Date(detail.createdAt.length === 10 ? `${detail.createdAt}T00:00:00.000Z` : detail.createdAt) : null;
  const dateValue = (value: unknown) => value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (!date || Number.isNaN(date.getTime()) || !parsedCreatedAt || Number.isNaN(parsedCreatedAt.getTime()) || !detail.title || !ISSUE_STATES.has(detail.mappedState ?? "") || !ISSUE_PRIORITIES.has(detail.mappedPriority ?? "") || detail.mappedAssigneeId === undefined || !dateValue(detail.startDate) || !dateValue(detail.dueDate) || !Number.isInteger(detail.progress) || detail.progress! < 0 || detail.progress! > 100) {
    throw decisionConflict("REDMINE_RECONCILIATION_MAPPING_INCOMPLETE", "The mapped Redmine snapshot is incomplete");
  }
  return {
    changedAt: date,
    createdAt: parsedCreatedAt,
    completedAt: detail.mappedState === "done" ? detail.completedAt ?? date : null,
    fields: { title: detail.title, description: detail.description ?? null, state: detail.mappedState!, priority: detail.mappedPriority!, assigneeId: detail.mappedAssigneeId, startDate: detail.startDate!, dueDate: detail.dueDate!, progress: detail.progress! },
  };
}
async function lockDecisionScope(transaction: Prisma.TransactionClient, request: RedmineReconciliationRequest, options: ScopeOptions) {
  await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "integration_connections" WHERE "id" = ${request.connectionId}::uuid FOR UPDATE`);
  await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${request.bindingId}::uuid FOR UPDATE`);
  return bindingScope(transaction, request, options);
}
async function assertCurrentDecisionScope(transaction: Prisma.TransactionClient, scope: Awaited<ReturnType<typeof bindingScope>>) {
  const credential = await serviceCredential(transaction, scope.connection);
  const identities = scope.preview.assigneeRemoteIds.length ? await transaction.integrationExternalIdentity.findMany({ where: { bindingId: scope.binding.id, remoteUserId: { in: scope.preview.assigneeRemoteIds } }, select: { remoteUserId: true, memberId: true, member: { select: { workspaceId: true } } } }) : [];
  const current = reconciliationScopeFingerprint({ connection: scope.connection, binding: scope.binding, credential }, scope.preview.mode, scope.preview.assigneeRemoteIds, identities);
  if (current !== scope.preview.scopeFingerprint) throw decisionConflict("REDMINE_RECONCILIATION_SCOPE_STALE", "The reconciliation scope changed");
}
async function lockCandidate(transaction: Prisma.TransactionClient, projectId: string, issueId: string) {
  await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "issues" WHERE "id" = ${issueId}::uuid FOR UPDATE`);
  const issue = await transaction.issue.findFirst({ where: { id: issueId, projectId } });
  if (!issue) throw decisionConflict("REDMINE_RECONCILIATION_CANDIDATE_INVALID", "The Kanon issue is not in the bound project");
  return issue;
}
async function cancelSafeCreate(transaction: Prisma.TransactionClient, bindingId: string, issueId: string) {
  const work = await transaction.integrationSyncWork.findMany({ where: { bindingId, entityType: "issue", entityId: issueId, direction: "outbound", state: { notIn: ["done", "superseded", "skipped"] } }, select: { id: true, state: true, attempts: true, leaseToken: true, leaseUntil: true, fence: true } });
  const safe = work.filter(({ state, attempts, leaseToken, leaseUntil, fence }) => state === "queued" && attempts === 0 && fence === 0 && leaseToken === null && leaseUntil === null);
  if (safe.length !== work.length) throw decisionConflict("REDMINE_RECONCILIATION_OUTBOUND_CREATE_UNCERTAIN", "An outbound create may already have reached Redmine");
  if (!safe.length) return;
  const changed = await transaction.integrationSyncWork.updateMany({ where: { id: { in: safe.map(({ id }) => id) }, state: "queued", attempts: 0, fence: 0, leaseToken: null, leaseUntil: null }, data: { state: "superseded", skippedReason: "reconciliation-linked" } });
  if (changed.count !== safe.length) throw decisionConflict("REDMINE_RECONCILIATION_OUTBOUND_CREATE_UNCERTAIN", "The outbound create changed while linking");
}
export async function decideRedmineReconciliationRecommendations(request: RedmineReconciliationRequest, decision: RedmineReconciliationDecision, dependencies: RedmineReconciliationDecisionDependencies = {}) {
  await bindingScope(prisma, request, dependencies);
  const linking = decision.kind === "accept" || decision.kind === "manual-link";
  if (linking && !dependencies.loadRemoteIssue) throw new AppError(500, "REDMINE_RECONCILIATION_DEPENDENCY_MISSING", "Remote issue loading is required for linking");
  const detail = linking ? await dependencies.loadRemoteIssue!(request.remoteIssueId) : null;
  try {
    return await prisma.$transaction(async (transaction) => {
      const scope = await lockDecisionScope(transaction, request, dependencies);
      if (linking) await assertCurrentDecisionScope(transaction, scope);
      if (!scope.preview.candidates.some(({ remoteId }) => remoteId === request.remoteIssueId)) throw decisionConflict("REDMINE_RECONCILIATION_UNLISTED", "The Redmine issue is not in this preview");
      const member = await transaction.member.findUniqueOrThrow({ where: { userId_workspaceId: { userId: request.userId, workspaceId: scope.connection.workspaceId } }, select: { id: true } });
      const now = dependencies.now?.() ?? new Date();
      const disposition = await transaction.integrationReconciliationDisposition.findFirst({ where: { bindingId: scope.binding.id, previewIdentity: scope.preview.previewIdentity, remoteIssueId: request.remoteIssueId } });
      if (!disposition || disposition.remoteSourceVersion !== scope.preview.candidates.find(({ remoteId }) => remoteId === request.remoteIssueId)?.sourceVersion) {
        throw decisionConflict("REDMINE_RECONCILIATION_PREVIEW_STALE", "The reconciliation preview changed");
      }
      if (decision.kind === "reject-all") {
        if (disposition.state !== "pending") {
          if (disposition.state === "import_as_new" && disposition.decisionKind === "owner-reject-all") {
            return { remoteIssueId: request.remoteIssueId, rejectedCount: 0, replayed: true };
          }
          throw decisionConflict("REDMINE_RECONCILIATION_PREVIEW_STALE", "The reconciliation decision was already settled");
        }
        const rejected = await transaction.integrationReconciliationRecommendation.updateMany({ where: { bindingId: scope.binding.id, previewIdentity: scope.preview.previewIdentity, remoteIssueId: request.remoteIssueId, decisionState: "pending" }, data: { decisionState: "rejected", decisionKind: "owner-reject-all", decidedById: member.id, decidedAt: now } });
        await transaction.integrationReconciliationDisposition.update({ where: { id: disposition.id }, data: { state: "import_as_new", decisionKind: "owner-reject-all", decidedById: member.id, decidedAt: now, acceptedRefId: null } });
        return { remoteIssueId: request.remoteIssueId, rejectedCount: rejected.count, replayed: rejected.count === 0 };
      }
      const recommendation = decision.kind === "manual-link" ? null : await transaction.integrationReconciliationRecommendation.findFirst({ where: { id: decision.recommendationId, bindingId: scope.binding.id, previewIdentity: scope.preview.previewIdentity, remoteIssueId: request.remoteIssueId } });
      if (decision.kind !== "manual-link" && !recommendation) throw new AppError(404, "REDMINE_RECONCILIATION_RECOMMENDATION_NOT_FOUND", "Recommendation not found");
      if (disposition.state !== "pending" && disposition.state !== "linked") {
        throw decisionConflict("REDMINE_RECONCILIATION_PREVIEW_STALE", "The reconciliation decision was already settled");
      }
      const candidateIssueId = decision.kind === "manual-link" ? decision.candidateIssueId : recommendation!.candidateIssueId;
      const issue = await lockCandidate(transaction, scope.binding.projectId, candidateIssueId);
      if (decision.kind === "reject") {
        if (recommendation!.decisionState === "rejected") return { remoteIssueId: request.remoteIssueId, recommendationId: recommendation!.id, rejectedCount: 0, replayed: true };
        if (recommendation!.decisionState !== "pending") throw decisionConflict();
        const changed = await transaction.integrationReconciliationRecommendation.updateMany({ where: { id: recommendation!.id, decisionState: "pending" }, data: { decisionState: "rejected", decisionKind: "owner-reject", decidedById: member.id, decidedAt: now } });
        if (changed.count !== 1) throw decisionConflict();
        return { remoteIssueId: request.remoteIssueId, recommendationId: recommendation!.id, rejectedCount: 1, replayed: false };
      }
      validateRemote(scope, request.remoteIssueId, detail!);
      const snapshot = linkSnapshot(detail!);
      const match = rankRedmineReconciliationCandidates(remoteScoreInput(detail!, scope.binding.projectId), [issue])[0];
      if (!match) throw decisionConflict("REDMINE_RECONCILIATION_CANDIDATE_INVALID", "The Kanon issue is not eligible");
      assertRedmineReconciliationFactorEvidence(match.evidence);
      const expectedLocal = decision.kind === "manual-link" ? decision.localFingerprint : recommendation!.localFingerprint;
      const expectedRemote = decision.kind === "manual-link" ? decision.remoteFingerprint : recommendation!.remoteFingerprint;
      if (recommendation) assertRedmineReconciliationFactorEvidence(recommendation.factorEvidence);
      if (expectedLocal !== match.evidence.localFingerprint) throw decisionConflict("REDMINE_RECONCILIATION_LOCAL_STALE", "The Kanon issue changed after scoring");
      if (expectedRemote !== match.evidence.remoteFingerprint || (recommendation && recommendation.remoteSourceVersion !== detail!.sourceVersion)) throw decisionConflict("REDMINE_RECONCILIATION_REMOTE_STALE", "The Redmine issue changed after scoring");
      if (recommendation && recommendation.scoringVersion !== REDMINE_RECONCILIATION_SCORER_VERSION) throw decisionConflict("REDMINE_RECONCILIATION_RECOMMENDATION_STALE", "The recommendation is no longer pending");
      const [localRef, remoteRef] = await Promise.all([
        transaction.externalRef.findUnique({ where: { connectionId_entityType_entityId: { connectionId: request.connectionId, entityType: "issue", entityId: issue.id } } }),
        transaction.externalRef.findUnique({ where: { connectionId_entityType_externalId: { connectionId: request.connectionId, entityType: "issue", externalId: request.remoteIssueId } } }),
      ]);
      if (localRef && remoteRef?.id === localRef.id) {
        const accepted = await transaction.integrationReconciliationRecommendation.findFirst({ where: { bindingId: scope.binding.id, previewIdentity: scope.preview.previewIdentity, remoteIssueId: request.remoteIssueId, candidateIssueId: issue.id, decisionState: "accepted", acceptedRefId: localRef.id } });
        if (accepted) return { remoteIssueId: request.remoteIssueId, candidateIssueId: issue.id, recommendationId: accepted.id, refId: localRef.id, replayed: true };
      }
      if (localRef || remoteRef) throw decisionConflict();
      await cancelSafeCreate(transaction, scope.binding.id, issue.id);
      const exact = decision.kind === "manual-link" ? await transaction.integrationReconciliationRecommendation.findFirst({ where: { bindingId: scope.binding.id, previewIdentity: scope.preview.previewIdentity, remoteIssueId: request.remoteIssueId, remoteSourceVersion: detail!.sourceVersion, candidateIssueId: issue.id, scoringVersion: REDMINE_RECONCILIATION_SCORER_VERSION, localFingerprint: match.evidence.localFingerprint, remoteFingerprint: match.evidence.remoteFingerprint } }) : recommendation;
      if (exact && exact.decisionState !== "pending") throw decisionConflict("REDMINE_RECONCILIATION_RECOMMENDATION_STALE", "The recommendation was already decided");
      const correlationId = applicationKey(scope.binding.id, request.remoteIssueId, detail!.sourceVersion);
      const ref = await transaction.externalRef.create({ data: { connectionId: request.connectionId, bindingId: scope.binding.id, entityType: "issue", entityId: issue.id, externalId: request.remoteIssueId, remoteUpdatedAt: snapshot.changedAt, localVersion: 1, lastCorrelationId: correlationId, metadata: issueSyncMetadata(null, { sourceVersion: detail!.sourceVersion, ...snapshot }) } });
      await transaction.integrationInboundApplication.create({ data: { bindingId: scope.binding.id, remoteEntityType: "issue", remoteId: request.remoteIssueId, remoteUpdatedAt: snapshot.changedAt, sourceVersion: detail!.sourceVersion, applicationKey: correlationId, correlationId, state: "applied", refId: ref.id, outcome: { provenance: "reconciliation-link", decisionKind: decision.kind, issueKey: issue.key } } });
      const decisionKind = decision.kind === "manual-link" ? "owner-manual-link" : "owner-accept-suggested";
      const selected = exact
        ? await transaction.integrationReconciliationRecommendation.update({ where: { id: exact.id }, data: { decisionState: "accepted", decisionKind, decidedById: member.id, decidedAt: now, acceptedRefId: ref.id } })
        : await transaction.integrationReconciliationRecommendation.create({ data: { bindingId: scope.binding.id, previewIdentity: scope.preview.previewIdentity, remoteIssueId: request.remoteIssueId, remoteSourceVersion: detail!.sourceVersion, candidateIssueId: issue.id, score: match.score, scoringVersion: REDMINE_RECONCILIATION_SCORER_VERSION, factorEvidence: match.evidence as unknown as Prisma.InputJsonValue, localFingerprint: match.evidence.localFingerprint, remoteFingerprint: match.evidence.remoteFingerprint, decisionState: "accepted", decisionKind, decidedById: member.id, decidedAt: now, acceptedRefId: ref.id } });
      await transaction.integrationReconciliationRecommendation.updateMany({ where: { bindingId: scope.binding.id, previewIdentity: scope.preview.previewIdentity, remoteIssueId: request.remoteIssueId, decisionState: "pending", id: { not: selected.id } }, data: { decisionState: "rejected", decisionKind: "owner-link-alternative", decidedById: member.id, decidedAt: now } });
      const settled = await transaction.integrationReconciliationDisposition.updateMany({ where: { id: disposition.id, state: "pending" }, data: { state: "linked", decisionKind, decidedById: member.id, decidedAt: now, acceptedRefId: ref.id } });
      if (settled.count !== 1) throw decisionConflict("REDMINE_RECONCILIATION_PREVIEW_STALE", "The reconciliation decision was already settled");
      return { remoteIssueId: request.remoteIssueId, candidateIssueId: issue.id, recommendationId: selected.id, refId: ref.id, replayed: false };
    }, { timeout: 10_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw decisionConflict();
    throw error;
  }
}
