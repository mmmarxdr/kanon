import { randomUUID } from "node:crypto";
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
import { proveExternalRefBindings } from "./backfill.js";
import { retryRedmineIssueImport } from "./inbound.js";
import { RedmineHttpError } from "./providers/redmine/http-client.js";

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
    if (path.startsWith("/issues.json?")) {
      return typeof list === "function" ? list(path) : list;
    }
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

function fullPreview(
  connectionId: string,
  bindingId: string,
  userId: string,
  dependencies: RedmineImportDependencies,
) {
  return previewRedmineIssueImport(connectionId, bindingId, userId, dependencies, "full");
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

async function setImportLifecycle(
  connectionId: string,
  bindingId: string,
  lifecycle: "active" | "paused",
) {
  await prisma.integrationConnection.update({ where: { id: connectionId }, data: { lifecycle } });
  await prisma.integrationProjectBinding.update({ where: { id: bindingId }, data: { lifecycle } });
}

async function preImportConflict(bindingId: string, remoteId = "42") {
  await prisma.integrationProjectBinding.update({
    where: { id: bindingId },
    data: { inboundEnabled: true, bootstrapState: "ready", bootstrapCutoff: cutoff },
  });
  const application = await prisma.integrationInboundApplication.create({
    data: {
      bindingId,
      remoteEntityType: "issue",
      remoteId,
      remoteUpdatedAt: new Date("2026-08-02T10:30:00.000Z"),
      sourceVersion: "sha256:failed-observation",
      applicationKey: `failed-${bindingId}-${remoteId}`,
      correlationId: `failed-${bindingId}-${remoteId}`,
      state: "conflict",
      outcome: { reason: "INBOUND_OBSERVATION_FAILED" },
    },
  });
  const conflict = await prisma.integrationConflict.create({
    data: {
      kind: "inbound-observation-failure",
      bindingId,
      applicationId: application.id,
      localEvidence: { refId: null },
      remoteEvidence: { provider: "redmine", remoteIssueId: remoteId },
    },
  });
  return { application, conflict };
}

describe("Redmine-created issue import", () => {
  beforeEach(cleanDatabase);
  afterAll(disconnectTestDb);

  it("previews full history without retaining private or provider content", async () => {
    const { owner, connection, binding } = await fixture({});
    await setImportLifecycle(connection.id, binding.id, "paused");
    const visible = redmineIssue({ status: { id: 9, name: "Unmapped" } });
    const hidden = redmineIssue({
      id: 43,
      subject: "Private subject",
      description: "Private body",
      is_private: true,
      updated_on: "2026-08-02T10:31:00Z",
    });
    const historical = redmineIssue({
      id: 44,
      assigned_to: null,
      status: { id: 5, name: "Closed" },
      updated_on: "2026-08-02T10:32:00Z",
      closed_on: "2026-08-02T10:00:00Z",
    });
    const transport = remote({
      issues: [visible, hidden, historical],
      total_count: 3,
      offset: 0,
      limit: 100,
    });

    const preview = await fullPreview(connection.id, binding.id, owner.userId, transport.dependencies);

    expect(preview).toMatchObject({
      cutoff,
      eligibleUnlinkedCount: 2,
      excludedPrivateCount: 1,
      linkedCount: 0,
      mappingGaps: { statusIds: ["5", "9"], priorityIds: [], assigneeRemoteUserIds: ["6"] },
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
      version: 2,
      previewIdentity: expect.any(String),
      mode: "full",
      scopeFingerprint: expect.stringMatching(/^sha256:/),
      cutoff: cutoff.toISOString(),
      complete: true,
      scannedCount: 3,
      remainingCount: 0,
      checkpoint: { remoteId: "44", pageToken: null },
      candidates: [
        { remoteId: "42", sourceVersion: expect.stringMatching(/^sha256:/) },
        { remoteId: "44", sourceVersion: expect.stringMatching(/^sha256:/) },
      ],
      assigneeRemoteIds: ["6"],
    });
    expect(JSON.stringify(stored.bootstrapPageToken)).not.toMatch(
      /Private subject|Private body|Imported issue|Imported description/,
    );
  });

  it("records a stable checkpoint without candidates in future-only mode", async () => {
    const { owner, connection, binding } = await fixture();
    await setImportLifecycle(connection.id, binding.id, "paused");
    const transport = remote({
      issues: [redmineIssue()],
      total_count: 1,
      offset: 0,
      limit: 100,
    });

    await expect(
      previewRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
        "future_only",
      ),
    ).resolves.toMatchObject({
      cutoff,
      mode: "future_only",
      complete: true,
      scannedCount: 1,
      remainingCount: 0,
      eligibleUnlinkedCount: 0,
      checkpoint: { remoteId: "42", pageToken: null },
    });
    const stored = await prisma.integrationProjectBinding.findUniqueOrThrow({
      where: { id: binding.id },
    });
    expect(stored.bootstrapState).toBe("previewed");
    expect(stored.bootstrapPageToken).toMatchObject({
      version: 2,
      mode: "future_only",
      cutoff: cutoff.toISOString(),
      candidates: [],
      checkpoint: { remoteId: "42", pageToken: null },
    });
  });

  it("resumes preview and activation beyond the first 100 issues", async () => {
    const { owner, project, connection, binding } = await fixture();
    await setImportLifecycle(connection.id, binding.id, "paused");
    const issues = Array.from({ length: 100 }, (_, index) =>
      redmineIssue({
        id: index + 1,
        assigned_to: null,
        updated_on: `2026-08-02T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(
          index % 60,
        ).padStart(2, "0")}Z`,
      }),
    );
    const last = redmineIssue({
      id: 101,
      assigned_to: null,
      updated_on: "2026-08-02T10:01:40Z",
    });
    const allIssues = [...issues, last];
    const transport = remote(
      (path) =>
        path.includes("offset=100")
          ? { issues: [last], total_count: 101, offset: 100, limit: 100 }
          : { issues, total_count: 101, offset: 0, limit: 100 },
      Object.fromEntries(
        allIssues.map((issue) => [String(issue.id), { issue: { ...issue, journals: [] } }]),
      ),
    );

    await expect(
      fullPreview(connection.id, binding.id, owner.userId, transport.dependencies),
    ).resolves.toMatchObject({ eligibleUnlinkedCount: 100 });

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

    await expect(
      fullPreview(connection.id, binding.id, owner.userId, transport.dependencies),
    ).resolves.toMatchObject({ eligibleUnlinkedCount: 101 });
    const completed = await prisma.integrationProjectBinding.findUniqueOrThrow({
      where: { id: binding.id },
    });
    expect(completed).toMatchObject({ bootstrapState: "previewed", bootstrapFence: 2 });
    expect(completed.bootstrapPageToken).toMatchObject({
      complete: true,
      nextOffset: 101,
      scannedCount: 101,
      checkpoint: { remoteId: "101", pageToken: null },
    });
    await setImportLifecycle(connection.id, binding.id, "active");

    const batches = [];
    while (batches.length < 20) {
      const batch = await activateRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      );
      batches.push(batch);
      if (batch.complete) break;
    }
    expect(batches.at(-1)?.complete).toBe(true);
    expect(batches).toHaveLength(11);
    expect(batches.reduce((total, batch) => total + batch.importedCount, 0)).toBe(101);
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(101);
    await expect(
      prisma.integrationInboundApplication.count({ where: { bindingId: binding.id } }),
    ).resolves.toBe(101);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      inboundEnabled: true,
      bootstrapState: "ready",
      bootstrapPageToken: null,
      cursorRemoteId: "101",
    });
  });

  it("restarts a resumed preview after Redmine pagination drift", async () => {
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
    let firstPage = true;
    const transport = remote((path) => {
      if (path.includes("offset=100")) {
        return { issues: [], total_count: 100, offset: 100, limit: 100 };
      }
      if (firstPage) {
        firstPage = false;
        return { issues, total_count: 101, offset: 0, limit: 100 };
      }
      return { issues: [], total_count: 0, offset: 0, limit: 100 };
    });

    await expect(
      previewRedmineIssueImport(connection.id, binding.id, owner.userId, transport.dependencies),
    ).rejects.toMatchObject({ code: "REDMINE_IMPORT_LIMIT" });
    await expect(
      previewRedmineIssueImport(connection.id, binding.id, owner.userId, transport.dependencies),
    ).rejects.toMatchObject({ code: "REDMINE_PREVIEW_STALE" });

    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      bootstrapState: "pending",
      bootstrapCutoff: cutoff,
      bootstrapPageToken: expect.objectContaining({ nextOffset: 0, scannedCount: 0 }),
      bootstrapLeaseToken: null,
      bootstrapLeaseUntil: null,
    });
    await expect(
      previewRedmineIssueImport(connection.id, binding.id, owner.userId, transport.dependencies),
    ).resolves.toMatchObject({ cutoff, eligibleUnlinkedCount: 0 });
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
      fullPreview(
        first.connection.id,
        first.binding.id,
        first.owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REDMINE_PREVIEW_LIFECYCLE" });

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
    await expect(
      previewRedmineIssueImport(
        first.connection.id,
        first.binding.id,
        first.owner.userId,
        { ...transport.dependencies, workspaceId: second.workspace.id },
      ),
    ).rejects.toMatchObject({ code: "INTEGRATION_NOT_FOUND" });

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

  it("rejects resume when a relevant assignee mapping changes", async () => {
    const { owner, assignee, connection, binding } = await fixture();
    await setImportLifecycle(connection.id, binding.id, "paused");
    const issues = Array.from({ length: 100 }, (_, index) => redmineIssue({ id: index + 1 }));
    const transport = remote({ issues, total_count: 101, offset: 0, limit: 100 });

    await expect(
      fullPreview(connection.id, binding.id, owner.userId, transport.dependencies),
    ).resolves.toMatchObject({ complete: false, scannedCount: 100, remainingCount: 1 });
    await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: binding.id,
        remoteUserId: "6",
        remoteLogin: "grace",
        remoteDisplayName: "Grace Hopper",
        memberId: assignee.id,
      },
    });

    await expect(
      fullPreview(connection.id, binding.id, owner.userId, transport.dependencies),
    ).rejects.toMatchObject({ code: "REDMINE_PREVIEW_STALE" });
    expect(transport.get).toHaveBeenCalledTimes(1);
  });

  it("rejects final evidence when the read map changes during provider I/O", async () => {
    const { owner, connection, binding } = await fixture();
    await setImportLifecycle(connection.id, binding.id, "paused");
    const transport = remote(async () => {
      await prisma.integrationProjectBinding.update({
        where: { id: binding.id },
        data: { readMap: { "2": "done", "priority:3": "high" } },
      });
      return { issues: [redmineIssue()], total_count: 1, offset: 0, limit: 100 };
    });

    await expect(
      fullPreview(connection.id, binding.id, owner.userId, transport.dependencies),
    ).rejects.toMatchObject({ code: "REDMINE_PREVIEW_STALE" });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ bootstrapState: "pending", bootstrapLeaseToken: null });
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

  it("keeps pending issue deletion claimable until finalization before preview", async () => {
    const { owner, project, connection, credential, binding } = await fixture();
    const issueId = randomUUID();
    const ref = await prisma.externalRef.create({
      data: {
        connectionId: connection.id,
        bindingId: binding.id,
        entityType: "issue",
        entityId: issueId,
        externalId: "pending-delete-42",
      },
    });
    const work = await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "issue",
        entityId: issueId,
        direction: "outbound",
        operation: "delete",
        dedupeKey: randomUUID(),
        laneKey: `issue:${issueId}`,
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: {
          version: 1,
          refId: ref.id,
          externalId: ref.externalId,
          issueKey: `${project.key}-1`,
        },
        correlationId: randomUUID(),
        authCredentialId: credential.id,
        refId: ref.id,
        epoch: binding.lifecycleEpoch,
      },
    });
    const transport = remote({ issues: [], total_count: 0, offset: 0, limit: 100 });
    const before = await prisma.integrationProjectBinding.findUniqueOrThrow({
      where: { id: binding.id },
    });

    await expect(
      previewRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "REMOTE_DELETE_IN_PROGRESS" });
    expect(transport.get).not.toHaveBeenCalled();
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      bootstrapState: before.bootstrapState,
      bootstrapCutoff: before.bootstrapCutoff,
      bootstrapPageToken: before.bootstrapPageToken,
      bootstrapLeaseToken: before.bootstrapLeaseToken,
      bootstrapLeaseUntil: before.bootstrapLeaseUntil,
      bootstrapFence: before.bootstrapFence,
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({
      state: "queued",
      attempts: 0,
      epoch: binding.lifecycleEpoch,
      authCredentialId: credential.id,
      refId: ref.id,
    });
    await expect(proveExternalRefBindings(prisma)).resolves.toBeUndefined();

    await prisma.$transaction([
      prisma.integrationSyncWork.update({
        where: { id: work.id },
        data: { state: "done" },
      }),
      prisma.externalRef.delete({ where: { id: ref.id } }),
    ]);
    await expect(proveExternalRefBindings(prisma)).resolves.toBeUndefined();
    await expect(
      previewRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).resolves.toMatchObject({ eligibleUnlinkedCount: 0 });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ bootstrapState: "previewed", bootstrapFence: 1 });
  });

  it("ignores unsettled outbound work from a superseded lifecycle epoch", async () => {
    const { owner, project, connection, binding } = await fixture();
    await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "project",
        entityId: project.id,
        direction: "outbound",
        operation: "update",
        dedupeKey: `stale-ambiguous-${binding.id}`,
        laneKey: `project-${binding.id}`,
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: {},
        correlationId: `stale-ambiguous-${binding.id}`,
        state: "ambiguous",
        epoch: binding.lifecycleEpoch - 1,
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
    ).resolves.toMatchObject({ eligibleUnlinkedCount: 0 });
    expect(transport.get).toHaveBeenCalled();
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
      updated_on: "2026-08-04T12:00:00Z",
      closed_on: "2026-08-04T12:00:00Z",
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

    expect(activated).toEqual({
      importedCount: 1,
      issueKeys: [`${project.key}-1`],
      replayed: false,
      complete: true,
    });
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
      completedAt: cutoff,
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
      remoteUpdatedAt: cutoff,
      localVersion: 1n,
      metadata: {
        remoteVersion: expect.stringMatching(/^sha256:/),
        baseline: expect.objectContaining({
          version: 1,
          completedAt: cutoff.toISOString(),
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
    const remoteVersion = (ref.metadata as { remoteVersion: string }).remoteVersion;
    await expect(
      prisma.integrationContentProvenance.findMany({
        where: { bindingId: binding.id, entityType: "issue", entityId: imported.id },
        orderBy: { field: "asc" },
        select: { field: true, origin: true, sourceVersion: true, contentHash: true },
      }),
    ).resolves.toEqual([
      {
        field: "description",
        origin: "redmine",
        sourceVersion: remoteVersion,
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      {
        field: "title",
        origin: "redmine",
        sourceVersion: remoteVersion,
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    ]);
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
      cursorUpdatedAt: cutoff,
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
    ).resolves.toEqual({ importedCount: 0, issueKeys: [], replayed: false, complete: true });
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

  it("requires legacy bindings to configure priority maps before activation", async () => {
    const { owner, connection, binding } = await fixture();
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { readMap: { "2": "in_progress" } },
    });
    const transport = remote({ issues: [], total_count: 0, offset: 0, limit: 100 });
    await previewRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );
    transport.get.mockClear();

    await expect(
      activateRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REDMINE_PRIORITY_UNMAPPED" });
    expect(transport.get).not.toHaveBeenCalled();

    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { readMap: { "2": "in_progress", "priority:3": "high" } },
    });
    await expect(
      activateRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).resolves.toEqual({ importedCount: 0, issueKeys: [], replayed: false, complete: true });
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

    const concurrent = await Promise.allSettled([
      activateRedmineIssueImport(connection.id, binding.id, owner.userId, transport.dependencies),
      activateRedmineIssueImport(connection.id, binding.id, owner.userId, transport.dependencies),
    ]);
    const replay = await activateRedmineIssueImport(
      connection.id,
      binding.id,
      owner.userId,
      transport.dependencies,
    );

    const fulfilled = concurrent
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof activateRedmineIssueImport>>> => result.status === "fulfilled")
      .map((result) => result.value);
    expect(fulfilled.some((result) => result.importedCount === 1)).toBe(true);
    for (const result of concurrent) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "REDMINE_IMPORT_IN_PROGRESS" });
      }
    }
    expect(replay).toEqual({ importedCount: 0, issueKeys: [], replayed: true, complete: true });
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
      ).resolves.toMatchObject({ inboundEnabled: false, bootstrapState: "bootstrapping" });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "issues" DROP CONSTRAINT IF EXISTS "test_redmine_import_rollback"',
      );
    }

    await expect(
      activateRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).resolves.toMatchObject({ importedCount: 1, complete: true });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
  });

  it("restarts preview when an activation candidate was deleted remotely", async () => {
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

    await expect(
      activateRedmineIssueImport(connection.id, binding.id, owner.userId, {
        ...transport.dependencies,
        client: () => ({
          get: async <T>() => {
            throw new RedmineHttpError(404);
          },
        }),
      }),
    ).rejects.toMatchObject({ code: "REDMINE_PREVIEW_STALE" });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      inboundEnabled: false,
      bootstrapState: "pending",
      bootstrapPageToken: expect.objectContaining({ nextOffset: 0, candidates: [] }),
      bootstrapLeaseToken: null,
      bootstrapLeaseUntil: null,
    });

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
    ).resolves.toMatchObject({ importedCount: 1, complete: true });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
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
    ).resolves.toMatchObject({ inboundEnabled: false, bootstrapState: "bootstrapping" });

    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { readMap: { "9": "in_progress", "priority:3": "high" } },
    });
    await expect(
      activateRedmineIssueImport(
        connection.id,
        binding.id,
        owner.userId,
        transport.dependencies,
      ),
    ).resolves.toMatchObject({ importedCount: 1, complete: true });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
  });

  it("refetches current detail and applies the same pre-import application", async () => {
    const { owner, project, connection, binding } = await fixture({});
    const { application, conflict } = await preImportConflict(binding.id);
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: {
        readMap: { "2": "in_progress", "priority:3": "high" },
        lifecycleEpoch: { increment: 1 },
      },
    });
    const current = redmineIssue({
      subject: "Current remote title",
      assigned_to: null,
      updated_on: "2026-08-03T11:00:00Z",
    });
    const transport = remote({}, {
      "42": {
        issue: {
          ...current,
          journals: [
            {
              id: 90,
              user: { id: 8, name: "Remote reviewer" },
              notes: "Current public comment",
              private_notes: false,
              created_on: "2026-08-02T10:00:00Z",
              updated_on: "2026-08-02T10:05:00Z",
              details: [],
            },
          ],
        },
      },
    });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).resolves.toEqual({ applicationId: application.id, state: "applied", issueKey: `${project.key}-1` });

    expect(transport.get).toHaveBeenCalledWith("/issues/42.json?include=journals");
    await expect(prisma.issue.findFirstOrThrow({ where: { projectId: project.id } })).resolves.toMatchObject({
      title: "Current remote title",
    });
    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({
      id: application.id,
      state: "applied",
      refId: expect.any(String),
      workId: expect.any(String),
      leaseToken: null,
      leaseUntil: null,
    });
    const completed = await prisma.integrationInboundApplication.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(completed.sourceVersion).toMatch(/^sha256:/);
    expect(completed.sourceVersion).not.toBe(application.sourceVersion);
    expect(completed.applicationKey).not.toBe(application.applicationKey);
    expect(completed.correlationId).toBe(completed.applicationKey);
    expect(completed.remoteUpdatedAt).toEqual(new Date("2026-08-03T11:00:00.000Z"));
    await expect(
      prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } }),
    ).resolves.toMatchObject({ state: "resolved" });
    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "INBOUND_APPLICATION_NOT_RETRYABLE" });
    expect(transport.get).toHaveBeenCalledTimes(1);
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
    await expect(
      prisma.externalRef.count({ where: { bindingId: binding.id, entityType: "issue" } }),
    ).resolves.toBe(1);
    await expect(prisma.comment.findFirstOrThrow()).resolves.toMatchObject({
      body: "Current public comment",
      source: "system",
      via: "redmine-inbound",
    });
    await expect(
      prisma.externalRef.findFirstOrThrow({ where: { bindingId: binding.id, entityType: "comment" } }),
    ).resolves.toMatchObject({ externalId: "90" });
    await expect(
      prisma.integrationInboundApplication.count({
        where: { bindingId: binding.id, remoteEntityType: "issue" },
      }),
    ).resolves.toBe(1);
  });

  it("keeps pre-activation closed history skipped during conflict retry", async () => {
    const { owner, project, connection, binding } = await fixture({ "5": "review" });
    const { application, conflict } = await preImportConflict(binding.id);
    const historical = redmineIssue({
      status: { id: 5, name: "Closed" },
      assigned_to: null,
      done_ratio: 100,
      updated_on: "2026-08-03T11:00:00Z",
      closed_on: "2026-08-03T10:45:00Z",
    });
    const transport = remote({}, { "42": { issue: { ...historical, journals: [] } } });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).resolves.toEqual({ applicationId: application.id, state: "skipped", issueKey: null });
    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({
      state: "skipped",
      outcome: expect.objectContaining({ reason: "pre-activation-closed-history" }),
      refId: null,
      workId: null,
    });
    await expect(
      prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } }),
    ).resolves.toMatchObject({ state: "resolved" });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it("keeps a retry conflict open when the binding cutoff is missing", async () => {
    const { owner, project, connection, binding } = await fixture();
    const { application, conflict } = await preImportConflict(binding.id);
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { bootstrapCutoff: null },
    });
    const current = redmineIssue({ assigned_to: null, updated_on: "2026-08-03T11:00:00Z" });
    const transport = remote({}, { "42": { issue: { ...current, journals: [] } } });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REDMINE_BOOTSTRAP_CUTOFF_MISSING" });
    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({ state: "conflict", leaseToken: null, leaseUntil: null });
    await expect(
      prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } }),
    ).resolves.toMatchObject({ state: "open" });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it("keeps the same application retryable after a current decoder failure", async () => {
    const { owner, project, connection, binding } = await fixture();
    const { application, conflict } = await preImportConflict(binding.id);
    const malformed = remote({}, { "42": { issue: { id: 42, subject: "do-not-store" } } });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        malformed.dependencies,
      ),
    ).rejects.toMatchObject({ code: "INBOUND_RETRY_CONFLICT" });

    const retainedApplication = await prisma.integrationInboundApplication.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(retainedApplication).toMatchObject({
      state: "conflict",
      fence: 1,
      leaseToken: null,
      leaseUntil: null,
      refId: null,
    });
    const retained = await prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } });
    expect(retained.state).toBe("open");
    expect(
      JSON.stringify([
        retainedApplication.outcome,
        retained.remoteEvidence,
        retained.localEvidence,
      ]),
    ).not.toContain("do-not-store");
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(0);

    const current = redmineIssue({ subject: "Decoded after deploy", assigned_to: null });
    const repaired = remote({}, { "42": { issue: { ...current, journals: [] } } });
    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        repaired.dependencies,
      ),
    ).resolves.toMatchObject({ applicationId: application.id, state: "applied" });
    await expect(prisma.issue.findFirstOrThrow({ where: { projectId: project.id } })).resolves.toMatchObject({
      title: "Decoded after deploy",
    });
  });

  it("allows only workspace owners to retry a pre-import conflict", async () => {
    const { assignee, connection, binding } = await fixture();
    const { application } = await preImportConflict(binding.id);
    const transport = remote({}, { "42": { issue: { ...redmineIssue(), journals: [] } } });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        assignee.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(transport.get).not.toHaveBeenCalled();
    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({ state: "conflict", fence: 0, leaseToken: null });
  });

  it("rejects an owner token scoped away from the binding project before provider I/O", async () => {
    const { owner, workspace, connection, binding } = await fixture();
    const otherProject = await seedTestProject(workspace.id);
    const { application } = await preImportConflict(binding.id);
    const transport = remote({}, { "42": { issue: { ...redmineIssue(), journals: [] } } });

    await expect(
      retryRedmineIssueImport(connection.id, binding.id, application.id, owner.userId, {
        ...transport.dependencies,
        allowedProjectIds: [otherProject.id],
      }),
    ).rejects.toMatchObject({ code: "INTEGRATION_BINDING_NOT_FOUND" });

    expect(transport.get).not.toHaveBeenCalled();
    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({ state: "conflict", fence: 0, leaseToken: null });
  });

  it("fences concurrent retries before provider I/O can import twice", async () => {
    const { owner, project, connection, binding } = await fixture();
    const { application } = await preImportConflict(binding.id);
    let release!: (value: unknown) => void;
    const response = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const transport = remote({});
    transport.get.mockImplementation(() => response);

    const first = retryRedmineIssueImport(
      connection.id,
      binding.id,
      application.id,
      owner.userId,
      transport.dependencies,
    );
    await vi.waitFor(() => expect(transport.get).toHaveBeenCalledOnce());

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "INBOUND_APPLICATION_NOT_RETRYABLE" });

    release({ issue: { ...redmineIssue({ assigned_to: null }), journals: [] } });
    await expect(first).resolves.toMatchObject({ applicationId: application.id, state: "applied" });
    expect(transport.get).toHaveBeenCalledTimes(1);
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
    await expect(prisma.externalRef.count({ where: { bindingId: binding.id } })).resolves.toBe(1);
  });

  it("returns the same application to conflict when the binding changes during refetch", async () => {
    const { owner, project, connection, binding } = await fixture();
    const { application, conflict } = await preImportConflict(binding.id);
    const transport = remote({});
    transport.get.mockImplementation(async () => {
      await prisma.integrationProjectBinding.update({
        where: { id: binding.id },
        data: { lifecycleEpoch: { increment: 1 } },
      });
      return { issue: { ...redmineIssue({ assigned_to: null }), journals: [] } };
    });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "INBOUND_RETRY_FENCE_CHANGED" });

    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({ state: "conflict", fence: 1, leaseToken: null, leaseUntil: null });
    await expect(
      prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } }),
    ).resolves.toMatchObject({ state: "open" });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it("skips the same application when current remote policy excludes the issue", async () => {
    const { owner, project, connection, binding } = await fixture();
    const { application, conflict } = await preImportConflict(binding.id);
    const current = redmineIssue({ is_private: true, assigned_to: null });
    const transport = remote({}, { "42": { issue: { ...current, journals: [] } } });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).resolves.toEqual({ applicationId: application.id, state: "skipped", issueKey: null });

    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({
      state: "skipped",
      refId: null,
      workId: null,
      leaseToken: null,
      leaseUntil: null,
      outcome: { reason: "private-issue", provenance: "redmine-inbound-retry" },
    });
    await expect(
      prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } }),
    ).resolves.toMatchObject({ state: "resolved" });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it("keeps a marked remote issue conflicted while its outbound create is unsettled", async () => {
    const { owner, project, connection, binding } = await fixture();
    const { application } = await preImportConflict(binding.id);
    const local = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Original local issue",
        projectId: project.id,
      },
    });
    await prisma.integrationSyncWork.create({
      data: {
        bindingId: binding.id,
        entityType: "issue",
        entityId: local.id,
        direction: "outbound",
        operation: "create",
        dedupeKey: `create-${local.id}`,
        laneKey: local.id,
        actorKey: `member:${owner.id}`,
        actorKind: "user",
        payload: { version: 1, fields: { title: local.title } },
        correlationId: `create-${local.id}`,
        state: "ambiguous",
        availableAt: cutoff,
        epoch: binding.lifecycleEpoch,
      },
    });
    const current = redmineIssue({
      description: `Remote result\n\n<!-- kanon-issue:${local.id} -->`,
      assigned_to: null,
    });
    const transport = remote({}, { "42": { issue: { ...current, journals: [] } } });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "OUTBOUND_CREATE_UNSETTLED" });

    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({ state: "conflict", leaseToken: null, leaseUntil: null });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(1);
    await expect(prisma.externalRef.count({ where: { connectionId: connection.id } })).resolves.toBe(0);
  });

  it("rejects a current ref owned by another project binding", async () => {
    const { owner, workspace, project, connection, binding } = await fixture();
    const { application } = await preImportConflict(binding.id);
    const otherProject = await seedTestProject(workspace.id);
    const otherBinding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: otherProject.id,
        remoteProjectId: "8",
        readMap: { "2": "in_progress", "priority:3": "high" },
        writeMap: {},
        lifecycle: "active",
        lifecycleEpoch: 1,
      },
    });
    const otherIssue = await prisma.issue.create({
      data: {
        key: `${otherProject.key}-1`,
        sequenceNum: 1,
        title: "Other project issue",
        projectId: otherProject.id,
      },
    });
    await prisma.externalRef.create({
      data: {
        connectionId: connection.id,
        bindingId: otherBinding.id,
        entityType: "issue",
        entityId: otherIssue.id,
        externalId: "42",
      },
    });
    const transport = remote({}, {
      "42": { issue: { ...redmineIssue({ assigned_to: null }), journals: [] } },
    });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REFERENCE_BINDING_MISMATCH" });

    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({ state: "conflict", refId: null });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it("rejects detail older than the retained failed observation", async () => {
    const { owner, project, connection, binding } = await fixture();
    const { application } = await preImportConflict(binding.id);
    const stale = redmineIssue({
      assigned_to: null,
      updated_on: "2026-08-02T10:00:00Z",
    });
    const transport = remote({}, { "42": { issue: { ...stale, journals: [] } } });

    await expect(
      retryRedmineIssueImport(
        connection.id,
        binding.id,
        application.id,
        owner.userId,
        transport.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REDMINE_DETAIL_MISMATCH" });

    await expect(
      prisma.integrationInboundApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).resolves.toMatchObject({ state: "conflict", refId: null, leaseToken: null });
    await expect(prisma.issue.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });
});
