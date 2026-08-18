import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  generateTestToken,
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
  resolveReleasedBindingPrivacy,
  setConnectionLifecycle,
  unbindProject,
  type ConnectionServiceDeps,
} from "./service.js";
import { patchSettings } from "../instance/service.js";
import { archiveProject } from "../project/service.js";
import { runIntegrationWorkerCycle } from "./worker.js";
import { resolveIssueCaptureContext } from "./issue-tx.js";
import * as integrationService from "./service.js";

const remote = {
  whoAmI: vi.fn(async () => ({ id: "remote-owner", displayName: "Owner", login: "owner" })),
  listStatuses: vi.fn(async () => [
    { id: "new", name: "New", writable: true },
    { id: "dev", name: "In Dev", writable: true },
  ]),
  listPriorities: vi.fn(async () => [
    { id: "normal", name: "Normal" },
    { id: "high", name: "High" },
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
const priorityReadMap = { normal: "medium", high: "high" } as const;
const priorityWriteMap = {
  critical: "high",
  high: "high",
  medium: "normal",
  low: "normal",
} as const;

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
    const detail = await getConnection(first.connection.id, owner.userId);

    expect(second.connection.id).toBe(first.connection.id);
    expect(first.connection).toMatchObject({ lifecycle: "draft", serviceFallbackEnabled: false });
    expect(detail.syncHealth.status).toBe("inactive");
    expect(first.discovery.projects).toEqual([{ id: "remote-project", name: "Remote project" }]);
    expect(discovery.statuses).toHaveLength(2);
    expect(discovery.priorities).toHaveLength(2);
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

  it("rejects instance URL changes without deleting workspace integration evidence", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      owner.userId,
      deps,
    );
    const project = await seedTestProject(workspace.id);
    await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: project.id,
        remoteProjectId: "remote-project",
        readMap: {},
        writeMap: {},
      },
    });

    await expect(
      patchSettings({ redmineBaseUrl: "https://new-redmine.example.test" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "REDMINE_CONNECTIONS_EXIST" });
    await expect(
      prisma.instanceSettings.findUniqueOrThrow({ where: { id: INSTANCE_SETTINGS_ID } }),
    ).resolves.toMatchObject({ redmineBaseUrl: "https://redmine.example.test" });
    await expect(
      prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } }),
    ).resolves.toMatchObject({ workspaceId: workspace.id });
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

  it("rejects non-owner bootstrap before remote validation", async () => {
    const workspace = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(workspace.id, "admin");

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/integrations/workspaces/${workspace.id}/connections`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { apiKey: "must-not-leave-kanon" },
    });
    expect(forbidden.statusCode).toBe(403);

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
      {
        timeActivityId: "9",
        readMap,
        writeMap,
        priorityReadMap,
        priorityWriteMap,
      },
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
      {
        projectId: project.id,
        remoteProjectId: "remote-project",
        timeActivityId: "9",
        readMap,
        writeMap,
        priorityReadMap,
        priorityWriteMap,
      },
      owner.userId,
      deps,
    );
    const active = await setConnectionLifecycle(connection.id, "active", owner.userId, deps);
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { commentCaptureEnabled: true, commentDispatchEnabled: true },
    });
    const disabled = await setConnectionLifecycle(connection.id, "disabled", owner.userId);

    expect(binding.lifecycle).toBe("draft");
    expect(active).toMatchObject({ lifecycle: "active", lifecycleEpoch: 1 });
    expect(disabled).toMatchObject({ lifecycle: "disabled", lifecycleEpoch: 2 });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      lifecycle: "disabled",
      lifecycleEpoch: 2,
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
      pollLeaseToken: null,
    });
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
      {
        projectId: project.id,
        remoteProjectId: "remote-project",
        timeActivityId: "9",
        readMap,
        writeMap,
        priorityReadMap,
        priorityWriteMap,
      },
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
      {
        projectId: project.id,
        remoteProjectId: "remote-project",
        timeActivityId: "9",
        readMap,
        writeMap: { backlog: "new" },
        priorityReadMap,
        priorityWriteMap,
      },
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
        {
          projectId: project.id,
          remoteProjectId: "remote-project",
          timeActivityId: "9",
          readMap: { new: "invented" },
          writeMap,
          priorityReadMap,
          priorityWriteMap,
        },
        owner.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_STATUS_MAP" });
    await expect(
      configureConnection(
        connection.id,
        {
          projectId: project.id,
          remoteProjectId: "invented",
          timeActivityId: "9",
          readMap,
          writeMap,
          priorityReadMap,
          priorityWriteMap,
        },
        owner.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "REMOTE_PROJECT_NOT_FOUND" });
    await expect(prisma.integrationProjectBinding.count()).resolves.toBe(0);
  });

  it("lets owners configure and bind while redacting maps from non-owners", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const instanceAdmin = await seedTestMemberWithRole(workspace.id, "member", {
      isInstanceAdmin: true,
    });
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id);

    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "secret" },
      owner.userId,
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
      {
        timeActivityId: "9",
        readMap,
        writeMap,
        priorityReadMap,
        priorityWriteMap,
      },
      owner.userId,
      deps,
    );

    const ownerDiscovery = await getConnectionDiscovery(connection.id, owner.userId, deps);
    expect(ownerDiscovery).toEqual({
      projects: [{ id: "remote-project", name: "Remote project" }],
      statuses: [
        { id: "new", name: "New", writable: true },
        { id: "dev", name: "In Dev", writable: true },
      ],
      priorities: [
        { id: "normal", name: "Normal" },
        { id: "high", name: "High" },
      ],
      timeEntryActivities: [{ id: "9", name: "Development", isDefault: true }],
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
      readMap: { ...readMap, "priority:normal": "medium", "priority:high": "high" },
    });

    const ownerView = await getWorkspaceConnection(workspace.id, owner.userId);
    expect(ownerView?.providerMaps?.timeActivityId).toBe("9");
    expect(ownerView?.providerMaps?.priorityReadMap).toEqual({ normal: "medium", high: "high" });
    expect(ownerView?.providerMaps?.priorityWriteMap).toEqual(priorityWriteMap);
    expect(ownerView?.bindings[0]?.readMap).toEqual(readMap);
    expect(ownerView?.bindings[0]).toMatchObject({
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
    });

    const adminView = await getWorkspaceConnection(workspace.id, instanceAdmin.userId);
    expect(adminView?.providerMaps).toBeNull();
    expect(adminView?.discoveredStatuses).toBeNull();

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

    const cutoff = new Date("2026-08-04T10:00:00.000Z");
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: {
        inboundEnabled: true,
        bootstrapState: "ready",
        bootstrapCutoff: cutoff,
        bootstrapPageToken: { complete: true },
        bootstrapLeaseToken: "bootstrap-lease",
        bootstrapLeaseUntil: cutoff,
        bootstrapFence: 3,
        cursorUpdatedAt: cutoff,
        cursorRemoteId: "42",
        pageToken: "poll-page",
        pollLeaseToken: "poll-lease",
        pollLeaseUntil: cutoff,
        pollFence: 4,
        auditCursorRemoteId: "42",
        auditCompletedAt: cutoff,
      },
    });
    remote.listProjects.mockResolvedValueOnce([
      { id: "remote-project", name: "Remote project" },
      { id: "remote-project-2", name: "Replacement project" },
    ]);

    await expect(
      bindProject(
        connection.id,
        { projectId: project.id, remoteProjectId: "remote-project-2" },
        owner.userId,
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "PROJECT_ALREADY_BOUND" });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ remoteProjectId: "remote-project" });
  });

  it("rejects service bootstrap when the instance admin is not a workspace member", async () => {
    const workspace = await seedTestWorkspace();
    await seedTestMemberWithRole(workspace.id, "owner");
    const outsiderAdmin = await seedInstanceAdminUser();

    await expect(
      createConnection({ workspaceId: workspace.id, apiKey: "secret" }, outsiderAdmin.userId, deps),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
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
        priorityReadMap,
        priorityWriteMap,
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

  it("isolates one owner's workspaces and atomically rejects a duplicate remote project", async () => {
    const workspaceA = await seedTestWorkspace();
    const workspaceB = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspaceA.id, "owner");
    await prisma.member.create({
      data: {
        userId: owner.userId,
        workspaceId: workspaceB.id,
        username: "shared-owner",
        role: "owner",
      },
    });
    const [projectA, projectB] = await Promise.all([
      seedTestProject(workspaceA.id),
      seedTestProject(workspaceB.id),
    ]);
    const [{ connection: connectionA }, { connection: connectionB }] = await Promise.all([
      createConnection({ workspaceId: workspaceA.id, apiKey: "key-a" }, owner.userId, deps),
      createConnection({ workspaceId: workspaceB.id, apiKey: "key-b" }, owner.userId, deps),
    ]);
    const maps = {
      timeActivityId: "9",
      readMap,
      writeMap,
      priorityReadMap,
      priorityWriteMap,
    };
    await Promise.all([
      configureProviderMaps(connectionA.id, maps, owner.userId, deps, workspaceA.id),
      configureProviderMaps(connectionB.id, maps, owner.userId, deps, workspaceB.id),
    ]);

    await expect(
      getConnection(connectionA.id, owner.userId, workspaceB.id),
    ).rejects.toMatchObject({ statusCode: 404, code: "INTEGRATION_NOT_FOUND" });
    const attempts = await Promise.allSettled([
      bindProject(
        connectionA.id,
        { projectId: projectA.id, remoteProjectId: "remote-project" },
        owner.userId,
        deps,
        workspaceA.id,
      ),
      bindProject(
        connectionB.id,
        { projectId: projectB.id, remoteProjectId: "remote-project" },
        owner.userId,
        deps,
        workspaceB.id,
      ),
    ]);

    expect(attempts.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(attempts.find(({ status }) => status === "rejected")).toMatchObject({
      reason: {
        code: "REMOTE_PROJECT_ALREADY_BOUND",
        message: "Redmine project is already bound",
      },
    });
    await expect(
      prisma.integrationProjectBinding.count({
        where: { remoteProjectId: "remote-project", releasedAt: null },
      }),
    ).resolves.toBe(1);
  });

  it("drains and releases a binding without deleting evidence before archive or transfer", async () => {
    const workspaceA = await seedTestWorkspace();
    const workspaceB = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspaceA.id, "owner");
    await prisma.member.create({
      data: {
        userId: owner.userId,
        workspaceId: workspaceB.id,
        username: "transfer-owner",
        role: "owner",
      },
    });
    const [projectA, projectB] = await Promise.all([
      seedTestProject(workspaceA.id),
      seedTestProject(workspaceB.id),
    ]);
    const { connection: connectionA } = await createConnection(
      { workspaceId: workspaceA.id, apiKey: "key-a" },
      owner.userId,
      deps,
    );
    const maps = {
      timeActivityId: "9",
      readMap,
      writeMap,
      priorityReadMap,
      priorityWriteMap,
    };
    await configureProviderMaps(connectionA.id, maps, owner.userId, deps, workspaceA.id);
    const binding = await bindProject(
      connectionA.id,
      { projectId: projectA.id, remoteProjectId: "remote-project" },
      owner.userId,
      deps,
      workspaceA.id,
    );
    await setConnectionLifecycle(connectionA.id, "active", owner.userId, deps, workspaceA.id);
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { commentCaptureEnabled: true, commentDispatchEnabled: true },
    });
    const reference = await prisma.externalRef.create({
      data: {
        connectionId: connectionA.id,
        bindingId: binding.id,
        entityType: "project",
        entityId: projectA.id,
        externalId: "remote-project",
      },
    });
    const work = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "project",
        entityId: projectA.id,
        direction: "outbound",
        operation: "update",
        dedupeKey: "release-work",
        laneKey: "release-work",
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: {},
        correlationId: "release-work",
        state: "leased",
        leaseToken: "release-lease",
        leaseUntil: new Date("2999-01-01T00:00:00.000Z"),
        epoch: binding.lifecycleEpoch,
        refId: reference.id,
      },
    });
    const application = await prisma.integrationInboundApplication.create({
      data: {
        bindingId: binding.id,
        remoteEntityType: "issue",
        remoteId: "42",
        remoteUpdatedAt: new Date("2026-08-09T00:00:00.000Z"),
        applicationKey: "release-application",
        correlationId: "release-application",
        state: "conflict",
      },
    });
    const conflict = await prisma.integrationConflict.create({
      data: {
        bindingId: binding.id,
        applicationId: application.id,
        kind: "mapping",
        localEvidence: {},
        remoteEvidence: {},
      },
    });

    await expect(archiveProject(projectA.id, owner.id, workspaceA.id)).rejects.toMatchObject({
      statusCode: 409,
      code: "PROJECT_INTEGRATION_BOUND",
    });
    await expect(
      unbindProject(connectionA.id, binding.id, owner.userId, workspaceA.id),
    ).resolves.toMatchObject({ status: "draining" });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      lifecycle: "active",
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
      releaseRequestedAt: expect.any(Date),
      releasedAt: null,
    });
    await expect(
      setConnectionLifecycle(connectionA.id, "paused", owner.userId, deps, workspaceA.id),
    ).rejects.toMatchObject({ statusCode: 409, code: "BINDING_RELEASE_IN_PROGRESS" });
    await expect(
      configureProviderMaps(connectionA.id, maps, owner.userId, deps, workspaceA.id),
    ).rejects.toMatchObject({ statusCode: 409, code: "BINDING_RELEASE_IN_PROGRESS" });
    await expect(resolveIssueCaptureContext(projectA.id, owner.id)).resolves.toBeNull();

    await prisma.integrationSyncWork.update({
      where: { id: work.id },
      data: { state: "done", leaseToken: null, leaseUntil: null },
    });
    await runIntegrationWorkerCycle(prisma, { limit: 1 });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ lifecycle: "disabled", releasedAt: expect.any(Date) });
    await expect(prisma.externalRef.findUnique({ where: { id: reference.id } })).resolves.not.toBeNull();
    await expect(
      prisma.integrationInboundApplication.findUnique({ where: { id: application.id } }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.integrationConflict.findUnique({ where: { id: conflict.id } }),
    ).resolves.not.toBeNull();
    await expect(
      bindProject(
        connectionA.id,
        { projectId: projectA.id, remoteProjectId: "remote-project" },
        owner.userId,
        deps,
        workspaceA.id,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "BINDING_HISTORY_UNRESOLVED" });

    await expect(archiveProject(projectA.id, owner.id, workspaceA.id)).resolves.toMatchObject({
      archived: true,
    });
    const { connection: connectionB } = await createConnection(
      { workspaceId: workspaceB.id, apiKey: "key-b" },
      owner.userId,
      deps,
    );
    await configureProviderMaps(connectionB.id, maps, owner.userId, deps, workspaceB.id);
    await expect(
      bindProject(
        connectionB.id,
        { projectId: projectB.id, remoteProjectId: "remote-project" },
        owner.userId,
        deps,
        workspaceB.id,
      ),
    ).resolves.toMatchObject({ projectId: projectB.id, remoteProjectId: "remote-project" });
  });

  it("keeps a binding draining when private-comment uncertainty or privacy conflict remains", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection({ workspaceId: workspace.id, apiKey: "key" }, owner.userId, deps);
    await configureProviderMaps(
      connection.id,
      { timeActivityId: "9", readMap, writeMap, priorityReadMap, priorityWriteMap },
      owner.userId,
      deps,
      workspace.id,
    );
    const binding = await bindProject(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project" },
      owner.userId,
      deps,
      workspace.id,
    );
    await setConnectionLifecycle(connection.id, "active", owner.userId, deps, workspace.id);
    const application = await prisma.integrationInboundApplication.create({
      data: {
        bindingId: binding.id,
        remoteEntityType: "comment",
        remoteParentType: "issue",
        remoteParentId: "100",
        remoteId: "private-release",
        remoteUpdatedAt: new Date("2026-08-01T10:05:00.000Z"),
        sourceVersion: "sha256:private-release-v1",
        applicationKey: "private-release-application",
        correlationId: "private-release-application",
        state: "conflict",
      },
    });
    const work = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "comment",
        entityId: randomUUID(),
        direction: "outbound",
        operation: "create",
        dedupeKey: "private-release-work",
        laneKey: "private-release",
        actorKey: "remote:5",
        actorKind: "remote",
        payload: { redacted: true },
        correlationId: "private-release-work",
        state: "dead",
        skippedReason: "private-comment-write-uncertain",
        epoch: binding.lifecycleEpoch,
      },
    });
    await prisma.integrationConflict.create({
      data: {
        bindingId: binding.id,
        applicationId: application.id,
        workId: work.id,
        kind: "inbound-comment-privacy",
        localEvidence: { outboundWriteUncertain: true },
        remoteEvidence: { reason: "private" },
      },
    });

    await expect(unbindProject(connection.id, binding.id, owner.userId, workspace.id)).resolves.toMatchObject({
      status: "draining",
    });
  });

  it("finalizes a draining release after an owner explicitly acknowledges privacy uncertainty", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection({ workspaceId: workspace.id, apiKey: "key" }, owner.userId, deps);
    await configureProviderMaps(
      connection.id,
      { timeActivityId: "9", readMap, writeMap, priorityReadMap, priorityWriteMap },
      owner.userId,
      deps,
      workspace.id,
    );
    const binding = await bindProject(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project" },
      owner.userId,
      deps,
      workspace.id,
    );
    await setConnectionLifecycle(connection.id, "active", owner.userId, deps, workspace.id);
    const application = await prisma.integrationInboundApplication.create({
      data: {
        bindingId: binding.id,
        remoteEntityType: "comment",
        remoteParentType: "issue",
        remoteParentId: "100",
        remoteId: "draining-private",
        remoteUpdatedAt: new Date("2026-08-01T10:05:00.000Z"),
        sourceVersion: "sha256:draining-private-v1",
        applicationKey: "draining-private-application",
        correlationId: "draining-private-application",
        state: "conflict",
      },
    });
    const work = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "comment",
        entityId: randomUUID(),
        direction: "outbound",
        operation: "create",
        dedupeKey: "draining-private-work",
        laneKey: "draining-private",
        actorKey: "remote:5",
        actorKind: "remote",
        payload: { redacted: true },
        correlationId: "draining-private-work",
        state: "dead",
        skippedReason: "private-comment-write-uncertain",
        epoch: binding.lifecycleEpoch,
      },
    });
    const conflict = await prisma.integrationConflict.create({
      data: {
        bindingId: binding.id,
        applicationId: application.id,
        workId: work.id,
        kind: "inbound-comment-privacy",
        localEvidence: { outboundWriteUncertain: true },
        remoteEvidence: { reason: "private" },
      },
    });

    await expect(unbindProject(connection.id, binding.id, owner.userId, workspace.id)).resolves.toMatchObject({
      status: "draining",
    });
    await expect(
      resolveReleasedBindingPrivacy(connection.id, binding.id, owner.userId, workspace.id),
    ).resolves.toMatchObject({ status: "released", bindingId: binding.id });
    await expect(prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } })).resolves.toMatchObject({
      lifecycle: "disabled",
      releasedAt: expect.any(Date),
    });
    await expect(prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } })).resolves.toMatchObject({
      state: "resolved",
      localEvidence: expect.objectContaining({
        privacyRecovery: expect.objectContaining({ acknowledgedByUserId: owner.userId }),
      }),
    });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({
      state: "superseded",
      skippedReason: "private-comment-write-uncertain",
    });
    await expect(
      bindProject(
        connection.id,
        { projectId: project.id, remoteProjectId: "remote-project" },
        owner.userId,
        deps,
        workspace.id,
      ),
    ).resolves.toMatchObject({ id: binding.id, releasedAt: null });
  });

  it("lets a fresh owner recover a released privacy block by project identity without a hidden binding id", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const [project, otherProject] = await Promise.all([
      seedTestProject(workspace.id),
      seedTestProject(workspace.id),
    ]);
    const { connection } = await createConnection({ workspaceId: workspace.id, apiKey: "key" }, owner.userId, deps);
    await configureProviderMaps(
      connection.id,
      { timeActivityId: "9", readMap, writeMap, priorityReadMap, priorityWriteMap },
      owner.userId,
      deps,
      workspace.id,
    );
    const binding = await bindProject(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project" },
      owner.userId,
      deps,
      workspace.id,
    );
    const application = await prisma.integrationInboundApplication.create({
      data: {
        bindingId: binding.id,
        remoteEntityType: "comment",
        remoteParentType: "issue",
        remoteParentId: "100",
        remoteId: "released-discovery-private",
        remoteUpdatedAt: new Date("2026-08-01T10:05:00.000Z"),
        sourceVersion: "sha256:released-discovery-private-v1",
        applicationKey: "released-discovery-private-application",
        correlationId: "released-discovery-private-application",
        state: "conflict",
      },
    });
    const work = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "comment",
        entityId: randomUUID(),
        direction: "outbound",
        operation: "create",
        dedupeKey: "released-discovery-private-work",
        laneKey: "released-discovery-private",
        actorKey: "remote:5",
        actorKind: "remote",
        payload: { redacted: true },
        correlationId: "released-discovery-private-work",
        state: "dead",
        skippedReason: "private-comment-write-uncertain",
        epoch: binding.lifecycleEpoch,
      },
    });
    const conflict = await prisma.integrationConflict.create({
      data: {
        bindingId: binding.id,
        applicationId: application.id,
        workId: work.id,
        kind: "inbound-comment-privacy",
        localEvidence: { outboundWriteUncertain: true },
        remoteEvidence: { reason: "private" },
      },
    });
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { lifecycle: "disabled", releasedAt: new Date("2026-08-01T10:06:00.000Z") },
    });

    const discovery = await app.inject({
      method: "GET",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      privacyRecovery: [{ projectId: project.id, remoteProjectId: "remote-project", status: "released" }],
    });
    expect(discovery.body).not.toContain(binding.id);

    const recoveryUrl = `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/privacy-recovery`;
    const payload = { projectId: project.id, remoteProjectId: "remote-project" };
    const forbidden = await app.inject({
      method: "POST",
      url: recoveryUrl,
      headers: { authorization: `Bearer ${member.token}` },
      payload,
    });
    const scopedOther = generateTestToken({
      userId: owner.userId,
      email: owner.email,
      allowedProjectIds: [otherProject.id],
    });
    const scoped = await app.inject({
      method: "POST",
      url: recoveryUrl,
      headers: { authorization: `Bearer ${scopedOther}` },
      payload,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(scoped.statusCode).toBe(404);
    await expect(prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } })).resolves.toMatchObject({
      state: "open",
    });

    const recovered = await app.inject({
      method: "POST",
      url: recoveryUrl,
      headers: { authorization: `Bearer ${owner.token}` },
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: recoveryUrl,
      headers: { authorization: `Bearer ${owner.token}` },
      payload,
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ status: "released", bindingId: binding.id });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ status: "already-recovered", bindingId: binding.id });
    await expect(prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } })).resolves.toMatchObject({
      state: "resolved",
      localEvidence: expect.objectContaining({
        privacyRecovery: expect.objectContaining({ acknowledgedByUserId: owner.userId }),
      }),
    });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({
      state: "superseded",
      skippedReason: "private-comment-write-uncertain",
    });
    await expect(
      bindProject(
        connection.id,
        { projectId: project.id, remoteProjectId: "remote-project" },
        owner.userId,
        deps,
        workspace.id,
      ),
    ).resolves.toMatchObject({ id: binding.id, releasedAt: null });
  });

  it("lets an owner explicitly recover a legacy released privacy block before reconnecting", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection({ workspaceId: workspace.id, apiKey: "key" }, owner.userId, deps);
    await configureProviderMaps(
      connection.id,
      { timeActivityId: "9", readMap, writeMap, priorityReadMap, priorityWriteMap },
      owner.userId,
      deps,
      workspace.id,
    );
    const binding = await bindProject(
      connection.id,
      { projectId: project.id, remoteProjectId: "remote-project" },
      owner.userId,
      deps,
      workspace.id,
    );
    await setConnectionLifecycle(connection.id, "active", owner.userId, deps, workspace.id);
    const application = await prisma.integrationInboundApplication.create({
      data: {
        bindingId: binding.id,
        remoteEntityType: "comment",
        remoteParentType: "issue",
        remoteParentId: "100",
        remoteId: "released-private",
        remoteUpdatedAt: new Date("2026-08-01T10:05:00.000Z"),
        sourceVersion: "sha256:released-private-v1",
        applicationKey: "released-private-application",
        correlationId: "released-private-application",
        state: "conflict",
      },
    });
    const work = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "comment",
        entityId: randomUUID(),
        direction: "outbound",
        operation: "create",
        dedupeKey: "released-private-work",
        laneKey: "released-private",
        actorKey: "remote:5",
        actorKind: "remote",
        payload: { redacted: true },
        correlationId: "released-private-work",
        state: "dead",
        skippedReason: "private-comment-write-uncertain",
        epoch: binding.lifecycleEpoch,
      },
    });
    const conflict = await prisma.integrationConflict.create({
      data: {
        bindingId: binding.id,
        applicationId: application.id,
        workId: work.id,
        kind: "inbound-comment-privacy",
        localEvidence: { outboundWriteUncertain: true },
        remoteEvidence: { reason: "private" },
      },
    });

    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { lifecycle: "disabled", releasedAt: new Date("2026-08-01T10:06:00.000Z") },
    });
    await expect(getConnection(connection.id, owner.userId, workspace.id)).resolves.toMatchObject({
      bindings: [],
      syncHealth: { blockedWork: { total: 0, items: [] } },
    });
    await expect(
      bindProject(
        connection.id,
        { projectId: project.id, remoteProjectId: "remote-project" },
        owner.userId,
        deps,
        workspace.id,
      ),
    ).rejects.toMatchObject({ code: "BINDING_HISTORY_UNRESOLVED" });

    const recover = (
      integrationService as unknown as {
        resolveReleasedBindingPrivacy?: (...args: unknown[]) => Promise<unknown>;
      }
    ).resolveReleasedBindingPrivacy;
    expect(recover).toBeTypeOf("function");
    await recover!(connection.id, binding.id, owner.userId, workspace.id);

    await expect(prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } })).resolves.toMatchObject({
      state: "resolved",
    });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({
      state: "superseded",
      skippedReason: "private-comment-write-uncertain",
    });
    await expect(
      bindProject(
        connection.id,
        { projectId: project.id, remoteProjectId: "remote-project" },
        owner.userId,
        deps,
        workspace.id,
      ),
    ).resolves.toMatchObject({ id: binding.id, releasedAt: null });
  });
});
