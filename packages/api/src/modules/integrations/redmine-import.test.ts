import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import {
  activateRedmineIssueImport,
  previewRedmineIssueImport,
  type RedmineImportDependencies,
} from "./redmine-import.js";

const cutoff = new Date("2026-08-04T12:00:00.000Z");

function redmineIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    project: { id: 7, name: "Delivery" },
    tracker: { id: 1, name: "Task" },
    status: { id: 2, name: "In progress" },
    priority: { id: 3, name: "High" },
    author: { id: 5, name: "Ada Lovelace", login: "ada" },
    assigned_to: { id: 6, name: "Grace Hopper", login: "grace" },
    subject: "Imported issue",
    description: "Imported description",
    start_date: "2026-08-01",
    due_date: "2026-08-15",
    done_ratio: 40,
    is_private: false,
    created_on: "2026-08-01T09:00:00Z",
    updated_on: "2026-08-02T10:30:00Z",
    closed_on: null,
    ...overrides,
  };
}

function remote(
  list: unknown,
  details: Readonly<Record<string, unknown>> = {},
): { dependencies: RedmineImportDependencies; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(async (path: string) => {
    if (path.startsWith("/issues.json?")) return list;
    const match = /^\/issues\/(\d+)\.json\?include=journals$/.exec(path);
    if (match?.[1] && details[match[1]]) return details[match[1]];
    throw new Error("Unexpected Redmine request");
  });
  return {
    get,
    dependencies: {
      now: () => cutoff,
      decrypt: () => "service-key",
      client: () => ({ get: <T>(path: string) => get(path) as Promise<T> }),
    },
  };
}

async function fixture(readMap: Record<string, string> = { "2": "in_progress" }) {
  const workspace = await seedTestWorkspace();
  const owner = await seedTestMemberWithRole(workspace.id, "owner");
  const assignee = await seedTestMemberWithRole(workspace.id, "member");
  const project = await seedTestProject(workspace.id);
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://redmine.example.test",
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
      externalUserId: "5",
      externalLogin: "ada",
      lastAuthStatus: "valid",
      lastValidatedAt: cutoff,
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
      remoteProjectId: "7",
      readMap: { "priority:3": "high", ...readMap },
      writeMap: {},
      lifecycle: "active",
      lifecycleEpoch: 1,
    },
  });
  return { workspace, owner, assignee, project, connection, credential, binding };
}

describe("Redmine-created issue import", () => {
  beforeEach(cleanDatabase);
  afterAll(disconnectTestDb);

  it("previews without local records, excludes private issues, and reports mapping gaps", async () => {
    const { owner, connection, binding } = await fixture({});
    const visible = redmineIssue({ status: { id: 9, name: "Unmapped" } });
    const hidden = redmineIssue({
      id: 43,
      subject: "Private subject",
      description: "Private body",
      is_private: true,
      updated_on: "2026-08-02T10:31:00Z",
    });
    const transport = remote({
      issues: [visible, hidden],
      total_count: 2,
      offset: 0,
      limit: 100,
    });

    const preview = await previewRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );

    expect(preview).toEqual({
      cutoff,
      eligibleUnlinkedCount: 1,
      excludedPrivateCount: 1,
      linkedCount: 0,
      mappingGaps: { statusIds: ["9"], priorityIds: [], assigneeRemoteUserIds: ["6"] },
    });
    await expect(prisma.issue.count()).resolves.toBe(0);
    await expect(prisma.externalRef.count()).resolves.toBe(0);
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
    const stored = await prisma.integrationProjectBinding.findUniqueOrThrow({
      where: { id: binding.id },
    });
    expect(stored).toMatchObject({
      inboundEnabled: false,
      bootstrapState: "previewed",
      bootstrapCutoff: cutoff,
      bootstrapFence: 1,
      bootstrapLeaseToken: null,
      bootstrapLeaseUntil: null,
    });
    expect(stored.bootstrapPageToken).toMatchObject({
      complete: true,
      scannedCount: 2,
      checkpoint: { remoteId: "43", pageToken: null },
      candidates: [{ remoteId: "42", sourceVersion: expect.stringMatching(/^sha256:/) }],
    });
    expect(JSON.stringify(stored.bootstrapPageToken)).not.toContain("Private subject");
    expect(JSON.stringify(stored.bootstrapPageToken)).not.toContain("Private body");
  });

  it("persists an incomplete checkpoint and never marks an over-cap preview complete", async () => {
    const { owner, connection, binding } = await fixture();
    const issues = Array.from({ length: 100 }, (_, index) =>
      redmineIssue({
        id: index + 1,
        assigned_to: null,
        updated_on: `2026-08-02T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(
          index % 60,
        ).padStart(2, "0")}Z`,
      }),
    );
    const transport = remote({ issues, total_count: 101, offset: 0, limit: 100 });

    await expect(
      previewRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REDMINE_IMPORT_LIMIT" });

    const stored = await prisma.integrationProjectBinding.findUniqueOrThrow({
      where: { id: binding.id },
    });
    expect(stored).toMatchObject({
      inboundEnabled: false,
      bootstrapState: "pending",
      bootstrapLeaseToken: null,
      bootstrapLeaseUntil: null,
    });
    expect(stored.bootstrapPageToken).toMatchObject({
      complete: false,
      nextOffset: 100,
      scannedCount: 100,
      checkpoint: { remoteId: "100", pageToken: expect.any(String) },
    });
    await expect(prisma.issue.count()).resolves.toBe(0);

    const retry = remote({ issues: [issues[0]], total_count: 1, offset: 0, limit: 100 });
    await expect(
      previewRedmineIssueImport(connection.id, binding.id, owner.userId, retry.dependencies),
    ).resolves.toMatchObject({ eligibleUnlinkedCount: 1 });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ bootstrapState: "previewed", bootstrapFence: 2 });
  });

  it("restarts a preview when persisted resume evidence is invalid", async () => {
    const { owner, connection, binding } = await fixture();
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: {
        bootstrapState: "pending",
        bootstrapCutoff: new Date("2026-08-03T12:00:00.000Z"),
        bootstrapPageToken: { version: 999 },
      },
    });
    const transport = remote({ issues: [], total_count: 0, offset: 0, limit: 100 });

    await expect(
      previewRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).resolves.toMatchObject({ cutoff, eligibleUnlinkedCount: 0 });
    expect(transport.get).toHaveBeenCalledWith(expect.stringContaining("offset=0"));
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ bootstrapState: "previewed", bootstrapCutoff: cutoff });
  });

  it("rejects non-owners, cross-connection bindings, inactive bindings, and invalid credentials", async () => {
    const first = await fixture();
    const second = await fixture();
    const member = await seedTestMemberWithRole(first.workspace.id, "member");
    const transport = remote({ issues: [], total_count: 0, offset: 0, limit: 100 });

    await expect(
      previewRedmineIssueImport(
        first.connection.id,
        first.binding.id,
        member.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      previewRedmineIssueImport(
        first.connection.id,
        second.binding.id,
        first.owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "INTEGRATION_BINDING_NOT_FOUND" });

    await prisma.integrationProjectBinding.update({
      where: { id: first.binding.id },
      data: { lifecycle: "paused" },
    });
    await expect(
      previewRedmineIssueImport(
        first.connection.id,
        first.binding.id,
        first.owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "INTEGRATION_NOT_ACTIVE" });

    await prisma.integrationProjectBinding.update({
      where: { id: first.binding.id },
      data: { lifecycle: "active" },
    });
    await prisma.memberIntegrationCredential.update({
      where: { id: first.credential.id },
      data: { lastAuthStatus: "invalid" },
    });
    await expect(
      previewRedmineIssueImport(
        first.connection.id,
        first.binding.id,
        first.owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "INTEGRATION_NOT_READY" });
    await prisma.memberIntegrationCredential.update({
      where: { id: first.credential.id },
      data: { lastAuthStatus: "valid" },
    });
    await expect(
      previewRedmineIssueImport(first.connection.id, first.binding.id, first.owner.userId, {
        ...transport.dependencies,
        decrypt: () => {
          throw new Error("invalid ciphertext");
        },
      }),
    ).rejects.toMatchObject({ code: "INTEGRATION_NOT_READY" });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: first.binding.id } }),
    ).resolves.toMatchObject({ bootstrapState: "pending", bootstrapLeaseToken: null });
    expect(transport.get).not.toHaveBeenCalled();
  });

  it("rejects preview while an outbound write may already have reached Redmine", async () => {
    const { owner, project, connection, binding } = await fixture();
    await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "project",
        entityId: project.id,
        direction: "outbound",
        operation: "update",
        dedupeKey: `leased-${binding.id}`,
        laneKey: `project-${binding.id}`,
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: {},
        correlationId: `leased-${binding.id}`,
        state: "leased",
        leaseToken: "in-flight",
        leaseUntil: new Date(cutoff.getTime() + 60_000),
        fence: 1,
        epoch: binding.lifecycleEpoch,
      },
    });
    const transport = remote({ issues: [], total_count: 0, offset: 0, limit: 100 });

    await expect(
      previewRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REDMINE_OUTBOUND_UNSETTLED" });
    expect(transport.get).not.toHaveBeenCalled();
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ bootstrapState: "not_required", bootstrapFence: 0 });
  });

  it("imports the preview atomically with identity, baseline, inbound work, and ready state", async () => {
    const { owner, assignee, project, connection, binding } = await fixture({ "5": "done" });
    await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: binding.id,
        remoteUserId: "6",
        remoteLogin: "grace",
        remoteDisplayName: "Grace Hopper",
        memberId: assignee.id,
      },
    });
    const issue = redmineIssue({
      status: { id: 5, name: "Closed" },
      done_ratio: 100,
      updated_on: "2026-08-03T11:00:00Z",
      closed_on: "2026-08-03T10:45:00Z",
    });
    const transport = remote(
      { issues: [issue], total_count: 1, offset: 0, limit: 100 },
      { "42": { issue: { ...issue, journals: [] } } },
    );
    await previewRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );

    const activated = await activateRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );

    expect(activated).toEqual({ importedCount: 1, issueKeys: [`${project.key}-1`], replayed: false });
    const imported = await prisma.issue.findFirstOrThrow({ where: { projectId: project.id } });
    expect(imported).toMatchObject({
      key: `${project.key}-1`,
      sequenceNum: 1,
      title: "Imported issue",
      description: "Imported description",
      state: "done",
      priority: "high",
      assigneeId: assignee.id,
      createdAt: new Date("2026-08-01T09:00:00Z"),
      completedAt: new Date("2026-08-03T10:45:00Z"),
    });
    await expect(
      prisma.issueSchedule.findUniqueOrThrow({ where: { issueId: imported.id } }),
    ).resolves.toMatchObject({
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      dueDate: new Date("2026-08-15T00:00:00.000Z"),
      progress: 100,
    });
    await expect(prisma.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({
      lastSequenceNum: 1,
    });
    const ref = await prisma.externalRef.findFirstOrThrow({ where: { entityId: imported.id } });
    expect(ref).toMatchObject({
      bindingId: binding.id,
      externalId: "42",
      remoteUpdatedAt: new Date("2026-08-03T11:00:00Z"),
      localVersion: 1n,
      metadata: {
        remoteVersion: expect.stringMatching(/^sha256:/),
        baseline: expect.objectContaining({
          version: 1,
          completedAt: "2026-08-03T10:45:00.000Z",
          fields: expect.objectContaining({
            state: "done",
            priority: "high",
            assigneeId: assignee.id,
          }),
        }),
      },
    });
    const work = await prisma.integrationSyncWork.findFirstOrThrow({ where: { entityId: imported.id } });
    expect(work).toMatchObject({
      bindingId: binding.id,
      direction: "inbound",
      operation: "create",
      actorKind: "remote",
      state: "done",
      refId: ref.id,
    });
    await expect(
      prisma.integrationSyncWork.count({ where: { entityId: imported.id, direction: "outbound" } }),
    ).resolves.toBe(0);
    await expect(
      prisma.integrationInboundApplication.findFirstOrThrow({ where: { refId: ref.id } }),
    ).resolves.toMatchObject({
      sourceVersion: expect.stringMatching(/^sha256:/),
      state: "applied",
      workId: work.id,
      applicationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(
      prisma.integrationExternalIdentity.findMany({
        where: { bindingId: binding.id },
        orderBy: { remoteUserId: "asc" },
        select: { remoteUserId: true, memberId: true, remoteLogin: true },
      }),
    ).resolves.toEqual([
      { remoteUserId: "5", memberId: null, remoteLogin: "ada" },
      { remoteUserId: "6", memberId: assignee.id, remoteLogin: "grace" },
    ]);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      inboundEnabled: true,
      bootstrapState: "ready",
      bootstrapCutoff: cutoff,
      bootstrapPageToken: null,
      bootstrapLeaseToken: null,
      bootstrapLeaseUntil: null,
      cursorUpdatedAt: new Date("2026-08-03T11:00:00Z"),
      cursorRemoteId: "42",
      pageToken: null,
      auditCursorRemoteId: "42",
      auditCompletedAt: cutoff,
    });
  });

  it("activates an empty preview without creating records", async () => {
    const { owner, project, connection, binding } = await fixture();
    const transport = remote({ issues: [], total_count: 0, offset: 0, limit: 100 });
    await previewRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );

    await expect(
      activateRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).resolves.toEqual({ importedCount: 0, issueKeys: [], replayed: false });
    await expect(prisma.issue.count()).resolves.toBe(0);
    await expect(prisma.externalRef.count()).resolves.toBe(0);
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
    await expect(prisma.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({
      lastSequenceNum: 0,
    });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      inboundEnabled: true,
      bootstrapState: "ready",
      cursorUpdatedAt: new Date(0),
      cursorRemoteId: "1",
      auditCursorRemoteId: null,
      auditCompletedAt: cutoff,
    });
  });

  it("serializes concurrent activation and replays without duplicate rows or keys", async () => {
    const { owner, project, connection, binding } = await fixture();
    const issue = redmineIssue();
    const transport = remote(
      { issues: [issue], total_count: 1, offset: 0, limit: 100 },
      { "42": { issue: { ...issue, journals: [] } } },
    );
    await previewRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );

    const concurrent = await Promise.all([
      activateRedmineIssueImport(connection.id, binding.id, owner.userId, transport.dependencies),
      activateRedmineIssueImport(connection.id, binding.id, owner.userId, transport.dependencies),
    ]);
    const replay = await activateRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );

    expect(concurrent.map((result) => result.importedCount).sort()).toEqual([0, 1]);
    expect(replay).toEqual({ importedCount: 0, issueKeys: [], replayed: true });
    await expect(prisma.issue.count()).resolves.toBe(1);
    await expect(prisma.externalRef.count()).resolves.toBe(1);
    await expect(prisma.integrationInboundApplication.count()).resolves.toBe(1);
    await expect(prisma.integrationSyncWork.count()).resolves.toBe(1);
    await expect(prisma.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({
      lastSequenceNum: 1,
    });
  });

  it("keeps the preview resumable and rolls back the key on a write failure", async () => {
    const { owner, project, connection, binding } = await fixture();
    const issue = redmineIssue({ subject: "force-import-rollback" });
    const transport = remote(
      { issues: [issue], total_count: 1, offset: 0, limit: 100 },
      { "42": { issue: { ...issue, journals: [] } } },
    );
    await previewRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "issues" ADD CONSTRAINT "test_redmine_import_rollback" CHECK ("title" <> \'force-import-rollback\')',
    );

    try {
      await expect(
        activateRedmineIssueImport(
          connection.id,
          binding.id,
          owner.userId,
          transport.dependencies,
        ),
      ).rejects.toThrow();

      await expect(prisma.issue.count()).resolves.toBe(0);
      await expect(prisma.externalRef.count()).resolves.toBe(0);
      await expect(prisma.integrationInboundApplication.count()).resolves.toBe(0);
      await expect(prisma.integrationSyncWork.count()).resolves.toBe(0);
      await expect(
        prisma.project.findUniqueOrThrow({ where: { id: project.id } }),
      ).resolves.toMatchObject({ lastSequenceNum: 0 });
      await expect(
        prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
      ).resolves.toMatchObject({ inboundEnabled: false, bootstrapState: "previewed" });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "issues" DROP CONSTRAINT IF EXISTS "test_redmine_import_rollback"',
      );
    }
  });

  it("rejects an unmapped status before transaction writes", async () => {
    const { owner, project, connection, binding } = await fixture({});
    const issue = redmineIssue({ status: { id: 9, name: "Unmapped" } });
    const transport = remote(
      { issues: [issue], total_count: 1, offset: 0, limit: 100 },
      { "42": { issue: { ...issue, journals: [] } } },
    );
    await previewRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );

    await expect(
      activateRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REDMINE_STATUS_UNMAPPED" });

    await expect(prisma.issue.count()).resolves.toBe(0);
    await expect(prisma.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({
      lastSequenceNum: 0,
    });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ inboundEnabled: false, bootstrapState: "previewed" });
  });
});
