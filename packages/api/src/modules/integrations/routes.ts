import {
  redmineReconciliationActivationProgressSchema,
  redmineReconciliationDecisionResultSchema,
  redmineReconciliationDecisionSchema,
  redmineReconciliationMaterializeResultSchema,
  redmineReconciliationMaterializeTargetSchema,
  redmineReconciliationPreviewProgressSchema,
  redmineReconciliationPreviewRequestSchema,
  redmineReconciliationRecommendationPageSchema,
  redmineReconciliationRecommendationQuerySchema,
  redmineReconciliationReviewPageRequestSchema,
  redmineReconciliationReviewPageResultSchema,
} from "@kanon/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { requireMember, requireRole } from "../../middleware/require-role.js";
import { scopedProjectIds } from "../../shared/token-scope.js";
import { AppError } from "../../shared/types.js";
import {
  activateRedmineIssueImport,
  previewRedmineIssueImport,
} from "./redmine-import.js";
import { retryRedmineIssueImport } from "./inbound.js";
import { decrypt } from "./core/crypto.js";
import { priorityReadKey } from "./issue-convergence.js";
import { decodeRedmineIssueDetail } from "./providers/redmine/decoder.js";
import { RedmineHttpClient, RedmineHttpError } from "./providers/redmine/http-client.js";
import {
  decideRedmineReconciliationRecommendations,
  listRedmineReconciliationRecommendations,
  materializeRedmineReconciliationRecommendations,
  reviewRedmineReconciliationPage,
  type RedmineReconciliationRemoteDetail,
} from "./redmine-reconciliation.js";
import {
  bindProject,
  clearCredential,
  configureConnection,
  configureProviderMaps,
  connectCredential,
  createConnection,
  getBindingAuditHealth,
  getConnection,
  getConnectionDiscovery,
  getWorkspaceConnection,
  ownedConnection,
  replaceServiceCredential,
  resolveBindingPrivacyByProject,
  resolveReleasedBindingPrivacy,
  setBindingCommentRollout,
  setConnectionLifecycle,
  serviceCredential,
  unbindProject,
} from "./service.js";

const WorkspaceId = z.object({ wid: z.string().uuid() });
const ConnectionId = WorkspaceId.extend({ id: z.string().uuid() });
const ConnectionBindingId = ConnectionId.extend({ bindingId: z.string().uuid() });
const ReconciliationIssueId = ConnectionBindingId.extend({ remoteIssueId: z.string().regex(/^\d+$/).max(64) });
const ReconciliationPreviewEvidence = z.object({ version: z.literal(2), complete: z.literal(true), mode: z.literal("full"), previewIdentity: z.string().uuid(), scopeFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), candidates: z.array(z.object({ remoteId: z.string().regex(/^\d+$/), sourceVersion: z.string().regex(/^sha256:[a-f0-9]{64}$/) })) }).passthrough();
const InboundApplicationId = ConnectionBindingId.extend({ applicationId: z.string().uuid() });
const CreateConnection = z.object({
  apiKey: z.string().min(1).max(4096),
});
const ConfigureConnection = z.object({
  projectId: z.string().uuid(),
  remoteProjectId: z.string().min(1),
  timeActivityId: z.string().min(1),
  readMap: z.record(z.string(), z.string()),
  writeMap: z.record(z.string(), z.string()),
  priorityReadMap: z.record(z.string(), z.string()).optional(),
  priorityWriteMap: z.record(z.string(), z.string()).optional(),
});
const ConfigureProviderMaps = z.object({
  timeActivityId: z.string().min(1),
  readMap: z.record(z.string(), z.string()),
  writeMap: z.record(z.string(), z.string()),
  priorityReadMap: z.record(z.string(), z.string()).optional(),
  priorityWriteMap: z.record(z.string(), z.string()).optional(),
});
const BindProject = z.object({
  projectId: z.string().uuid(),
  remoteProjectId: z.string().min(1),
});
const SetLifecycle = z.object({ lifecycle: z.enum(["active", "paused", "disabled"]) });
const SetCommentRollout = z
  .object({
    commentCaptureEnabled: z.boolean(),
    commentDispatchEnabled: z.boolean(),
  })
  .refine(({ commentCaptureEnabled, commentDispatchEnabled }) => !commentDispatchEnabled || commentCaptureEnabled, {
    message: "Comment capture must be enabled before dispatch",
    path: ["commentDispatchEnabled"],
  });
const RecoverPrivacy = z.object({
  projectId: z.string().uuid(),
  remoteProjectId: z.string().min(1),
});
const ConnectCredential = z.object({
  apiKey: z.string().min(1).max(4096),
});
const ReplaceServiceCredential = z.object({ apiKey: z.string().min(1).max(4096) });

async function requireUnscopedToken(request: FastifyRequest) {
  if (scopedProjectIds(request.user.allowedProjectIds)) {
    throw new AppError(403, "FORBIDDEN", "Token scope does not allow workspace integration control");
  }
}

type ReconciliationRouteScope = Readonly<{ connectionId: string; bindingId: string; userId: string; workspaceId: string; allowedProjectIds: string[] | null }>;
export interface IntegrationRouteOptions {
  readonly loadRedmineReconciliationIssue?: (input: ReconciliationRouteScope & { readonly remoteIssueId: string }) => Promise<RedmineReconciliationRemoteDetail>;
}
export async function loadRedmineReconciliationIssue(input: ReconciliationRouteScope & { readonly remoteIssueId: string }): Promise<RedmineReconciliationRemoteDetail> {
  const connection = await ownedConnection(prisma, input.connectionId, input.userId, input.workspaceId);
  if (connection.provider !== "redmine" || !["draft", "paused"].includes(connection.lifecycle)) throw new AppError(409, "REDMINE_RECONCILIATION_LIFECYCLE", "Reconciliation requires a draft or paused Redmine connection");
  const binding = await prisma.integrationProjectBinding.findFirst({
    where: { id: input.bindingId, connectionId: input.connectionId, lifecycle: { in: ["draft", "paused"] }, bootstrapState: "previewed", releaseRequestedAt: null, releasedAt: null, project: { archived: false }, ...(input.allowedProjectIds?.length ? { projectId: { in: input.allowedProjectIds } } : {}) },
    include: { connection: true },
  });
  if (!binding) throw new AppError(404, "INTEGRATION_BINDING_NOT_FOUND", "Integration project binding not found");
  const preview = ReconciliationPreviewEvidence.safeParse(binding.bootstrapPageToken);
  if (!preview.success) throw new AppError(409, "REDMINE_RECONCILIATION_UNLISTED", "The Redmine issue is not in this preview");
  const candidate = preview.data.candidates.find(({ remoteId }) => remoteId === input.remoteIssueId);
  if (!candidate) throw new AppError(409, "REDMINE_RECONCILIATION_UNLISTED", "The Redmine issue is not in this preview");
  const credential = await serviceCredential(prisma, connection);
  let apiKey: string;
  try { apiKey = decrypt(credential.encryptedKey); } catch { throw new AppError(409, "INTEGRATION_NOT_READY", "A valid service credential is required"); }
  let issue: ReturnType<typeof decodeRedmineIssueDetail>["issue"];
  try {
    const client = new RedmineHttpClient(connection.baseUrl, apiKey, { endpointAllowlist: env.REDMINE_ENDPOINT_ALLOWLIST });
    issue = decodeRedmineIssueDetail(await client.get<unknown>(`/issues/${encodeURIComponent(input.remoteIssueId)}.json?include=journals`), binding.remoteProjectId, input.remoteIssueId).issue;
  } catch (error) {
    if (error instanceof RedmineHttpError && error.statusCode === 404) return { remoteIssueId: input.remoteIssueId, remoteProjectId: binding.remoteProjectId, sourceVersion: candidate.sourceVersion, previewIdentity: preview.data.previewIdentity, scopeFingerprint: preview.data.scopeFingerprint, visible: false, title: null };
    throw new AppError(502, "REDMINE_CONNECTION_FAILED", "Redmine reconciliation failed while reading the remote issue");
  }
  const common = { remoteIssueId: issue.identity.remoteId, remoteProjectId: issue.identity.remoteProjectId, sourceVersion: issue.sourceVersion, previewIdentity: preview.data.previewIdentity, scopeFingerprint: preview.data.scopeFingerprint };
  if (issue.operation !== "upsert" || !("statusId" in issue.fields)) return { ...common, visible: false, title: null };
  const readMap = binding.readMap && typeof binding.readMap === "object" && !Array.isArray(binding.readMap) ? binding.readMap as Record<string, unknown> : {};
  const identity = issue.fields.assignee ? await prisma.integrationExternalIdentity.findFirst({ where: { bindingId: binding.id, remoteUserId: issue.fields.assignee.remoteId, member: { workspaceId: connection.workspaceId } }, select: { memberId: true } }) : null;
  return { ...common, visible: true, title: issue.fields.title, description: issue.fields.description, createdAt: issue.createdAt, changedAt: issue.changedAt, completedAt: issue.closedAt ?? null, mappedAssigneeId: issue.fields.assignee ? identity?.memberId : null, mappedState: typeof readMap[issue.fields.statusId] === "string" ? readMap[issue.fields.statusId] as string : null, mappedPriority: typeof readMap[priorityReadKey(issue.fields.priorityId)] === "string" ? readMap[priorityReadKey(issue.fields.priorityId)] as string : null, startDate: issue.fields.startDate, dueDate: issue.fields.dueDate, progress: issue.fields.progress };
}
function reconciliationDependencies(options: IntegrationRouteOptions, scope: ReconciliationRouteScope) {
  return {
    workspaceId: scope.workspaceId,
    allowedProjectIds: scope.allowedProjectIds,
    loadRemoteIssue: (remoteIssueId: string) => {
      return (options.loadRedmineReconciliationIssue ?? loadRedmineReconciliationIssue)({ ...scope, remoteIssueId });
    },
  };
}

export default async function integrationRoutes(fastify: FastifyInstance, options: IntegrationRouteOptions = {}): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/workspaces/:wid/connections",
    {
      preHandler: [requireRole("wid", "owner"), requireUnscopedToken],
      schema: { params: WorkspaceId, body: CreateConnection },
    },
    async (request, reply) => {
      const result = await createConnection(
        { workspaceId: request.params.wid, apiKey: request.body.apiKey },
        request.user.userId,
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/workspaces/:wid/connections",
    { preHandler: [requireMember("wid")], schema: { params: WorkspaceId } },
    async (request) =>
      getWorkspaceConnection(
        request.params.wid,
        request.user.userId,
        scopedProjectIds(request.user.allowedProjectIds),
      ),
  );

  app.get(
    "/workspaces/:wid/connections/:id",
    { preHandler: [requireMember("wid")], schema: { params: ConnectionId } },
    async (request) =>
      getConnection(
        request.params.id,
        request.user.userId,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      ),
  );

  app.get(
    "/workspaces/:wid/connections/:id/discovery",
    {
      preHandler: [requireRole("wid", "owner"), requireUnscopedToken],
      schema: { params: ConnectionId },
    },
    async (request) =>
      getConnectionDiscovery(
        request.params.id,
        request.user.userId,
        undefined,
        request.params.wid,
      ),
  );

  app.put(
    "/workspaces/:wid/connections/:id/mapping",
    {
      preHandler: [requireRole("wid", "owner"), requireUnscopedToken],
      schema: { params: ConnectionId, body: ConfigureConnection },
    },
    async (request) =>
      configureConnection(
        request.params.id,
        request.body,
        request.user.userId,
        undefined,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      ),
  );

  app.put(
    "/workspaces/:wid/connections/:id/provider-maps",
    {
      preHandler: [requireRole("wid", "owner"), requireUnscopedToken],
      schema: { params: ConnectionId, body: ConfigureProviderMaps },
    },
    async (request) =>
      configureProviderMaps(
        request.params.id,
        request.body,
        request.user.userId,
        undefined,
        request.params.wid,
      ),
  );

  app.put(
    "/workspaces/:wid/connections/:id/bindings",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: ConnectionId, body: BindProject },
    },
    async (request) =>
      bindProject(
        request.params.id,
        request.body,
        request.user.userId,
        undefined,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      ),
  );

  app.delete(
    "/workspaces/:wid/connections/:id/bindings/:bindingId",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: ConnectionBindingId },
    },
    async (request, reply) => {
      const result = await unbindProject(
        request.params.id,
        request.params.bindingId,
        request.user.userId,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      );
      return reply.status(result.status === "draining" ? 202 : 200).send(result);
    },
  );

  app.patch(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/comment-rollout",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: ConnectionBindingId, body: SetCommentRollout },
    },
    async (request) =>
      setBindingCommentRollout(
        request.params.id,
        request.params.bindingId,
        request.body,
        request.user.userId,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      ),
  );

  app.get(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/audit-health",
    { preHandler: [requireRole("wid", "owner"), requireUnscopedToken], schema: { params: ConnectionBindingId } },
    async (request) => getBindingAuditHealth(request.params.id, request.params.bindingId, request.user.userId, request.params.wid),
  );

  app.post(
    "/workspaces/:wid/connections/:id/privacy-recovery",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: ConnectionId, body: RecoverPrivacy },
    },
    async (request) =>
      resolveBindingPrivacyByProject(
        request.params.id,
        request.body,
        request.user.userId,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      ),
  );

  app.post(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/privacy-recovery",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: ConnectionBindingId },
    },
    async (request) =>
      resolveReleasedBindingPrivacy(
        request.params.id,
        request.params.bindingId,
        request.user.userId,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      ),
  );

  app.post(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/inbound/preview",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: ConnectionBindingId },
    },
    async (request) => {
      const previewRequest = redmineReconciliationPreviewRequestSchema.optional().parse(request.body);
      await getConnection(
        request.params.id,
        request.user.userId,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      );
      const result = await previewRedmineIssueImport(
        request.params.id,
        request.params.bindingId,
        request.user.userId,
        {
          workspaceId: request.params.wid,
          allowedProjectIds: scopedProjectIds(request.user.allowedProjectIds),
        },
        previewRequest?.mode,
      );
      return previewRequest ? redmineReconciliationPreviewProgressSchema.parse(result) : result;
    },
  );

  app.post(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/reconciliation/recommendations/materialize",
    { preHandler: [requireRole("wid", "owner")], schema: { params: ConnectionBindingId, body: redmineReconciliationMaterializeTargetSchema, response: { 200: redmineReconciliationMaterializeResultSchema } } },
    async (request) => {
      const scope = { connectionId: request.params.id, bindingId: request.params.bindingId, userId: request.user.userId, workspaceId: request.params.wid, allowedProjectIds: scopedProjectIds(request.user.allowedProjectIds) };
      const result = await materializeRedmineReconciliationRecommendations({ connectionId: scope.connectionId, bindingId: scope.bindingId, userId: scope.userId, remoteIssueId: request.body.remoteIssueId, candidateIssueId: request.body.candidateIssueId }, reconciliationDependencies(options, scope));
      return { ...result, recommendations: result.recommendations.map((item) => ({ ...item, decidedAt: item.decidedAt?.toISOString() ?? null })) };
    },
  );

  app.post(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/reconciliation/review-page",
    { preHandler: [requireRole("wid", "owner")], schema: { params: ConnectionBindingId, body: redmineReconciliationReviewPageRequestSchema, response: { 200: redmineReconciliationReviewPageResultSchema } } },
    async (request) => {
      const scope = { connectionId: request.params.id, bindingId: request.params.bindingId, userId: request.user.userId, workspaceId: request.params.wid, allowedProjectIds: scopedProjectIds(request.user.allowedProjectIds) };
      const page = await reviewRedmineReconciliationPage({ connectionId: scope.connectionId, bindingId: scope.bindingId, userId: scope.userId }, { ...reconciliationDependencies(options, scope), ...request.body });
      return { ...page, items: page.items.map((item) => ({ ...item, recommendations: item.recommendations.map((recommendation) => ({ ...recommendation, decidedAt: recommendation.decidedAt?.toISOString() ?? null })) })) };
    },
  );

  app.get(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/reconciliation/recommendations",
    { preHandler: [requireRole("wid", "owner")], schema: { params: ConnectionBindingId, querystring: redmineReconciliationRecommendationQuerySchema, response: { 200: redmineReconciliationRecommendationPageSchema } } },
    async (request) => {
      const page = await listRedmineReconciliationRecommendations(
        { connectionId: request.params.id, bindingId: request.params.bindingId, userId: request.user.userId },
        { workspaceId: request.params.wid, allowedProjectIds: scopedProjectIds(request.user.allowedProjectIds), ...request.query },
      );
      return { ...page, items: page.items.map((item) => ({ ...item, decidedAt: item.decidedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })) };
    },
  );

  app.post(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/reconciliation/issues/:remoteIssueId/decision",
    { preHandler: [requireRole("wid", "owner")], schema: { params: ReconciliationIssueId, body: redmineReconciliationDecisionSchema, response: { 200: redmineReconciliationDecisionResultSchema } } },
    async (request) => {
      const scope = { connectionId: request.params.id, bindingId: request.params.bindingId, userId: request.user.userId, workspaceId: request.params.wid, allowedProjectIds: scopedProjectIds(request.user.allowedProjectIds) };
      return decideRedmineReconciliationRecommendations({ connectionId: scope.connectionId, bindingId: scope.bindingId, userId: scope.userId, remoteIssueId: request.params.remoteIssueId }, request.body, reconciliationDependencies(options, scope));
    },
  );

  app.post(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/inbound/activate",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: ConnectionBindingId, response: { 200: redmineReconciliationActivationProgressSchema } },
    },
    async (request) => {
      await getConnection(
        request.params.id,
        request.user.userId,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      );
      return activateRedmineIssueImport(
        request.params.id,
        request.params.bindingId,
        request.user.userId,
        {
          workspaceId: request.params.wid,
          allowedProjectIds: scopedProjectIds(request.user.allowedProjectIds),
        },
      );
    },
  );

  app.post(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/inbound/applications/:applicationId/retry",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: InboundApplicationId },
    },
    async (request) => {
      await getConnection(
        request.params.id,
        request.user.userId,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      );
      return retryRedmineIssueImport(
        request.params.id,
        request.params.bindingId,
        request.params.applicationId,
        request.user.userId,
        {
          workspaceId: request.params.wid,
          allowedProjectIds: scopedProjectIds(request.user.allowedProjectIds),
        },
      );
    },
  );

  app.patch(
    "/workspaces/:wid/connections/:id/lifecycle",
    {
      preHandler: [requireRole("wid", "owner"), requireUnscopedToken],
      schema: { params: ConnectionId, body: SetLifecycle },
    },
    async (request) =>
      setConnectionLifecycle(
        request.params.id,
        request.body.lifecycle,
        request.user.userId,
        undefined,
        request.params.wid,
      ),
  );

  app.post(
    "/workspaces/:wid/connections/:id/credential",
    {
      preHandler: [requireMember("wid"), requireUnscopedToken],
      schema: { params: ConnectionId, body: ConnectCredential },
    },
    async (request) =>
      connectCredential(
        request.params.id,
        request.body.apiKey,
        request.user.userId,
        undefined,
        request.params.wid,
      ),
  );

  app.delete(
    "/workspaces/:wid/connections/:id/credential",
    {
      preHandler: [requireMember("wid"), requireUnscopedToken],
      schema: { params: ConnectionId },
    },
    async (request, reply) => {
      await clearCredential(request.params.id, request.user.userId, request.params.wid);
      return reply.status(204).send();
    },
  );

  app.put(
    "/workspaces/:wid/connections/:id/service-credential",
    {
      preHandler: [requireRole("wid", "owner"), requireUnscopedToken],
      schema: { params: ConnectionId, body: ReplaceServiceCredential },
    },
    async (request) =>
      replaceServiceCredential(
        request.params.id,
        request.body.apiKey,
        request.user.userId,
        undefined,
        request.params.wid,
      ),
  );
}
