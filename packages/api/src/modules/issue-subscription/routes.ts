/**
 * IssueSubscription routes — S4 / KAN-28
 *
 * Endpoints:
 *  PUT    /api/issues/:key/subscription  — subscribe (idempotent)
 *  DELETE /api/issues/:key/subscription  — unsubscribe
 *  GET    /api/issues/:key/subscription  — get own subscription status
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireIssueRole, requireIssueMember } from "../../middleware/require-role.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import * as subscriptionService from "./service.js";

const IssueKeyParam = z.object({ key: z.string() });

const SubscriptionStatusSchema = z.object({
  subscribed: z.boolean(),
});

/**
 * Resolve issue ID from issue key, asserting existence.
 * Throws 404 if not found.
 */
async function resolveIssueId(key: string): Promise<string> {
  const issue = await prisma.issue.findUnique({
    where: { key },
    select: { id: true },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${key}" not found`);
  }
  return issue.id;
}

export default async function issueSubscriptionRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * PUT /api/issues/:key/subscription
   * Subscribe the authenticated member to the issue. Idempotent.
   */
  app.put(
    "/issues/:key/subscription",
    {
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        response: { 200: SubscriptionStatusSchema },
      },
    },
    async (request, _reply) => {
      const issueId = await resolveIssueId(request.params.key);
      return subscriptionService.subscribe(issueId, request.member!.id);
    },
  );

  /**
   * DELETE /api/issues/:key/subscription
   * Unsubscribe the authenticated member from the issue. Idempotent.
   */
  app.delete(
    "/issues/:key/subscription",
    {
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        response: { 200: SubscriptionStatusSchema },
      },
    },
    async (request, _reply) => {
      const issueId = await resolveIssueId(request.params.key);
      return subscriptionService.unsubscribe(issueId, request.member!.id);
    },
  );

  /**
   * GET /api/issues/:key/subscription
   * Return the authenticated member's subscription status for the issue.
   */
  app.get(
    "/issues/:key/subscription",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
        response: { 200: SubscriptionStatusSchema },
      },
    },
    async (request, _reply) => {
      const issueId = await resolveIssueId(request.params.key);
      return subscriptionService.getStatus(issueId, request.member!.id);
    },
  );
}
