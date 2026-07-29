import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import { batchTransitionByKeys, transitionGroup } from "../issue/service.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";

async function bindProject(workspaceId: string, projectId: string) {
  const connection = await prisma.integrationConnection.create({
    data: { provider: "redmine", baseUrl: "https://pm.example.test", workspaceId },
  });
  return prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId,
      remoteProjectId: `remote-${projectId}`,
      readMap: { open: "backlog" },
      writeMap: { backlog: "open" },
      lifecycleEpoch: 5,
    },
  });
}

describe("group issue integration capture", () => {
  beforeEach(cleanDatabase);
  afterAll(disconnectTestDb);

  it("captures every persisted group and key-batch transition", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const binding = await bindProject(workspace.id, project.id);
    const issues = await Promise.all(
      ["group-a", "group-a", null, null].map((groupKey, index) =>
        prisma.issue.create({
          data: {
            key: `${project.key}-${index + 1}`,
            sequenceNum: index + 1,
            title: `Batch issue ${index + 1}`,
            groupKey,
            projectId: project.id,
          },
        }),
      ),
    );

    await expect(transitionGroup(project.id, "group-a", "analysis", member.id)).resolves.toMatchObject({ count: 2 });
    const transaction = prisma.$transaction.bind(prisma);
    const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(
      async (operation: any) => {
        await prisma.issue.update({
          where: { id: issues[2]!.id },
          data: { state: "analysis" },
        });
        return transaction(operation);
      },
    );
    const batchResult = await batchTransitionByKeys(
      project.id,
      { keys: issues.slice(2).map(({ key }) => key), to_state: "analysis" },
      member.id,
    );
    transactionSpy.mockImplementation(transaction as any);
    expect(batchResult).toMatchObject({ count: 1, keys: [issues[3]!.key] });

    const work = await prisma.integrationSyncWork.findMany({
      where: { bindingId: binding.id },
    });
    expect(work).toHaveLength(3);
    expect(new Set(work.map(({ entityId }) => entityId))).toEqual(
      new Set([issues[0]!.id, issues[1]!.id, issues[3]!.id]),
    );
    expect(work.every(({ operation }) => operation === "update")).toBe(true);
    expect(work.every(({ actorKey }) => actorKey === `member:${member.id}`)).toBe(true);
    expect(work.every(({ payload }) => JSON.stringify(payload).includes('"fields":{"state":"analysis"}'))).toBe(true);
    expect(await prisma.activityLog.count({ where: { issueId: issues[2]!.id } })).toBe(0);
  });

  it("rolls back batch state, audit, and work when capture fails", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Rollback batch issue",
        projectId: project.id,
      },
    });
    const foreignWorkspace = await seedTestWorkspace();
    await bindProject(foreignWorkspace.id, project.id);

    await expect(
      batchTransitionByKeys(
        project.id,
        { keys: [issue.key], to_state: "analysis" },
        member.id,
      ),
    ).rejects.toThrow("mismatched ownership");
    expect(await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).toMatchObject({
      state: "backlog",
    });
    expect(await prisma.activityLog.count({ where: { issueId: issue.id } })).toBe(0);
    expect(await prisma.integrationSyncWork.count()).toBe(0);
  });
});
