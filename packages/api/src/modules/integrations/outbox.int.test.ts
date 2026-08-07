import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { createComment } from "../comment/service.js";
import {
  captureIntegrationWorkTx,
  createIntegrationWorkLaneKey,
  scanIntegrationWork,
  type IntegrationWorkCapture,
} from "./outbox.js";

const concurrentPrisma = new PrismaClient();
const workspaceIds = new Set<string>();
const userIds = new Set<string>();

async function createFixture() {
  const workspace = await prisma.workspace.create({
    data: { name: "Outbox test workspace", slug: `outbox-${randomUUID()}` },
  });
  workspaceIds.add(workspace.id);

  const project = await prisma.project.create({
    data: {
      key: `O${randomUUID().slice(0, 5).toUpperCase()}`,
      name: "Outbox test project",
      workspaceId: workspace.id,
    },
  });
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://pm.example.test",
      workspaceId: workspace.id,
    },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: `remote-${randomUUID()}`,
      readMap: { "remote-open": "todo" },
      writeMap: { todo: "remote-open" },
    },
  });
  const issue = await prisma.issue.create({
    data: {
      key: `O-${randomUUID().slice(0, 8).toUpperCase()}`,
      sequenceNum: 1,
      title: "Outbox test issue",
      projectId: project.id,
    },
  });
  const externalRef = await prisma.externalRef.create({
    data: {
      entityType: "issue",
      entityId: issue.id,
      externalId: `remote-issue-${randomUUID()}`,
      connectionId: connection.id,
      bindingId: binding.id,
    },
  });

  return { workspace, project, connection, binding, issue, externalRef };
}

async function createCredential(workspaceId: string, connectionId: string) {
  const user = await prisma.user.create({
    data: { email: `outbox-${randomUUID()}@kanon.test`, passwordHash: "unused" },
  });
  userIds.add(user.id);
  const member = await prisma.member.create({
    data: {
      username: `outbox-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      workspaceId,
    },
  });
  return prisma.memberIntegrationCredential.create({
    data: { encryptedKey: "ciphertext", memberId: member.id, connectionId },
  });
}

async function createBoundaryFixtures(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const otherProject = await prisma.project.create({
    data: {
      key: `O${randomUUID().slice(0, 5).toUpperCase()}`,
      name: "Other outbox project",
      workspaceId: fixture.workspace.id,
    },
  });
  const otherConnection = await prisma.integrationConnection.create({
    data: {
      provider: "jira",
      baseUrl: "https://jira.example.test",
      workspaceId: fixture.workspace.id,
    },
  });
  const otherBinding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: otherConnection.id,
      projectId: fixture.project.id,
      remoteProjectId: `jira-${randomUUID()}`,
      readMap: { "remote-open": "todo" },
      writeMap: { todo: "remote-open" },
    },
  });
  const otherRef = await prisma.externalRef.create({
    data: {
      entityType: "issue",
      entityId: fixture.issue.id,
      externalId: `jira-issue-${randomUUID()}`,
      connectionId: otherConnection.id,
      bindingId: otherBinding.id,
    },
  });
  const otherConnectionCredential = await createCredential(
    fixture.workspace.id,
    otherConnection.id,
  );
  const foreignWorkspace = await prisma.workspace.create({
    data: { name: "Foreign outbox workspace", slug: `outbox-${randomUUID()}` },
  });
  workspaceIds.add(foreignWorkspace.id);
  const foreignCredential = await createCredential(foreignWorkspace.id, fixture.connection.id);
  return { otherProject, otherRef, otherConnectionCredential, foreignCredential };
}

function captureInTransaction(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Partial<IntegrationWorkCapture> = {},
) {
  return prisma.$transaction((transaction) =>
    captureIntegrationWorkTx(transaction, captureFor(fixture, overrides)),
  );
}

function captureFor(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Partial<IntegrationWorkCapture> = {},
): IntegrationWorkCapture {
  return {
    bindingId: fixture.binding.id,
    entityType: "issue",
    entityId: fixture.externalRef.entityId,
    direction: "outbound",
    operation: "update",
    actorKey: "member:actor-1",
    actorKind: "user",
    payload: { fields: ["title"], title: "Updated title" },
    correlationId: "mutation-correlation-1",
    refId: fixture.externalRef.id,
    ...overrides,
  };
}

afterEach(async () => {
  for (const workspaceId of workspaceIds) {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  }
  workspaceIds.clear();
  for (const userId of userIds) {
    await prisma.user.delete({ where: { id: userId } });
  }
  userIds.clear();
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), concurrentPrisma.$disconnect()]);
});

describe("integration outbox capture and scanner", () => {
  it("atomically captures a real linked comment with immutable dispatch proof", async () => {
    const fixture = await createFixture();
    const credential = await createCredential(fixture.workspace.id, fixture.connection.id);
    await Promise.all([
      prisma.integrationConnection.update({ where: { id: fixture.connection.id }, data: { lifecycle: "active" } }),
      prisma.integrationProjectBinding.update({ where: { id: fixture.binding.id }, data: { lifecycle: "active" } }),
      prisma.memberIntegrationCredential.update({
        where: { id: credential.id },
        data: { externalUserId: "5", lastAuthStatus: "valid", lastValidatedAt: new Date("2026-08-01T10:00:00Z") },
      }),
    ]);

    const comment = await createComment(fixture.issue.key, { body: "Ship atomically", source: "human" }, credential.memberId, null, true);
    const work = await prisma.integrationSyncWork.findFirstOrThrow({ where: { entityType: "comment", entityId: comment.id } });

    expect(work).toMatchObject({
      bindingId: fixture.binding.id, entityType: "comment", entityId: comment.id, operation: "create",
      authCredentialId: credential.id, refId: null, laneKey: createIntegrationWorkLaneKey(fixture.binding.id, "issue", fixture.issue.id),
      marker: `<!-- kanon-comment:${comment.id} -->`,
      payload: { version: 1, body: comment.body, bodySha256: createHash("sha256").update(comment.body).digest("hex"), commentUpdatedAt: comment.updatedAt.toISOString(), issueId: fixture.issue.id, parentRefId: fixture.externalRef.id, parentRemoteIssueId: fixture.externalRef.externalId, bindingEpoch: fixture.binding.lifecycleEpoch, credentialId: credential.id, credentialLastValidatedAt: "2026-08-01T10:00:00.000Z", credentialRemoteUserId: "5" },
    });
    await expect(prisma.activityLog.count({ where: { issueId: fixture.issue.id, details: { path: ["commentId"], equals: comment.id } } })).resolves.toBe(1);
  });

  it("captures comment ownership on the parent issue lane without storing the parent ref", async () => {
    const fixture = await createFixture();
    const credential = await createCredential(fixture.workspace.id, fixture.connection.id);
    const comment = await prisma.comment.create({
      data: { body: "Outbound", issueId: fixture.issue.id, authorId: credential.memberId },
    });
    const laneKey = createIntegrationWorkLaneKey(fixture.binding.id, "issue", fixture.issue.id);

    const work = await captureInTransaction(fixture, {
      entityType: "comment", entityId: comment.id, operation: "create", correlationId: comment.id,
      authCredentialId: credential.id, refId: null, laneKey, payload: { version: 1 },
    });

    expect(work).toMatchObject({ entityType: "comment", entityId: comment.id, laneKey, refId: null });
    await expect(captureInTransaction(fixture, {
      entityType: "comment", entityId: comment.id, operation: "create",
      correlationId: randomUUID(), refId: fixture.externalRef.id, payload: { version: 1 },
    })).rejects.toThrow(/reference/i);
  });

  it("captures one durable, idempotent lane item inside the caller transaction", async () => {
    const fixture = await createFixture();
    const credential = await createCredential(fixture.workspace.id, fixture.connection.id);
    const capture = captureFor(fixture, { authCredentialId: credential.id });

    const [first, duplicate] = await Promise.all([
      prisma.$transaction((transaction) => captureIntegrationWorkTx(transaction, capture)),
      concurrentPrisma.$transaction((transaction) =>
        captureIntegrationWorkTx(transaction, capture),
      ),
    ]);
    const next = await prisma.$transaction((transaction) =>
      captureIntegrationWorkTx(
        transaction,
        captureFor(fixture, {
          operation: "close",
          correlationId: "mutation-correlation-2",
          payload: { fields: ["state"], state: "done" },
        }),
      ),
    );

    expect(first).toMatchObject({
      bindingId: fixture.binding.id,
      entityType: "issue",
      entityId: fixture.externalRef.entityId,
      direction: "outbound",
      operation: "update",
      state: "queued",
      attempts: 0,
      fence: 0,
      actorKey: "member:actor-1",
      actorKind: "user",
      payload: capture.payload,
      correlationId: capture.correlationId,
      epoch: fixture.binding.lifecycleEpoch,
      refId: fixture.externalRef.id,
      authCredentialId: credential.id,
    });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.sequence).toBe(first.sequence);
    expect(duplicate.dedupeKey).toBe(first.dedupeKey);
    expect(next.id).not.toBe(first.id);
    expect(next.dedupeKey).not.toBe(first.dedupeKey);
    expect(next.laneKey).toBe(first.laneKey);
    expect(next.sequence).toBeGreaterThan(first.sequence);
    await expect(
      prisma.integrationSyncWork.count({ where: { bindingId: fixture.binding.id } }),
    ).resolves.toBe(2);
  });

  it("rolls back captured work with the enclosing domain transaction", async () => {
    const fixture = await createFixture();
    const capture = captureFor(fixture);

    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.project.update({
          where: { id: fixture.project.id },
          data: { name: "rolled back project" },
        });
        await captureIntegrationWorkTx(transaction, capture);
        throw new Error("rollback domain mutation");
      }),
    ).rejects.toThrow("rollback domain mutation");

    await expect(
      prisma.integrationSyncWork.findMany({ where: { bindingId: fixture.binding.id } }),
    ).resolves.toEqual([]);
    await expect(
      prisma.project.findUnique({ where: { id: fixture.project.id } }),
    ).resolves.toMatchObject({ name: "Outbox test project" });
  });

  it("accepts a local mutation correlation and rejects an unknown binding", async () => {
    const fixture = await createFixture();
    const { correlationId: _correlationId, ...captureBase } = captureFor(fixture);

    const captured = await prisma.$transaction((transaction) =>
      captureIntegrationWorkTx(transaction, {
        ...captureBase,
        localMutationCorrelationId: "local-mutation-correlation",
      }),
    );

    expect(captured.correlationId).toBe("local-mutation-correlation");
    await expect(
      prisma.$transaction((transaction) =>
        captureIntegrationWorkTx(transaction, {
          ...captureFor(fixture, { bindingId: randomUUID() }),
        }),
      ),
    ).rejects.toThrow("was not found");
  });

  it("rejects cross-project, cross-binding, cross-connection, and cross-tenant links", async () => {
    const fixture = await createFixture();
    const { otherProject, otherRef, otherConnectionCredential, foreignCredential } =
      await createBoundaryFixtures(fixture);

    const invalidCaptures: readonly [string, Partial<IntegrationWorkCapture>][] = [
      ["cross-project entity", { entityType: "project", entityId: otherProject.id, refId: null }],
      ["cross-binding reference", { refId: otherRef.id }],
      ["cross-connection credential", { authCredentialId: otherConnectionCredential.id }],
      ["cross-tenant credential", { authCredentialId: foreignCredential.id }],
    ];

    for (const [name, overrides] of invalidCaptures) {
      await expect(
        captureInTransaction(fixture, { ...overrides, correlationId: `invalid-${name}` }),
      ).rejects.toThrow();
    }

    await expect(
      prisma.integrationSyncWork.count({ where: { bindingId: fixture.binding.id } }),
    ).resolves.toBe(0);
  });

  it("derives the binding epoch and rejects stale or future caller epochs", async () => {
    const fixture = await createFixture();
    const binding = await prisma.integrationProjectBinding.update({
      where: { id: fixture.binding.id },
      data: { lifecycleEpoch: 7 },
    });

    for (const epoch of [6, 8]) {
      await expect(
        captureInTransaction(fixture, { epoch, correlationId: `${epoch}-epoch` }),
      ).rejects.toThrow("epoch");
    }
    await expect(
      prisma.integrationSyncWork.count({ where: { bindingId: binding.id } }),
    ).resolves.toBe(0);

    const derived = await captureInTransaction(fixture, { correlationId: "derived-epoch" });
    expect(derived.epoch).toBe(binding.lifecycleEpoch);
  });

  it("holds the binding epoch stable until the capture transaction commits", async () => {
    const fixture = await createFixture();
    let releaseCapture!: () => void;
    let markCaptured!: () => void;
    const holdCapture = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const captureStarted = new Promise<void>((resolve) => {
      markCaptured = resolve;
    });
    const capturePromise = prisma.$transaction(async (transaction) => {
      const work = await captureIntegrationWorkTx(
        transaction,
        captureFor(fixture, { correlationId: "stable-epoch" }),
      );
      markCaptured();
      await holdCapture;
      return work;
    });
    await captureStarted;

    let blockedError: unknown;
    try {
      await concurrentPrisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        await transaction.integrationProjectBinding.update({
          where: { id: fixture.binding.id },
          data: { lifecycleEpoch: fixture.binding.lifecycleEpoch + 1 },
        });
      });
    } catch (error) {
      blockedError = error;
    } finally {
      releaseCapture();
    }

    const captured = await capturePromise;
    expect(String(blockedError)).toContain("lock timeout");
    expect(captured.epoch).toBe(fixture.binding.lifecycleEpoch);
    await expect(
      concurrentPrisma.integrationProjectBinding.update({
        where: { id: fixture.binding.id },
        data: { lifecycleEpoch: fixture.binding.lifecycleEpoch + 1 },
      }),
    ).resolves.toMatchObject({ lifecycleEpoch: fixture.binding.lifecycleEpoch + 1 });
  });

  it("scans due queued and retry work in sequence without claiming or mutating it", async () => {
    const fixture = await createFixture();
    const now = new Date("2026-07-27T18:00:00.000Z");
    const due = await prisma.$transaction((transaction) =>
      captureIntegrationWorkTx(
        transaction,
        captureFor(fixture, {
          correlationId: "due-queued",
          availableAt: new Date("2026-07-27T17:59:00.000Z"),
        }),
      ),
    );
    const retry = await prisma.$transaction((transaction) =>
      captureIntegrationWorkTx(
        transaction,
        captureFor(fixture, {
          operation: "close",
          correlationId: "due-retry",
          availableAt: new Date("2026-07-27T17:58:00.000Z"),
        }),
      ),
    );
    await prisma.integrationSyncWork.update({
      where: { id: retry.id },
      data: { state: "retry" },
    });
    const future = await prisma.$transaction((transaction) =>
      captureIntegrationWorkTx(
        transaction,
        captureFor(fixture, {
          operation: "delete",
          correlationId: "future",
          availableAt: new Date("2026-07-27T18:01:00.000Z"),
        }),
      ),
    );
    const leased = await prisma.$transaction((transaction) =>
      captureIntegrationWorkTx(
        transaction,
        captureFor(fixture, {
          operation: "create",
          correlationId: "leased",
          availableAt: new Date("2026-07-27T17:57:00.000Z"),
        }),
      ),
    );
    await prisma.integrationSyncWork.update({
      where: { id: leased.id },
      data: { state: "leased", leaseToken: "lease-1", leaseUntil: new Date("2026-07-27T18:05:00.000Z") },
    });

    const scanned = await scanIntegrationWork(prisma, { now });

    expect(scanned.map(({ id }) => id)).toEqual([due.id, retry.id]);
    expect(scanned.map(({ state }) => state)).toEqual(["queued", "retry"]);
    await expect(
      prisma.integrationSyncWork.findUnique({ where: { id: future.id } }),
    ).resolves.toMatchObject({ state: "queued" });
    await expect(
      prisma.integrationSyncWork.findUnique({ where: { id: leased.id } }),
    ).resolves.toMatchObject({ state: "leased" });
  });
});
