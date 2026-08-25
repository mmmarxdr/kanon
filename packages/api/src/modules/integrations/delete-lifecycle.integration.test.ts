import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import {
  bindProject,
  configureConnection,
  configureProviderMaps,
  createConnection,
  finalizeDrainedBindingReleases,
  setConnectionLifecycle,
  unbindProject,
  type ConnectionServiceDeps,
} from "./service.js";

const remote = {
  whoAmI: vi.fn(async () => ({ id: "remote-owner", displayName: "Owner", login: "owner" })),
  listStatuses: vi.fn(async () => [{ id: "new", name: "New", writable: true }]),
  listPriorities: vi.fn(async () => [{ id: "normal", name: "Normal" }]),
  listProjects: vi.fn(async () => [{ id: "remote-project", name: "Remote project" }]),
  listTimeEntryActivities: vi.fn(async () => [{ id: "9", name: "Development", isDefault: true }]),
};
const deps: ConnectionServiceDeps = {
  remote: vi.fn(() => remote),
  encrypt: (secret) => `encrypted:${secret}`,
  decrypt: (secret) => secret.replace(/^encrypted:/, ""),
};
const readMap = { new: "todo" };
const writeMap = {
  backlog: "new",
  analysis: "new",
  todo: "new",
  in_progress: "new",
  review: "new",
  done: "new",
};
const priorityReadMap = { normal: "medium" } as const;
const priorityWriteMap = {
  critical: "normal",
  high: "normal",
  medium: "normal",
  low: "normal",
} as const;

async function fixture() {
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
    workspace.id,
  );
  await prisma.integrationProjectBinding.update({
    where: { id: binding.id },
    data: { bootstrapState: "ready", inboundEnabled: true },
  });
  await setConnectionLifecycle(connection.id, "active", owner.userId, deps, workspace.id);
  const credential = await prisma.memberIntegrationCredential.findFirstOrThrow({
    where: { connectionId: connection.id, memberId: owner.id },
  });
  return { workspace, owner, project, connection, binding, credential };
}

async function createDeleteWork(
  value: Awaited<ReturnType<typeof fixture>>,
  state: "queued" | "retry" | "dead",
) {
  const issueId = randomUUID();
  const ref = await prisma.externalRef.create({
    data: {
      connectionId: value.connection.id,
      bindingId: value.binding.id,
      entityType: "issue",
      entityId: issueId,
      externalId: randomUUID(),
    },
  });
  return prisma.integrationSyncWork.create({
    data: {
      bindingId: value.binding.id,
      entityType: "issue",
      entityId: issueId,
      direction: "outbound",
      operation: "delete",
      dedupeKey: randomUUID(),
      laneKey: `issue:${issueId}`,
      actorKey: `member:${value.owner.id}`,
      actorKind: "user",
      payload: { version: 1, refId: ref.id, externalId: ref.externalId, issueKey: `${value.project.key}-1` },
      correlationId: randomUUID(),
      authCredentialId: value.credential.id,
      refId: ref.id,
      epoch: value.binding.lifecycleEpoch + 1,
      state,
      skippedReason: state === "dead" ? "credential_invalid" : null,
      availableAt: new Date("2026-08-10T00:00:00.000Z"),
    },
  });
}

beforeEach(async () => {
  await cleanDatabase();
  await prisma.instanceSettings.update({
    where: { id: INSTANCE_SETTINGS_ID },
    data: { redmineBaseUrl: "https://redmine.example.test" },
  });
  vi.clearAllMocks();
});
afterAll(disconnectTestDb);

describe("issue-delete lifecycle safety", () => {
  it("keeps release draining for queued, retry, and credential-blocked delete cleanup", async () => {
    const value = await fixture();
    const work = await Promise.all([
      createDeleteWork(value, "queued"),
      createDeleteWork(value, "retry"),
      createDeleteWork(value, "dead"),
    ]);

    await expect(
      unbindProject(
        value.connection.id,
        value.binding.id,
        value.owner.userId,
        value.workspace.id,
      ),
    ).resolves.toMatchObject({ status: "draining" });
    await expect(finalizeDrainedBindingReleases(prisma)).resolves.toBe(0);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: value.binding.id } }),
    ).resolves.toMatchObject({ releaseRequestedAt: expect.any(Date), releasedAt: null });

    await prisma.integrationSyncWork.updateMany({
      where: { id: { in: work.map(({ id }) => id) } },
      data: { state: "done" },
    });
    await expect(finalizeDrainedBindingReleases(prisma)).resolves.toBe(1);
  });

  it("rejects provider-map changes while delete cleanup is unresolved", async () => {
    const value = await fixture();
    await createDeleteWork(value, "queued");
    const before = await prisma.integrationProjectBinding.findUniqueOrThrow({
      where: { id: value.binding.id },
    });

    await expect(
      configureProviderMaps(
        value.connection.id,
        { timeActivityId: "9", readMap, writeMap, priorityReadMap, priorityWriteMap },
        value.owner.userId,
        deps,
        value.workspace.id,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "REMOTE_DELETE_IN_PROGRESS" });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: value.binding.id } }),
    ).resolves.toMatchObject({ lifecycle: before.lifecycle, lifecycleEpoch: before.lifecycleEpoch });
  });

  it("rejects lifecycle invalidation while delete cleanup is unresolved", async () => {
    const value = await fixture();
    await createDeleteWork(value, "retry");

    await expect(
      setConnectionLifecycle(
        value.connection.id,
        "paused",
        value.owner.userId,
        deps,
        value.workspace.id,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "REMOTE_DELETE_IN_PROGRESS" });
    await expect(
      prisma.integrationConnection.findUniqueOrThrow({ where: { id: value.connection.id } }),
    ).resolves.toMatchObject({ lifecycle: "active" });
  });

  it.each(["queued", "retry", "dead"] as const)(
    "rejects project binding while %s delete cleanup would be invalidated",
    async (state) => {
      const value = await fixture();
      const secondProject = await seedTestProject(value.workspace.id);
      const work = await createDeleteWork(value, state);
      const beforeConnection = await prisma.integrationConnection.findUniqueOrThrow({
        where: { id: value.connection.id },
      });
      const beforeBinding = await prisma.integrationProjectBinding.findUniqueOrThrow({
        where: { id: value.binding.id },
      });
      remote.listProjects.mockResolvedValueOnce([
        { id: "remote-project-2", name: "Second remote project" },
      ]);

      await expect(
        bindProject(
          value.connection.id,
          { projectId: secondProject.id, remoteProjectId: "remote-project-2" },
          value.owner.userId,
          deps,
          value.workspace.id,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: "REMOTE_DELETE_IN_PROGRESS" });
      await expect(
        prisma.integrationConnection.findUniqueOrThrow({ where: { id: value.connection.id } }),
      ).resolves.toMatchObject({
        lifecycle: beforeConnection.lifecycle,
        lifecycleEpoch: beforeConnection.lifecycleEpoch,
      });
      await expect(
        prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: value.binding.id } }),
      ).resolves.toMatchObject({
        lifecycle: beforeBinding.lifecycle,
        lifecycleEpoch: beforeBinding.lifecycleEpoch,
      });
      await expect(
        prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
      ).resolves.toMatchObject({ state, epoch: work.epoch });
    },
  );
});
