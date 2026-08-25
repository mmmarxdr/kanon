import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import type {
  IssueCaptureFields,
  IssueCaptureIntent,
  IssueMutationDraft,
} from "./issue-mutation-contract.js";
import {
  captureIssueScheduleMutationTx,
  lockIssueCaptureBindingTx,
  withIssueMutationTx,
} from "./issue-tx.js";

const workspaceIds = new Set<string>();

async function createFixture() {
  const workspace = await prisma.workspace.create({
    data: { name: "Issue tx workspace", slug: `issue-tx-${randomUUID()}` },
  });
  workspaceIds.add(workspace.id);
  const project = await prisma.project.create({
    data: {
      key: `T${randomUUID().slice(0, 5).toUpperCase()}`,
      name: "Issue tx project",
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
      readMap: { open: "todo" },
      writeMap: { todo: "open" },
      lifecycleEpoch: 4,
    },
  });
  const issue = await prisma.issue.create({
    data: {
      key: `TX-${randomUUID().slice(0, 8).toUpperCase()}`,
      sequenceNum: 1,
      title: "Existing issue",
      projectId: project.id,
    },
  });
  const transitionIssue = await prisma.issue.create({
    data: {
      key: `TX-${randomUUID().slice(0, 8).toUpperCase()}`,
      sequenceNum: 2,
      title: "Transition issue",
      projectId: project.id,
    },
  });
  return { project, connection, binding, issue, transitionIssue };
}

function mutationDatabase(mutate: () => void): Pick<PrismaClient, "$transaction"> {
  const database = {
    $transaction: (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      prisma.$transaction((transaction) => {
        let mutated = false;
        const binding = new Proxy(transaction.integrationProjectBinding, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver) as unknown;
            if (property !== "findUnique" || typeof value !== "function") return value;
            return (...args: unknown[]) => {
              if (!mutated) {
                mutated = true;
                mutate();
              }
              return Reflect.apply(value, target, args);
            };
          },
        });
        return operation(
          new Proxy(transaction, {
            get: (target, property, receiver) =>
              property === "integrationProjectBinding"
                ? binding
                : Reflect.get(target, property, receiver),
          }) as Prisma.TransactionClient,
        );
      }),
  };
  return database as unknown as Pick<PrismaClient, "$transaction">;
}

function capture(
  bindingId: string,
  correlationId: string,
  fields: IssueCaptureFields,
  operation: IssueCaptureIntent["operation"] = "update",
): IssueCaptureIntent {
  return {
    bindingId,
    direction: "outbound",
    operation,
    actorKey: "member:actor-1",
    actorKind: "user",
    correlationId,
    fields,
  };
}

afterEach(async () => {
  for (const workspaceId of workspaceIds) {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  }
  workspaceIds.clear();
});

afterAll(() => prisma.$disconnect());

describe("withIssueMutationTx", () => {
  it("commits create, update, and transition captures from each returned Issue row", async () => {
    const fixture = await createFixture();
    const created = await withIssueMutationTx(async (transaction) => {
      const result = await transaction.issue.create({
        data: {
          key: `TX-${randomUUID().slice(0, 8).toUpperCase()}`,
          sequenceNum: 3,
          title: "Created issue",
          estimate: 8,
          projectId: fixture.project.id,
        },
      });
      return {
        result,
        capture: capture(
          fixture.binding.id,
          "create-correlation",
          { title: result.title, estimate: result.estimate },
          "create",
        ),
      };
    });
    const updated = await withIssueMutationTx(async (transaction) => {
      const result = await transaction.issue.update({
        where: { id: fixture.transitionIssue.id },
        data: { title: "Updated issue" },
      });
      return {
        result,
        capture: {
          ...capture(fixture.binding.id, "update-correlation", { title: result.title }),
          sourceVersion: "untrusted-remote-version",
        },
      };
    });
    const transitioned = await withIssueMutationTx(async (transaction) => {
      const result = await transaction.issue.update({
        where: { id: fixture.issue.id },
        data: { state: "in_progress" },
      });
      return {
        result,
        capture: capture(fixture.binding.id, "transition-correlation", {
          state: result.state,
        }),
      };
    });

    const work = await prisma.integrationSyncWork.findMany({
      where: {
        correlationId: {
          in: ["create-correlation", "update-correlation", "transition-correlation"],
        },
      },
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(new Set([created.id, updated.id, transitioned.id]).size).toBe(3);
    expect(Object.fromEntries(work.map((row) => [row.correlationId, row.entityId]))).toEqual({
      "create-correlation": created.id,
      "update-correlation": updated.id,
      "transition-correlation": transitioned.id,
    });
    expect(work.every((row) => row.entityType === "issue" && row.epoch === 4)).toBe(true);
    expect(work).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlationId: "create-correlation",
          direction: "outbound",
          operation: "create",
          actorKey: "member:actor-1",
          actorKind: "user",
        }),
        expect.objectContaining({
          correlationId: "update-correlation",
          direction: "outbound",
          operation: "update",
          actorKey: "member:actor-1",
          actorKind: "user",
        }),
        expect.objectContaining({
          correlationId: "transition-correlation",
          direction: "outbound",
          operation: "update",
          actorKey: "member:actor-1",
          actorKind: "user",
        }),
      ]),
    );
    expect(work.find((row) => row.correlationId === "create-correlation")?.payload).toEqual({
      version: 1,
      fields: { title: "Created issue", estimate: 8 },
      issue: {
        key: created.key,
        title: "Created issue",
        description: null,
        state: "backlog",
        priority: "medium",
        assigneeId: null,
        cycleId: null,
        estimate: 8,
        completedAt: null,
        updatedAt: created.updatedAt.toISOString(),
      },
    });
    const provenance = await prisma.integrationContentProvenance.findMany({
      where: { entityId: { in: [created.id, updated.id, transitioned.id] } },
    });
    expect(
      Object.fromEntries(
        provenance.map((row) => [
          row.entityId,
          {
            field: row.field,
            origin: row.origin,
            sourceVersion: row.sourceVersion,
            contentHash: row.contentHash,
          },
        ]),
      ),
    ).toEqual({
      [created.id]: {
        field: "title",
        origin: "kanon",
        sourceVersion: created.updatedAt.toISOString(),
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      [updated.id]: {
        field: "title",
        origin: "kanon",
        sourceVersion: updated.updatedAt.toISOString(),
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
  });

  it("rolls back callback, canonicalization, and outbox failures", async () => {
    const fixture = await createFixture();
    const keys = ["callback", "canonical", "outbox"].map(
      (kind) => `TX-${kind}-${randomUUID().slice(0, 6).toUpperCase()}`,
    );
    const create = (transaction: Prisma.TransactionClient, key: string) =>
      transaction.issue.create({
        data: { key, sequenceNum: 10, title: key, projectId: fixture.project.id },
      });

    await expect(
      withIssueMutationTx(async (transaction) => {
        await create(transaction, keys[0]!);
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");
    await expect(
      withIssueMutationTx(async (transaction) => {
        const result = await create(transaction, keys[1]!);
        return {
          result,
          capture: {
            ...capture(fixture.binding.id, "canonical-failure", { title: result.title }),
            entityId: result.id,
          },
        } as IssueMutationDraft;
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      withIssueMutationTx(async (transaction) => {
        const result = await create(transaction, keys[2]!);
        return {
          result,
          capture: capture(randomUUID(), "outbox-failure", { title: result.title }),
        };
      }),
    ).rejects.toThrow("was not found");

    expect(await prisma.issue.count({ where: { key: { in: keys } } })).toBe(0);
    expect(
      await prisma.integrationSyncWork.count({
        where: { correlationId: { in: ["canonical-failure", "outbox-failure"] } },
      }),
    ).toBe(0);
  });

  it("never re-reads caller-owned data after canonicalization", async () => {
    const fixture = await createFixture();
    let source: IssueMutationDraft | undefined;
    const returned = await withIssueMutationTx(
      async (transaction) => {
        const result = await transaction.issue.create({
          data: {
            key: `TX-${randomUUID().slice(0, 8).toUpperCase()}`,
            sequenceNum: 20,
            title: "Stable title",
            projectId: fixture.project.id,
          },
        });
        source = {
          result,
          capture: capture(fixture.binding.id, "mutation-race", { title: result.title }),
        };
        return source;
      },
      mutationDatabase(() => {
        source!.result.title = "Caller mutation";
        (source!.capture.fields as { title: string }).title = "Caller mutation";
      }),
    );

    const work = await prisma.integrationSyncWork.findFirstOrThrow({
      where: { correlationId: "mutation-race" },
    });
    expect(source!.result.title).toBe("Caller mutation");
    expect(returned.title).toBe("Stable title");
    expect(work.payload).toMatchObject({
      fields: { title: "Stable title" },
      issue: { title: "Stable title" },
    });
  });

  it("serializes concurrent blocked issue and schedule evidence updates", async () => {
    const fixture = await createFixture();
    const ref = await prisma.externalRef.create({
      data: {
        connectionId: fixture.connection.id,
        bindingId: fixture.binding.id,
        entityType: "issue",
        entityId: fixture.issue.id,
        externalId: `remote-${randomUUID()}`,
      },
    });
    const conflict = await prisma.integrationConflict.create({
      data: {
        kind: "inbound-field-convergence",
        bindingId: fixture.binding.id,
        refId: ref.id,
        localEvidence: {
          blockedFields: ["title", "dueDate"],
          fields: {
            title: { local: fixture.issue.title, localVersion: "initial" },
            dueDate: { local: null, localVersion: "initial" },
          },
        },
        remoteEvidence: {},
      },
    });

    let releaseLock!: () => void;
    let confirmLock!: () => void;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockConfirmed = new Promise<void>((resolve) => {
      confirmLock = resolve;
    });
    const blocker = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "integration_conflicts" WHERE "id" = ${conflict.id}::uuid FOR UPDATE`,
      );
      confirmLock();
      await lockReleased;
    });
    await lockConfirmed;

    const titleWrite = withIssueMutationTx(
      async (transaction) => {
        const result = await transaction.issue.update({
          where: { id: fixture.issue.id },
          data: { title: "Concurrent local title" },
        });
        return {
          result,
          capture: capture(fixture.binding.id, "concurrent-title", { title: result.title }),
        };
      },
      prisma,
      fixture.binding.id,
    );
    const scheduleWrite = prisma.$transaction(async (transaction) => {
      await lockIssueCaptureBindingTx(transaction, fixture.binding.id);
      const result = await transaction.issueSchedule.create({
        data: { issueId: fixture.issue.id, dueDate: new Date("2026-08-30T00:00:00.000Z") },
      });
      await captureIssueScheduleMutationTx(
        transaction,
        fixture.issue.id,
        {
          bindingId: fixture.binding.id,
          direction: "outbound",
          actorKey: "member:actor-1",
          actorKind: "user",
        },
        { dueDate: result.dueDate!.toISOString() },
        result.updatedAt.toISOString(),
      );
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseLock();
    const [, title, schedule] = await Promise.all([blocker, titleWrite, scheduleWrite]);

    await expect(
      prisma.integrationConflict.findUniqueOrThrow({ where: { id: conflict.id } }),
    ).resolves.toMatchObject({
      localEvidence: expect.objectContaining({
        fields: expect.objectContaining({
          title: expect.objectContaining({
            local: title.title,
            localVersion: title.updatedAt.toISOString(),
          }),
          dueDate: expect.objectContaining({
            local: schedule.dueDate!.toISOString(),
            localVersion: schedule.updatedAt.toISOString(),
          }),
        }),
      }),
    });
    await expect(
      prisma.integrationSyncWork.count({ where: { entityId: fixture.issue.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.integrationContentProvenance.findUnique({
        where: {
          bindingId_entityType_entityId_field: {
            bindingId: fixture.binding.id,
            entityType: "issue",
            entityId: fixture.issue.id,
            field: "title",
          },
        },
      }),
    ).resolves.toMatchObject({
      origin: "kanon",
      sourceVersion: title.updatedAt.toISOString(),
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });
});
