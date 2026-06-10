/**
 * IssueSubscription routes — S4 / KAN-28
 *
 * Endpoints:
 *  PUT    /api/issues/:key/subscription  — subscribe (idempotent)
 *  DELETE /api/issues/:key/subscription  — unsubscribe
 *  GET    /api/issues/:key/subscription  — get own subscription status
 *
 * Fix 2 (KAN-28): requireIssueRole now sets request.issueId (mirrors the
 * requireProjectRole → request.projectId pattern). Route handlers read
 * request.issueId directly, eliminating the second DB lookup that was
 * previously performed by the local resolveIssueId helper.
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireIssueRole, requireIssueMember } from "../../middleware/require-role.js";
import { subscriptionStatusSchema } from "@kanon/shared";
import * as subscriptionService from "./service.js";

const IssueKeyParam = z.object({ key: z.string() });

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
        response: { 200: subscriptionStatusSchema },
      },
    },
    async (request, _reply) => {
      return subscriptionService.subscribe(request.issueId!, request.member!.id);
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
        response: { 200: subscriptionStatusSchema },
      },
    },
    async (request, _reply) => {
      return subscriptionService.unsubscribe(request.issueId!, request.member!.id);
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
        response: { 200: subscriptionStatusSchema },
      },
    },
    async (request, _reply) => {
      return subscriptionService.getStatus(request.issueId!, request.member!.id);
    },
  );
}
