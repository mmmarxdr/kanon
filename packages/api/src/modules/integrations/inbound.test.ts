import { randomUUID } from "node:crypto";
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
import type { InboundCursor, InboundIssueStatusChange } from "./core/types.js";
import { runInboundSyncCycle, type InboundIssueDetailOptions } from "./inbound.js";
import type {
  RedmineCommentChange,
  RedmineIssueChange,
} from "./providers/redmine/decoder.js";

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
      lastValidatedAt: baseline,
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
      readMap: {
        open: "in_progress",
        review: "review",
        closed: "done",
        "priority:3": "medium",
      },
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
      inboundEnabled: true,
      bootstrapState: "ready",
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
  await prisma.project.update({
    where: { id: project.id },
    data: { lastSequenceNum: 1 },
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
      metadata: {
        remoteVersion: baseline.toISOString(),
        baseline: {
          version: 1,
          sourceVersion: baseline.toISOString(),
          changedAt: baseline.toISOString(),
          createdAt: issue.createdAt.toISOString(),
          completedAt: null,
          fields: {
            title: issue.title,
            description: issue.description,
            state: issue.state,
            priority: issue.priority,
            assigneeId: issue.assigneeId,
            startDate: null,
            dueDate: null,
            progress: 0,
          },
        },
      },
    },
  });
  return { workspace, owner, project, connection, credential, binding, issue, ref };
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

function detailChange(
  changedAt: Date,
  overrides: Partial<RedmineIssueChange> = {},
): RedmineIssueChange {
  return {
    identity: { type: "issue", remoteId: "999", remoteProjectId: "41" },
    operation: "upsert",
    changedAt,
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    sourceVersion: `sha256:${changedAt.getTime()}`,
    actor: { remoteId: "5", displayName: "Remote author", username: "author" },
    fields: {
      title: "Remote-created issue",
      description: "Remote description",
      statusId: "open",
      priorityId: "3",
      assignee: null,
      startDate: "2026-08-01",
      dueDate: null,
      progress: 20,
    },
    ...overrides,
  };
}

function dependencies(changes: readonly InboundIssueStatusChange[]) {
  const loadIssueDetail = vi.fn(async (options: InboundIssueDetailOptions): Promise<RedmineIssueChange> => {
    const observed = changes.find(({ entityId }) => entityId === options.remoteIssueId);
    if (!observed) throw new Error("Unexpected Redmine issue detail request");
    const statusId = observed.state === "done" ? "closed" : observed.state === "review" ? "review" : "open";
    return detailChange(observed.changedAt, {
      identity: { type: "issue", remoteId: observed.entityId, remoteProjectId: "41" },
      ...(observed.state === "done" ? { closedAt: observed.changedAt } : {}),
      fields: {
        title: "Linked issue",
        description: null,
        statusId,
        priorityId: "3",
        assignee: null,
        startDate: null,
        dueDate: null,
        progress: observed.state === "done" ? 100 : 0,
      },
    });
  });
  return {
    limit: 1,
    now: () => baseline,
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
    loadIssueDetail,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function resumableDependencies(changes: readonly InboundIssueStatusChange[]) {
  const setup = dependencies(changes);
  setup.createSource.mockImplementation(() => ({
    poll: vi.fn(async (cursor: InboundCursor | null) => {
      const pending = cursor
        ? changes.filter(
            (change) =>
              change.changedAt > cursor.updatedAt ||
              (change.changedAt.getTime() === cursor.updatedAt.getTime() &&
                Number(change.entityId) > Number(cursor.entityId)),
          )
        : changes;
      const last = pending.at(-1);
      return {
        changes: pending,
        nextCursor: last ? { updatedAt: last.changedAt, entityId: last.entityId } : cursor,
        hasMore: false,
      };
    }),
  }));
  return setup;
}

describe("Redmine inbound sync", () => {
  beforeEach(cleanDatabase);
  afterAll(disconnectTestDb);

  it("claims only inbound-enabled bindings with a ready bootstrap", async () => {
    const { binding } = await fixture();
    const disabled = dependencies([]);
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { inboundEnabled: false, bootstrapState: "ready" },
    });

    await runInboundSyncCycle(prisma, disabled);

    expect(disabled.createSource).not.toHaveBeenCalled();

    const pending = dependencies([]);
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { inboundEnabled: true, bootstrapState: "pending" },
    });

    await runInboundSyncCycle(prisma, pending);

    expect(pending.createSource).not.toHaveBeenCalled();
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ pollLeaseToken: null, pollFence: 0 });
  });

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

  it("imports public Redmine comments once and excludes private notes", async () => {
    const { owner, binding, issue } = await fixture();
    const observedAt = new Date("2026-08-01T10:01:00.000Z");
    const publicComment: RedmineCommentChange = {
      identity: {
        type: "comment",
        remoteId: "900",
        remoteProjectId: "41",
        parent: { type: "issue", remoteId: "100" },
      },
      operation: "upsert",
      changedAt: observedAt,
      createdAt: observedAt,
      sourceVersion: "sha256:comment-900-v1",
      actor: { remoteId: "5", displayName: "Remote author", username: "author" },
      fields: { body: "Comment created in Redmine" },
    };
    const privateComment: RedmineCommentChange = {
      identity: {
        type: "comment",
        remoteId: "901",
        remoteProjectId: "41",
        parent: { type: "issue", remoteId: "100" },
      },
      operation: "tombstone",
      changedAt: observedAt,
      createdAt: observedAt,
      sourceVersion: "sha256:comment-901-v1",
      fields: { reason: "private" },
    };
    const detail = {
      ...detailChange(observedAt, {
        identity: { type: "issue", remoteId: "100", remoteProjectId: "41" },
        fields: {
          title: "Linked issue",
          description: null,
          statusId: "review",
          priorityId: "3",
          assignee: null,
          startDate: null,
          dueDate: null,
          progress: 0,
        },
      }),
      comments: [publicComment, privateComment],
    };
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockResolvedValue(detail);

    await runInboundSyncCycle(prisma, setup);

    const comment = await prisma.comment.findFirstOrThrow({ where: { issueId: issue.id } });
    expect(comment).toMatchObject({
      body: "Comment created in Redmine",
      source: "system",
      via: "redmine-inbound",
      authorId: owner.id,
      createdAt: observedAt,
    });
    await expect(
      prisma.externalRef.findUniqueOrThrow({
        where: {
          connectionId_entityType_externalId: {
            connectionId: binding.connectionId,
            entityType: "comment",
            externalId: "900",
          },
        },
      }),
    ).resolves.toMatchObject({ bindingId: binding.id, entityId: comment.id });
    await expect(
      prisma.integrationInboundApplication.findMany({
        where: { bindingId: binding.id, remoteEntityType: "comment" },
        orderBy: { remoteId: "asc" },
        select: { remoteId: true, state: true, outcome: true },
      }),
    ).resolves.toEqual([
      {
        remoteId: "900",
        state: "applied",
        outcome: expect.objectContaining({ provenance: "redmine-inbound" }),
      },
      {
        remoteId: "901",
        state: "skipped",
        outcome: { reason: "private-comment" },
      },
    ]);

    const later = new Date("2026-08-01T10:02:00.000Z");
    const replay = dependencies([change(later, "review")]);
    replay.loadIssueDetail.mockResolvedValue({ ...detail, changedAt: later });
    await runInboundSyncCycle(prisma, replay);

    await expect(prisma.comment.count({ where: { issueId: issue.id } })).resolves.toBe(1);
  });

  it("applies remote-only linked fields atomically without an outbound echo", async () => {
    const { workspace, project, binding, issue, ref } = await fixture();
    const assignee = await seedTestMember(workspace.id);
    await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: binding.id,
        remoteUserId: "6",
        remoteDisplayName: "Remote assignee",
        memberId: assignee.id,
      },
    });
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: {
        readMap: {
          open: "in_progress",
          review: "review",
          closed: "done",
          "priority:3": "medium",
          "priority:4": "high",
        },
      },
    });
    const observedAt = new Date("2026-08-01T10:02:00.000Z");
    const setup = dependencies([change(observedAt, "in_progress")]);
    setup.loadIssueDetail.mockResolvedValue(
      detailChange(observedAt, {
        identity: { type: "issue", remoteId: "100", remoteProjectId: "41" },
        fields: {
          title: "Remote title",
          description: `Remote body\n\n<!-- kanon-issue:${issue.id} -->`,
          statusId: "open",
          priorityId: "4",
          assignee: { remoteId: "6", displayName: "Remote assignee" },
          startDate: "2026-08-02",
          dueDate: "2026-08-20",
          progress: 70,
        },
      }),
    );

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      title: "Remote title",
      description: "Remote body",
      state: "in_progress",
      priority: "high",
      assigneeId: assignee.id,
    });
    await expect(prisma.issueSchedule.findUniqueOrThrow({ where: { issueId: issue.id } })).resolves.toMatchObject({
      startDate: new Date("2026-08-02T00:00:00.000Z"),
      dueDate: new Date("2026-08-20T00:00:00.000Z"),
      progress: 70,
    });
    await expect(prisma.externalRef.findUniqueOrThrow({ where: { id: ref.id } })).resolves.toMatchObject({
      remoteUpdatedAt: observedAt,
      metadata: expect.objectContaining({
        baseline: expect.objectContaining({
          fields: expect.objectContaining({
            title: "Remote title",
            description: "Remote body",
            state: "in_progress",
            priority: "high",
            assigneeId: assignee.id,
            startDate: "2026-08-02",
            dueDate: "2026-08-20",
            progress: 70,
          }),
        }),
      }),
    });
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({ where: { refId: ref.id, remoteUpdatedAt: observedAt } }),
    ).resolves.toMatchObject({
      state: "applied",
      outcome: expect.objectContaining({
        appliedFields: [
          "title",
          "description",
          "state",
          "priority",
          "assigneeId",
          "startDate",
          "dueDate",
          "progress",
        ],
        conflictFields: [],
      }),
    });
    await expect(
      prisma.integrationSyncWork.findMany({
        where: { entityId: issue.id },
        select: { direction: true, state: true },
      }),
    ).resolves.toEqual([{ direction: "inbound", state: "done" }]);
  });

  it("applies unrelated remote fields and quarantines an outbound field conflict", async () => {
    const { owner, binding, issue, ref } = await fixture();
    await prisma.issue.update({
      where: { id: issue.id },
      data: { title: "Local title", priority: "high" },
    });
    const outbound = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "issue",
        entityId: issue.id,
        direction: "outbound",
        operation: "update",
        dedupeKey: randomUUID(),
        laneKey: randomUUID(),
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: { version: 1, fields: { title: "Local title", priority: "high" } },
        correlationId: randomUUID(),
        epoch: binding.lifecycleEpoch,
      },
    });
    const titleOnly = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "issue",
        entityId: issue.id,
        direction: "outbound",
        operation: "update",
        dedupeKey: randomUUID(),
        laneKey: randomUUID(),
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: { version: 1, fields: { title: "Local title" } },
        correlationId: randomUUID(),
        epoch: binding.lifecycleEpoch,
      },
    });
    const observedAt = new Date("2026-08-01T10:02:30.000Z");
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockResolvedValue(
      detailChange(observedAt, {
        identity: { type: "issue", remoteId: "100", remoteProjectId: "41" },
        fields: {
          title: "Remote title",
          description: "Remote-only body",
          statusId: "review",
          priorityId: "3",
          assignee: null,
          startDate: null,
          dueDate: null,
          progress: 0,
        },
      }),
    );

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      title: "Local title",
      description: "Remote-only body",
    });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: outbound.id } })).resolves.toMatchObject({
      state: "queued",
      payload: { version: 1, fields: { priority: "high" } },
    });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: titleOnly.id } })).resolves.toMatchObject({
      state: "dead",
      skippedReason: "inbound_field_conflict",
    });
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({ where: { refId: ref.id, remoteUpdatedAt: observedAt } }),
    ).resolves.toMatchObject({
      state: "conflict",
      outcome: expect.objectContaining({
        appliedFields: ["description"],
        conflictFields: ["title"],
      }),
    });
    await expect(
      prisma.integrationConflict.findFirstOrThrow({ where: { refId: ref.id, kind: "inbound-field-convergence" } }),
    ).resolves.toMatchObject({
      localEvidence: expect.objectContaining({
        fields: expect.objectContaining({ title: expect.objectContaining({ reason: "diverged" }) }),
      }),
    });
  });

  it("keeps an unmapped priority field-scoped while applying the remote title", async () => {
    const { issue, ref } = await fixture();
    const observedAt = new Date("2026-08-01T10:02:45.000Z");
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockResolvedValue(
      detailChange(observedAt, {
        identity: { type: "issue", remoteId: "100", remoteProjectId: "41" },
        fields: {
          title: "Mapped remote title",
          description: null,
          statusId: "review",
          priorityId: "99",
          assignee: null,
          startDate: null,
          dueDate: null,
          progress: 0,
        },
      }),
    );

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      title: "Mapped remote title",
      priority: "medium",
    });
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({ where: { refId: ref.id, remoteUpdatedAt: observedAt } }),
    ).resolves.toMatchObject({
      state: "conflict",
      outcome: expect.objectContaining({
        appliedFields: ["title"],
        conflictFields: ["priority"],
      }),
    });
  });

  it("quarantines a remote date range whose start is after its due date", async () => {
    const { issue, ref } = await fixture();
    const observedAt = new Date("2026-08-01T10:02:47.000Z");
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockResolvedValue(
      detailChange(observedAt, {
        identity: { type: "issue", remoteId: "100", remoteProjectId: "41" },
        fields: {
          title: "Linked issue",
          description: null,
          statusId: "review",
          priorityId: "3",
          assignee: null,
          startDate: "2026-08-20",
          dueDate: "2026-08-02",
          progress: 0,
        },
      }),
    );

    await runInboundSyncCycle(prisma, setup);

    await expect(
      prisma.issueSchedule.findUnique({ where: { issueId: issue.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.externalRef.findUniqueOrThrow({ where: { id: ref.id } }),
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({
        baseline: expect.objectContaining({
          fields: expect.objectContaining({ startDate: null, dueDate: null }),
        }),
      }),
    });
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({
        where: { refId: ref.id, remoteUpdatedAt: observedAt },
      }),
    ).resolves.toMatchObject({
      state: "conflict",
      outcome: expect.objectContaining({
        appliedFields: [],
        conflictFields: ["startDate", "dueDate"],
      }),
    });
    await expect(
      prisma.integrationConflict.findFirstOrThrow({
        where: { refId: ref.id, kind: "inbound-field-convergence" },
      }),
    ).resolves.toMatchObject({
      localEvidence: {
        issueId: issue.id,
        issueKey: expect.any(String),
        fields: {
          startDate: expect.objectContaining({ reason: "invalid" }),
          dueDate: expect.objectContaining({ reason: "invalid" }),
        },
      },
      remoteEvidence: {
        provider: "redmine",
        remoteIssueId: "100",
        remoteVersion: expect.any(String),
        fields: {
          startDate: { value: "2026-08-20", reason: "invalid-date-range" },
          dueDate: { value: "2026-08-02", reason: "invalid-date-range" },
        },
      },
    });
  });

  it("rejects a credential replacement during linked convergence", async () => {
    const { credential, binding, issue, ref } = await fixture();
    const observedAt = new Date("2026-08-01T10:02:50.000Z");
    const setup = dependencies([change(observedAt, "in_progress")]);
    setup.loadIssueDetail.mockImplementation(async () => {
      await prisma.memberIntegrationCredential.update({
        where: { id: credential.id },
        data: {
          encryptedKey: "replacement-key",
          lastValidatedAt: new Date(baseline.getTime() + 1),
        },
      });
      return detailChange(observedAt, {
        identity: { type: "issue", remoteId: "100", remoteProjectId: "41" },
        fields: {
          title: "Must not apply",
          description: null,
          statusId: "open",
          priorityId: "3",
          assignee: null,
          startDate: null,
          dueDate: null,
          progress: 0,
        },
      });
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      title: "Linked issue",
      state: "review",
    });
    await expect(prisma.externalRef.findUniqueOrThrow({ where: { id: ref.id } })).resolves.toMatchObject({
      remoteUpdatedAt: baseline,
    });
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
    await expect(prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } })).resolves.toMatchObject({
      cursorUpdatedAt: null,
      cursorRemoteId: null,
    });
  });

  it("records a malformed linked detail without leaking provider content", async () => {
    const { binding, ref } = await fixture();
    const observedAt = new Date("2026-08-01T10:02:55.000Z");
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockRejectedValue(
      Object.assign(new Error("provider secret body"), { apiKey: "must-not-log" }),
    );

    await runInboundSyncCycle(prisma, setup);

    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({ where: { refId: ref.id, remoteUpdatedAt: observedAt } }),
    ).resolves.toMatchObject({
      state: "conflict",
      outcome: expect.objectContaining({ reason: "INBOUND_OBSERVATION_FAILED" }),
    });
    await expect(
      prisma.integrationConflict.findFirstOrThrow({
        where: { refId: ref.id, kind: "inbound-observation-failure" },
      }),
    ).resolves.toMatchObject({ remoteEvidence: expect.objectContaining({ remoteIssueId: "100" }) });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ cursorUpdatedAt: observedAt, cursorRemoteId: "100" });
    expect(JSON.stringify([...setup.logger.warn.mock.calls, ...setup.logger.error.mock.calls])).not.toMatch(
      /provider secret body|must-not-log|service-secret/,
    );
  });

  it("records a mismatched linked detail and advances past the poison observation", async () => {
    const { binding, ref } = await fixture();
    const observedAt = new Date("2026-08-01T10:02:57.000Z");
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockResolvedValue(
      detailChange(observedAt, {
        identity: { type: "issue", remoteId: "different", remoteProjectId: "41" },
      }),
    );

    await runInboundSyncCycle(prisma, setup);

    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({
        where: { refId: ref.id, remoteUpdatedAt: observedAt },
      }),
    ).resolves.toMatchObject({
      state: "conflict",
      outcome: expect.objectContaining({ reason: "INBOUND_OBSERVATION_FAILED" }),
    });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ cursorUpdatedAt: observedAt, cursorRemoteId: "100" });
  });

  it("imports an unlinked Redmine issue observed after activation", async () => {
    const { binding, issue, project } = await fixture();
    const unlinkedAt = new Date("2026-08-01T10:03:00.000Z");
    const setup = dependencies([change(unlinkedAt, "in_progress", "999")]);
    const detail = detailChange(unlinkedAt);
    setup.loadIssueDetail.mockResolvedValue(detail);

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      state: "review",
    });
    const imported = await prisma.issue.findFirstOrThrow({
      where: { projectId: project.id, id: { not: issue.id } },
    });
    expect(imported).toMatchObject({
      key: `${project.key}-2`,
      title: "Remote-created issue",
      state: "in_progress",
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
      completedAt: null,
    });
    const ref = await prisma.externalRef.findFirstOrThrow({ where: { externalId: "999" } });
    expect(ref).toMatchObject({
      bindingId: binding.id,
      remoteUpdatedAt: unlinkedAt,
      metadata: expect.objectContaining({ remoteVersion: detail.sourceVersion }),
    });
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({ where: { refId: ref.id } }),
    ).resolves.toMatchObject({
      sourceVersion: detail.sourceVersion,
      state: "applied",
      outcome: expect.objectContaining({ provenance: "redmine-inbound-discovery" }),
    });
    await expect(
      prisma.integrationSyncWork.findMany({
        where: { entityId: imported.id },
        select: { direction: true, operation: true, state: true },
      }),
    ).resolves.toEqual([{ direction: "inbound", operation: "create", state: "done" }]);
    await expect(
      prisma.integrationSyncWork.count({ where: { entityId: imported.id, direction: "outbound" } }),
    ).resolves.toBe(0);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ cursorUpdatedAt: unlinkedAt, cursorRemoteId: "999" });
    expect(setup.loadIssueDetail).toHaveBeenCalledWith(
      expect.objectContaining({ remoteProjectId: "41", remoteIssueId: "999" }),
    );
  });

  it("imports a newly observed issue already closed in Redmine as done", async () => {
    const { issue, project } = await fixture();
    const observedAt = new Date("2026-08-01T10:04:00.000Z");
    const closedAt = new Date("2026-08-01T10:02:00.000Z");
    const setup = dependencies([change(observedAt, "done", "999")]);
    setup.loadIssueDetail.mockResolvedValue({
      ...detailChange(observedAt),
      closedAt,
      fields: {
        title: "Created and closed remotely",
        description: null,
        statusId: "closed",
        priorityId: "3",
        assignee: null,
        startDate: null,
        dueDate: null,
        progress: 100,
      },
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(
      prisma.issue.findFirstOrThrow({ where: { projectId: project.id, id: { not: issue.id } } }),
    ).resolves.toMatchObject({ state: "done", completedAt: closedAt });
  });

  it("skips private detail without provider content and imports a later public observation", async () => {
    const { binding, project } = await fixture();
    const privateAt = new Date("2026-08-01T10:05:00.000Z");
    const hidden = dependencies([change(privateAt, "in_progress", "999")]);
    hidden.loadIssueDetail.mockResolvedValue(
      detailChange(privateAt, {
        operation: "tombstone",
        actor: undefined,
        fields: { reason: "private" },
      }),
    );

    await runInboundSyncCycle(prisma, hidden);

    await expect(prisma.issue.count()).resolves.toBe(1);
    await expect(prisma.externalRef.count()).resolves.toBe(1);
    await expect(prisma.integrationExternalIdentity.count()).resolves.toBe(0);
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ cursorUpdatedAt: privateAt, cursorRemoteId: "999" });

    const publicAt = new Date("2026-08-01T10:06:00.000Z");
    const reopened = dependencies([change(publicAt, "review", "999")]);
    const publicDetail = detailChange(publicAt, {
      fields: {
        title: "Now public",
        description: "Visible body",
        statusId: "review",
        priorityId: "3",
        assignee: null,
        startDate: null,
        dueDate: null,
        progress: 50,
      },
    });
    reopened.loadIssueDetail.mockResolvedValue(publicDetail);

    await runInboundSyncCycle(prisma, reopened);

    await expect(prisma.issue.count()).resolves.toBe(2);
    await expect(prisma.externalRef.count()).resolves.toBe(2);
    await expect(
      prisma.issue.findFirstOrThrow({ where: { projectId: project.id, title: "Now public" } }),
    ).resolves.toMatchObject({ state: "review" });
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(1);
  });

  it("deduplicates concurrent discovery and replay without outbound work", async () => {
    const { project } = await fixture();
    const observedAt = new Date("2026-08-01T10:07:00.000Z");
    const setup = dependencies([change(observedAt, "in_progress", "999")]);
    setup.loadIssueDetail.mockResolvedValue(detailChange(observedAt));

    await Promise.all([runInboundSyncCycle(prisma, setup), runInboundSyncCycle(prisma, setup)]);
    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(2);
    await expect(prisma.externalRef.count({ where: { externalId: "999" } })).resolves.toBe(1);
    await expect(
      prisma.integrationInboundApplication.count({ where: { remoteId: "999" } }),
    ).resolves.toBe(1);
    await expect(
      prisma.integrationSyncWork.count({ where: { direction: "outbound" } }),
    ).resolves.toBe(0);
    expect(setup.loadIssueDetail).toHaveBeenCalledOnce();
  });

  it("defers provider-success-before-ref-finalize to the unsettled outbound create", async () => {
    const { owner, project, credential, binding } = await fixture();
    const local = await prisma.issue.create({
      data: {
        key: `${project.key}-2`,
        sequenceNum: 2,
        title: "Created locally",
        projectId: project.id,
        state: "in_progress",
      },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { lastSequenceNum: 2 },
    });
    const outbound = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "issue",
        entityId: local.id,
        direction: "outbound",
        operation: "create",
        dedupeKey: randomUUID(),
        laneKey: randomUUID(),
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        authCredentialId: credential.id,
        payload: { version: 1, fields: { title: local.title, state: local.state } },
        correlationId: randomUUID(),
        epoch: binding.lifecycleEpoch,
        state: "leased",
        leaseToken: "provider-succeeded",
        leaseUntil: new Date(baseline.getTime() + 120_000),
        fence: 1,
      },
    });
    const observedAt = new Date("2026-08-01T10:07:30.000Z");
    const setup = dependencies([change(observedAt, "in_progress", "999")]);
    setup.loadIssueDetail.mockResolvedValue(
      detailChange(observedAt, {
        fields: {
          title: "Created locally",
          description: `Provider body\n\n<!-- kanon-issue:${local.id} -->`,
          statusId: "open",
          priorityId: "3",
          assignee: null,
          startDate: null,
          dueDate: null,
          progress: 0,
        },
      }),
    );

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(2);
    await expect(prisma.externalRef.count({ where: { externalId: "999" } })).resolves.toBe(0);
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: outbound.id } }),
    ).resolves.toMatchObject({ state: "leased", leaseToken: "provider-succeeded", refId: null });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      cursorUpdatedAt: null,
      cursorRemoteId: null,
      pollLeaseToken: null,
      pollLeaseUntil: new Date(baseline.getTime() + 60_000),
    });
    expect(setup.logger.warn).toHaveBeenCalledWith(
      {
        bindingId: binding.id,
        remoteIssueId: "999",
        error: { name: "AppError", code: "OUTBOUND_CREATE_UNSETTLED", statusCode: 409 },
      },
      "Inbound Redmine issue processing failed",
    );
    expect(JSON.stringify(setup.logger.warn.mock.calls)).not.toContain("Provider body");
  });

  it.each(["replacement", "revocation"] as const)(
    "rejects a service credential %s during detail loading without importing",
    async (race) => {
      const { project, credential, binding } = await fixture();
      const observedAt = new Date("2026-08-01T10:07:45.000Z");
      const setup = dependencies([change(observedAt, "in_progress", "999")]);
      setup.loadIssueDetail.mockImplementation(async () => {
        await prisma.memberIntegrationCredential.update({
          where: { id: credential.id },
          data:
            race === "replacement"
              ? {
                  encryptedKey: "replacement-secret",
                  lastValidatedAt: new Date(baseline.getTime() + 1),
                }
              : { revokedAt: observedAt },
        });
        return detailChange(observedAt, {
          fields: {
            title: "Credential race provider title",
            description: "Credential race provider body",
            statusId: "open",
            priorityId: "3",
            assignee: null,
            startDate: null,
            dueDate: null,
            progress: 0,
          },
        });
      });

      await runInboundSyncCycle(prisma, setup);

      await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
      await expect(prisma.externalRef.count({ where: { externalId: "999" } })).resolves.toBe(0);
      await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
      await expect(
        prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
      ).resolves.toMatchObject({
        cursorUpdatedAt: null,
        cursorRemoteId: null,
        pollLeaseToken: null,
        pollLeaseUntil: new Date(baseline.getTime() + 60_000),
      });
      const storedCredential = await prisma.memberIntegrationCredential.findUniqueOrThrow({
        where: { id: credential.id },
      });
      if (race === "replacement") {
        expect(storedCredential).toMatchObject({
          encryptedKey: "replacement-secret",
          lastAuthStatus: "valid",
          revokedAt: null,
        });
      } else {
        expect(storedCredential).toMatchObject({ revokedAt: observedAt });
      }
      expect(setup.logger.warn).toHaveBeenCalledWith(
        {
          bindingId: binding.id,
          remoteIssueId: "999",
          error: { name: "AppError", code: "INBOUND_CREDENTIAL_STALE", statusCode: 409 },
        },
        "Inbound Redmine issue processing failed",
      );
      const logs = JSON.stringify([
        ...setup.logger.warn.mock.calls,
        ...setup.logger.error.mock.calls,
      ]);
      expect(logs).not.toMatch(/replacement-secret|Credential race provider|service-secret/);
    },
  );

  it("rejects a credential replacement during source polling before applying any changes", async () => {
    const { issue, project, credential, binding } = await fixture();
    const observedAt = new Date("2026-08-01T10:07:50.000Z");
    const changes = [
      { ...change(observedAt, "done"), remoteVersion: "source-provider-body" },
      change(new Date(observedAt.getTime() + 1), "in_progress", "999"),
    ];
    const setup = dependencies(changes);
    setup.createSource.mockReturnValue({
      poll: vi.fn(async () => {
        await prisma.memberIntegrationCredential.update({
          where: { id: credential.id },
          data: {
            encryptedKey: "source-poll-replacement-key",
            lastValidatedAt: new Date(baseline.getTime() + 1),
          },
        });
        return {
          changes,
          nextCursor: {
            updatedAt: changes[1]!.changedAt,
            entityId: changes[1]!.entityId,
          },
          hasMore: false,
        };
      }),
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      state: "review",
    });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
    await expect(prisma.externalRef.count({ where: { externalId: "999" } })).resolves.toBe(0);
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
    expect(setup.loadIssueDetail).not.toHaveBeenCalled();
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      cursorUpdatedAt: null,
      cursorRemoteId: null,
      pollLeaseToken: null,
      pollLeaseUntil: new Date(baseline.getTime() + 60_000),
    });
    await expect(
      prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: credential.id } }),
    ).resolves.toMatchObject({
      encryptedKey: "source-poll-replacement-key",
      lastAuthStatus: "valid",
      revokedAt: null,
    });
    expect(JSON.stringify(setup.logger.error.mock.calls)).not.toMatch(
      /source-poll-replacement-key|source-provider-body|service-secret/,
    );
  });

  it("rejects a credential replacement before committing a private detail cursor", async () => {
    const { project, credential, binding } = await fixture();
    const observedAt = new Date("2026-08-01T10:07:55.000Z");
    const setup = dependencies([change(observedAt, "in_progress", "999")]);
    setup.loadIssueDetail.mockImplementation(async () => {
      await prisma.memberIntegrationCredential.update({
        where: { id: credential.id },
        data: {
          encryptedKey: "private-detail-replacement-key",
          lastValidatedAt: new Date(baseline.getTime() + 1),
        },
      });
      return detailChange(observedAt, {
        operation: "tombstone",
        actor: undefined,
        fields: { reason: "private" },
        sourceVersion: "sha256:private-provider-body",
      });
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
    await expect(prisma.externalRef.count({ where: { externalId: "999" } })).resolves.toBe(0);
    await expect(prisma.integrationExternalIdentity.count()).resolves.toBe(0);
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      cursorUpdatedAt: null,
      cursorRemoteId: null,
      pollLeaseToken: null,
      pollLeaseUntil: new Date(baseline.getTime() + 60_000),
    });
    await expect(
      prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: credential.id } }),
    ).resolves.toMatchObject({
      encryptedKey: "private-detail-replacement-key",
      lastAuthStatus: "valid",
      revokedAt: null,
    });
    expect(JSON.stringify(setup.logger.error.mock.calls)).not.toMatch(
      /private-detail-replacement-key|private-provider-body|service-secret/,
    );
  });

  it("caps discovery at ten detail reads and resumes the remaining observations", async () => {
    const { project, binding } = await fixture();
    const changes = Array.from({ length: 15 }, (_, index) =>
      change(new Date(baseline.getTime() + (index + 1) * 60_000), "in_progress", String(1000 + index)),
    );
    const setup = resumableDependencies(changes);
    const details = new Map(
      changes.map((observed) => [
        observed.entityId,
        detailChange(observed.changedAt, {
          identity: { type: "issue", remoteId: observed.entityId, remoteProjectId: "41" },
          sourceVersion: `sha256:${observed.entityId}`,
        }),
      ]),
    );
    setup.loadIssueDetail.mockImplementation(async ({ remoteIssueId }) => details.get(remoteIssueId)!);

    await runInboundSyncCycle(prisma, setup);

    expect(setup.loadIssueDetail).toHaveBeenCalledTimes(10);
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(11);
    await expect(
      prisma.integrationInboundApplication.count({ where: { bindingId: binding.id } }),
    ).resolves.toBe(10);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      cursorUpdatedAt: changes[9]!.changedAt,
      cursorRemoteId: changes[9]!.entityId,
    });

    await runInboundSyncCycle(prisma, setup);

    expect(setup.loadIssueDetail).toHaveBeenCalledTimes(15);
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(16);
    await expect(
      prisma.integrationInboundApplication.count({ where: { bindingId: binding.id } }),
    ).resolves.toBe(15);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      cursorUpdatedAt: changes[14]!.changedAt,
      cursorRemoteId: changes[14]!.entityId,
    });
  });

  it("counts private issue detail reads against the discovery cap", async () => {
    const { project, binding } = await fixture();
    const changes = Array.from({ length: 11 }, (_, index) =>
      change(new Date(baseline.getTime() + (index + 1) * 60_000), "in_progress", String(2000 + index)),
    );
    const setup = resumableDependencies(changes);
    setup.loadIssueDetail.mockImplementation(async ({ remoteIssueId }) => {
      const observed = changes.find(({ entityId }) => entityId === remoteIssueId)!;
      return Number(remoteIssueId) < 2010
        ? detailChange(observed.changedAt, {
            identity: { type: "issue", remoteId: remoteIssueId, remoteProjectId: "41" },
            operation: "tombstone",
            actor: undefined,
            fields: { reason: "private" },
          })
        : detailChange(observed.changedAt, {
            identity: { type: "issue", remoteId: remoteIssueId, remoteProjectId: "41" },
          });
    });

    await runInboundSyncCycle(prisma, setup);

    expect(setup.loadIssueDetail).toHaveBeenCalledTimes(10);
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      cursorUpdatedAt: changes[9]!.changedAt,
      cursorRemoteId: changes[9]!.entityId,
    });

    await runInboundSyncCycle(prisma, setup);

    expect(setup.loadIssueDetail).toHaveBeenCalledTimes(11);
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(2);
    await expect(prisma.externalRef.count({ where: { externalId: "2010" } })).resolves.toBe(1);
  });

  it("does not import after the poll lease and fence are replaced during detail loading", async () => {
    const { binding, project } = await fixture();
    const observedAt = new Date("2026-08-01T10:08:00.000Z");
    const setup = dependencies([change(observedAt, "in_progress", "999")]);
    setup.loadIssueDetail.mockImplementation(async () => {
      await prisma.integrationProjectBinding.update({
        where: { id: binding.id },
        data: { pollLeaseToken: "replacement-owner", pollFence: { increment: 1 } },
      });
      return detailChange(observedAt);
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
    await expect(prisma.externalRef.count({ where: { externalId: "999" } })).resolves.toBe(0);
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      cursorUpdatedAt: null,
      cursorRemoteId: null,
      pollLeaseToken: "replacement-owner",
      pollFence: 2,
    });
  });

  it.each(["mapping", "detail", "identity"] as const)(
    "records an unlinked %s failure and advances to the next observation",
    async (failure) => {
      const { binding, project } = await fixture();
      const observedAt = new Date("2026-08-01T10:09:00.000Z");
      const setup = dependencies([change(observedAt, "in_progress", "999")]);
      if (failure === "mapping") {
        setup.loadIssueDetail.mockResolvedValue(
          detailChange(observedAt, {
            fields: {
              title: "Unmapped issue",
              description: null,
              statusId: "missing",
              priorityId: "3",
              assignee: null,
              startDate: null,
              dueDate: null,
              progress: 0,
            },
          }),
        );
      } else if (failure === "detail") {
        setup.loadIssueDetail.mockRejectedValue(
          Object.assign(new Error("detail secret"), { apiKey: "must-not-be-logged" }),
        );
      } else {
        setup.loadIssueDetail.mockResolvedValue(
          detailChange(observedAt, {
            identity: { type: "issue", remoteId: "1000", remoteProjectId: "41" },
          }),
        );
      }

      await runInboundSyncCycle(prisma, setup);

      await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
      await expect(prisma.externalRef.count({ where: { externalId: "999" } })).resolves.toBe(0);
      await expect(
        prisma.integrationInboundApplication.findFirstOrThrow({ where: { remoteId: "999" } }),
      ).resolves.toMatchObject({
        state: "conflict",
        outcome: expect.objectContaining({ reason: "INBOUND_OBSERVATION_FAILED" }),
      });
      await expect(
        prisma.integrationConflict.findFirstOrThrow({
          where: { bindingId: binding.id, kind: "inbound-observation-failure" },
        }),
      ).resolves.toMatchObject({
        refId: null,
        remoteEvidence: expect.objectContaining({ remoteIssueId: "999" }),
      });
      await expect(
        prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
      ).resolves.toMatchObject({
        cursorUpdatedAt: observedAt,
        cursorRemoteId: "999",
        pollLeaseToken: null,
        pollLeaseUntil: null,
      });
      const logs = JSON.stringify([
        ...setup.logger.warn.mock.calls,
        ...setup.logger.error.mock.calls,
      ]);
      expect(logs).not.toMatch(/must-not-be-logged|detail secret|Unmapped issue/);
    },
  );

  it("rolls back every discovery row and preserves the cursor on a write failure", async () => {
    const { binding, project } = await fixture();
    const observedAt = new Date("2026-08-01T10:10:00.000Z");
    const setup = dependencies([change(observedAt, "in_progress", "999")]);
    setup.loadIssueDetail.mockResolvedValue(
      detailChange(observedAt, {
        fields: {
          title: "force-discovery-rollback",
          description: null,
          statusId: "open",
          priorityId: "3",
          assignee: null,
          startDate: null,
          dueDate: null,
          progress: 0,
        },
      }),
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "issues" ADD CONSTRAINT "test_redmine_discovery_rollback" CHECK ("title" <> \'force-discovery-rollback\')',
    );

    try {
      await runInboundSyncCycle(prisma, setup);

      await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
      await expect(prisma.externalRef.count({ where: { externalId: "999" } })).resolves.toBe(0);
      await expect(prisma.integrationExternalIdentity.count()).resolves.toBe(0);
      await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
      await expect(prisma.integrationSyncWork.count()).resolves.toBe(0);
      await expect(prisma.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({
        lastSequenceNum: 1,
      });
      await expect(
        prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
      ).resolves.toMatchObject({
        cursorUpdatedAt: null,
        cursorRemoteId: null,
        pollLeaseUntil: new Date(baseline.getTime() + 60_000),
      });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "issues" DROP CONSTRAINT IF EXISTS "test_redmine_discovery_rollback"',
      );
    }
  });

  it("ignores expired work sessions when applying a remote close", async () => {
    const { owner, issue, ref } = await fixture();
    await prisma.workSession.create({
      data: {
        userId: owner.userId,
        memberId: owner.id,
        issueId: issue.id,
        source: "stale-test",
        startedAt: new Date("2026-08-01T08:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-01T08:01:00.000Z"),
      },
    });
    const closedAt = new Date("2026-08-04T10:02:00.000Z");

    await runInboundSyncCycle(prisma, dependencies([change(closedAt, "done")]));

    await expect(prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).resolves.toMatchObject({
      state: "done",
    });
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({
        where: { refId: ref.id, remoteUpdatedAt: closedAt },
      }),
    ).resolves.toMatchObject({
      state: "applied",
      outcome: expect.objectContaining({ conflictFields: [] }),
    });
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
    ).resolves.toBe(3);

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

  it("invalidates a rejected service credential, releases its lease, and stops every binding", async () => {
    const { workspace, connection, credential } = await fixture();
    const secondProject = await seedTestProject(workspace.id);
    await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: secondProject.id,
        remoteProjectId: "42",
        readMap: {},
        writeMap: {},
        lifecycle: "active",
        lifecycleEpoch: 1,
      },
    });
    const setup = dependencies([]);
    const poll = vi.fn().mockRejectedValue({
      name: "RedmineHttpError",
      statusCode: 401,
      apiKey: "must-not-be-logged",
    });
    setup.createSource.mockReturnValue({ poll });

    await runInboundSyncCycle(prisma, { ...setup, limit: 2 });

    expect(poll).toHaveBeenCalledOnce();
    await expect(
      prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: credential.id } }),
    ).resolves.toMatchObject({ lastAuthStatus: "invalid" });
    await expect(
      prisma.integrationProjectBinding.count({
        where: { connectionId: connection.id, OR: [{ pollLeaseToken: { not: null } }, { pollLeaseUntil: { not: null } }] },
      }),
    ).resolves.toBe(0);

    expect(JSON.stringify(setup.logger.error.mock.calls)).not.toContain("must-not-be-logged");
  });

  it("keeps a replacement credential valid and releases the lease immediately after a stale 401", async () => {
    const { credential, binding } = await fixture();
    const setup = dependencies([]);
    setup.createSource.mockReturnValue({
      poll: vi.fn(async () => {
        await prisma.memberIntegrationCredential.update({
          where: { id: credential.id },
          data: { encryptedKey: "replacement-key", lastValidatedAt: baseline },
        });
        throw Object.assign(new Error("rejected"), { statusCode: 401 });
      }),
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(
      prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: credential.id } }),
    ).resolves.toMatchObject({
      lastAuthStatus: "valid",
    });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ pollLeaseToken: null, pollLeaseUntil: null });
  });

  it("contains a reclaimed-poll 401 after invalidating the observed credential", async () => {
    const { credential, binding } = await fixture();
    const newLeaseUntil = new Date(baseline.getTime() + 120_000);
    const setup = dependencies([]);
    setup.createSource.mockReturnValue({
      poll: vi.fn(async () => {
        await prisma.integrationProjectBinding.update({
          where: { id: binding.id },
          data: {
            pollLeaseToken: "new-owner",
            pollLeaseUntil: newLeaseUntil,
            pollFence: { increment: 1 },
          },
        });
        throw Object.assign(new Error("rejected secret"), { statusCode: 401 });
      }),
    });

    await expect(runInboundSyncCycle(prisma, setup)).resolves.toBeUndefined();
    expect(
      await prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: credential.id } }),
    ).toMatchObject({ lastAuthStatus: "invalid" });
    expect(
      await prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).toMatchObject({
      pollLeaseToken: "new-owner",
      pollLeaseUntil: newLeaseUntil,
      pollFence: 2,
    });
    expect(JSON.stringify(setup.logger.error.mock.calls)).not.toContain("secret");
  });

  it.each([
      Object.assign(new Error("forbidden secret"), { statusCode: 403, apiKey: "forbidden-key" }),
      Object.assign(new Error("network secret"), { code: "ECONNRESET", apiKey: "network-key" }),
    ])("keeps non-auth failures on the normal failed-poll delay without leaking errors", async (error) => {
      const { credential, binding } = await fixture();
      const setup = dependencies([]);
      setup.createSource.mockReturnValue({ poll: vi.fn().mockRejectedValue(error) });

      await runInboundSyncCycle(prisma, setup);

      await expect(
        prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: credential.id } }),
      ).resolves.toMatchObject({ lastAuthStatus: "valid" });
      await expect(
        prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
      ).resolves.toMatchObject({
        pollLeaseToken: null,
        pollLeaseUntil: new Date(baseline.getTime() + 60_000),
      });
      expect(JSON.stringify(setup.logger.error.mock.calls)).not.toMatch(/secret|-key/);
    });
});

describe("Redmine inbound comment echoes", () => {
  beforeEach(cleanDatabase);

  const commentUuid = "550e8400-e29b-41d4-a716-446655440000";
  const marker = `<!-- kanon-comment:${commentUuid} -->`;

  function markedJournal(observedAt: Date, remoteId = "902"): RedmineCommentChange {
    return {
      identity: {
        type: "comment",
        remoteId,
        remoteProjectId: "41",
        parent: { type: "issue", remoteId: "100" },
      },
      operation: "upsert",
      changedAt: observedAt,
      createdAt: observedAt,
      sourceVersion: "sha256:comment-902-v1",
      actor: { remoteId: "5", displayName: "Remote author", username: "author" },
      fields: { body: `Delivered body\n\n${marker}` },
    };
  }

  it.each(["leased", "ambiguous", "done"] as const)("attaches a marked journal with %s outbound proof", async (state) => {
    const { owner, binding, connection, issue, ref } = await fixture();
    const local = await prisma.comment.create({
      data: { id: commentUuid, issueId: issue.id, authorId: owner.id, body: "Delivered body" },
    });
    const work = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "comment",
        entityId: local.id,
        direction: "outbound",
        operation: "create",
        dedupeKey: "comment-echo-work",
        laneKey: issue.id,
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: { version: 1, issueId: issue.id, parentRefId: ref.id, parentRemoteIssueId: "100" },
        correlationId: local.id,
        epoch: binding.lifecycleEpoch,
        refId: null,
        marker,
        state,
      },
    });
    const observedAt = new Date("2026-08-01T10:01:00.000Z");
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockResolvedValue({
      ...detailChange(observedAt, { identity: { type: "issue", remoteId: "100", remoteProjectId: "41" } }),
      comments: [markedJournal(observedAt)],
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.comment.count({ where: { issueId: issue.id } })).resolves.toBe(1);
    await expect(
      prisma.externalRef.findUniqueOrThrow({
        where: { connectionId_entityType_externalId: { connectionId: connection.id, entityType: "comment", externalId: "902" } },
      }),
    ).resolves.toMatchObject({ entityId: local.id, bindingId: binding.id });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({ state: "done", refId: expect.any(String) });
    await expect(prisma.integrationInboundApplication.findFirstOrThrow({ where: { workId: work.id } })).resolves.toMatchObject({
      outcome: expect.objectContaining({ provenance: "redmine-inbound-echo", marker }),
    });
  });

  it("imports an altered marked journal without claiming its local comment proof", async () => {
    const { owner, binding, connection, issue, ref } = await fixture();
    const local = await prisma.comment.create({
      data: { id: commentUuid, issueId: issue.id, authorId: owner.id, body: "Delivered body" },
    });
    const work = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "comment",
        entityId: local.id,
        direction: "outbound",
        operation: "create",
        dedupeKey: "altered-comment-echo-work",
        laneKey: issue.id,
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: { version: 1 },
        correlationId: local.id,
        epoch: binding.lifecycleEpoch,
        refId: ref.id,
        marker,
        state: "leased",
      },
    });
    const observedAt = new Date("2026-08-01T10:01:00.000Z");
    const alteredBody = `Altered remote body\n\n${marker}`;
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockResolvedValue({
      ...detailChange(observedAt, { identity: { type: "issue", remoteId: "100", remoteProjectId: "41" } }),
      comments: [{ ...markedJournal(observedAt), fields: { body: alteredBody } }],
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.comment.count({ where: { issueId: issue.id } })).resolves.toBe(2);
    const remoteRef = await prisma.externalRef.findUniqueOrThrow({
      where: { connectionId_entityType_externalId: { connectionId: connection.id, entityType: "comment", externalId: "902" } },
    });
    expect(remoteRef.entityId).not.toBe(local.id);
    await expect(prisma.comment.findUniqueOrThrow({ where: { id: remoteRef.entityId } })).resolves.toMatchObject({
      body: alteredBody,
      source: "system",
      via: "redmine-inbound",
    });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({ state: "leased" });
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({ where: { bindingId: binding.id, remoteId: "902" } }),
    ).resolves.toMatchObject({ workId: null, outcome: { provenance: "redmine-inbound" } });
  });

  it("imports a second marked journal normally when the local comment is already mapped", async () => {
    const { owner, binding, connection, issue, ref } = await fixture();
    const local = await prisma.comment.create({
      data: { id: commentUuid, issueId: issue.id, authorId: owner.id, body: "Delivered body" },
    });
    await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "comment",
        entityId: local.id,
        direction: "outbound",
        operation: "create",
        dedupeKey: "mapped-comment-echo-work",
        laneKey: issue.id,
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: { version: 1 },
        correlationId: local.id,
        epoch: binding.lifecycleEpoch,
        refId: ref.id,
        marker,
        state: "done",
      },
    });
    await prisma.externalRef.create({
      data: {
        connectionId: connection.id,
        bindingId: binding.id,
        entityType: "comment",
        entityId: local.id,
        externalId: "902",
        remoteUpdatedAt: baseline,
      },
    });
    const observedAt = new Date("2026-08-01T10:01:00.000Z");
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockResolvedValue({
      ...detailChange(observedAt, { identity: { type: "issue", remoteId: "100", remoteProjectId: "41" } }),
      comments: [markedJournal(observedAt, "903")],
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(prisma.comment.count({ where: { issueId: issue.id } })).resolves.toBe(2);
    await expect(
      prisma.externalRef.findUniqueOrThrow({
        where: { connectionId_entityType_externalId: { connectionId: connection.id, entityType: "comment", externalId: "903" } },
      }),
    ).resolves.toMatchObject({ bindingId: binding.id, entityId: expect.not.stringMatching(commentUuid) });
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({ where: { bindingId: binding.id, remoteId: "903" } }),
    ).resolves.toMatchObject({ workId: null, outcome: { provenance: "redmine-inbound" } });
  });

  it.each([
    ["queued", "queued", {}],
    ["dead", "dead", {}],
    ["superseded", "superseded", {}],
    ["wrong issue", "leased", { issueId: randomUUID() }],
    ["wrong parent ref", "leased", { parentRefId: randomUUID() }],
    ["wrong remote issue", "leased", { parentRemoteIssueId: "wrong" }],
    ["open conflict", "ambiguous", {}],
  ] as const)(
    "does not use %s work as proof of an outbound comment",
    async (proof, state, payloadOverride) => {
      const { owner, binding, connection, issue, ref } = await fixture();
      const local = await prisma.comment.create({
        data: { id: commentUuid, issueId: issue.id, authorId: owner.id, body: "Delivered body" },
      });
      const work = await prisma.integrationSyncWork.create({
        data: {
          bindingId: binding.id,
          entityType: "comment",
          entityId: local.id,
          direction: "outbound",
          operation: "create",
          dedupeKey: `unproven-comment-echo-${proof}`,
          laneKey: issue.id,
          actorKey: `member:${owner.id}`,
          actorKind: "user",
          payload: { version: 1, issueId: issue.id, parentRefId: ref.id, parentRemoteIssueId: "100", ...payloadOverride },
          correlationId: local.id,
          epoch: binding.lifecycleEpoch,
          refId: null,
          marker,
          state,
        },
      });
      if (proof === "open conflict") {
        await prisma.integrationConflict.create({
          data: { kind: "outbound-create-ambiguity", bindingId: binding.id, workId: work.id, localEvidence: {}, remoteEvidence: {} },
        });
      }
      const observedAt = new Date("2026-08-01T10:01:00.000Z");
      const setup = dependencies([change(observedAt, "review")]);
      setup.loadIssueDetail.mockResolvedValue({
        ...detailChange(observedAt, { identity: { type: "issue", remoteId: "100", remoteProjectId: "41" } }),
        comments: [markedJournal(observedAt)],
      });

      await runInboundSyncCycle(prisma, setup);

      await expect(prisma.comment.count({ where: { issueId: issue.id } })).resolves.toBe(2);
      await expect(
        prisma.externalRef.findUniqueOrThrow({
          where: { connectionId_entityType_externalId: { connectionId: connection.id, entityType: "comment", externalId: "902" } },
        }),
      ).resolves.toMatchObject({ entityId: expect.not.stringMatching(commentUuid) });
      await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({ state });
    },
  );

  it("does not attach a copied marker without its matching outbound work", async () => {
    const { owner, binding, connection, issue } = await fixture();
    await prisma.comment.create({
      data: { id: commentUuid, issueId: issue.id, authorId: owner.id, body: "Original local comment" },
    });
    const observedAt = new Date("2026-08-01T10:01:00.000Z");
    const setup = dependencies([change(observedAt, "review")]);
    setup.loadIssueDetail.mockResolvedValue({
      ...detailChange(observedAt, { identity: { type: "issue", remoteId: "100", remoteProjectId: "41" } }),
      comments: [markedJournal(observedAt)],
    });

    await runInboundSyncCycle(prisma, setup);

    await expect(
      prisma.externalRef.findFirst({ where: { connectionId: connection.id, entityType: "comment", entityId: commentUuid } }),
    ).resolves.toBeNull();
    await expect(prisma.comment.count({ where: { issueId: issue.id } })).resolves.toBe(2);
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({ where: { bindingId: binding.id, remoteId: "902" } }),
    ).resolves.toMatchObject({ workId: null, outcome: { provenance: "redmine-inbound" } });
  });
});
