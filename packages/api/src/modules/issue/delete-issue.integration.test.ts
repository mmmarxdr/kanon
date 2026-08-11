import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import type { DomainEvent } from "../../services/event-bus/types.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { deleteIssue } from "./delete-issue.js";

async function fixture(options: { priority?: "critical" | "medium" } = {}) {
  const workspace = await seedTestWorkspace();
  const member = await seedTestMemberWithRole(workspace.id, "admin", {
    email: `delete-${randomUUID()}@kanon.test`,
    projectAccess: "workspace",
  });
  const project = await seedTestProject(workspace.id, `D${randomUUID().slice(0, 4).toUpperCase()}`);
  const issue = await prisma.issue.create({
    data: {
      key: `${project.key}-1`,
      sequenceNum: 1,
      title: "Delete me",
      priority: options.priority ?? "medium",
      projectId: project.id,
    },
  });
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://redmine.example.test",
      lifecycle: "active",
      workspaceId: workspace.id,
    },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "remote-project",
      readMap: { "1": "todo" },
      writeMap: { todo: "1" },
      lifecycle: "active",
    },
  });
  return { workspace, member, project, issue, connection, binding };
}

describe("deleteIssue", () => {
  beforeEach(cleanDatabase);
  afterAll(disconnectTestDb);

  it("requires the exact case-sensitive key for critical issues", async () => {
    const value = await fixture({ priority: "critical" });

    await expect(deleteIssue(value.issue.id, value.issue.key, { confirmationKey: value.issue.key.toLowerCase() }, value.member.id))
      .rejects.toMatchObject({ statusCode: 400, code: "ISSUE_CONFIRMATION_KEY_MISMATCH" });
    await expect(prisma.issue.findUnique({ where: { id: value.issue.id } })).resolves.not.toBeNull();
  });

  it("writes an audit snapshot before hard-deleting an unlinked issue", async () => {
    const value = await fixture();
    const comment = await prisma.comment.create({
      data: { issueId: value.issue.id, authorId: value.member.id, body: "Cascade me" },
    });
    const timeEntry = await prisma.timeEntry.create({
      data: {
        issueId: value.issue.id,
        memberId: value.member.id,
        hours: 1,
        workedOn: new Date("2026-08-11T00:00:00.000Z"),
        via: "test",
      },
    });

    const events: DomainEvent[] = [];
    const unsubscribe = eventBus.subscribe((event) => events.push(event), "delete-issue-test");
    const result = await deleteIssue(value.issue.id, value.issue.key, {}, value.member.id);
    unsubscribe();

    expect(result).toMatchObject({
      deletedIssueId: value.issue.id,
      deletedIssueKey: value.issue.key,
      remoteDeleteQueued: false,
      detachedTimeEntryCount: 1,
    });
    await expect(prisma.issue.findUnique({ where: { id: value.issue.id } })).resolves.toBeNull();
    await expect(prisma.comment.findUnique({ where: { id: comment.id } })).resolves.toBeNull();
    await expect(prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntry.id } })).resolves
      .toMatchObject({ issueId: null });
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { entityType: "issue", entityId: value.issue.id },
    });
    expect(audit).toMatchObject({ action: "delete", authorId: value.member.id });
    expect(audit.payload).toMatchObject({
      issueSnapshot: expect.objectContaining({ id: value.issue.id, key: value.issue.key }),
      cascadedRecordCounts: expect.objectContaining({ comments: 1 }),
      detachedRecordCounts: { timeEntries: 1 },
      remoteReferences: [],
      remoteDeleteQueued: false,
    });
    expect((audit.payload as { cascadedRecordCounts: object }).cascadedRecordCounts)
      .not.toHaveProperty("timeEntries");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "issue.deleted",
        payload: expect.objectContaining({
          issueId: value.issue.id,
          issueKey: value.issue.key,
          projectKey: value.project.key,
          remoteDeleteQueued: false,
        }),
      }),
    );
  });

  it("rejects linked deletion until durable remote deletion is available", async () => {
    const value = await fixture();
    await prisma.externalRef.create({
      data: {
        connectionId: value.connection.id,
        bindingId: value.binding.id,
        entityType: "issue",
        entityId: value.issue.id,
        externalId: "20",
      },
    });

    await expect(deleteIssue(value.issue.id, value.issue.key, {}, value.member.id)).rejects.toMatchObject({
      statusCode: 409,
      code: "REMOTE_DELETE_UNAVAILABLE",
    });
    await expect(prisma.issue.findUnique({ where: { id: value.issue.id } })).resolves.not.toBeNull();
  });

  it("rejects a non-Redmine external reference without mislabeling it as Redmine", async () => {
    const value = await fixture();
    await prisma.integrationConnection.update({
      where: { id: value.connection.id },
      data: { provider: "other" },
    });
    const ref = await prisma.externalRef.create({
      data: {
        connectionId: value.connection.id,
        bindingId: value.binding.id,
        entityType: "issue",
        entityId: value.issue.id,
        externalId: "other-20",
      },
    });

    await expect(deleteIssue(value.issue.id, value.issue.key, {}, value.member.id)).rejects
      .toMatchObject({ statusCode: 409, code: "EXTERNAL_REFERENCE_EXISTS" });
    await expect(prisma.issue.findUnique({ where: { id: value.issue.id } })).resolves.not.toBeNull();
    await expect(prisma.externalRef.findUnique({ where: { id: ref.id } })).resolves.not.toBeNull();
  });

  it("maps only timeout-form P2028 failures to the retryable concurrency error", async () => {
    const value = await fixture();
    const timeout = new Prisma.PrismaClientKnownRequestError(
      "Transaction API error: Transaction already closed: the transaction has expired",
      { code: "P2028", clientVersion: "6.19.2" },
    );
    const transaction = vi.fn().mockRejectedValueOnce(timeout);
    const database = {
      issue: { findUnique: vi.fn().mockResolvedValue({ projectId: value.project.id }) },
      $transaction: transaction,
    } as unknown as typeof prisma;

    const deletion = deleteIssue(value.issue.id, value.issue.key, {}, value.member.id, { database })
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 250,
      timeout: 30_000,
    }));
    await expect(deletion).resolves
      .toMatchObject({ statusCode: 503, code: "CONCURRENCY_ERROR" });
  });

  it("preserves unrelated P2028 failures", async () => {
    const value = await fixture();
    const unrelated = new Prisma.PrismaClientKnownRequestError(
      "Transaction API error: unsupported transaction operation",
      { code: "P2028", clientVersion: "6.19.2" },
    );
    const transaction = vi.fn().mockRejectedValueOnce(unrelated);
    const database = {
      issue: { findUnique: vi.fn().mockResolvedValue({ projectId: value.project.id }) },
      $transaction: transaction,
    } as unknown as typeof prisma;

    const deletion = deleteIssue(value.issue.id, value.issue.key, {}, value.member.id, { database })
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(transaction).toHaveBeenCalled());
    await expect(deletion).resolves.toBe(unrelated);
  });

  it("rejects an ambiguous remote create instead of risking an orphan", async () => {
    const value = await fixture();
    await prisma.integrationSyncWork.create({
      data: {
        bindingId: value.binding.id,
        entityType: "issue",
        entityId: value.issue.id,
        direction: "outbound",
        operation: "create",
        dedupeKey: randomUUID(),
        laneKey: randomUUID(),
        actorKey: `member:${value.member.id}`,
        actorKind: "user",
        payload: { version: 1, fields: {}, issue: { key: value.issue.key } },
        correlationId: randomUUID(),
        state: "ambiguous",
        epoch: value.binding.lifecycleEpoch,
      },
    });

    await expect(deleteIssue(value.issue.id, value.issue.key, {}, value.member.id)).rejects.toMatchObject({
      statusCode: 409,
      code: "REMOTE_CREATE_UNRESOLVED",
    });
    await expect(prisma.issue.findUnique({ where: { id: value.issue.id } })).resolves.not.toBeNull();
  });

  it("never follows a reused key away from the middleware-authorized issue identity", async () => {
    const value = await fixture();
    const authorizedId = value.issue.id;
    const authorizedKey = value.issue.key;
    await prisma.issue.delete({ where: { id: authorizedId } });
    const replacement = await prisma.issue.create({
      data: {
        key: authorizedKey,
        sequenceNum: value.issue.sequenceNum,
        title: "Same key, different identity",
        projectId: value.project.id,
      },
    });

    await expect(deleteIssue(authorizedId, authorizedKey, {}, value.member.id)).rejects.toMatchObject({
      statusCode: 404,
      code: "ISSUE_NOT_FOUND",
    });
    await expect(prisma.issue.findUnique({ where: { id: replacement.id } })).resolves.not.toBeNull();
  });
});
