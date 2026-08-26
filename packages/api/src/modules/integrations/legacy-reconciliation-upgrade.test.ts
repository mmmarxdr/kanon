import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { getConnection, prepareRedmineReconciliation } from "./service.js";

const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];

async function legacyReconciliationFixture() {
  const workspace = await seedTestWorkspace();
  const owner = await seedTestMemberWithRole(workspace.id, "owner");
  const project = await seedTestProject(workspace.id);
  createdWorkspaceIds.push(workspace.id);
  createdUserIds.push(owner.userId);
  const connection = await prisma.integrationConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: "redmine",
      baseUrl: "https://redmine.example.test",
      lifecycle: "active",
      lifecycleEpoch: 4,
    },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "remote-project",
      readMap: {},
      writeMap: {},
      lifecycle: "active",
      lifecycleEpoch: 4,
      inboundEnabled: true,
      bootstrapState: "ready",
      bootstrapFence: 2,
    },
  });
  return { workspace, owner, connection, binding };
}

describe("legacy Redmine reconciliation upgrade", () => {
  afterEach(async () => {
    const workspaceIds = createdWorkspaceIds.splice(0);
    const userIds = createdUserIds.splice(0);
    if (workspaceIds.length) await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  afterAll(async () => {
    await disconnectTestDb();
  });

  it("surfaces and safely prepares only legacy ready bindings", async () => {
    const { workspace, owner, connection, binding } = await legacyReconciliationFixture();
    const completedProject = await seedTestProject(workspace.id);
    const completedBinding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: completedProject.id,
        remoteProjectId: "completed-project",
        readMap: {},
        writeMap: {},
        lifecycle: "active",
        lifecycleEpoch: 4,
        inboundEnabled: true,
        bootstrapState: "ready",
        bootstrapPageToken: { version: 2, complete: true },
        bootstrapFence: 7,
      },
    });

    const before = await getConnection(connection.id, owner.userId, workspace.id);
    expect(before.bindings.find(({ id }) => id === binding.id)).toMatchObject({
      inboundReady: true,
      reconciliationRequired: true,
    });
    expect(before.bindings.find(({ id }) => id === completedBinding.id)).toMatchObject({
      inboundReady: true,
      reconciliationRequired: false,
    });

    await expect(
      prepareRedmineReconciliation(connection.id, owner.userId, undefined, workspace.id),
    ).resolves.toEqual({ preparedBindingIds: [binding.id] });
    await expect(
      prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } }),
    ).resolves.toMatchObject({ lifecycle: "paused", lifecycleEpoch: 5 });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      lifecycle: "paused",
      lifecycleEpoch: 5,
      inboundEnabled: false,
      bootstrapState: "pending",
      bootstrapCutoff: null,
      bootstrapPageToken: null,
      bootstrapLeaseToken: null,
      bootstrapLeaseUntil: null,
      bootstrapFence: 3,
    });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: completedBinding.id } }),
    ).resolves.toMatchObject({
      lifecycle: "paused",
      lifecycleEpoch: 5,
      inboundEnabled: true,
      bootstrapState: "ready",
      bootstrapPageToken: { version: 2, complete: true },
      bootstrapFence: 7,
    });
  });

  it("excludes release-pending bindings and refuses to cross the release fence", async () => {
    const { workspace, owner, connection, binding } = await legacyReconciliationFixture();
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { releaseRequestedAt: new Date("2026-08-25T12:00:00.000Z") },
    });

    const before = await getConnection(connection.id, owner.userId, workspace.id);
    expect(before.bindings.find(({ id }) => id === binding.id)).toMatchObject({
      releasePending: true,
      inboundReady: false,
      reconciliationRequired: false,
    });
    await expect(
      prepareRedmineReconciliation(connection.id, owner.userId, undefined, workspace.id),
    ).rejects.toMatchObject({ code: "BINDING_RELEASE_IN_PROGRESS" });
    await expect(
      prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } }),
    ).resolves.toMatchObject({ lifecycle: "active", lifecycleEpoch: 4 });
  });
});
