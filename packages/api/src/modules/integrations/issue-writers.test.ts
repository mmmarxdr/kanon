import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { createIssue, transitionIssue, updateIssue } from "../issue/service.js";
import { reviseEstimate, upsertPlan } from "../schedule/service.js";
import { startWork } from "../work-session/service.js";
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

  it("captures start_work autoassignment and its missing start date", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const { binding } = await bindProject(workspace.id, project.id, member.id);
    const created = await createIssue(project.id, { title: "Started issue", labels: [] }, member.id);

    await startWork(created.key, member.id, member.userId, "mcp");

    const work = await prisma.integrationSyncWork.findMany({
      where: { bindingId: binding.id, entityId: created.id },
      orderBy: { sequence: "asc" },
    });
    const fields = work.flatMap((row) => {
      const payload = row.payload as { fields?: Record<string, unknown> };
      return Object.keys(payload.fields ?? {});
    });
    expect(fields).toContain("assigneeId");
    expect(fields).toContain("startDate");

    const issue = await prisma.issue.findUniqueOrThrow({
      where: { id: created.id },
      include: { schedule: true },
    });
    expect(issue.assigneeId).toBe(member.id);
    expect(issue.schedule?.startDate).toBeInstanceOf(Date);
  });

  it("preserves an explicit start date across concurrent and repeated starts", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const { binding } = await bindProject(workspace.id, project.id, member.id);
    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Concurrent plan",
        projectId: project.id,
      },
    });
    const explicitStart = "2026-08-01T00:00:00.000Z";

    await Promise.all([
      upsertPlan(issue.key, { startDate: explicitStart }, member.id),
      upsertPlan(
        issue.key,
        { startDate: "2026-08-04T00:00:00.000Z" },
        member.id,
        null,
        { startDateIfMissing: true },
      ),
    ]);
    const startDateCapturesBeforeRepeatedStarts = (
      await prisma.integrationSyncWork.findMany({
        where: { bindingId: binding.id, entityId: issue.id },
      })
    ).filter(({ payload }) =>
      Object.hasOwn((payload as { fields?: Record<string, unknown> }).fields ?? {}, "startDate"),
    ).length;
    await startWork(issue.key, member.id, member.userId, "mcp");
    await startWork(issue.key, member.id, member.userId, "mcp");

    const schedule = await prisma.issueSchedule.findUniqueOrThrow({ where: { issueId: issue.id } });
    expect(schedule.startDate?.toISOString()).toBe(explicitStart);

    const capturedStartDates = (
      await prisma.integrationSyncWork.findMany({
        where: { bindingId: binding.id, entityId: issue.id },
      })
    ).flatMap(({ payload }) => {
      const fields = (payload as { fields?: { startDate?: string } }).fields;
      return fields?.startDate ? [fields.startDate] : [];
    });
    expect(capturedStartDates.at(-1)).toBe(explicitStart);
    expect(capturedStartDates).toHaveLength(startDateCapturesBeforeRepeatedStarts);
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

  it("does not attach a revoked personal credential to future work", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const { credential } = await bindProject(workspace.id, project.id, member.id);
    await prisma.memberIntegrationCredential.update({
      where: { id: credential!.id },
      data: { lastAuthStatus: "revoked", revokedAt: new Date() },
    });

    const issue = await createIssue(project.id, { title: "No stale auth", labels: [] }, member.id);
    await expect(
      prisma.integrationSyncWork.findFirstOrThrow({ where: { entityId: issue.id } }),
    ).resolves.toMatchObject({ authCredentialId: null });
  });

  it("captures schedule and estimate changes in their writer transactions", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    const { binding, credential } = await bindProject(workspace.id, project.id, member.id);
    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Scheduled issue",
        projectId: project.id,
      },
    });

    await upsertPlan(
      issue.key,
      {
        startDate: "2026-08-04T00:00:00.000Z",
        dueDate: "2026-08-20T00:00:00.000Z",
        progress: 65,
      },
      member.id,
    );
    await reviseEstimate(issue.key, { hours: "7.50" }, member.id);

    const work = await prisma.integrationSyncWork.findMany({
      where: { bindingId: binding.id, entityId: issue.id },
      orderBy: { sequence: "asc" },
    });
    expect(work).toHaveLength(2);
    expect(work.every(({ authCredentialId }) => authCredentialId === credential!.id)).toBe(true);
    expect(work.map(({ payload }) => payload)).toEqual([
      {
        version: 1,
        fields: {
          startDate: "2026-08-04T00:00:00.000Z",
          dueDate: "2026-08-20T00:00:00.000Z",
          progress: 65,
        },
      },
      { version: 1, fields: { estimateHours: 7.5 } },
    ]);
  });

  it("rolls schedule and estimate writes back when outbox capture fails", async () => {
    const workspace = await seedTestWorkspace();
    const foreignWorkspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    await bindProject(foreignWorkspace.id, project.id);
    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Rollback schedule",
        projectId: project.id,
      },
    });

    await expect(
      upsertPlan(
        issue.key,
        { startDate: "2026-08-04T00:00:00.000Z" },
        member.id,
        null,
        { startDateIfMissing: true },
      ),
    ).rejects.toThrow("mismatched ownership");
    expect(await prisma.issueSchedule.findUnique({ where: { issueId: issue.id } })).toBeNull();

    await expect(reviseEstimate(issue.key, { hours: "3.50" }, member.id)).rejects.toThrow(
      "mismatched ownership",
    );
    expect(await prisma.issueSchedule.findUnique({ where: { issueId: issue.id } })).toBeNull();
    expect(await prisma.estimateRevision.count({ where: { issueId: issue.id } })).toBe(0);
    expect(await prisma.integrationSyncWork.count({ where: { entityId: issue.id } })).toBe(0);
  });
});
