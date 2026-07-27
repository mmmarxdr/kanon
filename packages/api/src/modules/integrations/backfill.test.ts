import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  backfillExternalRefBindings,
  backfillExternalRefBindingsInTransaction,
  ExternalRefBackfillError,
  resolveBindingCandidates,
} from "./backfill.js";

const workspaceIds = new Set<string>();

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
  await prisma.$disconnect();
});

describe("external reference binding backfill core", () => {
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
    await createExternalRef(
      connection.id,
      "project",
      alreadyBoundProject.id,
      binding.id,
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

  it("participates in an outer transaction so a caller rollback undoes the plan", async () => {
    const { projectRef } = await createProjectFixture();

    await expect(
      prisma.$transaction(async (transaction) => {
        const result = await backfillExternalRefBindingsInTransaction(transaction);
        expect(result.snapshot.zeroUnresolved).toBe(true);
        throw new Error("forced core rollback");
      }),
    ).rejects.toThrow("forced core rollback");

    await expect(
      prisma.externalRef.findUnique({ where: { id: projectRef.id } }),
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
});
