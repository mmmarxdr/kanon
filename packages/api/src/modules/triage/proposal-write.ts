import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import {
  AUTHORIZATION_POLICY_VERSION,
  computeProposalIdentity,
  type JsonValue,
} from "./canonical.js";
import { PreviewEnvelopeSchema, ProposalEnvelopeSchema, type PreviewEnvelope } from "./contracts.js";
import { verifyPreviewSeal } from "./preview.js";
import { createSourceIdentity } from "./source.js";

const DAY_MS = 86_400_000;
const VALIDITY_DAYS = 7;
const MAX_RETRIES = 3;
const PERSISTENCE_DEADLINE_MS = 2900;

export const PersistTriageProposalBodySchema = z
  .object({
    preview: PreviewEnvelopeSchema,
    previewSeal: z.string().min(1).max(200),
    retainedItemIds: z.array(z.string().min(1).max(200)).max(20).optional(),
    supersedesId: z.string().uuid().optional(),
  })
  .strict();

type PersistBody = z.infer<typeof PersistTriageProposalBodySchema>;

interface PersistInput {
  readonly issueKey: string;
  readonly issueId: string;
  readonly memberId: string;
  readonly userId: string;
  readonly allowedProjectIds: readonly string[] | undefined;
  readonly client: string | null;
  readonly correlationId: string;
  readonly body: PersistBody;
}

function knownRequestError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function databaseCode(error: unknown, code: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const meta = error.meta as { code?: unknown; message?: unknown } | undefined;
  return meta?.code === code || (typeof meta?.message === "string" && meta.message.includes(code));
}

function serializationFailure(error: unknown): boolean {
  return knownRequestError(error, "P2034") || (knownRequestError(error, "P2010") && databaseCode(error, "40001"));
}

function persistenceTimeout(error: unknown): boolean {
  return knownRequestError(error, "P2024") || knownRequestError(error, "P2028");
}

async function canViewProject(
  transaction: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
  projectId: string,
  allowedProjectIds: readonly string[] | undefined,
  requireWrite: boolean,
): Promise<boolean> {
  if (allowedProjectIds && !allowedProjectIds.includes(projectId)) return false;
  const member = await transaction.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true, projectAccess: true },
  });
  if (!member) return false;
  if (member.role === "owner" || member.role === "admin" || member.projectAccess === "workspace") {
    return !requireWrite || member.role !== "viewer";
  }
  const projectMember = await transaction.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { role: true },
  });
  return !!projectMember && (!requireWrite || projectMember.role !== "viewer");
}

function selection(preview: PreviewEnvelope, retainedItemIds?: readonly string[]) {
  const candidateById = new Map(
    preview.candidates.flatMap((candidate) => [
      [candidate.issueId, candidate] as const,
      [candidate.issueKey, candidate] as const,
    ]),
  );
  const recommendationById = new Map(
    preview.recommendations.map((recommendation) => [recommendation.itemId, recommendation]),
  );
  const requested = retainedItemIds ?? [
    ...recommendationById.keys(),
    ...preview.candidates.map((candidate) => candidate.issueId),
  ];
  const unknown = requested.filter(
    (id) => !recommendationById.has(id) && !candidateById.has(id),
  );
  if (unknown.length > 0) {
    throw new AppError(400, "UNKNOWN_RETAINED_ITEM", "A retained item is not in the preview");
  }
  const recommendations = [...new Set(requested.flatMap((id) => {
      const recommendation = recommendationById.get(id);
      return recommendation ? [recommendation] : [];
    }))].sort((left, right) => left.itemId.localeCompare(right.itemId));
  const candidates = [...new Set(requested.flatMap((id) => {
      const candidate = candidateById.get(id);
      return candidate ? [candidate] : [];
    }))].sort((left, right) => left.issueId.localeCompare(right.issueId));
  const evidenceRefs = new Set(
    recommendations.flatMap((recommendation) =>
      recommendation.evidence.map((evidence) => evidence.evidenceRefId)),
  );
  const sourceCandidates = [...new Map(
    [...candidates, ...preview.candidates.filter((candidate) =>
      candidate.evidence.some((evidence) => evidenceRefs.has(evidence.evidenceRefId)),
    )].map((candidate) => [candidate.issueId, candidate] as const),
  ).values()].sort((left, right) => left.issueId.localeCompare(right.issueId));
  return {
    recommendations,
    candidates,
    sourceCandidates,
    retainedItemIds: [...new Set(requested)].sort(),
  };
}

function persistedPreview(
  preview: PreviewEnvelope,
  retained: ReturnType<typeof selection>,
): PreviewEnvelope {
  const evidenceIds = new Set([
    ...retained.recommendations.flatMap((item) => item.evidence.map((evidence) => evidence.evidenceRefId)),
    ...retained.sourceCandidates.flatMap((item) => item.evidence.map((evidence) => evidence.evidenceRefId)),
  ]);
  const retainedIds = new Set([
    ...retained.recommendations.map((item) => item.itemId),
    ...retained.sourceCandidates.flatMap((item) => [item.issueId, item.issueKey]),
  ]);
  const { contextToken: _contextToken, ...bounded } = preview;
  return PreviewEnvelopeSchema.parse({
    ...bounded,
    recommendations: retained.recommendations,
    candidates: retained.sourceCandidates,
    conflicts: preview.conflicts.filter((id) => retainedIds.has(id)),
    unknowns: preview.unknowns.filter((id) => retainedIds.has(id)),
    ...(preview.evidence
      ? { evidence: preview.evidence.filter((evidence) => evidenceIds.has(evidence.evidenceRefId)) }
      : {}),
  });
}

function deduplicated(
  proposal: { id: string; lifecycle: string; createdAt: Date; expiresAt: Date; supersedesId: string | null },
  supersedesId?: string,
) {
  if (
    supersedesId &&
    proposal.id !== supersedesId &&
    proposal.supersedesId !== supersedesId
  ) {
    throw new AppError(409, "SUPERSESSION_CONFLICT", "Proposal identity has another predecessor");
  }
  return response(proposal, "deduplicated");
}

function response(proposal: {
  id: string;
  lifecycle: string;
  createdAt: Date;
  expiresAt: Date;
}, outcome: "created" | "deduplicated") {
  return {
    id: proposal.id,
    outcome,
    lifecycle: proposal.lifecycle,
    nonExecutable: true,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
  };
}

export async function persistTriageProposal(
  input: PersistInput,
  deadlineAt = performance.now() + PERSISTENCE_DEADLINE_MS,
) {
  const preview = PreviewEnvelopeSchema.parse(input.body.preview);
  if (preview.authorizationPolicyVersion !== AUTHORIZATION_POLICY_VERSION) {
    throw new AppError(409, "AUTHORIZATION_POLICY_CONFLICT", "Authorization policy changed; rerun preview");
  }
  verifyPreviewSeal(preview, input.body.previewSeal, new Date(), true);
  const retained = selection(preview, input.body.retainedItemIds);
  const storedPreview = persistedPreview(preview, retained);
  const supported = retained.recommendations.filter((item) => item.state === "supported");
  const normalizedPayload = {
    actions: supported.map((item) => item.normalized),
    candidateIds: retained.candidates.map((item) => item.issueId).sort(),
  };
  if (normalizedPayload.actions.length + normalizedPayload.candidateIds.length === 0) {
    throw new AppError(400, "NO_SUPPORTED_CONTENT", "No supported triage content was retained");
  }
  const hostRecommendation = retained.recommendations.find((item) => item.source === "host_ai" && item.model);
  const generator: JsonValue = hostRecommendation?.model
    ? {
        kind: "host_ai_hybrid" as const,
        id: "triage-preview",
        version: "1",
        policy: preview.policy,
        model: hostRecommendation.model,
      }
    : {
        kind: "kanon_policy" as const,
        id: "triage-preview",
        version: "1",
        policy: preview.policy,
      };
  const identityDigest = computeProposalIdentity({
    contractVersion: "triage-proposal.v1",
    authorizationPolicyVersion: preview.authorizationPolicyVersion,
    scope: preview.effectiveScope,
    target: preview.target,
    normalizedPayload,
    generator,
  });
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const remaining = Math.floor(deadlineAt - performance.now());
    if (remaining < 2) {
      throw new AppError(503, "PERSISTENCE_TIMED_OUT", "Proposal persistence deadline exceeded");
    }
    const maxWait = Math.max(1, Math.min(250, Math.floor(remaining / 4)));
    try {
      return await prisma.$transaction(async (transaction) => {
        const [clock] = await transaction.$queryRaw<[{ now: Date }]>`SELECT CURRENT_TIMESTAMP AS "now"`;
        const databaseNow = clock.now;
        const seal = verifyPreviewSeal(preview, input.body.previewSeal, databaseNow, true);
        await transaction.$queryRaw`SELECT "id" FROM "issues" WHERE "id" = ${input.issueId}::uuid FOR SHARE`;
        const issue = await transaction.issue.findUnique({
          where: { id: input.issueId },
          include: { project: true },
        });
        if (!issue || !(await canViewProject(
          transaction,
          input.userId,
          issue.project.workspaceId,
          issue.projectId,
          input.allowedProjectIds,
          true,
        ))) {
          throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Issue not found");
        }
        if (
          issue.key !== input.issueKey ||
          issue.id !== preview.target.issueId ||
          issue.projectId !== preview.target.projectId ||
          issue.project.workspaceId !== preview.target.workspaceId
        ) {
          throw new AppError(409, "SOURCE_CONFLICT", "Issue source changed; rerun preview");
        }

        const source = createSourceIdentity({
          workspaceId: issue.project.workspaceId,
          projectId: issue.projectId,
          issueId: issue.id,
          issueKey: issue.key,
          projectKey: issue.project.key,
          title: issue.title,
          description: issue.description,
          type: issue.type,
          priority: issue.priority,
          state: issue.state,
          labels: issue.labels,
          groupId: issue.groupKey,
          assigneeId: issue.assigneeId,
          cycleId: issue.cycleId,
          parentId: issue.parentId,
          issueUpdatedAt: issue.updatedAt,
          projectUpdatedAt: issue.project.updatedAt,
        });
        if (
          source.sourceVersion !== preview.target.sourceVersion ||
          source.sourceHash !== preview.target.sourceHash
        ) {
          throw new AppError(409, "SOURCE_CONFLICT", "Issue source changed; rerun preview");
        }
        const policy = await transaction.triagePolicy.findFirst({
          where: {
            workspaceId: issue.project.workspaceId,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (policy?.id !== preview.policy.id || policy.version !== preview.policy.version) {
          throw new AppError(409, "POLICY_CONFLICT", "Triage policy changed; rerun preview");
        }

        const currentCandidates = await transaction.issue.findMany({
          where: { id: { in: retained.sourceCandidates.map(({ issueId }) => issueId) } },
          include: { project: true },
        });
        const currentById = new Map(currentCandidates.map((candidate) => [candidate.id, candidate]));
        const [candidateMembers, candidateProjectMembers] = await Promise.all([
          transaction.member.findMany({
            where: {
              userId: input.userId,
              workspaceId: { in: [...new Set(currentCandidates.map(({ project }) => project.workspaceId))] },
            },
            select: { workspaceId: true, role: true, projectAccess: true },
          }),
          transaction.projectMember.findMany({
            where: {
              userId: input.userId,
              projectId: { in: [...new Set(currentCandidates.map(({ projectId }) => projectId))] },
            },
            select: { projectId: true },
          }),
        ]);
        const memberByWorkspace = new Map(candidateMembers.map((member) => [member.workspaceId, member]));
        const memberProjects = new Set(candidateProjectMembers.map(({ projectId }) => projectId));
        const candidateSources: Array<{
          sourceVersion: string;
          sourceHash: string;
          snapshot: Record<string, unknown>;
        }> = [];
        for (const candidate of retained.sourceCandidates) {
          const current = currentById.get(candidate.issueId);
          const member = current ? memberByWorkspace.get(current.project.workspaceId) : null;
          const visible = current && (!input.allowedProjectIds || input.allowedProjectIds.includes(current.projectId)) &&
            member && (member.role === "owner" || member.role === "admin" || member.projectAccess === "workspace" ||
              memberProjects.has(current.projectId));
          if (!visible) {
            throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Retained candidate not found");
          }
          const inScope = (
            preview.effectiveScope.kind === "workspace"
              ? current.project.workspaceId === preview.effectiveScope.workspaceId
              : current.projectId === preview.effectiveScope.projectId
          );
          if (!inScope) {
            throw new AppError(409, "SOURCE_CONFLICT", "Candidate source changed; rerun preview");
          }
          const currentSource = createSourceIdentity({
            workspaceId: current.project.workspaceId,
            projectId: current.projectId,
            issueId: current.id,
            issueKey: current.key,
            projectKey: current.project.key,
            title: current.title,
            description: current.description,
            type: current.type,
            priority: current.priority,
            state: current.state,
            labels: current.labels,
            groupId: current.groupKey,
            assigneeId: current.assigneeId,
            cycleId: current.cycleId,
            parentId: current.parentId,
            issueUpdatedAt: current.updatedAt,
            projectUpdatedAt: current.project.updatedAt,
          });
          if (
            current.key !== candidate.issueKey ||
            currentSource.sourceVersion !== candidate.sourceVersion ||
            currentSource.sourceHash !== candidate.sourceHash
          ) {
            throw new AppError(409, "SOURCE_CONFLICT", "Candidate source changed; rerun preview");
          }
          candidateSources.push({
            sourceVersion: currentSource.sourceVersion,
            sourceHash: currentSource.sourceHash,
            snapshot: currentSource.canonicalSource,
          });
        }

        if (input.body.supersedesId) {
          await transaction.$queryRaw`SELECT "id" FROM "triage_proposals" WHERE "id" = ${input.body.supersedesId}::uuid FOR UPDATE`;
          const predecessor = await transaction.triageProposal.findUnique({
            where: { id: input.body.supersedesId },
            include: { content: { select: { id: true } } },
          });
          if (
            !predecessor ||
            predecessor.workspaceId !== issue.project.workspaceId ||
            predecessor.projectId !== issue.projectId ||
            predecessor.targetIssueId !== issue.id
          ) {
            throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Prior proposal not found");
          }
          if (predecessor.lifecycle === "disposed" || predecessor.disposedAt || !predecessor.content ||
            predecessor.createdAt > databaseNow) {
            throw new AppError(409, "SUPERSESSION_CONFLICT", "Prior proposal cannot be superseded");
          }
        }

        const existing = await transaction.triageProposal.findUnique({
          where: { identityDigest },
        });
        if (existing) return deduplicated(existing, input.body.supersedesId);
        if (seal.expired) {
          throw new AppError(409, "PREVIEW_EXPIRED", "Preview expired; rerun preview");
        }

        if (input.body.supersedesId) {
          const successor = await transaction.triageProposal.findFirst({
            where: { supersedesId: input.body.supersedesId },
            select: { id: true },
          });
          if (successor) {
            throw new AppError(409, "SUPERSESSION_CONFLICT", "A successor already exists");
          }
        }

        const createdAt = databaseNow;
        const expiresAt = new Date(createdAt.getTime() + VALIDITY_DAYS * DAY_MS);
        const retentionEligibleAt = new Date(createdAt.getTime() + policy.retentionDays * DAY_MS);
        const proposalEnvelope = ProposalEnvelopeSchema.parse({
          kind: "issue_triage_v1",
          contractVersion: "triage-proposal.v1",
          identityDigest,
          target: preview.target,
          sourceSeal: preview.previewSeal,
          authorizationPolicyVersion: preview.authorizationPolicyVersion,
          effectiveScope: preview.effectiveScope,
          normalizedPayload,
          generator,
          provenance: {
            authorizationPolicyVersion: preview.authorizationPolicyVersion,
            sourceVersion: preview.target.sourceVersion,
            sourceHash: preview.target.sourceHash,
            policyId: preview.policy.id,
            policyVersion: preview.policy.version,
            traceId: input.correlationId,
            initiator: input.memberId,
            ...(input.client ? { client: input.client } : {}),
            sourceSnapshots: {
              target: source.canonicalSource,
              candidates: candidateSources,
            },
          },
          lifecycle: "pending",
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          ...(input.body.supersedesId ? { supersedesId: input.body.supersedesId } : {}),
          nonExecutable: true,
        });
        const created = await transaction.triageProposal.create({
          data: {
            identityDigest,
            targetIssueId: issue.id,
            workspaceId: issue.project.workspaceId,
            projectId: issue.projectId,
            policyId: policy.id,
            lifecycle: "pending",
            listSummary: {
              targetIssueKey: issue.key,
              targetTitle: issue.title,
              actionKinds: [...new Set(supported.map((item) => item.normalized.concept))].sort(),
              generatorSource: hostRecommendation
                ? supported.some((item) => item.source === "deterministic_policy")
                  ? "mixed"
                  : "host_ai"
                : "deterministic_policy",
              policy: preview.policy,
              ...(hostRecommendation?.model ? { model: hostRecommendation.model } : {}),
              confidenceBands: [...new Set([
                ...supported.map((item) => item.confidence),
                ...retained.candidates.map((item) => item.confidence),
              ])].sort(),
              degraded: preview.degradation.length > 0,
              degradationCategories: preview.degradation,
              recommendationCount: supported.length,
              candidateCount: retained.candidates.length,
              nonExecutable: true,
            },
            createdAt,
            expiresAt,
            retentionEligibleAt,
            capturedRetentionDays: policy.retentionDays,
            capturedPolicyVersion: policy.version,
            supersedesId: input.body.supersedesId,
            content: {
              create: {
                payload: proposalEnvelope as unknown as Prisma.InputJsonValue,
                provenance: {
                  preview: storedPreview,
                  retainedItemIds: retained.retainedItemIds,
                  retainedCandidateIds: retained.sourceCandidates.map((candidate) => candidate.issueId),
                } as unknown as Prisma.InputJsonValue,
              },
            },
            lifecycleEvents: {
              create: {
                state: "pending",
                actorId: input.memberId,
                reason: "created",
                details: { correlationId: input.correlationId },
              },
            },
          },
        });
        return response(created, "created");
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait,
        timeout: Math.max(1, remaining - maxWait),
      });
    } catch (error) {
      if (serializationFailure(error)) {
        if (attempt + 1 < MAX_RETRIES && deadlineAt - performance.now() > 20) {
          await new Promise((resolve) => setTimeout(
            resolve,
            10 * (attempt + 1) + Math.floor(Math.random() * 10),
          ));
          continue;
        }
        throw new AppError(503, "CONCURRENCY_ERROR", "Proposal persistence could not be serialized");
      }
      if (persistenceTimeout(error)) {
        throw new AppError(503, "PERSISTENCE_TIMED_OUT", "Proposal persistence deadline exceeded");
      }
      if (knownRequestError(error, "P2002")) {
        const existing = await prisma.triageProposal.findUnique({ where: { identityDigest } });
        if (existing) return deduplicated(existing, input.body.supersedesId);
        if (input.body.supersedesId) {
          throw new AppError(409, "SUPERSESSION_CONFLICT", "A successor already exists");
        }
      }
      throw error;
    }
  }
  throw new AppError(503, "CONCURRENCY_ERROR", "Proposal persistence could not be serialized");
}
