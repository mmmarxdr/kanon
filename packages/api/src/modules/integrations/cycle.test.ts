import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import { closeCycle, createCycle, deleteCycle } from "../cycle/service.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";

const startDate = new Date("2026-08-03T00:00:00.000Z");
const endDate = new Date("2026-08-09T00:00:00.000Z");
const cycleInput = (name: string) => ({ name, startDate, endDate });

async function bindProject(workspaceId: string, projectId: string, memberId?: string) {
  const connection = await prisma.integrationConnection.create({
    data: { provider: "redmine", baseUrl: "https://pm.example.test", workspaceId },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId,
      remoteProjectId: `remote-${projectId}`,
      readMap: { open: "backlog" },
      writeMap: { backlog: "open" },
      lifecycleEpoch: 7,
    },
  });
  const credential = memberId
    ? await prisma.memberIntegrationCredential.create({
        data: {
          connectionId: connection.id,
          memberId,
          encryptedKey: "encrypted-test-key",
          lastAuthStatus: "valid",
          lastValidatedAt: new Date(),
        },
      })
    : null;
  return { connection, binding, credential };
}

describe("cycle integration capture", () => {
  beforeEach(cleanDatabase);
  afterAll(disconnectTestDb);

  it("captures create, close, and linked hard-delete before the cycle disappears", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const transaction = prisma.$transaction.bind(prisma);
    let linked: Awaited<ReturnType<typeof bindProject>> | undefined;
    const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(
      async (operation: any) => {
        linked = await bindProject(workspace.id, project.id, member.id);
        return transaction(operation);
      },
    );
    const created = await createCycle(project.id, cycleInput("Captured cycle"), member.id);
    transactionSpy.mockImplementation(transaction as any);
    const { connection, binding, credential } = linked!;
    const closed = await closeCycle(created.id, {
      verbose: true,
      actorMemberId: member.id,
    });
    const retried = await closeCycle(created.id, {
      verbose: true,
      actorMemberId: member.id,
    });
    const attachedIssue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Attached issue",
        projectId: project.id,
      },
    });
    const attached = await createCycle(
      project.id,
      {
        ...cycleInput("Attached cycle"),
        attachIssueKeys: [attachedIssue.key],
      },
      member.id,
    );
    const doomed = await prisma.cycle.create({
      data: { name: "Deleted cycle", startDate, endDate, projectId: project.id },
    });
    const reference = await prisma.externalRef.create({
      data: {
        connectionId: connection.id,
        bindingId: binding.id,
        entityType: "cycle",
        entityId: doomed.id,
        externalId: "remote-cycle-1",
      },
    });
    await deleteCycle(doomed.id, { reason: "obsolete" }, member.id);

    const work = await prisma.integrationSyncWork.findMany({
      where: { bindingId: binding.id, entityType: "cycle" },
      orderBy: { sequence: "asc" },
    });
    expect(retried.closedAt).toEqual(closed.closedAt);
    expect(work.map(({ operation }) => operation)).toEqual([
      "create",
      "close",
      "create",
      "delete",
    ]);
    expect(work.map(({ entityId }) => entityId)).toEqual([
      created.id,
      created.id,
      attached.id,
      doomed.id,
    ]);
    expect(work.every(({ actorKind }) => actorKind === "user")).toBe(true);
    expect(work.every(({ authCredentialId }) => authCredentialId === credential!.id)).toBe(true);
    expect(work[0]!.payload).toMatchObject({
      cycle: { id: created.id, state: "upcoming", startDate: startDate.toISOString() },
    });
    expect(work[1]!.payload).toMatchObject({
      cycle: { id: created.id, state: "done", closedAt: expect.any(String) },
    });
    expect(work[3]).toMatchObject({ refId: reference.id, actorKey: `member:${member.id}` });
    expect(work[3]!.payload).toMatchObject({
      version: 1,
      cycle: { id: doomed.id, name: "Deleted cycle", startDate: startDate.toISOString() },
    });
  });

  it("rolls back create, close, delete, and audit when cycle capture fails", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const cycle = await prisma.cycle.create({
      data: { ...cycleInput("Rollback cycle"), projectId: project.id },
    });
    const foreignWorkspace = await seedTestWorkspace();
    await bindProject(foreignWorkspace.id, project.id);

    await expect(
      createCycle(project.id, cycleInput("Rollback create"), member.id),
    ).rejects.toThrow("mismatched ownership");
    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Rollback attach",
        projectId: project.id,
      },
    });
    await expect(
      createCycle(
        project.id,
        {
          ...cycleInput("Rollback attached create"),
          attachIssueKeys: [issue.key],
        },
        member.id,
      ),
    ).rejects.toThrow("mismatched ownership");
    await expect(
      closeCycle(cycle.id, { actorMemberId: member.id }),
    ).rejects.toThrow("mismatched ownership");
    await expect(deleteCycle(cycle.id, {}, member.id)).rejects.toThrow(
      "mismatched ownership",
    );
    await expect(prisma.cycle.findUnique({ where: { id: cycle.id } })).resolves.toBeTruthy();
    expect(await prisma.adminAuditLog.count({ where: { entityId: cycle.id } })).toBe(0);
    expect(await prisma.integrationSyncWork.count()).toBe(0);
  });

});
