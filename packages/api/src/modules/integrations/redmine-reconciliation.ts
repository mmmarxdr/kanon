import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import {
  assertRedmineReconciliationFactorEvidence,
  rankRedmineReconciliationCandidates,
  REDMINE_RECONCILIATION_SCORER_VERSION,
} from "./redmine-reconciliation-score.js";
import { ownedConnection } from "./service.js";
const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const FullPreview = z
  .object({
    version: z.literal(2),
    complete: z.literal(true),
    mode: z.literal("full"),
    previewIdentity: z.string().uuid(),
    scopeFingerprint: Hash,
    candidates: z.array(z.object({ remoteId: z.string().regex(/^\d+$/), sourceVersion: Hash }).strict()),
  })
  .passthrough();
const DecisionState = z.enum(["pending", "accepted", "rejected"]);
const Cursor = z.object({ score: z.number().int(), id: z.string().uuid() }).strict();
const MAX_PAGE = 50;
type Database = Prisma.TransactionClient;
export type RedmineReconciliationRequest = Readonly<{ connectionId: string; bindingId: string; userId: string; remoteIssueId: string }>;
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
  readonly mappedAssigneeId?: string | null;
  readonly mappedState?: string | null;
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
function validateRemote(scope: Awaited<ReturnType<typeof bindingScope>>, requestedId: string, detail: RedmineReconciliationRemoteDetail) {
  if (!detail.visible) {
    throw new AppError(409, "REDMINE_RECONCILIATION_NOT_VISIBLE", "The Redmine issue is not visible");
  }
  const listed = scope.preview.candidates.find(
    ({ remoteId }) => remoteId === requestedId && detail.remoteIssueId === requestedId,
  );
  if (!listed) {
    throw new AppError(409, "REDMINE_RECONCILIATION_UNLISTED", "The Redmine issue is not in this preview");
  }
  if (listed.sourceVersion !== detail.sourceVersion) {
    throw new AppError(409, "REDMINE_RECONCILIATION_SOURCE_STALE", "The Redmine issue changed after preview");
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
}
export async function materializeRedmineReconciliationRecommendations(request: RedmineReconciliationRequest, dependencies: RedmineReconciliationDependencies) {
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
          where: { entityType: "issue", entityId: { in: issues.map(({ id }) => id) } },
          select: { entityId: true },
        })
      : [];
    const linkedIds = new Set(linkedLocals.map(({ entityId }) => entityId));
    const ranked = rankRedmineReconciliationCandidates(
      {
        id: detail.remoteIssueId,
        projectId: scope.binding.projectId,
        title: detail.title,
        description: detail.description,
        createdAt: detail.createdAt,
        mappedAssigneeId: detail.mappedAssigneeId,
        mappedState: detail.mappedState,
      },
      issues.filter(({ id }) => !linkedIds.has(id)),
    );
    ranked.forEach(({ evidence }) => assertRedmineReconciliationFactorEvidence(evidence));
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
        remoteIssueId: detail.remoteIssueId,
        decisionState: "pending",
        ...(snapshots.length ? { NOT: { OR: snapshots } } : {}),
      },
    });
    await transaction.integrationReconciliationRecommendation.createMany({
      data: ranked.map(({ candidateIssueId, score, evidence }) => ({
        bindingId: scope.binding.id,
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
    return { remoteIssueId: detail.remoteIssueId, recommendationCount: ranked.length };
  });
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
    return { ...row, factorEvidence: row.factorEvidence };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor: more && last
      ? Buffer.from(JSON.stringify({ score: last.score, id: last.id })).toString("base64url")
      : null,
  };
}
