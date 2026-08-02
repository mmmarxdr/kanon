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
import { runIntegrationWorkerCycle } from "./worker.js";

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

  it("resumes only the immediate pause cohort and safely fences leased work", async () => {
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
    await setConnectionLifecycle(connection.id, "active", owner.userId, deps);
    const credential = await prisma.memberIntegrationCredential.findFirstOrThrow({
      where: { connectionId: connection.id, memberId: owner.id },
    });
    await prisma.externalRef.create({
      data: {
        connectionId: connection.id,
        bindingId: binding.id,
        entityType: "project",
        entityId: project.id,
        externalId: "remote-project",
      },
    });
    await prisma.integrationSyncWork.createMany({
      data: [
        {
          entityType: "project",
          entityId: project.id,
          direction: "outbound",
          operation: "update",
          dedupeKey: "historical",
          laneKey: "historical",
          actorKey: `member:${owner.id}`,
          actorKind: "user",
          authCredentialId: credential.id,
          payload: {},
          correlationId: "historical",
          availableAt: new Date("2999-01-01T00:00:00.000Z"),
          epoch: 0,
          bindingId: binding.id,
        },
        {
          entityType: "project",
          entityId: project.id,
          direction: "outbound",
          operation: "update",
          dedupeKey: "before-pause",
          laneKey: "before-pause",
          actorKey: `member:${owner.id}`,
          actorKind: "user",
          authCredentialId: credential.id,
          payload: {},
          correlationId: "before-pause",
          state: "retry",
          epoch: 1,
          bindingId: binding.id,
        },
        {
          entityType: "project",
          entityId: project.id,
          direction: "outbound",
          operation: "update",
          dedupeKey: "in-flight",
          laneKey: "in-flight",
          actorKey: `member:${owner.id}`,
          actorKind: "user",
          authCredentialId: credential.id,
          payload: {},
          correlationId: "in-flight",
          state: "leased",
          leaseToken: "lease-token",
          leaseUntil: new Date("2999-01-01T00:00:00.000Z"),
          fence: 1,
          epoch: 1,
          bindingId: binding.id,
        },
      ],
    });
    await setConnectionLifecycle(connection.id, "paused", owner.userId, deps);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { dedupeKey: "in-flight" } }),
    ).resolves.toMatchObject({ epoch: 2, state: "leased" });
    await prisma.integrationSyncWork.update({
      where: { dedupeKey: "in-flight" },
      data: { state: "ambiguous", leaseToken: null, leaseUntil: null },
    });
    await prisma.integrationSyncWork.create({
      data: {
        entityType: "project",
        entityId: project.id,
        direction: "outbound",
        operation: "update",
        dedupeKey: "during-pause",
        laneKey: "during-pause",
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        authCredentialId: credential.id,
        payload: {},
        correlationId: "during-pause",
        availableAt: new Date("2999-01-01T00:00:00.000Z"),
        epoch: 2,
        bindingId: binding.id,
      },
    });

    const resumed = await setConnectionLifecycle(connection.id, "active", owner.userId, deps);
    const unchanged = await setConnectionLifecycle(connection.id, "active", owner.userId, deps);

    await expect(
      prisma.integrationSyncWork.findMany({
        orderBy: { sequence: "asc" },
        select: { epoch: true, state: true },
      }),
    ).resolves.toEqual([
      { epoch: 0, state: "queued" },
      { epoch: 3, state: "retry" },
      { epoch: 3, state: "ambiguous" },
      { epoch: 3, state: "queued" },
    ]);
    expect(resumed.lifecycleEpoch).toBe(3);
    expect(unchanged.lifecycleEpoch).toBe(3);

    const ensureProject = vi.fn().mockResolvedValue({ externalId: "remote-project" });
    await runIntegrationWorkerCycle(prisma, {
      limit: 10,
      decrypt: () => "secret",
      createAdapter: () => ({
        ensureProject,
        ensureCycle: vi.fn(),
        pushIssue: vi.fn(),
        reconcileCreate: vi.fn(),
      }),
    });

    expect(ensureProject).toHaveBeenCalledTimes(2);
    await expect(
      prisma.integrationSyncWork.findMany({
        where: { dedupeKey: { in: ["before-pause", "in-flight"] } },
        orderBy: { sequence: "asc" },
        select: { epoch: true, state: true },
      }),
    ).resolves.toEqual([
      { epoch: 3, state: "done" },
      { epoch: 3, state: "done" },
    ]);
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
