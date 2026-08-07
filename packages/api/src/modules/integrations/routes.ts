import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  activateRedmineIssueImport,
  previewRedmineIssueImport,
} from "./redmine-import.js";
import { retryRedmineIssueImport } from "./inbound.js";
import {
  bindProject,
  clearCredential,
  configureConnection,
  configureProviderMaps,
  connectCredential,
  createConnection,
  getConnection,
  getConnectionDiscovery,
  getWorkspaceConnection,
  replaceServiceCredential,
  setConnectionLifecycle,
} from "./service.js";

const ConnectionId = z.object({ id: z.string().uuid() });
const ConnectionBindingId = ConnectionId.extend({ bindingId: z.string().uuid() });
const InboundApplicationId = ConnectionBindingId.extend({ applicationId: z.string().uuid() });
const WorkspaceConnection = z.object({ workspaceId: z.string().uuid() });
const CreateConnection = z.object({
  workspaceId: z.string().uuid(),
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
const ConnectCredential = z.object({
  connectionId: z.string().uuid(),
  apiKey: z.string().min(1).max(4096),
});
const ReplaceServiceCredential = z.object({ apiKey: z.string().min(1).max(4096) });

export default async function integrationRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/connections", { schema: { body: CreateConnection } }, async (request, reply) => {
    const result = await createConnection(request.body, request.user.userId);
    return reply.status(201).send(result);
  });

  app.get(
    "/connections",
    { schema: { querystring: WorkspaceConnection } },
    async (request) => getWorkspaceConnection(request.query.workspaceId, request.user.userId),
  );

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

  app.put(
    "/connections/:id/provider-maps",
    { schema: { params: ConnectionId, body: ConfigureProviderMaps } },
    async (request) => configureProviderMaps(request.params.id, request.body, request.user.userId),
  );

  app.put(
    "/connections/:id/bindings",
    { schema: { params: ConnectionId, body: BindProject } },
    async (request) => bindProject(request.params.id, request.body, request.user.userId),
  );

  app.post(
    "/connections/:id/bindings/:bindingId/inbound/preview",
    { schema: { params: ConnectionBindingId } },
    async (request) =>
      previewRedmineIssueImport(
        request.params.id,
        request.params.bindingId,
        request.user.userId,
      ),
  );

  app.post(
    "/connections/:id/bindings/:bindingId/inbound/activate",
    { schema: { params: ConnectionBindingId } },
    async (request) =>
      activateRedmineIssueImport(
        request.params.id,
        request.params.bindingId,
        request.user.userId,
      ),
  );

  app.post(
    "/connections/:id/bindings/:bindingId/inbound/applications/:applicationId/retry",
    { schema: { params: InboundApplicationId } },
    async (request) =>
      retryRedmineIssueImport(
        request.params.id,
        request.params.bindingId,
        request.params.applicationId,
        request.user.userId,
        { allowedProjectIds: request.user.allowedProjectIds },
      ),
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

  app.put(
    "/connections/:id/service-credential",
    { schema: { params: ConnectionId, body: ReplaceServiceCredential } },
    async (request) =>
      replaceServiceCredential(request.params.id, request.body.apiKey, request.user.userId),
  );
}
