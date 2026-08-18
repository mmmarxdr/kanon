import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/types.js";
import {
  AUTHORIZATION_POLICY_VERSION,
  canonicalJson,
  canonicalJsonBytes,
  sha256Hex,
} from "./canonical.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { PreviewEnvelopeSchema, type PreviewEnvelope } from "./contracts.js";
import { searchIssues } from "./search.js";
import { createSourceIdentity } from "./source.js";

const PREVIEW_TOKEN_CONTEXT = "triage-preview-context.v1";
const PREVIEW_SEAL_VERSION = "seal.v1";
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const PREVIEW_API_DEADLINE_MS = 2500;

const ScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }).strict(),
  z.object({ kind: z.literal("workspace"), workspaceId: z.string().uuid() }).strict(),
]);
const HostOutcomeSchema = z
  .object({
    status: z.enum(["completed", "unavailable", "timed_out", "invalid"]),
    provider: z.string().min(1).max(200).optional(),
    model: z.string().min(1).max(200).optional(),
    modelVersion: z.string().min(1).max(200).optional(),
  })
  .strict();
const HostSuggestionSchema = z
  .object({
    concept: z.enum(["severity", "impact", "urgency", "sla"]),
    value: z.union([z.string().min(1).max(240), z.number().finite()]),
    reason: z.string().min(1).max(240),
    evidenceRefIds: z.array(z.string().min(1).max(200)).min(1).max(3),
    confidence: z.enum(["low", "medium", "high"]),
    confidenceBasis: z.string().min(1).max(240),
  })
  .strict();

export const PreviewRequestSchema = z.discriminatedUnion("phase", [
  z
    .object({
      phase: z.literal("prepare"),
      scope: ScopeSchema.optional(),
      format: z.enum(["compact", "full"]).default("compact"),
      aiIntent: z.enum(["none", "host_assisted"]).default("none"),
    })
    .strict(),
  z
    .object({
      phase: z.literal("validate"),
      contextToken: z.string().min(1).max(16_384),
      hostOutcome: HostOutcomeSchema,
      suggestions: z.array(z.record(z.unknown())).max(10).optional(),
      format: z.enum(["compact", "full"]).default("compact"),
    })
    .strict(),
]);

export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;

interface ExecutePreviewInput {
  readonly issueKey: string;
  readonly userId: string;
  readonly allowedProjectIds: readonly string[] | undefined;
  readonly correlationId: string;
  readonly request: PreviewRequest;
  readonly deadlineAt?: number;
}

interface PreviewContext {
  readonly version: 1;
  readonly expiresAt: string;
  readonly issueKey: string;
  readonly previewIdentity: string;
  readonly scope: z.infer<typeof ScopeSchema>;
  readonly sourceDigest: string;
}

type UnsignedPreview = Omit<PreviewEnvelope, "previewSeal" | "contextToken">;
type HostRecommendationResult = Pick<
  UnsignedPreview,
  "recommendations" | "conflicts" | "degradation"
>;

function boundedSearchQuery(title: string, issueKey: string): string {
  const tokens = title.normalize("NFKC").match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  while (tokens.length > 0 && Buffer.byteLength(tokens.join(" "), "utf8") > 256) tokens.pop();
  return tokens.join(" ") || issueKey;
}

function boundedText(value: string, maxUnits: number): string {
  const bounded = value.slice(0, maxUnits);
  const last = bounded.charCodeAt(bounded.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? bounded.slice(0, -1) : bounded;
}

function isStatementTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; meta?: unknown };
  const meta = value.meta && typeof value.meta === "object"
    ? value.meta as { code?: unknown; message?: unknown }
    : {};
  return value.code === "SEARCH_TIMED_OUT" || value.code === "P2024" || value.code === "P2028" ||
    meta.code === "57014" ||
    /statement timeout|canceling statement|57014/i.test(
      [value.message, meta.message].filter((item) => typeof item === "string").join(" "),
    );
}

function sealBinding(preview: Omit<PreviewEnvelope, "previewSeal" | "contextToken">) {
  return {
    contractVersion: preview.contractVersion,
    previewIdentity: preview.previewIdentity,
    target: preview.target,
    observedAt: preview.observedAt,
    generatedAt: preview.generatedAt,
    authorizationPolicyVersion: preview.authorizationPolicyVersion,
    effectiveScope: preview.effectiveScope,
    searchCompleteness: preview.searchCompleteness,
    policy: preview.policy,
    recommendations: preview.recommendations,
    candidates: preview.candidates,
    conflicts: preview.conflicts,
    unknowns: preview.unknowns,
    degradation: preview.degradation,
    ...(preview.evidence ? { evidence: preview.evidence } : {}),
    correlationId: preview.correlationId,
  };
}

function sourceBinding(preview: Omit<PreviewEnvelope, "previewSeal" | "contextToken">) {
  return {
    target: preview.target,
    effectiveScope: preview.effectiveScope,
    authorizationPolicyVersion: preview.authorizationPolicyVersion,
    policy: preview.policy,
    candidates: preview.candidates.map(({ issueId, sourceVersion, sourceHash }) => ({
      issueId,
      sourceVersion,
      sourceHash,
    })),
  };
}

function sealFor(preview: Omit<PreviewEnvelope, "previewSeal" | "contextToken">, expiresAt: Date) {
  const expires = Math.floor(expiresAt.getTime() / 1000).toString(36);
  const digest = sha256Hex(canonicalJsonBytes(sealBinding(preview)));
  const signature = createHmac("sha256", env.JWT_SECRET)
    .update(`${PREVIEW_SEAL_VERSION}.${expires}.${digest}`)
    .digest("base64url");
  return `${PREVIEW_SEAL_VERSION}.${expires}.${digest}.${signature}`;
}

export function verifyPreviewSeal(
  preview: PreviewEnvelope,
  explicitSeal: string,
  now = new Date(),
  allowExpired = false,
): { expired: boolean } {
  if (preview.previewSeal !== explicitSeal) {
    throw new AppError(409, "PREVIEW_SEAL_MISMATCH", "Preview seal does not match the preview");
  }
  const parts = explicitSeal.split(".");
  const [prefix, version, expires, digest, signature] = parts;
  if (
    parts.length !== 5 ||
    prefix !== "seal" ||
    version !== "v1" ||
    !expires?.match(/^[0-9a-z]+$/) ||
    !digest?.match(/^[a-f0-9]{64}$/) ||
    !signature?.match(/^[A-Za-z0-9_-]{43}$/)
  ) {
    throw new AppError(400, "INVALID_PREVIEW_SEAL", "Preview seal is invalid");
  }
  const expiresAt = Number.parseInt(expires, 36) * 1000;
  if (!Number.isFinite(expiresAt)) throw new AppError(400, "INVALID_PREVIEW_SEAL", "Preview seal is invalid");
  const { previewSeal, contextToken, ...unsigned } = preview;
  void previewSeal;
  void contextToken;
  const expectedDigest = sha256Hex(canonicalJsonBytes(sealBinding(unsigned)));
  const expectedSignature = createHmac("sha256", env.JWT_SECRET)
    .update(`${PREVIEW_SEAL_VERSION}.${expires}.${expectedDigest}`)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    digest !== expectedDigest ||
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new AppError(400, "INVALID_PREVIEW_SEAL", "Preview seal is invalid");
  }
  const expired = expiresAt <= now.getTime();
  if (expired && !allowExpired) {
    throw new AppError(409, "PREVIEW_EXPIRED", "Preview expired; rerun preview");
  }
  return { expired };
}

async function preparePreview(
  issueKey: string,
  userId: string,
  allowedProjectIds: readonly string[] | undefined,
  correlationId: string,
  scope: z.infer<typeof ScopeSchema>,
  format: "compact" | "full",
  previewIdentity: string = randomUUID(),
  deadlineAt = performance.now() + PREVIEW_API_DEADLINE_MS,
): Promise<UnsignedPreview> {
  const remaining = Math.floor(deadlineAt - performance.now());
  if (remaining < 2) throw new AppError(503, "PREVIEW_TIMED_OUT", "Triage preview deadline exceeded");
  const maxWait = Math.max(1, Math.min(250, Math.floor(remaining / 4)));
  const loadContext = () => prisma.$transaction(async (tx) => {
    const target = await tx.issue.findUnique({
      where: { key: issueKey },
      include: { project: true },
    });
    if (!target) throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Issue not found");
    if (scope.kind === "workspace" && scope.workspaceId !== target.project.workspaceId) {
      throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Issue not found");
    }
    const currentPolicy = await tx.triagePolicy.findFirst({
      where: { workspaceId: target.project.workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { issue: target, policy: currentPolicy };
  }, { maxWait, timeout: remaining - maxWait });
  let loaded: Awaited<ReturnType<typeof loadContext>>;
  try {
    loaded = await loadContext();
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw new AppError(503, "PREVIEW_TIMED_OUT", "Triage preview deadline exceeded");
    }
    throw error;
  }
  const { issue, policy } = loaded;
  if (!policy) throw new AppError(503, "TRIAGE_POLICY_UNAVAILABLE", "Triage policy is unavailable");

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
  let search: Awaited<ReturnType<typeof searchIssues>>;
  const searchDeadlineMs = Math.floor(deadlineAt - performance.now());
  if (searchDeadlineMs < 100) {
    throw new AppError(503, "PREVIEW_TIMED_OUT", "Triage preview deadline exceeded");
  }
  try {
    search = await searchIssues(
      issue.project.workspaceId,
      userId,
      {
        q: boundedSearchQuery(issue.title, issue.key),
        scope,
        projection: "compact",
        limit: 10,
        targetIssueId: issue.id,
        deadlineMs: Math.min(900, searchDeadlineMs),
      },
      allowedProjectIds,
      correlationId,
    );
  } catch (error) {
    if (!isStatementTimeout(error)) {
      throw error;
    }
    search = {
      contractVersion: "issue-search.v1",
      orderingVersion: "issue-search.v1",
      completeness: "timed_out",
      limit: 10,
      returnedCount: 0,
      effectiveScope: scope.kind === "workspace"
        ? { kind: "workspace", workspaceId: issue.project.workspaceId }
        : { kind: "project", workspaceId: issue.project.workspaceId, projectId: issue.projectId },
      correlationId,
      degradation: ["candidate_timeout"],
      rows: [],
    };
  }
  const policyEvidence = {
    evidenceRefId: `target:${issue.id}:priority`,
    sourceClass: "deterministic_fact" as const,
    field: "priority",
    fact: `Current priority is ${issue.priority}`,
    sourceVersion: source.sourceVersion,
  };
  const recommendation = {
    itemId: "policy:priority-urgency:v1",
    state: "supported" as const,
    normalized: {
      concept: "urgency" as const,
      operation: "recommend" as const,
      value: issue.priority,
      metadataOnly: true as const,
    },
    source: "deterministic_policy" as const,
    reason: "Urgency follows the target's current priority",
    evidence: [policyEvidence],
    confidence: "high" as const,
    confidenceBasis: "Direct canonical priority field",
    ruleVersion: "priority-urgency.v1",
  };
  const candidates = search.rows.map((candidate) => ({
    rank: candidate.rank,
    issueId: candidate.issueId,
    issueKey: candidate.issueKey,
    sourceVersion: candidate.sourceVersion,
    sourceHash: candidate.sourceHash,
    sourceClass: "deterministic_policy" as const,
    reason: "Bounded title/key similarity candidate",
    evidence: [
      {
        evidenceRefId: `candidate:${candidate.issueId}:title`,
        sourceClass: "untrusted_issue_text" as const,
        field: "title",
        excerpt: boundedText(candidate.title, 240),
        sourceVersion: candidate.sourceVersion,
      },
    ],
    confidence: "medium" as const,
    confidenceBasis: "Deterministic bounded search rank",
  }));
  const now = new Date();
  return {
    contractVersion: "triage-preview.v1",
    previewIdentity,
    target: {
      issueId: issue.id,
      issueKey: issue.key,
      projectId: issue.projectId,
      projectKey: issue.project.key,
      workspaceId: issue.project.workspaceId,
      sourceVersion: source.sourceVersion,
      sourceHash: source.sourceHash,
    },
    observedAt: now.toISOString(),
    generatedAt: now.toISOString(),
    authorizationPolicyVersion: AUTHORIZATION_POLICY_VERSION,
    effectiveScope: search.effectiveScope,
    searchCompleteness: search.completeness,
    correlationId,
    policy: { id: policy.id, version: policy.version },
    recommendations: [recommendation],
    candidates,
    conflicts: [],
    unknowns: [],
    degradation: search.degradation,
    ...(format === "full"
      ? { evidence: [policyEvidence, ...candidates.flatMap((candidate) => candidate.evidence)] }
      : {}),
  };
}

function hostRecommendations(
  request: Extract<PreviewRequest, { phase: "validate" }>,
  preview: UnsignedPreview,
): HostRecommendationResult {
  if (request.hostOutcome.status !== "completed") {
    return {
      recommendations: preview.recommendations,
      conflicts: preview.conflicts,
      degradation: [...new Set([...preview.degradation, `ai_${request.hostOutcome.status}`])],
    };
  }
  if (
    !request.hostOutcome.provider ||
    !request.hostOutcome.model ||
    !request.hostOutcome.modelVersion ||
    !request.suggestions?.length
  ) {
    return {
      recommendations: preview.recommendations,
      conflicts: preview.conflicts,
      degradation: [...new Set([...preview.degradation, "ai_invalid"])],
    };
  }
  const hostModel = {
    provider: request.hostOutcome.provider,
    model: request.hostOutcome.model,
    modelVersion: request.hostOutcome.modelVersion,
  };
  const evidence = new Map(
    [...preview.recommendations.flatMap((item) => item.evidence), ...preview.candidates.flatMap((item) => item.evidence)]
      .map((item) => [item.evidenceRefId, item]),
  );
  const suggestions = request.suggestions.slice(0, 3);
  const parsed = suggestions.map((suggestion) => HostSuggestionSchema.safeParse(suggestion));
  if (parsed.some((result) => !result.success)) {
    return {
      recommendations: preview.recommendations,
      conflicts: preview.conflicts,
      degradation: [...new Set([...preview.degradation, "ai_invalid"])],
    };
  }
  const additions = parsed.flatMap((result, index) => {
    if (!result.success) return [];
    const selectedEvidence = result.data.evidenceRefIds.map((id) => evidence.get(id));
    if (selectedEvidence.some((item) => !item)) return [];
    return [{
      itemId: `host:${index + 1}`,
      state: "supported" as const,
      normalized: {
        concept: result.data.concept,
        operation: "recommend" as const,
        value: result.data.value,
        metadataOnly: true as const,
      },
      source: "host_ai" as const,
      reason: result.data.reason,
      evidence: selectedEvidence as NonNullable<(typeof selectedEvidence)[number]>[],
      confidence: result.data.confidence,
      confidenceBasis: result.data.confidenceBasis,
      model: hostModel,
    }];
  });
  if (additions.length === parsed.length) {
    const conflictIds = new Set(preview.conflicts);
    const recommendations = [...preview.recommendations, ...additions];
    for (const recommendation of recommendations) {
      if (recommendation.state !== "supported") continue;
      for (const other of recommendations) {
        if (
          other.state === "supported" &&
          other.itemId !== recommendation.itemId &&
          other.normalized.concept === recommendation.normalized.concept &&
          canonicalJson(other.normalized) !== canonicalJson(recommendation.normalized)
        ) {
          conflictIds.add(recommendation.itemId);
          conflictIds.add(other.itemId);
        }
      }
    }
    return {
      recommendations: recommendations.map((item) =>
        conflictIds.has(item.itemId) ? { ...item, state: "conflict" as const } : item),
      conflicts: [...conflictIds],
      degradation: request.suggestions.length > suggestions.length
        ? [...new Set([...preview.degradation, "host_suggestions_truncated"])]
        : preview.degradation,
    };
  }
  return {
    recommendations: preview.recommendations,
    conflicts: preview.conflicts,
    degradation: [...new Set([...preview.degradation, "ai_invalid"])],
  };
}

export async function executePreview(input: ExecutePreviewInput): Promise<PreviewEnvelope> {
  const deadlineAt = input.deadlineAt ?? performance.now() + PREVIEW_API_DEADLINE_MS;
  if (input.request.phase === "prepare") {
    const scope = input.request.scope ?? { kind: "project" as const };
    const preview = await preparePreview(
      input.issueKey,
      input.userId,
      input.allowedProjectIds,
      input.correlationId,
      scope,
      input.request.format,
      randomUUID(),
      deadlineAt,
    );
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
    const previewSeal = sealFor(preview, expiresAt);
    if (input.request.aiIntent !== "host_assisted") {
      return PreviewEnvelopeSchema.parse({ ...preview, previewSeal });
    }
    const context: PreviewContext = {
      version: 1,
      expiresAt: expiresAt.toISOString(),
      issueKey: input.issueKey,
      previewIdentity: preview.previewIdentity,
      scope,
      sourceDigest: sha256Hex(canonicalJsonBytes(sourceBinding(preview))),
    };
    const contextToken = encodeCursor(context, { key: env.JWT_SECRET, context: PREVIEW_TOKEN_CONTEXT });
    return PreviewEnvelopeSchema.parse({ ...preview, previewSeal, contextToken });
  }

  let context: PreviewContext;
  try {
    context = decodeCursor<PreviewContext>(input.request.contextToken, {
      key: env.JWT_SECRET,
      context: PREVIEW_TOKEN_CONTEXT,
    });
  } catch {
    throw new AppError(400, "INVALID_CONTEXT_TOKEN", "Preview context token is invalid");
  }
  if (context.version !== 1 || context.issueKey !== input.issueKey) {
    throw new AppError(409, "CONTEXT_MISMATCH", "Preview context does not match the target");
  }
  const contextExpiresAt = new Date(context.expiresAt);
  if (contextExpiresAt.getTime() <= Date.now()) {
    throw new AppError(409, "PREVIEW_EXPIRED", "Preview expired; rerun preview");
  }
  const preview = await preparePreview(
    input.issueKey,
    input.userId,
    input.allowedProjectIds,
    input.correlationId,
    context.scope,
    input.request.format,
    context.previewIdentity,
    deadlineAt,
  );
  if (contextExpiresAt.getTime() <= Date.now()) {
    throw new AppError(409, "PREVIEW_EXPIRED", "Preview expired; rerun preview");
  }
  if (sha256Hex(canonicalJsonBytes(sourceBinding(preview))) !== context.sourceDigest) {
    throw new AppError(409, "SOURCE_CONFLICT", "Issue source changed; rerun preview");
  }
  const host = hostRecommendations(input.request, preview);
  const validated: UnsignedPreview = {
    ...preview,
    generatedAt: new Date().toISOString(),
    recommendations: host.recommendations,
    conflicts: host.conflicts,
    degradation: host.degradation,
  };
  const previewSeal = sealFor(validated, contextExpiresAt);
  return PreviewEnvelopeSchema.parse({ ...validated, previewSeal });
}
