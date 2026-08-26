import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import type {
  PmProviderAdapter,
  ProviderCreateReconciler,
  PushResult,
} from "./core/types.js";
import { claimIntegrationWork } from "./claims.js";
import { RedmineHttpError } from "./providers/redmine/http-client.js";
import {
  readIntegrationWorkerStartupSnapshot,
  runIntegrationWorkerCycle,
  type IntegrationWorkerDependencies,
} from "./worker.js";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const workspaceIds = new Set<string>();
const userIds = new Set<string>();

async function createFixture(
  entityType: "issue" | "cycle" | "project" = "issue",
) {
  const workspace = await prisma.workspace.create({
    data: { name: "Ambiguity workspace", slug: `ambiguity-${randomUUID()}` },
  });
  workspaceIds.add(workspace.id);
  const project = await prisma.project.create({
    data: {
      key: `A${randomUUID().slice(0, 5).toUpperCase()}`,
      name: "Ambiguity project",
      workspaceId: workspace.id,
    },
  });
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://pm.example.test",
      lifecycle: "active",
      lifecycleEpoch: 3,
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
      lifecycleEpoch: 3,
    },
  });
  const user = await prisma.user.create({
    data: { email: `ambiguity-${randomUUID()}@kanon.test`, passwordHash: "unused" },
  });
  userIds.add(user.id);
  const member = await prisma.member.create({
    data: {
      username: `ambiguity-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      workspaceId: workspace.id,
    },
  });
  const credential = await prisma.memberIntegrationCredential.create({
    data: {
      encryptedKey: "encrypted-api-key",
      lastAuthStatus: "valid",
      memberId: member.id,
      connectionId: connection.id,
    },
  });
  const entity =
    entityType === "issue"
      ? await prisma.issue.create({
          data: {
            key: `${project.key}-1`,
            sequenceNum: 1,
            title: "Ambiguous issue",
            projectId: project.id,
          },
        })
      : entityType === "cycle"
        ? await prisma.cycle.create({
            data: {
              name: "Ambiguous cycle",
              startDate: NOW,
              endDate: new Date(NOW.getTime() + 86_400_000),
              projectId: project.id,
            },
          })
        : project;
  const work = await prisma.integrationSyncWork.create({
    data: {
      bindingId: binding.id,
      entityType,
      entityId: entity.id,
      direction: "outbound",
      operation: "create",
      dedupeKey: randomUUID(),
      laneKey: randomUUID(),
      actorKey: `member:${member.id}`,
      actorKind: "user",
      authCredentialId: credential.id,
      payload:
        entityType === "issue"
          ? { version: 1, fields: { title: "Ambiguous issue" }, issue: {} }
          : {},
      correlationId: randomUUID(),
      state: "ambiguous",
      availableAt: NOW,
      epoch: binding.lifecycleEpoch,
    },
  });
  return { workspace, project, connection, binding, credential, entity, work };
}

function evidence(externalId: string): PushResult {
  return {
    externalId,
    requestedStatusId: null,
    achievedStatusId: "2",
    remoteVersion: "2026-07-30T12:00:01.000Z",
  };
}

function createLaterWork(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  epoch = fixture.binding.lifecycleEpoch,
) {
  return prisma.integrationSyncWork.create({
    data: {
      bindingId: fixture.binding.id,
      entityType: fixture.work.entityType,
      entityId: fixture.work.entityId,
      direction: "outbound",
      operation: "update",
      dedupeKey: randomUUID(),
      laneKey: fixture.work.laneKey,
      actorKey: fixture.work.actorKey,
      actorKind: fixture.work.actorKind,
      authCredentialId: fixture.credential.id,
      payload: fixture.work.payload,
      correlationId: randomUUID(),
      availableAt: NOW,
      epoch,
    },
  });
}

function dependencies(reconcileCreate: ProviderCreateReconciler["reconcileCreate"], now = () => NOW) {
  const provider: Pick<
    PmProviderAdapter,
    "ensureProject" | "ensureCycle" | "pushIssue" | "reconcileCreate"
  > = {
    ensureProject: vi.fn(),
    ensureCycle: vi.fn(),
    pushIssue: vi.fn(),
    reconcileCreate,
  };
  return {
    now,
    jitter: () => 0,
    decrypt: () => "api-key-do-not-persist",
    createAdapter: () => provider,
    claim: vi.fn().mockResolvedValue([]),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } satisfies IntegrationWorkerDependencies;
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

afterAll(() => prisma.$disconnect());

describe("integration ambiguity reconciliation", () => {
  it("attaches one exact remote match and completes the fenced work", async () => {
    const fixture = await createFixture();
    const reconcileCreate = vi.fn(async () => {
      await expect(prisma.$queryRaw`SELECT "state","provider_io_fence" FROM "integration_sync_work" WHERE "id"=${fixture.work.id}::uuid`).resolves.toEqual([{ state: "leased", provider_io_fence: 1 }]);
      return [evidence("remote-42")];
    });

    await runIntegrationWorkerCycle(prisma, dependencies(reconcileCreate, () => new Date()));

    expect(reconcileCreate).toHaveBeenCalledWith({
      entityType: "issue",
      entityId: fixture.entity.id,
      remoteProjectId: fixture.binding.remoteProjectId,
    });
    const completed = await prisma.integrationSyncWork.findUniqueOrThrow({
      where: { id: fixture.work.id },
    });
    expect(completed).toMatchObject({ state: "done", actualStatus: "2" });
    await expect(prisma.$queryRaw`SELECT "provider_io_fence" FROM "integration_sync_work" WHERE "id"=${fixture.work.id}::uuid`).resolves.toEqual([{ provider_io_fence: null }]);
    await expect(
      prisma.externalRef.findUniqueOrThrow({ where: { id: completed.refId! } }),
    ).resolves.toMatchObject({
      bindingId: fixture.binding.id,
      connectionId: fixture.connection.id,
      entityType: "issue",
      entityId: fixture.entity.id,
      externalId: "remote-42",
    });
  });

  it("does not reconcile unresolved provider I/O", async () => {
    const fixture = await createFixture();
    await prisma.$executeRaw`UPDATE "integration_sync_work" SET "provider_io_fence"=0 WHERE "id"=${fixture.work.id}::uuid`;
    const reconcileCreate = vi.fn();

    await runIntegrationWorkerCycle(prisma, dependencies(reconcileCreate));

    expect(reconcileCreate).not.toHaveBeenCalled();
  });

  it("persists one secret-free conflict for zero matches and keeps the lane ambiguous", async () => {
    const fixture = await createFixture();
    const reconcileCreate = vi.fn().mockResolvedValue([]);
    const deps = dependencies(reconcileCreate);

    await runIntegrationWorkerCycle(prisma, deps);
    await runIntegrationWorkerCycle(prisma, deps);

    expect(reconcileCreate).toHaveBeenCalledOnce();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: fixture.work.id } }),
    ).resolves.toMatchObject({ state: "ambiguous", leaseToken: null, leaseUntil: null });
    const conflicts = await prisma.integrationConflict.findMany({
      where: { workId: fixture.work.id, state: "open" },
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "outbound-create-ambiguity",
      bindingId: fixture.binding.id,
      remoteEvidence: { reason: "zero-matches", matchCount: 0, matches: [] },
    });
    expect(JSON.stringify(conflicts)).not.toContain("api-key-do-not-persist");
    expect(JSON.stringify(conflicts)).not.toContain("encrypted-api-key");
  });

  it("persists conflict evidence for multiple matches or a terminal read failure", async () => {
    const multiple = await createFixture();
    const matches = Array.from({ length: 12 }, (_, index) => evidence(String(12 - index)));
    await runIntegrationWorkerCycle(
      prisma,
      dependencies(vi.fn().mockResolvedValue(matches)),
    );
    const conflict = await prisma.integrationConflict.findFirstOrThrow({
      where: { workId: multiple.work.id },
    });
    expect(conflict).toMatchObject({
      remoteEvidence: {
        reason: "multiple-matches",
        matchCount: 12,
      },
    });
    expect((conflict.remoteEvidence as { matches: PushResult[] }).matches).toHaveLength(10);
    expect(
      (conflict.remoteEvidence as { matches: PushResult[] }).matches.map(({ externalId }) =>
        externalId,
      ),
    ).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);

    const terminal = await createFixture();
    await runIntegrationWorkerCycle(
      prisma,
      dependencies(vi.fn().mockRejectedValue(new RedmineHttpError(400))),
    );
    await expect(
      prisma.integrationConflict.findFirstOrThrow({ where: { workId: terminal.work.id } }),
    ).resolves.toMatchObject({
      remoteEvidence: {
        reason: "terminal-read-failure",
        error: { name: "RedmineHttpError", statusCode: 400 },
      },
    });
  });

  it("backs off transient reads while remaining ambiguous without a conflict", async () => {
    const fixture = await createFixture();
    const error = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });

    await runIntegrationWorkerCycle(
      prisma,
      dependencies(vi.fn().mockRejectedValue(error)),
    );

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: fixture.work.id } }),
    ).resolves.toMatchObject({
      state: "ambiguous",
      attempts: 1,
      availableAt: new Date(NOW.getTime() + 30_000),
      leaseToken: null,
      leaseUntil: null,
    });
    await expect(
      prisma.integrationConflict.count({ where: { workId: fixture.work.id } }),
    ).resolves.toBe(0);
  });

  it("turns current-epoch refs into safe retries and stale-epoch refs into superseded work", async () => {
    const current = await createFixture();
    await prisma.externalRef.create({
      data: {
        connectionId: current.connection.id,
        bindingId: current.binding.id,
        entityType: "issue",
        entityId: current.entity.id,
        externalId: "remote-current",
      },
    });
    const currentReconcile = vi.fn();
    await runIntegrationWorkerCycle(prisma, dependencies(currentReconcile));
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: current.work.id } }),
    ).resolves.toMatchObject({ state: "retry", leaseToken: null });
    expect(currentReconcile).not.toHaveBeenCalled();

    const stale = await createFixture();
    await prisma.externalRef.create({
      data: {
        connectionId: stale.connection.id,
        bindingId: stale.binding.id,
        entityType: "issue",
        entityId: stale.entity.id,
        externalId: "remote-stale",
      },
    });
    await prisma.integrationSyncWork.update({
      where: { id: stale.work.id },
      data: { epoch: stale.binding.lifecycleEpoch - 1 },
    });
    const staleReconcile = vi.fn();
    await runIntegrationWorkerCycle(prisma, dependencies(staleReconcile));
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: stale.work.id } }),
    ).resolves.toMatchObject({ state: "superseded", leaseToken: null });
    expect(staleReconcile).not.toHaveBeenCalled();
  });

  it("keeps a stale unresolved create and its lane blocked behind one manual conflict", async () => {
    const fixture = await createFixture();
    await prisma.integrationSyncWork.update({
      where: { id: fixture.work.id },
      data: { epoch: fixture.binding.lifecycleEpoch - 1 },
    });
    const later = await createLaterWork(fixture);
    const reconcileCreate = vi.fn();

    await runIntegrationWorkerCycle(prisma, dependencies(reconcileCreate));

    expect(reconcileCreate).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: fixture.work.id } }),
    ).resolves.toMatchObject({ state: "ambiguous", leaseToken: null });
    await expect(
      prisma.integrationConflict.findMany({
        where: { workId: fixture.work.id, state: "open" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        remoteEvidence: expect.objectContaining({ reason: "stale-epoch-unresolved" }),
      }),
    ]);
    await expect(claimIntegrationWork(prisma, { now: NOW, limit: 1 })).resolves.toEqual([]);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: later.id } }),
    ).resolves.toMatchObject({ state: "queued" });
  });

  it("attaches one exact match when the binding epoch changes during the provider read", async () => {
    const fixture = await createFixture();
    const reconcileCreate = vi.fn(async () => {
      await prisma.integrationProjectBinding.update({
        where: { id: fixture.binding.id },
        data: { lifecycleEpoch: fixture.binding.lifecycleEpoch + 1 },
      });
      return [evidence("remote-after-epoch")];
    });

    await runIntegrationWorkerCycle(prisma, dependencies(reconcileCreate));

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: fixture.work.id } }),
    ).resolves.toMatchObject({ state: "done", actualStatus: "2" });
    await expect(
      prisma.externalRef.findFirstOrThrow({ where: { entityId: fixture.entity.id } }),
    ).resolves.toMatchObject({ externalId: "remote-after-epoch" });
  });

  it("turns zero, terminal, and transient reads into stale-epoch manual conflicts", async () => {
    for (const outcome of ["zero", "terminal", "transient"] as const) {
      const fixture = await createFixture();
      let later: Awaited<ReturnType<typeof createLaterWork>> | undefined;
      const reconcileCreate = vi.fn(async () => {
        const epoch = fixture.binding.lifecycleEpoch + 1;
        await prisma.integrationProjectBinding.update({
          where: { id: fixture.binding.id },
          data: { lifecycleEpoch: epoch },
        });
        later = await createLaterWork(fixture, epoch);
        if (outcome === "terminal") throw new RedmineHttpError(400);
        if (outcome === "transient") {
          throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
        }
        return [];
      });
      const deps = dependencies(reconcileCreate);

      await runIntegrationWorkerCycle(prisma, deps);
      await runIntegrationWorkerCycle(prisma, deps);

      expect(reconcileCreate, outcome).toHaveBeenCalledOnce();
      await expect(
        prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: fixture.work.id } }),
      ).resolves.toMatchObject({ state: "ambiguous", leaseToken: null, leaseUntil: null });
      await expect(
        prisma.integrationConflict.findMany({
          where: { workId: fixture.work.id, state: "open" },
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          remoteEvidence: expect.objectContaining({ reason: "stale-epoch-unresolved" }),
        }),
      ]);
      await expect(claimIntegrationWork(prisma, { now: NOW, limit: 1 })).resolves.toEqual([]);
      await expect(
        prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: later!.id } }),
      ).resolves.toMatchObject({ state: "queued" });
    }
  });

  it("conflicts instead of overwriting a local ref with a different exact match", async () => {
    const fixture = await createFixture();
    const reconcileCreate = vi.fn(async () => {
      await prisma.externalRef.create({
        data: {
          connectionId: fixture.connection.id,
          bindingId: fixture.binding.id,
          entityType: "issue",
          entityId: fixture.entity.id,
          externalId: "remote-existing",
        },
      });
      return [evidence("remote-marker-match")];
    });

    await runIntegrationWorkerCycle(prisma, dependencies(reconcileCreate));

    await expect(
      prisma.externalRef.findFirstOrThrow({ where: { entityId: fixture.entity.id } }),
    ).resolves.toMatchObject({ externalId: "remote-existing" });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: fixture.work.id } }),
    ).resolves.toMatchObject({ state: "ambiguous" });
    await expect(
      prisma.integrationConflict.findFirstOrThrow({ where: { workId: fixture.work.id } }),
    ).resolves.toMatchObject({
      remoteEvidence: expect.objectContaining({ reason: "external-reference-collision" }),
    });
  });

  it("conflicts instead of stealing an exact-match external ID from another entity", async () => {
    const fixture = await createFixture();
    const sibling = await prisma.issue.create({
      data: {
        key: `${fixture.project.key}-2`,
        sequenceNum: 2,
        title: "Sibling issue",
        projectId: fixture.project.id,
      },
    });
    const siblingRef = await prisma.externalRef.create({
      data: {
        connectionId: fixture.connection.id,
        bindingId: fixture.binding.id,
        entityType: "issue",
        entityId: sibling.id,
        externalId: "remote-shared",
      },
    });

    await runIntegrationWorkerCycle(
      prisma,
      dependencies(vi.fn().mockResolvedValue([evidence("remote-shared")])),
    );

    await expect(
      prisma.externalRef.findUniqueOrThrow({ where: { id: siblingRef.id } }),
    ).resolves.toMatchObject({ entityId: sibling.id, externalId: "remote-shared" });
    await expect(
      prisma.externalRef.count({ where: { entityId: fixture.entity.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.integrationConflict.findFirstOrThrow({ where: { workId: fixture.work.id } }),
    ).resolves.toMatchObject({
      remoteEvidence: expect.objectContaining({ reason: "external-reference-collision" }),
    });
  });

  it("opens one conflict and suppresses reads when transient attempts reach eight", async () => {
    const fixture = await createFixture();
    await prisma.integrationSyncWork.update({
      where: { id: fixture.work.id },
      data: { attempts: 7 },
    });
    const error = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const reconcileCreate = vi.fn().mockRejectedValue(error);
    const deps = dependencies(reconcileCreate);

    await runIntegrationWorkerCycle(prisma, deps);
    await runIntegrationWorkerCycle(prisma, deps);

    expect(reconcileCreate).toHaveBeenCalledOnce();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: fixture.work.id } }),
    ).resolves.toMatchObject({ state: "ambiguous", attempts: 8, leaseToken: null });
    await expect(
      prisma.integrationConflict.findMany({
        where: { workId: fixture.work.id, state: "open" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        remoteEvidence: expect.objectContaining({ reason: "transient-read-exhausted" }),
      }),
    ]);
  });

  it("requires manual conflict resolution for project creates without a stable marker", async () => {
    const fixture = await createFixture("project");
    const reconcileCreate = vi.fn();

    await runIntegrationWorkerCycle(prisma, dependencies(reconcileCreate));

    expect(reconcileCreate).not.toHaveBeenCalled();
    await expect(
      prisma.integrationConflict.findFirstOrThrow({ where: { workId: fixture.work.id } }),
    ).resolves.toMatchObject({
      remoteEvidence: { reason: "no-stable-marker", entityType: "project" },
    });
  });

  it("does not attach a match after a newer fence takes ownership", async () => {
    const fixture = await createFixture("cycle");
    const reconcileCreate = vi.fn(async () => {
      await prisma.integrationSyncWork.update({
        where: { id: fixture.work.id },
        data: {
          fence: { increment: 1 },
          leaseToken: "newer-owner",
          leaseUntil: new Date("2999-01-01T00:00:00.000Z"),
        },
      });
      return [evidence("remote-cycle")];
    });

    await runIntegrationWorkerCycle(prisma, dependencies(reconcileCreate));

    await expect(
      prisma.externalRef.count({
        where: { connectionId: fixture.connection.id, entityId: fixture.entity.id },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: fixture.work.id } }),
    ).resolves.toMatchObject({ state: "leased", leaseToken: "newer-owner" });
  });

  it("reports a DB-clock startup snapshot without credentials or payloads", async () => {
    const queued = await createFixture();
    await prisma.integrationSyncWork.update({
      where: { id: queued.work.id },
      data: { state: "queued" },
    });
    const dead = await createFixture();
    await prisma.integrationSyncWork.update({
      where: { id: dead.work.id },
      data: { state: "dead" },
    });

    await expect(readIntegrationWorkerStartupSnapshot(prisma, { now: NOW })).resolves.toEqual({
      queued: 1,
      retry: 0,
      ambiguous: 0,
      dead: 1,
      oldestDueAt: NOW,
    });
  });
});
