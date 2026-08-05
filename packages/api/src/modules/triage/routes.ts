import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { getIssueTriageHistory } from "./issue-history.js";
import { requireIssueMember } from "../../middleware/require-role.js";

export async function triageProposalReadRoutes(appRaw: FastifyInstance) {
  const app = appRaw.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/issues/:key/triage-history",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: z.object({ key: z.string() }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(20).default(10),
          cursor: z.string().optional()
        })
      }
    },
    getIssueTriageHistory
  );

  app.get("/api/triage-proposals/:id", async (request, reply) => {
    return { ok: true };
  });

  app.get("/api/projects/:key/triage-proposals", async (request, reply) => {
    return { rows: [] };
  });
}
