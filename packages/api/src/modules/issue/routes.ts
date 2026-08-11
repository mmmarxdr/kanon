import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateIssueBody,
  UpdateIssueBody,
  TransitionBody,
  BatchTransitionBody,
  BatchTransitionByKeysBody,
  ProjectKeyParam,
  IssueKeyParam,
  GroupKeyParam,
  IssueFilterQuery,
  ReconcileTimeBody,
  DeleteIssueBody,
} from "./schema.js";
import { IssueSearchInputSchema } from "../triage/contracts.js";
import {
  requireProjectMember,
  requireProjectRole,
  requireIssueMember,
  requireIssueRole,
  requireMember,
} from "../../middleware/require-role.js";
import * as issueService from "./service.js";
import { searchIssues } from "../triage/search.js";
import { reconcileIssueTime } from "./reconcile.js";
import { deleteIssue } from "./delete-issue.js";

/**
 * Issue routes plugin.
 * Registered under /api prefix.
 */
export default async function issueRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/workspaces/:workspaceId/issue-search.v1
   */
  app.post(
    "/workspaces/:workspaceId/issue-search.v1",
    {
      preHandler: [requireMember("workspaceId")],
      schema: {
        params: z.object({ workspaceId: z.string() }),
        body: IssueSearchInputSchema,
      },
    },
    async (request, reply) => {
      const response = await searchIssues(
        request.params.workspaceId,
        request.member!.userId,
        request.body
      );
      return reply.status(200).send(response);
    }
  );

  /**
   * POST /api/projects/:key/issues
   */
  app.post(
    "/projects/:key/issues",
    {
      preHandler: [requireProjectRole("key", "member")],
      schema: {
        params: ProjectKeyParam,
        body: CreateIssueBody,
      },
    },
    async (request, reply) => {
      const issue = await issueService.createIssue(
        request.projectId!,
        request.body,
        request.member!.id,
        request.via,
      );
      return reply.status(201).send(issue);
    },
  );

  /**
   * GET /api/projects/:key/issues
   */
  app.get(
    "/projects/:key/issues",
    {
      preHandler: [requireProjectMember("key")],
      schema: {
        params: ProjectKeyParam,
        querystring: IssueFilterQuery,
      },
    },
    async (request, _reply) => {
      return issueService.listIssues(request.projectId!, request.query);
    },
  );

  /**
   * GET /api/issues/:key
   */
  app.get(
    "/issues/:key",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, _reply) => {
      return issueService.getIssue(
        request.params.key,
        request.member?.id,
        request.projectRole === "admin" || request.projectRole === "owner",
      );
    },
  );

  app.delete(
    "/issues/:key",
    {
      preHandler: [requireIssueRole("key", "admin")],
      schema: { params: IssueKeyParam, body: DeleteIssueBody },
    },
    async (request, reply) => {
      const deleted = await deleteIssue(
        request.issueId!,
        request.params.key,
        request.body,
        request.member!.id,
      );
      return reply.status(200).send(deleted);
    },
  );

  /**
   * PATCH /api/issues/:key
   */
  app.patch(
    "/issues/:key",
    {
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        body: UpdateIssueBody,
      },
    },
    async (request, _reply) => {
      return issueService.updateIssue(
        request.params.key,
        request.body,
        request.member!.id,
        request.via,
      );
    },
  );

  /**
   * POST /api/issues/:key/transition
   */
  app.post(
    "/issues/:key/transition",
    {
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        body: TransitionBody,
      },
    },
    async (request, _reply) => {
      return issueService.transitionIssue(
        request.params.key,
        request.body.to_state,
        request.member!.id,
        request.via,
      );
    },
  );

  /**
   * GET /api/projects/:key/issues/groups
   * Returns aggregated group summaries for a project.
   */
  app.get(
    "/projects/:key/issues/groups",
    {
      preHandler: [requireProjectMember("key")],
      schema: {
        params: ProjectKeyParam,
      },
    },
    async (request, _reply) => {
      return issueService.listIssueGroups(request.projectId!);
    },
  );

  /**
   * PATCH /api/projects/:key/issues/groups/:groupKey/transition
   * Batch-transitions all issues in a group to a new state.
   */
  app.patch(
    "/projects/:key/issues/groups/:groupKey/transition",
    {
      preHandler: [requireProjectRole("key", "member")],
      schema: {
        params: GroupKeyParam,
        body: BatchTransitionBody,
      },
    },
    async (request, _reply) => {
      return issueService.transitionGroup(
        request.projectId!,
        request.params.groupKey,
        request.body.to_state,
        request.member!.id,
      );
    },
  );

  /**
   * POST /api/projects/:key/issues/batch-transition
   * Batch-transitions issues identified by keys to a new state.
   * All-or-nothing: pre-validation rejects on cross-project / invalid
   * state-machine target before any DB write.
   */
  app.post(
    "/projects/:key/issues/batch-transition",
    {
      preHandler: [requireProjectRole("key", "member")],
      schema: {
        params: ProjectKeyParam,
        body: BatchTransitionByKeysBody,
      },
    },
    async (request, _reply) => {
      return issueService.batchTransitionByKeys(
        request.projectId!,
        request.body,
        request.member!.id,
      );
    },
  );

  /**
   * POST /api/issues/:key/reconcile-time
   * KAN-157: Confirm captured time for an issue before →done.
   *   - Promotes unpromoted WorkLogs → approved TimeEntries
   *   - Self-approves all draft/submitted TimeEntries (dev attestation)
   *   - Optional addHours: creates a manual approved TimeEntry
   *   - Stamps issue.timeConfirmedAt = now
   * Wired as issue-member (same as the transition route).
   */
  app.post(
    "/issues/:key/reconcile-time",
    {
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        body: ReconcileTimeBody,
      },
    },
    async (request, reply) => {
      // Resolve issueId from the gate-resolved field (set by requireIssueRole).
      // Fall back to a DB lookup via the key if not set (defensive).
      const issueId = request.issueId!;
      const result = await reconcileIssueTime(
        issueId,
        request.member!.id,
        request.body,
      );
      return reply.status(200).send(result);
    },
  );
}
