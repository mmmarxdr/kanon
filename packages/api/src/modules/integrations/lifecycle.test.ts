import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  seedInstanceAdminUser,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import {
  bindProject,
  configureConnection,
  configureProviderMaps,
  createConnection,
  getConnection,
  getConnectionDiscovery,
  getWorkspaceConnection,
  setConnectionLifecycle,
  type ConnectionServiceDeps,
} from "./service.js";
import { patchSettings } from "../instance/service.js";
import { runIntegrationWorkerCycle } from "./worker.js";

const remote = {
  whoAmI: vi.fn(async () => ({ id: "remote-owner", displayName: "Owner", login: "owner" })),
  listStatuses: vi.fn(async () => [
    { id: "new", name: "New", writable: true },
    { id: "dev", name: "In Dev", writable: true },
  ]),
  listProjects: vi.fn(async () => [{ id: "remote-project", name: "Remote project" }]),
  listTimeEntryActivities: vi.fn(async () => [
    { id: "9", name: "Development", isDefault: true },
  ]),
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
    await prisma.instanceSettings.update({
      where: { id: INSTANCE_SETTINGS_ID },
      data: { redmineBaseUrl: "https://redmine.example.test" },
    });
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  it("bootstraps one draft connection and service credential atomically", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });

    const first = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      owner.userId,
      deps,
    );
    const second = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      owner.userId,
      deps,
    );
    const discovery = await getConnectionDiscovery(first.connection.id, owner.userId, deps);

    expect(second.connection.id).toBe(first.connection.id);
    expect(first.connection).toMatchObject({ lifecycle: "draft", serviceFallbackEnabled: false });
    expect(first.discovery.projects).toEqual([{ id: "remote-project", name: "Remote project" }]);
    expect(discovery.statuses).toHaveLength(2);
    expect(discovery.timeEntryActivities).toEqual([
      { id: "9", name: "Development", isDefault: true },
    ]);
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

  it("requires an instance-admin Redmine URL before testing a key", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    await prisma.instanceSettings.update({
      where: { id: INSTANCE_SETTINGS_ID },
      data: { redmineBaseUrl: null },
    });

    await expect(
      createConnection({ workspaceId: workspace.id, apiKey: "secret" }, owner.userId, deps),
    ).rejects.toMatchObject({ statusCode: 409, code: "REDMINE_NOT_CONFIGURED" });
    expect(deps.remote).not.toHaveBeenCalled();
  });

  it("returns an actionable error when Redmine discovery fails", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    remote.whoAmI.mockRejectedValueOnce(new Error("Unsafe remote endpoint: HTTPS is required"));

    await expect(
      createConnection({ workspaceId: workspace.id, apiKey: "secret" }, owner.userId, deps),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "REDMINE_CONNECTION_FAILED",
      message:
        "Redmine connection failed. Verify the API key or ask an instance admin to check the URL, endpoint allowlist, and network access",
    });
    await expect(prisma.integrationConnection.count()).resolves.toBe(0);
    await expect(prisma.memberIntegrationCredential.count()).resolves.toBe(0);
  });

  it("returns an actionable error when the Redmine client cannot be created", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    vi.mocked(deps.remote).mockImplementationOnce(() => {
      throw new Error("invalid endpoint");
    });

    await expect(
      createConnection({ workspaceId: workspace.id, apiKey: "secret" }, owner.userId, deps),
    ).rejects.toMatchObject({ statusCode: 502, code: "REDMINE_CONNECTION_FAILED" });
    await expect(prisma.integrationConnection.count()).resolves.toBe(0);
    await expect(prisma.memberIntegrationCredential.count()).resolves.toBe(0);
  });

  it("cannot persist a stale connection while the instance URL changes", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_delay_redmine_connection()
      RETURNS trigger AS $$
      BEGIN
        PERFORM pg_sleep(0.5);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_delay_redmine_connection
      BEFORE INSERT ON "integration_connections"
      FOR EACH ROW EXECUTE FUNCTION test_delay_redmine_connection()
    `);

    try {
      const creating = createConnection(
        { workspaceId: workspace.id, apiKey: "secret" },
        owner.userId,
        deps,
      );
      let insertStarted = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const [activity] = await prisma.$queryRaw<Array<{ active: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE pid <> pg_backend_pid()
              AND state = 'active'
              AND query LIKE 'INSERT INTO %integration_connections%'
          ) AS active
        `;
        if (activity?.active) {
          insertStarted = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(insertStarted).toBe(true);

      await Promise.all([
        creating,
        patchSettings({ redmineBaseUrl: "https://new-redmine.example.test" }),
      ]);

      await expect(
        prisma.instanceSettings.findUniqueOrThrow({ where: { id: INSTANCE_SETTINGS_ID } }),
      ).resolves.toMatchObject({ redmineBaseUrl: "https://new-redmine.example.test" });
      await expect(
        prisma.integrationConnection.count({ where: { provider: "redmine" } }),
      ).resolves.toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS test_delay_redmine_connection ON "integration_connections"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_delay_redmine_connection()");
    }
  });

  it("rolls back the connection when credential linkage fails", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const marker = "force-bootstrap-rollback";
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "member_integration_credentials" ADD CONSTRAINT "test_bootstrap_rollback" CHECK ("encrypted_key" <> '${marker}')`,
    );
    try {
      await expect(
        createConnection(
          { workspaceId: workspace.id, apiKey: "secret" },
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

  it("rejects non-instance-admins over HTTP before remote validation or persistence", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const admin = await seedTestMemberWithRole(workspace.id, "admin");

    for (const actor of [owner, admin]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/integrations/connections",
        headers: { authorization: `Bearer ${actor.token}` },
        payload: {
          workspaceId: workspace.id,
          apiKey: "must-not-leave-kanon",
        },
      });
      expect(response.statusCode).toBe(403);
    }
    await expect(prisma.integrationConnection.count()).resolves.toBe(0);
  });

  it("rejects workspace admins from editing provider maps or binding projects", async () => {
    const workspace = await seedTestWorkspace();
    const instanceAdmin = await seedTestMemberWithRole(workspace.id, "owner", {
      isInstanceAdmin: true,
    });
    const workspaceAdmin = await seedTestMemberWithRole(workspace.id, "admin");
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      instanceAdmin.userId,
      deps,
    );

    await expect(
      configureProviderMaps(
        connection.id,
        { timeActivityId: "9", readMap, writeMap },
        workspaceAdmin.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    await configureProviderMaps(
      connection.id,
      { timeActivityId: "9", readMap, writeMap },
      instanceAdmin.userId,
      deps,
    );

    await expect(
      bindProject(
        connection.id,
        { projectId: project.id, remoteProjectId: "remote-project" },
        workspaceAdmin.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("binds only a discovered project, activates complete maps, and fences disablement", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      owner.userId,
      deps,
    );

    const binding = await configureConnection(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project", timeActivityId: "9", readMap, writeMap },
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
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      owner.userId,
      deps,
    );
    const binding = await configureConnection(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project", timeActivityId: "9", readMap, writeMap },
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
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      owner.userId,
      deps,
    );
    await configureConnection(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project", timeActivityId: "9", readMap, writeMap: { backlog: "new" } },
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
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      owner.userId,
      deps,
    );

    await expect(
      configureConnection(
        connection.id,
        { projectId: project.id, remoteProjectId: "remote-project", timeActivityId: "9", readMap: { new: "invented" }, writeMap },
        owner.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_STATUS_MAP" });
    await expect(
      configureConnection(
        connection.id,
        { projectId: project.id, remoteProjectId: "invented", timeActivityId: "9", readMap, writeMap },
        owner.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "REMOTE_PROJECT_NOT_FOUND" });
    await expect(prisma.integrationProjectBinding.count()).resolves.toBe(0);
  });

  it("lets owners bind projects after instance-admin maps, and redacts maps for members", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const instanceAdmin = await seedTestMemberWithRole(workspace.id, "member", {
      isInstanceAdmin: true,
    });
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id);

    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      instanceAdmin.userId,
      deps,
    );

    await expect(
      bindProject(
        connection.id,
        { projectId: project.id, remoteProjectId: "remote-project" },
        owner.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "PROVIDER_MAPS_REQUIRED" });

    await configureProviderMaps(
      connection.id,
      { timeActivityId: "9", readMap, writeMap },
      instanceAdmin.userId,
      deps,
    );

    const ownerDiscovery = await getConnectionDiscovery(connection.id, owner.userId, deps);
    expect(ownerDiscovery).toEqual({
      projects: [{ id: "remote-project", name: "Remote project" }],
      statuses: [],
      timeEntryActivities: [],
    });

    const binding = await bindProject(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project" },
      owner.userId,
      deps,
    );
    expect(binding).toMatchObject({
      projectId: project.id,
      remoteProjectId: "remote-project",
      readMap,
    });

    const adminView = await getWorkspaceConnection(workspace.id, instanceAdmin.userId);
    expect(adminView?.providerMaps?.timeActivityId).toBe("9");
    expect(adminView?.bindings[0]?.readMap).toEqual(readMap);

    const memberView = await getConnection(connection.id, member.userId);
    expect(memberView.providerMaps).toBeNull();
    expect(memberView.discoveredStatuses).toBeNull();
    expect(memberView.bindings[0]).toMatchObject({
      projectId: project.id,
      remoteProjectId: "remote-project",
      readMap: {},
      writeMap: {},
      timeActivityId: null,
    });
  });

  it("rejects service bootstrap when the instance admin is not a workspace member", async () => {
    const workspace = await seedTestWorkspace();
    await seedTestMemberWithRole(workspace.id, "owner");
    const outsiderAdmin = await seedInstanceAdminUser();

    await expect(
      createConnection({ workspaceId: workspace.id, apiKey: "secret" }, outsiderAdmin.userId, deps),
    ).rejects.toMatchObject({ statusCode: 409, code: "WORKSPACE_MEMBERSHIP_REQUIRED" });
    await expect(prisma.integrationConnection.count()).resolves.toBe(0);
  });

  it("bumps binding epochs when cascading provider maps onto active bindings", async () => {
    const workspace = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      admin.userId,
      deps,
    );
    await configureConnection(
      connection.id,
      {
        projectId: project.id,
        remoteProjectId: "remote-project",
        timeActivityId: "9",
        readMap,
        writeMap,
      },
      admin.userId,
      deps,
    );
    await setConnectionLifecycle(connection.id, "active", admin.userId, deps);

    await configureProviderMaps(
      connection.id,
      { timeActivityId: "9", readMap, writeMap },
      admin.userId,
      deps,
    );

    await expect(
      prisma.integrationProjectBinding.findFirstOrThrow({ where: { connectionId: connection.id } }),
    ).resolves.toMatchObject({ lifecycle: "draft", lifecycleEpoch: 2 });
    await expect(
      prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } }),
    ).resolves.toMatchObject({ lifecycle: "draft", lifecycleEpoch: 2 });
  });
});
