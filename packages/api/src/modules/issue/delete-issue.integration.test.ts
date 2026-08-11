import { randomUUID } from "node:crypto";
import type { IntegrationBootstrapState } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
import { proveExternalRefBindings } from "../integrations/backfill.js";
import { unbindProject } from "../integrations/service.js";
import { deleteIssue } from "./delete-issue.js";

async function fixture(options: {
  priority?: "critical" | "medium";
  credential?: boolean;
  bootstrapState?: IntegrationBootstrapState;
} = {}) {
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
      bootstrapState: options.bootstrapState ?? "not_required",
    },
  });
  const credential = options.credential === false
    ? null
    : await prisma.memberIntegrationCredential.create({
        data: {
          connectionId: connection.id,
          memberId: member.id,
          encryptedKey: "encrypted-key",
          lastAuthStatus: "valid",
        },
      });
  return { workspace, member, project, issue, connection, binding, credential };
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

    const events: DomainEvent[] = [];
    const unsubscribe = eventBus.subscribe((event) => events.push(event), "delete-issue-test");
    const result = await deleteIssue(value.issue.id, value.issue.key, {}, value.member.id);
    unsubscribe();

    expect(result).toMatchObject({
      deletedIssueId: value.issue.id,
      deletedIssueKey: value.issue.key,
      remoteDeleteQueued: false,
    });
    await expect(prisma.issue.findUnique({ where: { id: value.issue.id } })).resolves.toBeNull();
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { entityType: "issue", entityId: value.issue.id },
    });
    expect(audit).toMatchObject({ action: "delete", authorId: value.member.id });
    expect(audit.payload).toMatchObject({
      issueSnapshot: expect.objectContaining({ id: value.issue.id, key: value.issue.key }),
      remoteReferences: [],
      remoteDeleteQueued: false,
    });
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

  it("captures linked Redmine deletion before hard-deleting locally", async () => {
    const value = await fixture();
    const ref = await prisma.externalRef.create({
      data: {
        connectionId: value.connection.id,
        bindingId: value.binding.id,
        entityType: "issue",
        entityId: value.issue.id,
        externalId: "179",
      },
    });

    await expect(deleteIssue(value.issue.id, value.issue.key, {}, value.member.id)).resolves.toMatchObject({
      deletedIssueId: value.issue.id,
      remoteDeleteQueued: true,
    });
    await expect(prisma.issue.findUnique({ where: { id: value.issue.id } })).resolves.toBeNull();
    await expect(prisma.externalRef.findUnique({ where: { id: ref.id } })).resolves.not.toBeNull();
    await expect(prisma.integrationSyncWork.findFirst({ where: { entityId: value.issue.id, operation: "delete" } }))
      .resolves.toMatchObject({ state: "queued", refId: ref.id, authCredentialId: value.credential!.id });
  });

  it("cleans descendant references and pending work before deleting locally", async () => {
    const value = await fixture();
    const issueRef = await prisma.externalRef.create({
      data: {
        connectionId: value.connection.id,
        bindingId: value.binding.id,
        entityType: "issue",
        entityId: value.issue.id,
        externalId: "179",
      },
    });
    const comment = await prisma.comment.create({
      data: {
        issueId: value.issue.id,
        authorId: value.member.id,
        body: "Delete descendant",
        source: "system",
      },
    });
    const timeEntry = await prisma.timeEntry.create({
      data: {
        issueId: value.issue.id,
        memberId: value.member.id,
        hours: 1,
        workedOn: new Date("2026-08-10T00:00:00.000Z"),
        via: "test",
      },
    });
    const [commentRef, timeEntryRef] = await Promise.all([
      prisma.externalRef.create({
        data: {
          connectionId: value.connection.id,
          bindingId: value.binding.id,
          entityType: "comment",
          entityId: comment.id,
          externalId: "journal-12",
        },
      }),
      prisma.externalRef.create({
        data: {
          connectionId: value.connection.id,
          bindingId: value.binding.id,
          entityType: "time_entry",
          entityId: timeEntry.id,
          externalId: "spent-34",
        },
      }),
    ]);
    const work = await Promise.all([
      prisma.integrationSyncWork.create({
        data: {
          bindingId: value.binding.id,
          entityType: "comment",
          entityId: comment.id,
          direction: "outbound",
          operation: "update",
          dedupeKey: randomUUID(),
          laneKey: randomUUID(),
          actorKey: `member:${value.member.id}`,
          actorKind: "user",
          payload: { version: 1 },
          correlationId: randomUUID(),
          authCredentialId: value.credential!.id,
          refId: commentRef.id,
          epoch: value.binding.lifecycleEpoch,
        },
      }),
      prisma.integrationSyncWork.create({
        data: {
          bindingId: value.binding.id,
          entityType: "time_entry",
          entityId: timeEntry.id,
          direction: "outbound",
          operation: "update",
          dedupeKey: randomUUID(),
          laneKey: randomUUID(),
          actorKey: `member:${value.member.id}`,
          actorKind: "user",
          payload: { version: 1 },
          correlationId: randomUUID(),
          state: "retry",
          authCredentialId: value.credential!.id,
          refId: timeEntryRef.id,
          epoch: value.binding.lifecycleEpoch,
        },
      }),
    ]);

    await expect(
      deleteIssue(value.issue.id, value.issue.key, {}, value.member.id),
    ).resolves.toMatchObject({ remoteDeleteQueued: true });

    await expect(
      prisma.externalRef.findMany({
        where: { id: { in: [commentRef.id, timeEntryRef.id] } },
      }),
    ).resolves.toEqual([]);
    await expect(
      prisma.integrationSyncWork.findMany({
        where: { id: { in: work.map(({ id }) => id) } },
        orderBy: { id: "asc" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ state: "superseded", refId: null }),
      expect.objectContaining({ state: "superseded", refId: null }),
    ]);
    await expect(prisma.externalRef.findUnique({ where: { id: issueRef.id } }))
      .resolves.not.toBeNull();
    await expect(prisma.comment.findUnique({ where: { id: comment.id } })).resolves.toBeNull();
    await expect(prisma.timeEntry.findUnique({ where: { id: timeEntry.id } }))
      .resolves.toMatchObject({ issueId: null });
    await expect(proveExternalRefBindings(prisma)).resolves.toBeUndefined();
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { entityType: "issue", entityId: value.issue.id },
    });
    expect(audit.payload).toMatchObject({
      descendantIntegrationCleanup: {
        externalReferencesDeleted: 2,
        workItemsSuperseded: 2,
      },
    });
  });

  it.each([
    "pending",
    "previewed",
    "bootstrapping",
    "converging",
    "failed",
  ] as const)("rejects linked deletion while bootstrap state is %s and remains safe to unbind", async (bootstrapState) => {
    const value = await fixture({ bootstrapState });
    const owner = await seedTestMemberWithRole(value.workspace.id, "owner");
    await prisma.externalRef.create({
      data: {
        connectionId: value.connection.id,
        bindingId: value.binding.id,
        entityType: "issue",
        entityId: value.issue.id,
        externalId: "20",
      },
    });

    await expect(
      deleteIssue(value.issue.id, value.issue.key, {}, value.member.id),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "REMOTE_DELETE_BOOTSTRAP_INCOMPLETE",
    });
    await expect(prisma.issue.findUnique({ where: { id: value.issue.id } }))
      .resolves.not.toBeNull();
    await expect(
      prisma.integrationSyncWork.count({
        where: { entityId: value.issue.id, operation: "delete" },
      }),
    ).resolves.toBe(0);
    await expect(
      unbindProject(
        value.connection.id,
        value.binding.id,
        owner.userId,
        value.workspace.id,
      ),
    ).resolves.toMatchObject({ status: "released" });
  });

  it("rejects linked deletion without a usable actor credential", async () => {
    const value = await fixture({ credential: false });
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
      code: "REMOTE_DELETE_CREDENTIAL_REQUIRED",
    });
    await expect(prisma.issue.findUnique({ where: { id: value.issue.id } })).resolves.not.toBeNull();
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
