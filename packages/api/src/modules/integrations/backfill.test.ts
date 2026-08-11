import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { cleanDatabase, disconnectTestDb, seedTestMember } from "../../test/helpers.js";
import {
  EXTERNAL_REF_BACKFILL_LOCK_KEY,
  ExternalRefBackfillInvariantError,
  ExternalRefBindingProofError,
  proveExternalRefBindings,
  withExternalRefBackfillWriteGate,
  withTargetedExternalRefBackfillWriteGate,
} from "./backfill.js";
import * as backfillModule from "./backfill.js";

const concurrentPrisma = new PrismaClient();

async function fixture() {
  const workspace = await prisma.workspace.create({
    data: { name: "ExternalRef integrity", slug: `external-ref-${randomUUID()}` },
  });
  const project = await prisma.project.create({
    data: {
      key: `ER${randomUUID().slice(0, 4).toUpperCase()}`,
      name: "ExternalRef integrity",
      workspaceId: workspace.id,
    },
  });
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://redmine.example.test",
      workspaceId: workspace.id,
    },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: `remote-${randomUUID()}`,
      readMap: {},
      writeMap: {},
    },
  });
  const ref = await prisma.externalRef.create({
    data: {
      connectionId: connection.id,
      bindingId: binding.id,
      entityType: "project",
      entityId: project.id,
      externalId: `remote-${randomUUID()}`,
    },
  });
  return { workspace, project, connection, binding, ref };
}

async function tryAcquireGate() {
  return concurrentPrisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ locked: boolean }>>(
      Prisma.sql`
        SELECT pg_try_advisory_xact_lock(${EXTERNAL_REF_BACKFILL_LOCK_KEY}::bigint) AS locked
      `,
    );
    return rows[0]?.locked === true;
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("external reference binding integrity", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await Promise.all([disconnectTestDb(), concurrentPrisma.$disconnect()]);
  });

  it("removes the consumed nullable backfill API", async () => {
    await fixture();

    expect("backfillExternalRefBindingsInTransaction" in backfillModule).toBe(false);
    expect("backfillExternalRefBindings" in backfillModule).toBe(false);
    await expect(proveExternalRefBindings(prisma)).resolves.toBeUndefined();
    await expect(withExternalRefBackfillWriteGate(prisma, async () => "valid"))
      .resolves.toBe("valid");
  });

  it("accepts comment references owned through their parent issue", async () => {
    const { workspace, project, connection, binding } = await fixture();
    const member = await seedTestMember(workspace.id);
    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Inbound comment ownership",
        projectId: project.id,
      },
    });
    const comment = await prisma.comment.create({
      data: {
        issueId: issue.id,
        authorId: member.id,
        body: "Imported from Redmine",
        source: "system",
      },
    });
    await prisma.externalRef.create({
      data: {
        connectionId: connection.id,
        bindingId: binding.id,
        entityType: "comment",
        entityId: comment.id,
        externalId: `journal-${randomUUID()}`,
      },
    });

    await expect(proveExternalRefBindings(prisma)).resolves.toBeUndefined();
    await expect(withExternalRefBackfillWriteGate(prisma, async () => "valid"))
      .resolves.toBe("valid");
  });

  it("accepts only an exact recoverable pending issue-delete tombstone", async () => {
    const { workspace, project, connection, binding } = await fixture();
    const member = await seedTestMember(workspace.id);
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { lifecycle: "active" },
    });
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { lifecycle: "active", bootstrapState: "ready" },
    });
    const credential = await prisma.memberIntegrationCredential.create({
      data: {
        connectionId: connection.id,
        memberId: member.id,
        encryptedKey: "encrypted",
        lastAuthStatus: "valid",
      },
    });
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
        laneKey: randomUUID(),
        actorKey: `member:${member.id}`,
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

    await expect(proveExternalRefBindings(prisma)).resolves.toBeUndefined();
    await expect(withExternalRefBackfillWriteGate(prisma, async () => "valid"))
      .resolves.toBe("valid");

    await prisma.integrationSyncWork.update({
      where: { id: work.id },
      data: {
        payload: {
          version: 1,
          refId: ref.id,
          externalId: "wrong-remote-id",
          issueKey: `${project.key}-1`,
        },
      },
    });
    await expect(proveExternalRefBindings(prisma)).rejects.toMatchObject({
      name: ExternalRefBindingProofError.name,
      diagnostics: [{ reason: "local-entity-not-found", count: 1 }],
    });
  });

  it("validates a targeted worker write", async () => {
    const { ref } = await fixture();

    await prisma.$transaction((transaction) =>
      withTargetedExternalRefBackfillWriteGate(transaction, async (gated) => {
        await gated.externalRef.update({
          where: { id: ref.id },
          data: { externalUrl: "https://redmine.example.test/issues/1" },
        });
        return ref.id;
      }),
    );

    await expect(prisma.externalRef.findUniqueOrThrow({ where: { id: ref.id } })).resolves
      .toMatchObject({ externalUrl: "https://redmine.example.test/issues/1" });
  });

  it("rolls back an invalid targeted worker write", async () => {
    const { project, ref } = await fixture();

    await expect(
      prisma.$transaction((transaction) =>
        withTargetedExternalRefBackfillWriteGate(transaction, async (gated) => {
          await gated.externalRef.update({
            where: { id: ref.id },
            data: { entityId: randomUUID() },
          });
          return ref.id;
        }),
      ),
    ).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({ externalRefId: ref.id, reason: "local-entity-not-found" }),
      ],
    });
    await expect(prisma.externalRef.findUniqueOrThrow({ where: { id: ref.id } })).resolves
      .toMatchObject({ entityId: project.id });
  });

  it("rolls back when a targeted writer returns a missing ref", async () => {
    const { ref } = await fixture();

    await expect(
      prisma.$transaction((transaction) =>
        withTargetedExternalRefBackfillWriteGate(transaction, async (gated) => {
          await gated.externalRef.update({
            where: { id: ref.id },
            data: { externalUrl: "https://must-roll-back.example.test" },
          });
          return randomUUID();
        }),
      ),
    ).rejects.toThrow(/targeted external reference/i);
    await expect(prisma.externalRef.findUniqueOrThrow({ where: { id: ref.id } })).resolves
      .toMatchObject({ externalUrl: null });
  });

  it("rolls back a binding ownership mismatch", async () => {
    const { workspace, project, binding, ref } = await fixture();
    const replacement = await prisma.project.create({
      data: {
        key: `RP${randomUUID().slice(0, 4).toUpperCase()}`,
        name: "Replacement project",
        workspaceId: workspace.id,
      },
    });

    await expect(
      withExternalRefBackfillWriteGate(prisma, async (transaction) => {
        await transaction.project.update({
          where: { id: project.id },
          data: { name: "must roll back" },
        });
        return transaction.integrationProjectBinding.update({
          where: { id: binding.id },
          data: { projectId: replacement.id },
        });
      }),
    ).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({ externalRefId: ref.id, reason: "binding-mismatch" }),
      ],
    });
    await expect(prisma.integrationProjectBinding.findUnique({ where: { id: binding.id } }))
      .resolves.toMatchObject({ projectId: project.id });
    await expect(prisma.project.findUnique({ where: { id: project.id } })).resolves.toMatchObject({
      name: "ExternalRef integrity",
    });
  });

  it("rolls back a cross-workspace binding", async () => {
    const { binding, project, ref } = await fixture();
    const foreignWorkspace = await prisma.workspace.create({
      data: { name: "Foreign workspace", slug: `external-ref-foreign-${randomUUID()}` },
    });
    const foreignProject = await prisma.project.create({
      data: {
        key: `FW${randomUUID().slice(0, 4).toUpperCase()}`,
        name: "Foreign project",
        workspaceId: foreignWorkspace.id,
      },
    });

    await expect(
      withExternalRefBackfillWriteGate(prisma, (transaction) =>
        transaction.integrationProjectBinding.update({
          where: { id: binding.id },
          data: { projectId: foreignProject.id },
        }),
      ),
    ).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({ externalRefId: ref.id, reason: "tenant-mismatch" }),
      ],
    });
    await expect(prisma.integrationProjectBinding.findUnique({ where: { id: binding.id } }))
      .resolves.toMatchObject({ projectId: project.id });

    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { projectId: foreignProject.id },
    });
    await expect(proveExternalRefBindings(prisma)).rejects.toMatchObject({
      name: ExternalRefBindingProofError.name,
      diagnostics: [{ reason: "tenant-mismatch", count: 1 }],
    });
  });

  it("excludes a concurrent cooperating writer until commit", async () => {
    const { project } = await fixture();
    const acquired = deferred();
    const release = deferred();
    const first = withExternalRefBackfillWriteGate(prisma, async (transaction) => {
      await transaction.project.update({
        where: { id: project.id },
        data: { name: "first writer" },
      });
      acquired.resolve();
      await release.promise;
    });

    await acquired.promise;
    await expect(tryAcquireGate()).resolves.toBe(false);
    release.resolve();
    await expect(first).resolves.toBeUndefined();
    await expect(tryAcquireGate()).resolves.toBe(true);
  });
});
