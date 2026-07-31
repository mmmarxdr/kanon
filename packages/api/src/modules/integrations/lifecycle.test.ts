import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import {
  configureConnection,
  createConnection,
  getConnectionDiscovery,
  setConnectionLifecycle,
  type ConnectionServiceDeps,
} from "./service.js";

const remote = {
  whoAmI: vi.fn(async () => ({ id: "remote-owner", displayName: "Owner", login: "owner" })),
  listStatuses: vi.fn(async () => [
    { id: "new", name: "New", writable: true },
    { id: "dev", name: "In Dev", writable: true },
  ]),
  listProjects: vi.fn(async () => [{ id: "remote-project", name: "Remote project" }]),
};
const deps: ConnectionServiceDeps = {
  remote: vi.fn(() => remote),
  encrypt: vi.fn(() => "encrypted-token"),
  decrypt: vi.fn(() => "plain-token"),
};
const readMap = { new: "backlog", dev: "in_progress" };
const writeMap = {
  backlog: "new",
  analysis: "new",
  todo: "dev",
  in_progress: "dev",
  review: "dev",
  done: "dev",
};

describe("integration connection lifecycle", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await cleanDatabase();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  it("bootstraps one draft connection and service credential atomically", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");

    const first = await createConnection(
      { workspaceId: workspace.id, baseUrl: "https://redmine.example.test", apiKey: "secret" },
      owner.userId,
      deps,
    );
    const second = await createConnection(
      { workspaceId: workspace.id, baseUrl: "https://redmine.example.test", apiKey: "secret" },
      owner.userId,
      deps,
    );
    const discovery = await getConnectionDiscovery(first.connection.id, owner.userId, deps);

    expect(second.connection.id).toBe(first.connection.id);
    expect(first.connection).toMatchObject({ lifecycle: "draft", serviceFallbackEnabled: false });
    expect(first.discovery.projects).toEqual([{ id: "remote-project", name: "Remote project" }]);
    expect(discovery.statuses).toHaveLength(2);
    const credentials = await prisma.memberIntegrationCredential.findMany();
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({
      memberId: owner.id,
      encryptedKey: "encrypted-token",
      externalUserId: "remote-owner",
      lastAuthStatus: "valid",
    });
    expect(first.connection.serviceCredentialId).toBe(credentials[0]!.id);
  });

  it("rolls back the connection when credential linkage fails", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const marker = "force-bootstrap-rollback";
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "member_integration_credentials" ADD CONSTRAINT "test_bootstrap_rollback" CHECK ("encrypted_key" <> '${marker}')`,
    );
    try {
      await expect(
        createConnection(
          { workspaceId: workspace.id, baseUrl: "https://redmine.example.test", apiKey: "secret" },
          owner.userId,
          { ...deps, encrypt: () => marker },
        ),
      ).rejects.toThrow();
      await expect(prisma.integrationConnection.count()).resolves.toBe(0);
      await expect(prisma.memberIntegrationCredential.count()).resolves.toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "member_integration_credentials" DROP CONSTRAINT IF EXISTS "test_bootstrap_rollback"',
      );
    }
  });

  it("rejects a non-owner over HTTP before remote validation or persistence", async () => {
    const workspace = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(workspace.id, "admin");

    const response = await app.inject({
      method: "POST",
      url: "/api/integrations/connections",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        workspaceId: workspace.id,
        baseUrl: "https://redmine.example.test",
        apiKey: "must-not-leave-kanon",
      },
    });

    expect(response.statusCode).toBe(403);
    await expect(prisma.integrationConnection.count()).resolves.toBe(0);
  });

  it("binds only a discovered project, activates complete maps, and fences disablement", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, baseUrl: "https://redmine.example.test", apiKey: "secret" },
      owner.userId,
      deps,
    );

    const binding = await configureConnection(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project", readMap, writeMap },
      owner.userId,
      deps,
    );
    const active = await setConnectionLifecycle(connection.id, "active", owner.userId, deps);
    const disabled = await setConnectionLifecycle(connection.id, "disabled", owner.userId);

    expect(binding.lifecycle).toBe("draft");
    expect(active).toMatchObject({ lifecycle: "active", lifecycleEpoch: 1 });
    expect(disabled).toMatchObject({ lifecycle: "disabled", lifecycleEpoch: 2 });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ lifecycle: "disabled", lifecycleEpoch: 2, pollLeaseToken: null });
  });

  it("rejects activation when a writable Kanon state has no confirmed mapping", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, baseUrl: "https://redmine.example.test", apiKey: "secret" },
      owner.userId,
      deps,
    );
    await configureConnection(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project", readMap, writeMap: { backlog: "new" } },
      owner.userId,
      deps,
    );

    await expect(setConnectionLifecycle(connection.id, "active", owner.userId)).rejects.toMatchObject({
      statusCode: 409,
      code: "INTEGRATION_NOT_READY",
    });
    await expect(
      prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } }),
    ).resolves.toMatchObject({ lifecycle: "draft", lifecycleEpoch: 0 });
  });

  it("rejects projects and status mappings that discovery did not return", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, baseUrl: "https://redmine.example.test", apiKey: "secret" },
      owner.userId,
      deps,
    );

    await expect(
      configureConnection(
        connection.id,
        { projectId: project.id, remoteProjectId: "remote-project", readMap: { new: "invented" }, writeMap },
        owner.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_STATUS_MAP" });
    await expect(
      configureConnection(
        connection.id,
        { projectId: project.id, remoteProjectId: "invented", readMap, writeMap },
        owner.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "REMOTE_PROJECT_NOT_FOUND" });
    await expect(prisma.integrationProjectBinding.count()).resolves.toBe(0);
  });
});
