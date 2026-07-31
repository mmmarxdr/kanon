import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
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
const concurrentPrisma = new PrismaClient();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bindProject(
  workspaceId: string,
  projectId: string,
  memberId?: string,
  provider = "redmine",
) {
  const connection = await prisma.integrationConnection.create({
    data: { provider, baseUrl: "https://pm.example.test", workspaceId },
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
  afterAll(async () => {
    await Promise.all([disconnectTestDb(), concurrentPrisma.$disconnect()]);
  });

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
    expect(work[3]).toMatchObject({
      refId: null,
      actorKey: `member:${member.id}`,
      state: "skipped",
      skippedReason: "Remote cycle hard-delete is not supported",
    });
    expect(work[3]!.payload).toMatchObject({
      version: 1,
      cycle: { id: doomed.id, name: "Deleted cycle", startDate: startDate.toISOString() },
    });
    await expect(
      prisma.externalRef.findUnique({ where: { id: reference.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.externalRef.count({ where: { entityType: "cycle", entityId: doomed.id } }),
    ).resolves.toBe(0);
  });

  it("captures and skips hard-delete work for every project binding", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const first = await bindProject(workspace.id, project.id, member.id);
    const second = await bindProject(workspace.id, project.id, member.id, "jira");
    const cycle = await createCycle(project.id, cycleInput("Multi-binding cycle"), member.id);
    await Promise.all(
      [first, second].map(({ connection, binding }) =>
        prisma.externalRef.create({
          data: {
            connectionId: connection.id,
            bindingId: binding.id,
            entityType: "cycle",
            entityId: cycle.id,
            externalId: `remote-${binding.id}`,
          },
        }),
      ),
    );

    await deleteCycle(cycle.id, { reason: "obsolete" }, member.id);

    const work = await prisma.integrationSyncWork.findMany({
      where: { entityType: "cycle", entityId: cycle.id },
      orderBy: [{ bindingId: "asc" }, { sequence: "asc" }],
    });
    expect(work).toHaveLength(4);
    for (const binding of [first.binding, second.binding]) {
      expect(work.filter((row) => row.bindingId === binding.id)).toMatchObject([
        { operation: "create", state: "queued" },
        {
          operation: "delete",
          state: "skipped",
          skippedReason: "Remote cycle hard-delete is not supported",
        },
      ]);
    }
    await expect(
      prisma.externalRef.count({ where: { entityType: "cycle", entityId: cycle.id } }),
    ).resolves.toBe(0);
  });

  it("re-reads a cycle under lock so a winning activation prevents deletion", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const cycle = await prisma.cycle.create({
      data: { ...cycleInput("Activation winner"), projectId: project.id },
    });
    const ready = deferred();
    const release = deferred();
    const activation = concurrentPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "cycles" WHERE "id" = ${cycle.id}::uuid FOR UPDATE
      `;
      await transaction.cycle.update({
        where: { id: cycle.id },
        data: { state: "active" },
      });
      ready.resolve();
      await release.promise;
    });
    await ready.promise;

    const deletion = deleteCycle(cycle.id, { force: true }, member.id);
    await vi.waitFor(async () => {
      const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock' AND query ILIKE '%cycles%'
        ) AS "waiting"
      `;
      expect(row?.waiting).toBe(true);
    });
    release.resolve();
    await activation;

    await expect(deletion).rejects.toMatchObject({ code: "CYCLE_ACTIVE", statusCode: 409 });
    await expect(prisma.cycle.findUniqueOrThrow({ where: { id: cycle.id } })).resolves.toMatchObject(
      { state: "active" },
    );
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
