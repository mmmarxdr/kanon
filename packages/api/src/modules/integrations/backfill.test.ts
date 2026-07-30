import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  backfillExternalRefBindings,
  EXTERNAL_REF_BACKFILL_LOCK_KEY,
  ExternalRefBackfillError,
  ExternalRefBackfillInvariantError,
  resolveBindingCandidates,
  withTargetedExternalRefBackfillWriteGate,
  withExternalRefBackfillWriteGate,
} from "./backfill.js";
import * as backfillModule from "./backfill.js";

const workspaceIds = new Set<string>();
const concurrentPrisma = new PrismaClient();

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function tryAcquireBackfillWriteGate(client: PrismaClient): Promise<boolean> {
  return client.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ locked: boolean }>>(
      Prisma.sql`
        SELECT pg_try_advisory_xact_lock(${EXTERNAL_REF_BACKFILL_LOCK_KEY}::bigint) AS locked
      `,
    );
    return rows[0]?.locked === true;
  });
}

async function createWorkspace(name: string) {
  const workspace = await prisma.workspace.create({
    data: { name, slug: `backfill-${randomUUID()}` },
  });
  workspaceIds.add(workspace.id);
  return workspace;
}

async function createProject(workspaceId: string, prefix: string) {
  return prisma.project.create({
    data: {
      key: `${prefix}${randomUUID().slice(0, 5).toUpperCase()}`,
      name: "Backfill project",
      workspaceId,
    },
  });
}

async function createConnection(workspaceId: string) {
  return prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://pm.example.test",
      workspaceId,
    },
  });
}

async function createBinding(connectionId: string, projectId: string) {
  return prisma.integrationProjectBinding.create({
    data: {
      connectionId,
      projectId,
      remoteProjectId: `remote-${randomUUID()}`,
      readMap: { "remote-open": "todo" },
      writeMap: { todo: "remote-open" },
    },
  });
}

async function createExternalRef(
  connectionId: string,
  entityType: string,
  entityId: string,
  bindingId?: string,
) {
  return prisma.externalRef.create({
    data: {
      entityType,
      entityId,
      externalId: `remote-${randomUUID()}`,
      connectionId,
      ...(bindingId ? { bindingId } : {}),
    },
  });
}

async function createProjectFixture() {
  const workspace = await createWorkspace("Backfill workspace");
  const project = await createProject(workspace.id, "B");
  const connection = await createConnection(workspace.id);
  const binding = await createBinding(connection.id, project.id);
  const projectRef = await createExternalRef(connection.id, "project", project.id);

  return { workspace, project, connection, binding, projectRef };
}

async function createCrossWorkspaceFixture() {
  const entityWorkspace = await createWorkspace("Entity workspace");
  const connectionWorkspace = await createWorkspace("Connection workspace");
  const project = await createProject(entityWorkspace.id, "X");
  const connection = await createConnection(connectionWorkspace.id);
  const binding = await createBinding(connection.id, project.id);
  const issue = await prisma.issue.create({
    data: {
      key: `X-${randomUUID()}`,
      sequenceNum: 1,
      title: "Cross-workspace issue",
      projectId: project.id,
    },
  });
  const projectRef = await createExternalRef(connection.id, "project", project.id);
  const issueRef = await createExternalRef(connection.id, "issue", issue.id);

  return { project, connection, binding, projectRef, issueRef };
}

afterEach(async () => {
  for (const workspaceId of workspaceIds) {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  }
  workspaceIds.clear();
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), concurrentPrisma.$disconnect()]);
});

describe("external reference binding backfill core", () => {
  it("does not expose a caller-owned backfill transaction helper", () => {
    expect("backfillExternalRefBindingsInTransaction" in backfillModule).toBe(false);
  });

  it("resolves project, issue, and cycle ownership in one transaction snapshot", async () => {
    const { workspace, project, connection, binding, projectRef } =
      await createProjectFixture();
    const issue = await prisma.issue.create({
      data: {
        key: `I-${randomUUID()}`,
        sequenceNum: 1,
        title: "Backfill issue",
        projectId: project.id,
      },
    });
    const cycle = await prisma.cycle.create({
      data: {
        name: "Backfill cycle",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-08-07T00:00:00.000Z"),
        projectId: project.id,
      },
    });
    const issueRef = await createExternalRef(connection.id, "issue", issue.id);
    const cycleRef = await createExternalRef(connection.id, "cycle", cycle.id);

    const result = await backfillExternalRefBindings(prisma);

    expect(result).toMatchObject({
      scanned: 3,
      updated: 3,
      unresolved: [],
      snapshot: { unresolvedCount: 0, zeroUnresolved: true },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    await expect(
      prisma.externalRef.findMany({
        where: { connectionId: connection.id },
        orderBy: { entityType: "asc" },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: projectRef.id, bindingId: binding.id }),
        expect.objectContaining({ id: issueRef.id, bindingId: binding.id }),
        expect.objectContaining({ id: cycleRef.id, bindingId: binding.id }),
      ]),
    );
    await expect(
      prisma.externalRef.count({
        where: { connection: { workspaceId: workspace.id }, bindingId: null },
      }),
    ).resolves.toBe(0);
  });

  it("skips already-bound rows and is idempotent on rerun", async () => {
    const { connection, project, binding } = await createProjectFixture();
    const alreadyBoundProject = await createProject(
      project.workspaceId,
      "A",
    );
    const alreadyBoundBinding = await createBinding(
      connection.id,
      alreadyBoundProject.id,
    );
    await createExternalRef(
      connection.id,
      "project",
      alreadyBoundProject.id,
      alreadyBoundBinding.id,
    );

    await expect(backfillExternalRefBindings(prisma)).resolves.toMatchObject({
      scanned: 1,
      updated: 1,
      snapshot: { unresolvedCount: 0, zeroUnresolved: true },
    });
    await expect(backfillExternalRefBindings(prisma)).resolves.toMatchObject({
      scanned: 0,
      updated: 0,
      unresolved: [],
      snapshot: { unresolvedCount: 0, zeroUnresolved: true },
    });
  });

  it("rejects cross-workspace project and issue candidates without leaking IDs", async () => {
    const { project, connection, binding, projectRef, issueRef } =
      await createCrossWorkspaceFixture();

    let failure: unknown;
    try {
      await backfillExternalRefBindings(prisma);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ExternalRefBackfillError);
    const backfillError = failure as ExternalRefBackfillError;
    expect(backfillError.result).toMatchObject({
      scanned: 2,
      updated: 0,
      snapshot: { unresolvedCount: 2, zeroUnresolved: false },
    });
    expect(backfillError.diagnostics).toEqual(
      [...backfillError.diagnostics].sort((left, right) =>
        left.externalRefId.localeCompare(right.externalRefId),
      ),
    );
    expect(backfillError.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalRefId: projectRef.id,
          entityType: "project",
          entityId: project.id,
          reason: "tenant-mismatch",
          candidateBindingIds: [],
        }),
        expect.objectContaining({
          externalRefId: issueRef.id,
          entityType: "issue",
          reason: "tenant-mismatch",
          candidateBindingIds: [],
        }),
      ]),
    );
    expect(backfillError.diagnostics.map(({ candidateBindingIds }) => candidateBindingIds)).toEqual([
      [],
      [],
    ]);
    await expect(
      prisma.integrationProjectBinding.findUnique({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ projectId: project.id, connectionId: connection.id });
    await expect(
      prisma.externalRef.count({ where: { bindingId: null } }),
    ).resolves.toBe(2);
  });

  it("reports a tenant mismatch before binding lookup when the reference connection is foreign", async () => {
    const { connection, project, binding, projectRef } =
      await createCrossWorkspaceFixture();
    await prisma.integrationProjectBinding.delete({ where: { id: binding.id } });

    let failure: unknown;
    try {
      await backfillExternalRefBindings(prisma);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ExternalRefBackfillError);
    const diagnostics = (failure as ExternalRefBackfillError).diagnostics;
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(({ externalRefId }) => externalRefId)).toEqual(
      [...diagnostics.map(({ externalRefId }) => externalRefId)].sort(),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        {
        externalRefId: projectRef.id,
        connectionId: connection.id,
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        reason: "tenant-mismatch",
        candidateBindingIds: [],
        },
        expect.objectContaining({ reason: "tenant-mismatch", candidateBindingIds: [] }),
      ]),
    );
  });

  it("reports stable diagnostics and rolls back every planned update", async () => {
    const { connection, project, projectRef } = await createProjectFixture();
    const noBindingProject = await createProject(project.workspaceId, "N");
    const unsupportedRef = await createExternalRef(
      connection.id,
      "milestone",
      randomUUID(),
    );
    const missingEntityRef = await createExternalRef(
      connection.id,
      "issue",
      randomUUID(),
    );
    const noBindingRef = await createExternalRef(
      connection.id,
      "project",
      noBindingProject.id,
    );

    let failure: unknown;
    try {
      await backfillExternalRefBindings(prisma);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ExternalRefBackfillError);
    const backfillError = failure as ExternalRefBackfillError;
    expect(backfillError.result).toMatchObject({
      scanned: 4,
      updated: 0,
      snapshot: { unresolvedCount: 3, zeroUnresolved: false },
    });
    expect(backfillError.diagnostics.map(({ externalRefId }) => externalRefId)).toEqual(
      [...backfillError.diagnostics.map(({ externalRefId }) => externalRefId)].sort(),
    );
    expect(backfillError.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalRefId: unsupportedRef.id,
          reason: "unsupported-entity-type",
          candidateBindingIds: [],
        }),
        expect.objectContaining({
          externalRefId: missingEntityRef.id,
          reason: "local-entity-not-found",
          candidateBindingIds: [],
        }),
        expect.objectContaining({
          externalRefId: noBindingRef.id,
          reason: "binding-not-found",
          candidateBindingIds: [],
        }),
      ]),
    );
    await expect(
      prisma.externalRef.findUnique({ where: { id: projectRef.id } }),
    ).resolves.toMatchObject({ bindingId: null });
  });

  it("rolls back a composed write through the owned gate", async () => {
    const { binding, projectRef } = await createProjectFixture();

    await expect(
      withExternalRefBackfillWriteGate(prisma, async (transaction) => {
        await transaction.externalRef.update({
          where: { id: projectRef.id },
          data: { bindingId: binding.id },
        });
        throw new Error("forced owned gate rollback");
      }),
    ).rejects.toThrow("forced owned gate rollback");

    await expect(
      prisma.externalRef.findUnique({ where: { id: projectRef.id } }),
    ).resolves.toMatchObject({ bindingId: null });
  });

  it("validates only the ref returned by the targeted worker gate", async () => {
    const { workspace, connection } = await createProjectFixture();
    const validProject = await createProject(workspace.id, "T");
    const validBinding = await createBinding(connection.id, validProject.id);
    const validRef = await createExternalRef(
      connection.id,
      "project",
      validProject.id,
      validBinding.id,
    );

    await prisma.$transaction((transaction) =>
      withTargetedExternalRefBackfillWriteGate(transaction, async (gated) => {
        await gated.externalRef.update({
          where: { id: validRef.id },
          data: { externalId: "remote-targeted-updated" },
        });
        return validRef.id;
      }),
    );

    await expect(
      prisma.externalRef.findUniqueOrThrow({ where: { id: validRef.id } }),
    ).resolves.toMatchObject({ externalId: "remote-targeted-updated" });
  });

  it("rolls back a targeted ref that violates the shared ownership invariant", async () => {
    const { binding, projectRef } = await createProjectFixture();

    await expect(
      prisma.$transaction((transaction) =>
        withTargetedExternalRefBackfillWriteGate(transaction, async (gated) => {
          await gated.externalRef.update({
            where: { id: projectRef.id },
            data: { bindingId: binding.id, entityId: randomUUID() },
          });
          return projectRef.id;
        }),
      ),
    ).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({
          externalRefId: projectRef.id,
          reason: "local-entity-not-found",
        }),
      ],
    });
    await expect(
      prisma.externalRef.findUniqueOrThrow({ where: { id: projectRef.id } }),
    ).resolves.toMatchObject({ bindingId: null });
  });

  it("rolls back when the targeted gate returns a missing ref ID", async () => {
    const { binding, projectRef } = await createProjectFixture();

    await expect(
      prisma.$transaction((transaction) =>
        withTargetedExternalRefBackfillWriteGate(transaction, async (gated) => {
          await gated.externalRef.update({
            where: { id: projectRef.id },
            data: { bindingId: binding.id },
          });
          return randomUUID();
        }),
      ),
    ).rejects.toThrow(/targeted external reference/i);
    await expect(
      prisma.externalRef.findUniqueOrThrow({ where: { id: projectRef.id } }),
    ).resolves.toMatchObject({ bindingId: null });
  });

  it("classifies no, one, and multiple candidates deterministically", () => {
    expect(resolveBindingCandidates("connection-1", "project-1", [])).toEqual({
      bindingId: null,
      reason: "binding-not-found",
      candidateBindingIds: [],
    });
    expect(
      resolveBindingCandidates("connection-1", "project-1", [
        { id: "binding-1", connectionId: "connection-1", projectId: "project-1" },
      ]),
    ).toEqual({ bindingId: "binding-1" });
    expect(
      resolveBindingCandidates("connection-1", "project-1", [
        { id: "binding-2", connectionId: "connection-1", projectId: "project-1" },
        { id: "binding-1", connectionId: "connection-1", projectId: "project-1" },
      ]),
    ).toEqual({
      bindingId: null,
      reason: "ambiguous-binding",
      candidateBindingIds: ["binding-1", "binding-2"],
    });
  });

  it("rolls back a gated null-bound writer and releases the transaction lock", async () => {
    const { workspace, connection, projectRef } = await createProjectFixture();
    const rollbackProjectKey = `N${randomUUID().slice(0, 5).toUpperCase()}`;

    await backfillExternalRefBindings(prisma);

    await expect(
      withExternalRefBackfillWriteGate(concurrentPrisma, async (transaction) => {
        const rollbackProject = await transaction.project.create({
          data: {
            key: rollbackProjectKey,
            name: "Gated null-bound project",
            workspaceId: workspace.id,
          },
        });
        return transaction.externalRef.create({
          data: {
            entityType: "project",
            entityId: rollbackProject.id,
            externalId: "remote-gated-null-bound",
            connectionId: connection.id,
          },
        });
      }),
    ).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({
          entityType: "project",
          reason: "unbound-reference",
        }),
      ],
    });

    await expect(
      prisma.project.findFirst({ where: { key: rollbackProjectKey } }),
    ).resolves.toBeNull();
    await expect(
      prisma.externalRef.count({ where: { externalId: "remote-gated-null-bound" } }),
    ).resolves.toBe(0);
    await expect(
      prisma.externalRef.findUnique({ where: { id: projectRef.id } }),
    ).resolves.toMatchObject({ bindingId: expect.any(String) });
    await expect(tryAcquireBackfillWriteGate(concurrentPrisma)).resolves.toBe(true);
  });

  it("rolls back a gated binding ownership mutation with the writer's other changes", async () => {
    const { workspace, binding, project, projectRef } = await createProjectFixture();
    const replacementProject = await prisma.project.create({
      data: {
        key: `R${randomUUID().slice(0, 5).toUpperCase()}`,
        name: "Replacement project",
        workspaceId: workspace.id,
      },
    });

    await backfillExternalRefBindings(prisma);

    await expect(
      withExternalRefBackfillWriteGate(concurrentPrisma, async (transaction) => {
        await transaction.project.update({
          where: { id: project.id },
          data: { name: "Rolled back project mutation" },
        });
        return transaction.integrationProjectBinding.update({
          where: { id: binding.id },
          data: { projectId: replacementProject.id },
        });
      }),
    ).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({
          externalRefId: projectRef.id,
          reason: "binding-mismatch",
        }),
      ],
    });

    await expect(
      prisma.integrationProjectBinding.findUnique({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ projectId: project.id });
    await expect(
      prisma.externalRef.findUnique({ where: { id: projectRef.id } }),
    ).resolves.toMatchObject({ bindingId: binding.id });
    await expect(prisma.project.findUnique({ where: { id: project.id } })).resolves.toMatchObject(
      { name: "Backfill project" },
    );
    await expect(tryAcquireBackfillWriteGate(concurrentPrisma)).resolves.toBe(true);
  });

  it("commits a valid gated project, binding, and ExternalRef write", async () => {
    const { workspace, connection } = await createProjectFixture();
    const validProjectKey = `V${randomUUID().slice(0, 5).toUpperCase()}`;

    await backfillExternalRefBindings(prisma);

    const created = await withExternalRefBackfillWriteGate(
      concurrentPrisma,
      async (transaction) => {
        const project = await transaction.project.create({
          data: {
            key: validProjectKey,
            name: "Valid gated project",
            workspaceId: workspace.id,
          },
        });
        const binding = await transaction.integrationProjectBinding.create({
          data: {
            connectionId: connection.id,
            projectId: project.id,
            remoteProjectId: "remote-valid-gated",
            readMap: { "remote-open": "todo" },
            writeMap: { todo: "remote-open" },
          },
        });
        return transaction.externalRef.create({
          data: {
            entityType: "project",
            entityId: project.id,
            externalId: "remote-valid-gated",
            connectionId: connection.id,
            bindingId: binding.id,
          },
        });
      },
    );

    expect(created).toMatchObject({
      entityType: "project",
      connectionId: connection.id,
      bindingId: expect.any(String),
    });
    await expect(
      prisma.externalRef.findUnique({ where: { id: created.id } }),
    ).resolves.toMatchObject({
      entityId: created.entityId,
      bindingId: created.bindingId,
    });
    await expect(tryAcquireBackfillWriteGate(concurrentPrisma)).resolves.toBe(true);
  });

  it("uses the shared invariant validator for the backfill final proof", async () => {
    const { workspace, connection, projectRef } = await createProjectFixture();
    const invalidProject = await prisma.project.create({
      data: {
        key: `I${randomUUID().slice(0, 5).toUpperCase()}`,
        name: "Invalidly attached project",
        workspaceId: workspace.id,
      },
    });
    const invalidBinding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: invalidProject.id,
        remoteProjectId: "remote-invalid-final-proof",
        readMap: { "remote-open": "todo" },
        writeMap: { todo: "remote-open" },
      },
    });
    await prisma.externalRef.update({
      where: { id: projectRef.id },
      data: { bindingId: invalidBinding.id },
    });

    await expect(backfillExternalRefBindings(prisma)).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({
          externalRefId: projectRef.id,
          reason: "binding-mismatch",
        }),
      ],
    });
    await expect(
      prisma.externalRef.findUnique({ where: { id: projectRef.id } }),
    ).resolves.toMatchObject({ bindingId: invalidBinding.id });
    await expect(tryAcquireBackfillWriteGate(concurrentPrisma)).resolves.toBe(true);
  });

  it("excludes a participating insert until an owned gate transaction commits", async () => {
    const { workspace, connection, project } = await createProjectFixture();
    const unboundProject = await prisma.project.create({
      data: {
        key: `P${randomUUID().slice(0, 5).toUpperCase()}`,
        name: "Concurrent unbound project",
        workspaceId: workspace.id,
      },
    });
    const proofReady = createDeferred();
    const release = createDeferred();

    await backfillExternalRefBindings(prisma);

    const gatePromise = withExternalRefBackfillWriteGate(prisma, async (transaction) => {
      await transaction.project.update({
        where: { id: project.id },
        data: { name: "owned-gate-committed" },
      });
      proofReady.resolve();
      await release.promise;
      return transaction.project.findUnique({ where: { id: project.id } });
    });

    await proofReady.promise;
    await expect(tryAcquireBackfillWriteGate(concurrentPrisma)).resolves.toBe(false);

    const writerPromise = withExternalRefBackfillWriteGate(
      concurrentPrisma,
      async (transaction) => {
        await expect(
          transaction.project.findUnique({ where: { id: project.id } }),
        ).resolves.toMatchObject({ name: "owned-gate-committed" });
        return transaction.externalRef.create({
          data: {
            entityType: "project",
            entityId: unboundProject.id,
            externalId: "remote-concurrent-insert",
            connectionId: connection.id,
          },
        });
      },
    );
    release.resolve();

    await expect(gatePromise).resolves.toMatchObject({ name: "owned-gate-committed" });
    await expect(writerPromise).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({
          entityId: unboundProject.id,
          reason: "unbound-reference",
        }),
      ],
    });
    await expect(
      prisma.externalRef.count({
        where: { connectionId: connection.id, bindingId: null },
      }),
    ).resolves.toBe(0);
    await expect(tryAcquireBackfillWriteGate(concurrentPrisma)).resolves.toBe(true);
  });

  it("excludes a participating binding mutation until an owned gate transaction commits", async () => {
    const { workspace, binding, project, projectRef } = await createProjectFixture();
    const replacementProject = await prisma.project.create({
      data: {
        key: `M${randomUUID().slice(0, 5).toUpperCase()}`,
        name: "Concurrent replacement project",
        workspaceId: workspace.id,
      },
    });
    const proofReady = createDeferred();
    const release = createDeferred();

    await backfillExternalRefBindings(prisma);

    const gatePromise = withExternalRefBackfillWriteGate(prisma, async (transaction) => {
      await transaction.project.update({
        where: { id: project.id },
        data: { name: "owned-gate-mutation-committed" },
      });
      proofReady.resolve();
      await release.promise;
      return transaction.project.findUnique({ where: { id: project.id } });
    });

    await proofReady.promise;
    await expect(tryAcquireBackfillWriteGate(concurrentPrisma)).resolves.toBe(false);

    const mutationPromise = withExternalRefBackfillWriteGate(
      concurrentPrisma,
      (transaction) =>
        transaction.integrationProjectBinding.update({
          where: { id: binding.id },
          data: { projectId: replacementProject.id },
        }),
    );
    release.resolve();

    await expect(gatePromise).resolves.toMatchObject({
      name: "owned-gate-mutation-committed",
    });
    await expect(mutationPromise).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({
          externalRefId: projectRef.id,
          reason: "binding-mismatch",
        }),
      ],
    });
    await expect(
      prisma.integrationProjectBinding.findUnique({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ projectId: project.id });
    await expect(
      prisma.externalRef.findUnique({ where: { id: projectRef.id } }),
    ).resolves.toMatchObject({ bindingId: binding.id });
    await expect(
      prisma.project.findUnique({ where: { id: project.id } }),
    ).resolves.toMatchObject({ name: "owned-gate-mutation-committed" });
    await expect(tryAcquireBackfillWriteGate(concurrentPrisma)).resolves.toBe(true);
  });

  it("rejects a gated cross-workspace binding mutation without committing it", async () => {
    const { binding, project, projectRef } = await createProjectFixture();
    const foreignWorkspace = await prisma.workspace.create({
      data: {
        name: "Foreign binding workspace",
        slug: `backfill-foreign-${randomUUID()}`,
      },
    });
    workspaceIds.add(foreignWorkspace.id);
    const foreignProject = await prisma.project.create({
      data: {
        key: `F${randomUUID().slice(0, 5).toUpperCase()}`,
        name: "Foreign binding project",
        workspaceId: foreignWorkspace.id,
      },
    });

    await backfillExternalRefBindings(prisma);

    await expect(
      withExternalRefBackfillWriteGate(concurrentPrisma, (transaction) =>
        transaction.integrationProjectBinding.update({
          where: { id: binding.id },
          data: { projectId: foreignProject.id },
        }),
      ),
    ).rejects.toMatchObject({
      name: ExternalRefBackfillInvariantError.name,
      violations: [
        expect.objectContaining({
          externalRefId: projectRef.id,
          reason: "tenant-mismatch",
        }),
      ],
    });
    await expect(
      prisma.integrationProjectBinding.findUnique({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ projectId: project.id });
    await expect(tryAcquireBackfillWriteGate(concurrentPrisma)).resolves.toBe(true);
  });
});
