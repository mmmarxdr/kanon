import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { createIssue, transitionIssue, updateIssue } from "../issue/service.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";

async function bindProject(workspaceId: string, projectId: string, memberId?: string) {
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://pm.example.test",
      workspaceId,
    },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId,
      remoteProjectId: `remote-${projectId}`,
      readMap: { open: "backlog" },
      writeMap: { backlog: "open" },
      lifecycleEpoch: 3,
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
  return { binding, credential };
}

describe("issue writer integration capture", () => {
  beforeEach(cleanDatabase);
  afterAll(disconnectTestDb);

  it("captures create, update, and transition from their persisted Issue rows", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const { binding, credential } = await bindProject(workspace.id, project.id, member.id);

    const created = await createIssue(
      project.id,
      { title: "Captured issue", labels: [] },
      member.id,
    );
    const updated = await updateIssue(
      created.key,
      { title: "Captured update" },
      member.id,
    );
    const transitioned = await transitionIssue(created.key, "analysis", member.id);

    const work = await prisma.integrationSyncWork.findMany({
      where: { bindingId: binding.id, entityId: created.id },
      orderBy: { sequence: "asc" },
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(updated.title).toBe("Captured update");
    expect(transitioned.state).toBe("analysis");
    expect(work).toHaveLength(3);
    expect(work.map(({ operation }) => operation)).toEqual(["create", "update", "update"]);
    expect(work.every(({ actorKey }) => actorKey === `member:${member.id}`)).toBe(true);
    expect(work.every(({ actorKind }) => actorKind === "user")).toBe(true);
    expect(work.every(({ authCredentialId }) => authCredentialId === credential!.id)).toBe(true);
    expect(work.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({
        fields: {
          title: "Captured issue",
          description: null,
          state: "backlog",
          assigneeId: null,
          cycleId: null,
          estimate: null,
        },
        issue: expect.objectContaining({ key: created.key, title: "Captured issue" }),
      }),
      expect.objectContaining({
        fields: { title: "Captured update" },
        issue: expect.objectContaining({ title: "Captured update" }),
      }),
      expect.objectContaining({
        fields: { state: "analysis" },
        issue: expect.objectContaining({ state: "analysis" }),
      }),
    ]);
  });

  it("keeps unbound projects inert and rolls back when bound capture fails", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const unbound = await seedTestProject(workspace.id);

    await expect(
      createIssue(unbound.id, { title: "Local only", labels: [] }, member.id),
    ).resolves.toMatchObject({ title: "Local only" });
    expect(await prisma.integrationSyncWork.count()).toBe(0);

    const foreignWorkspace = await seedTestWorkspace();
    const bound = await seedTestProject(workspace.id);
    await bindProject(foreignWorkspace.id, bound.id);

    await expect(
      createIssue(bound.id, { title: "Must roll back", labels: [] }, member.id),
    ).rejects.toThrow("mismatched ownership");
    expect(await prisma.issue.findFirst({ where: { title: "Must roll back" } })).toBeNull();
  });
});
