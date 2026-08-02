import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { transitionIssue } from "../issue/service.js";
import type { InboundIssueStatusChange } from "./core/types.js";
import { runInboundSyncCycle } from "./inbound.js";

const baseline = new Date("2026-08-01T10:00:00.000Z");

async function fixture(state = "review" as const) {
  const workspace = await seedTestWorkspace();
  const owner = await seedTestMember(workspace.id);
  const project = await seedTestProject(workspace.id);
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://redmine.example",
      workspaceId: workspace.id,
      lifecycle: "active",
      lifecycleEpoch: 1,
    },
  });
  const credential = await prisma.memberIntegrationCredential.create({
    data: {
      connectionId: connection.id,
      memberId: owner.id,
      encryptedKey: "encrypted-service-key",
      lastAuthStatus: "valid",
      lastValidatedAt: new Date(),
    },
  });
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: { serviceCredentialId: credential.id },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "41",
      readMap: { open: "in_progress", review: "review", closed: "done" },
      writeMap: {
        backlog: "open",
        analysis: "open",
        todo: "open",
        in_progress: "open",
        review: "review",
        done: "closed",
        _timeEntryActivityId: "9",
      },
      lifecycle: "active",
      lifecycleEpoch: 1,
    },
  });
  const issue = await prisma.issue.create({
    data: {
      key: `${project.key}-1`,
      sequenceNum: 1,
      title: "Linked issue",
      projectId: project.id,
      state,
    },
  });
  const ref = await prisma.externalRef.create({
    data: {
      connectionId: connection.id,
      bindingId: binding.id,
      entityType: "issue",
      entityId: issue.id,
      externalId: "100",
      remoteUpdatedAt: baseline,
      lastCorrelationId: "outbound-correlation",
    },
  });
  return { owner, binding, issue, ref };
}

function change(
  changedAt: Date,
  state: InboundIssueStatusChange["state"],
  entityId = "100",
): InboundIssueStatusChange {
  return {
    entityType: "issue",
    entityId,
    operation: state === "done" ? "close" : "update",
    changedAt,
    remoteVersion: changedAt.toISOString(),
    correlationId: null,
    state,
  };
}

function dependencies(changes: readonly InboundIssueStatusChange[]) {
  return {
    limit: 1,
    decrypt: vi.fn(() => "service-secret"),
    createSource: vi.fn(() => ({
      poll: vi.fn(async () => ({
        changes,
        nextCursor: changes.length
          ? {
              updatedAt: changes.at(-1)!.changedAt,
              entityId: changes.at(-1)!.entityId,
            }
          : null,
        hasMore: false,
      })),
    })),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("Redmine inbound sync", () => {
  beforeEach(cleanDatabase);
  afterAll(disconnectTestDb);

  it("skips an equal correlated version and applies only a greater remote version", async () => {
    const { binding, issue, ref } = await fixture();

    await runInboundSyncCycle(prisma, dependencies([change(baseline, "done")]));

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      state: "review",
    });
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({
        where: { bindingId: binding.id, remoteUpdatedAt: baseline },
      }),
    ).resolves.toMatchObject({
      state: "skipped",
      outcome: expect.objectContaining({ reason: "stale-or-correlated-echo" }),
    });
    await expect(prisma.integrationSyncWork.count({ where: { entityId: issue.id } })).resolves.toBe(0);

    const greater = new Date("2026-08-01T10:01:00.000Z");
    await runInboundSyncCycle(prisma, dependencies([change(greater, "in_progress")]));

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      state: "in_progress",
    });
    await expect(prisma.externalRef.findUniqueOrThrow({ where: { id: ref.id } })).resolves.toMatchObject({
      remoteUpdatedAt: greater,
    });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ cursorUpdatedAt: greater, cursorRemoteId: "100" });
  });

  it("advances the bootstrap cursor without importing an unlinked Redmine issue", async () => {
    const { binding, issue } = await fixture();
    const unlinkedAt = new Date("2026-08-01T10:03:00.000Z");

    await runInboundSyncCycle(prisma, dependencies([change(unlinkedAt, "done", "999")]));

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      state: "review",
    });
    await expect(prisma.issue.count()).resolves.toBe(1);
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ cursorUpdatedAt: unlinkedAt, cursorRemoteId: "999" });
  });

  it("accepts reported time unchanged, closes in Kanon, suppresses echo, and keeps later edits", async () => {
    const { owner, binding, issue, ref } = await fixture();
    await prisma.workLog.create({
      data: {
        issueId: issue.id,
        memberId: owner.id,
        startedAt: new Date("2026-08-01T08:00:00.000Z"),
        endedAt: new Date("2026-08-01T10:00:00.000Z"),
        durationS: 7200,
        reason: "stopped",
      },
    });
    const closedAt = new Date("2026-08-01T10:02:00.000Z");

    await runInboundSyncCycle(prisma, dependencies([change(closedAt, "done")]));

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      state: "done",
      completedAt: expect.any(Date),
      timeConfirmedAt: expect.any(Date),
    });
    const entries = await prisma.timeEntry.findMany({ where: { issueId: issue.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      hours: expect.objectContaining({}),
      status: "approved",
      sourceWorkLogId: expect.any(String),
      adjustsId: null,
      via: "reconcile",
    });
    expect(entries[0]!.hours.toString()).toBe("2");

    const application = await prisma.integrationInboundApplication.findFirstOrThrow({
      where: { bindingId: binding.id, remoteUpdatedAt: closedAt },
    });
    expect(application).toMatchObject({
      state: "applied",
      refId: ref.id,
      workId: expect.any(String),
      outcome: expect.objectContaining({
        from: "review",
        to: "done",
        timeReconciled: true,
        reportedTotalHours: 2,
        provenance: "redmine-inbound",
      }),
    });
    await expect(
      prisma.integrationSyncWork.findMany({
        where: { entityId: issue.id },
        select: { direction: true, operation: true, state: true, actorKind: true },
      }),
    ).resolves.toEqual([
      { direction: "inbound", operation: "close", state: "done", actorKind: "remote" },
    ]);
    await expect(
      prisma.activityLog.count({ where: { issueId: issue.id, via: "redmine-inbound" } }),
    ).resolves.toBe(2);

    await transitionIssue(issue.key, "review", owner.id);
    await expect(
      prisma.integrationSyncWork.findMany({
        where: { entityId: issue.id },
        orderBy: { sequence: "asc" },
        select: { direction: true, state: true, correlationId: true },
      }),
    ).resolves.toEqual([
      { direction: "inbound", state: "done", correlationId: application.correlationId },
      { direction: "outbound", state: "queued", correlationId: expect.any(String) },
    ]);
  });
});
