import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateIssueBody,
  UpdateIssueBody,
  TransitionBody,
  BatchTransitionBody,
  ProjectKeyParam,
  IssueKeyParam,
  GroupKeyParam,
  IssueFilterQuery,
} from "./schema.js";
import * as issueService from "./service.js";

/**
 * Issue routes plugin.
 * Registered under /api prefix.
 */
export default async function issueRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/projects/:key/issues
   */
  app.post(
    "/projects/:key/issues",
    {
      schema: {
        params: ProjectKeyParam,
        body: CreateIssueBody,
      },
    },
    async (request, reply) => {
      const issue = await issueService.createIssue(
        request.params.key,
        request.body,
        request.user.memberId,
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
      schema: {
        params: ProjectKeyParam,
        querystring: IssueFilterQuery,
      },
    },
    async (request, _reply) => {
      return issueService.listIssues(request.params.key, request.query);
    },
  );

  /**
   * GET /api/issues/:key
   */
  app.get(
    "/issues/:key",
    {
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, _reply) => {
      return issueService.getIssue(request.params.key);
    },
  );

  /**
   * PATCH /api/issues/:key
   */
  app.patch(
    "/issues/:key",
    {
      schema: {
        params: IssueKeyParam,
        body: UpdateIssueBody,
      },
    },
    async (request, _reply) => {
      return issueService.updateIssue(
        request.params.key,
        request.body,
        request.user.memberId,
      );
    },
  );

  /**
   * POST /api/issues/:key/transition
   */
  app.post(
    "/issues/:key/transition",
    {
      schema: {
        params: IssueKeyParam,
        body: TransitionBody,
      },
    },
    async (request, _reply) => {
      return issueService.transitionIssue(
        request.params.key,
        request.body.to_state,
        request.user.memberId,
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
      schema: {
        params: ProjectKeyParam,
      },
    },
    async (request, _reply) => {
      return issueService.listIssueGroups(request.params.key);
    },
  );

  /**
   * GET /api/issues/:key/context
   * Returns past AI session context from Engram for the given issue.
   */
  app.get(
    "/issues/:key/context",
    {
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, _reply) => {
      return issueService.getIssueContext(request.params.key, request.log);
    },
  );

  /**
   * PATCH /api/projects/:key/issues/groups/:groupKey/transition
   * Batch-transitions all issues in a group to a new state.
   */
  app.patch(
    "/projects/:key/issues/groups/:groupKey/transition",
    {
      schema: {
        params: GroupKeyParam,
        body: BatchTransitionBody,
      },
    },
    async (request, _reply) => {
      return issueService.transitionGroup(
        request.params.key,
        request.params.groupKey,
        request.body.to_state,
        request.user.memberId,
      );
    },
  );
}
