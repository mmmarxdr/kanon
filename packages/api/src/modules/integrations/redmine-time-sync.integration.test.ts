import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { reconcileIssueTime } from "../issue/reconcile.js";
import { transitionIssue } from "../issue/service.js";

const writeMap = {
  backlog: "1",
  analysis: "2",
  todo: "3",
  in_progress: "4",
  review: "5",
  done: "6",
  _timeEntryActivityId: "9",
};

describe("KAN-205 confirmed Redmine time capture", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await disconnectTestDb();
  });

  it("closes active work, accumulates every session, and durably captures each worker credential", async () => {
    const workspace = await seedTestWorkspace();
    const finalizer = await seedTestMemberWithRole(workspace.id, "pm");
    const workerA = await seedTestMemberWithRole(workspace.id, "member");
    const workerB = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id, "RTS");
    const connection = await prisma.integrationConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: "redmine",
        baseUrl: "https://redmine.example.test",
        lifecycle: "active",
        lifecycleEpoch: 1,
      },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: project.id,
        remoteProjectId: "41",
        readMap: { "1": "backlog", "6": "done" },
        writeMap,
        lifecycle: "active",
        lifecycleEpoch: 1,
      },
    });
    const credentials = await Promise.all(
      [finalizer, workerA, workerB].map((member) =>
        prisma.memberIntegrationCredential.create({
          data: {
            connectionId: connection.id,
            memberId: member.id,
            encryptedKey: `credential:${member.id}`,
            externalUserId: `remote:${member.id}`,
            lastAuthStatus: "valid",
          },
        }),
      ),
    );
    const credentialByMember = new Map(
      credentials.map((credential) => [credential.memberId, credential.id]),
    );
    const issue = await prisma.issue.create({
      data: {
        key: "RTS-1",
        sequenceNum: 1,
        title: "Sync confirmed time",
        state: "review",
        projectId: project.id,
      },
    });
    await prisma.externalRef.create({
      data: {
        connectionId: connection.id,
        bindingId: binding.id,
        entityType: "issue",
        entityId: issue.id,
        externalId: "99",
      },
    });

    const sessionStarts = [
      new Date("2026-07-28T08:00:00.000Z"),
      new Date("2026-07-29T13:00:00.000Z"),
    ];
    await prisma.workLog.createMany({
      data: [
        {
          issueId: issue.id,
          memberId: workerA.id,
          startedAt: sessionStarts[0]!,
          endedAt: new Date("2026-07-28T09:00:00.000Z"),
          durationS: 3600,
          reason: "stopped",
        },
        {
          issueId: issue.id,
          memberId: workerB.id,
          startedAt: sessionStarts[1]!,
          endedAt: new Date("2026-07-29T13:30:00.000Z"),
          durationS: 1800,
          reason: "stopped",
        },
      ],
    });
    const capturedAt = Date.now();
    await prisma.workSession.create({
      data: {
        issueId: issue.id,
        memberId: workerA.id,
        userId: workerA.userId,
        source: "mcp",
        startedAt: new Date(capturedAt - 10 * 60 * 1000),
        lastHeartbeat: new Date(capturedAt - 6 * 60 * 1000),
      },
    });

    await expect(transitionIssue(issue.key, "done", finalizer.id)).rejects.toMatchObject({
      code: "RECONCILIATION_REQUIRED",
    });
    await expect(prisma.workSession.count({ where: { issueId: issue.id } })).resolves.toBe(0);
    await expect(prisma.workLog.count({ where: { issueId: issue.id } })).resolves.toBe(3);
    await expect(
      prisma.workLog.findFirst({
        where: { issueId: issue.id, reason: "expired" },
        select: { durationS: true },
      }),
    // The heartbeat's five-minute lease ends one minute before capturedAt:
    // (capturedAt - 1 min) - (capturedAt - 10 min) = exactly 9 min = 540s.
    ).resolves.toEqual({ durationS: 540 });

    const summary = await reconcileIssueTime(issue.id, finalizer.id);
    const entries = await prisma.timeEntry.findMany({
      where: { issueId: issue.id, status: "approved" },
      orderBy: { workedOn: "asc" },
    });
    expect(entries).toHaveLength(3);
    expect(summary.entries).toHaveLength(3);
    expect(summary.totalHours).toBe(
      Math.round(entries.reduce((sum, entry) => sum + Number(entry.hours), 0) * 100) / 100,
    );
    expect(entries.slice(0, 2).map(({ workedOn }) => workedOn)).toEqual(sessionStarts);

    const timeWork = await prisma.integrationSyncWork.findMany({
      where: { bindingId: binding.id, entityType: "time_entry" },
      orderBy: { sequence: "asc" },
    });
    expect(timeWork).toHaveLength(3);
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    for (const work of timeWork) {
      const entry = entryById.get(work.entityId)!;
      expect(work).toMatchObject({
        state: "queued",
        actorKey: `member:${entry.memberId}`,
        authCredentialId: credentialByMember.get(entry.memberId),
      });
      expect(work.authCredentialId).not.toBe(credentialByMember.get(finalizer.id));
    }

    await reconcileIssueTime(issue.id, finalizer.id);
    await expect(
      prisma.integrationSyncWork.count({
        where: { bindingId: binding.id, entityType: "time_entry" },
      }),
    ).resolves.toBe(3);

    const concurrentCorrections = await Promise.all([
      reconcileIssueTime(issue.id, finalizer.id, { confirmedTotalHours: "1" }),
      reconcileIssueTime(issue.id, finalizer.id, { confirmedTotalHours: "1" }),
    ]);
    expect(concurrentCorrections.map(({ totalHours }) => totalHours)).toEqual([1, 1]);
    const correctedEntries = await prisma.timeEntry.findMany({
      where: { issueId: issue.id, status: "approved" },
    });
    expect(
      Math.round(correctedEntries.reduce((sum, entry) => sum + Number(entry.hours), 0) * 100) /
        100,
    ).toBe(1);
    expect(correctedEntries.some(({ via }) => via === "reconcile-override")).toBe(true);
    await expect(
      prisma.integrationSyncWork.count({
        where: { bindingId: binding.id, entityType: "time_entry" },
      }),
    ).resolves.toBeGreaterThan(3);

    await expect(transitionIssue(issue.key, "done", finalizer.id)).resolves.toMatchObject({
      state: "done",
    });
    await expect(
      prisma.integrationSyncWork.count({
        where: {
          bindingId: binding.id,
          entityType: "issue",
          payload: { path: ["fields", "state"], equals: "done" },
        },
      }),
    ).resolves.toBe(1);
  });

  it("ignores bindings that are not Redmine time targets", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id, "NRT");
    const connection = await prisma.integrationConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: "other",
        baseUrl: "https://pm.example.test",
        lifecycle: "active",
        lifecycleEpoch: 1,
      },
    });
    await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: project.id,
        remoteProjectId: "41",
        readMap: {},
        writeMap: {},
        lifecycle: "active",
        lifecycleEpoch: 1,
      },
    });
    const issue = await prisma.issue.create({
      data: {
        key: "NRT-1",
        sequenceNum: 1,
        title: "Do not sync unrelated provider time",
        state: "review",
        projectId: project.id,
      },
    });
    await prisma.workLog.create({
      data: {
        issueId: issue.id,
        memberId: member.id,
        startedAt: new Date("2026-07-28T08:00:00.000Z"),
        endedAt: new Date("2026-07-28T09:00:00.000Z"),
        durationS: 3600,
        reason: "stopped",
      },
    });

    await expect(reconcileIssueTime(issue.id, member.id)).resolves.toMatchObject({
      totalHours: 1,
    });
    await expect(prisma.integrationSyncWork.count()).resolves.toBe(0);
  });
});
