import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  clearCredential,
  configureConnection,
  connectCredential,
  createConnection,
  getConnection,
  getConnectionDiscovery,
  setConnectionLifecycle,
} from "./service.js";

const ConnectionId = z.object({ id: z.string().uuid() });
const CreateConnection = z.object({
  workspaceId: z.string().uuid(),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).max(4096),
});
const ConfigureConnection = z.object({
  projectId: z.string().uuid(),
  remoteProjectId: z.string().min(1),
  timeActivityId: z.string().min(1),
  readMap: z.record(z.string(), z.string()),
  writeMap: z.record(z.string(), z.string()),
});
const SetLifecycle = z.object({ lifecycle: z.enum(["active", "paused", "disabled"]) });
const ConnectCredential = z.object({
  connectionId: z.string().uuid(),
  apiKey: z.string().min(1).max(4096),
});

export default async function integrationRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/connections", { schema: { body: CreateConnection } }, async (request, reply) => {
    const result = await createConnection(request.body, request.user.userId);
    return reply.status(201).send(result);
  });

  app.get(
    "/connections/:id",
    { schema: { params: ConnectionId } },
    async (request) => getConnection(request.params.id, request.user.userId),
  );

  app.get(
    "/connections/:id/discovery",
    { schema: { params: ConnectionId } },
    async (request) => getConnectionDiscovery(request.params.id, request.user.userId),
  );

  app.put(
    "/connections/:id/mapping",
    { schema: { params: ConnectionId, body: ConfigureConnection } },
    async (request) => configureConnection(request.params.id, request.body, request.user.userId),
  );

  app.patch(
    "/connections/:id/lifecycle",
    { schema: { params: ConnectionId, body: SetLifecycle } },
    async (request) =>
      setConnectionLifecycle(request.params.id, request.body.lifecycle, request.user.userId),
  );

  app.post(
    "/credentials",
    { schema: { body: ConnectCredential } },
    async (request) =>
      connectCredential(request.body.connectionId, request.body.apiKey, request.user.userId),
  );

  app.delete(
    "/connections/:id/credential",
    { schema: { params: ConnectionId } },
    async (request, reply) => {
      await clearCredential(request.params.id, request.user.userId);
      return reply.status(204).send();
    },
  );
}
