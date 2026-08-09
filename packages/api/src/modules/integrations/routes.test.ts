import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  generateTestToken,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { retryRedmineIssueImport } from "./inbound.js";

vi.mock("./inbound.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inbound.js")>()),
  retryRedmineIssueImport: vi.fn(),
}));

const retry = vi.mocked(retryRedmineIssueImport);

describe("integration retry route", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    retry.mockReset();
    await cleanDatabase();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  it("requires authentication and validates the application identifier", async () => {
    const connectionId = randomUUID();
    const bindingId = randomUUID();
    const applicationId = randomUUID();
    const workspaceId = randomUUID();
    const path = `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/bindings/${bindingId}/inbound/applications/${applicationId}/retry`;

    const unauthenticated = await app.inject({ method: "POST", url: path });
    expect(unauthenticated.statusCode).toBe(401);
    expect(retry).not.toHaveBeenCalled();

    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const invalid = await app.inject({
      method: "POST",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connectionId}/bindings/${bindingId}/inbound/applications/not-a-uuid/retry`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(invalid.statusCode).toBe(400);
    expect(retry).not.toHaveBeenCalled();
  });

  it("wires identifiers, user scope, and the successful response", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test" },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: project.id,
        remoteProjectId: "remote-project",
        readMap: {},
        writeMap: {},
      },
    });
    const applicationId = randomUUID();
    const allowedProjectId = randomUUID();
    const token = generateTestToken({
      userId: owner.userId,
      allowedProjectIds: [allowedProjectId],
    });
    const result = { applicationId, state: "applied" as const, issueKey: "KAN-1" };
    retry.mockResolvedValue(result);

    const response = await app.inject({
      method: "POST",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/bindings/${binding.id}/inbound/applications/${applicationId}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(retry).toHaveBeenCalledWith(connection.id, binding.id, applicationId, owner.userId, {
      allowedProjectIds: [allowedProjectId],
    });
  });

  it("prevents a scoped owner from controlling the workspace or another project binding", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const [allowed, denied] = await Promise.all([
      seedTestProject(workspace.id),
      seedTestProject(workspace.id),
    ]);
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test" },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: denied.id,
        remoteProjectId: "remote-project",
        readMap: {},
        writeMap: {},
      },
    });
    const token = generateTestToken({
      userId: owner.userId,
      email: owner.email,
      allowedProjectIds: [allowed.id],
    });
    const headers = { authorization: `Bearer ${token}` };

    const create = await app.inject({
      method: "POST",
      url: `/api/integrations/workspaces/${workspace.id}/connections`,
      headers,
      payload: { apiKey: "secret" },
    });
    const mapping = await app.inject({
      method: "PUT",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/mapping`,
      headers,
      payload: {
        projectId: allowed.id,
        remoteProjectId: "remote-project",
        timeActivityId: "9",
        readMap: {},
        writeMap: {},
      },
    });
    const credential = await app.inject({
      method: "POST",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/credential`,
      headers,
      payload: { apiKey: "secret" },
    });
    const unbind = await app.inject({
      method: "DELETE",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/bindings/${binding.id}`,
      headers,
    });

    expect(create.statusCode).toBe(403);
    expect(mapping.statusCode).toBe(403);
    expect(credential.statusCode).toBe(403);
    expect(unbind.statusCode).toBe(404);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ releasedAt: null });
  });
});
