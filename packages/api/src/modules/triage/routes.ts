import { FastifyInstance } from "fastify";

export async function triageProposalReadRoutes(app: FastifyInstance) {
  app.get("/api/triage-proposals/:id", async (request, reply) => {
    return { ok: true };
  });

  app.get("/api/projects/:key/triage-proposals", async (request, reply) => {
    return { rows: [] };
  });
}
