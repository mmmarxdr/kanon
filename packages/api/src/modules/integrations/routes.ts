import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireMember, requireRole } from "../../middleware/require-role.js";
import { scopedProjectIds } from "../../shared/token-scope.js";
import { AppError } from "../../shared/types.js";
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
  unbindProject,
} from "./service.js";

const WorkspaceId = z.object({ wid: z.string().uuid() });
const ConnectionId = WorkspaceId.extend({ id: z.string().uuid() });
const ConnectionBindingId = ConnectionId.extend({ bindingId: z.string().uuid() });
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
const ConnectCredential = z.object({
  apiKey: z.string().min(1).max(4096),
});
const ReplaceServiceCredential = z.object({ apiKey: z.string().min(1).max(4096) });

async function requireUnscopedToken(request: FastifyRequest) {
  if (scopedProjectIds(request.user.allowedProjectIds)) {
    throw new AppError(403, "FORBIDDEN", "Token scope does not allow workspace integration control");
  }
}

export default async function integrationRoutes(fastify: FastifyInstance): Promise<void> {
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

  app.post(
    "/workspaces/:wid/connections/:id/bindings/:bindingId/inbound/preview",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: ConnectionBindingId },
    },
    async (request) => {
      await getConnection(
        request.params.id,
        request.user.userId,
        request.params.wid,
        scopedProjectIds(request.user.allowedProjectIds),
      );
      return previewRedmineIssueImport(
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
    "/workspaces/:wid/connections/:id/bindings/:bindingId/inbound/activate",
    {
      preHandler: [requireRole("wid", "owner")],
      schema: { params: ConnectionBindingId },
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
