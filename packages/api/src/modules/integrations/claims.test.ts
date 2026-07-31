import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { claimIntegrationWork } from "./claims.js";
import { captureIntegrationWorkTx } from "./outbox.js";

const concurrentPrisma = new PrismaClient();
const workspaceIds = new Set<string>();
const userIds = new Set<string>();

async function createFixture(
  bindingLifecycle: "active" | "paused" = "active",
  connectionLifecycle: "active" | "paused" | "draft" = bindingLifecycle
) {
  const workspace = await prisma.workspace.create({
    data: { name: "Claims test workspace", slug: `claims-${randomUUID()}` },
  });
  workspaceIds.add(workspace.id);
  const project = await prisma.project.create({
    data: {
      key: `C${randomUUID().slice(0, 5).toUpperCase()}`,
      name: "Claims test project",
      workspaceId: workspace.id,
    },
  });
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://pm.example.test",
      lifecycle: connectionLifecycle,
      lifecycleEpoch: 3,
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
      lifecycle: bindingLifecycle,
      lifecycleEpoch: 3,
    },
  });
  const issue = await prisma.issue.create({
    data: {
      key: `C-${randomUUID().slice(0, 8).toUpperCase()}`,
      sequenceNum: 1,
      title: "Claims test issue",
      projectId: project.id,
    },
  });
  return { workspace, connection, binding, issue };
}

function createWork(
  binding: Awaited<ReturnType<typeof createFixture>>["binding"],
  overrides: Partial<Prisma.IntegrationSyncWorkUncheckedCreateInput> = {}
) {
  return prisma.integrationSyncWork.create({
    data: {
      bindingId: binding.id,
      entityType: "issue",
      entityId: randomUUID(),
      direction: "outbound",
      operation: "update",
      dedupeKey: randomUUID(),
      laneKey: randomUUID(),
      actorKey: "member:actor",
      actorKind: "user",
      payload: { version: 1, fields: { title: "title" }, issue: { title: "title" } },
      correlationId: randomUUID(),
      epoch: binding.lifecycleEpoch,
      ...overrides,
    },
  });
}

async function createCredential(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const user = await prisma.user.create({
    data: { email: `claims-${randomUUID()}@kanon.test`, passwordHash: "unused" },
  });
  userIds.add(user.id);
  const member = await prisma.member.create({
    data: {
      username: `claims-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      workspaceId: fixture.workspace.id,
    },
  });
  return prisma.memberIntegrationCredential.create({
    data: { encryptedKey: "ciphertext", memberId: member.id, connectionId: fixture.connection.id },
  });
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function beforeTransaction(
  client: PrismaClient,
  before: (transaction: Prisma.TransactionClient) => Promise<unknown>
) {
  return {
    $transaction: (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      client.$transaction(async (transaction) => {
        await before(transaction);
        return operation(transaction);
      }),
  } as unknown as Pick<PrismaClient, "$transaction">;
}

function holdTransaction(client: PrismaClient, started: () => void, release: Promise<void>) {
  return {
    $transaction: (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      client.$transaction(async (transaction) => {
        const result = await operation(transaction);
        started();
        await release;
        return result;
      }),
  } as unknown as Pick<PrismaClient, "$transaction">;
}

beforeEach(() => prisma.integrationSyncWork.deleteMany());

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

describe("claimIntegrationWork", () => {
  it("defaults leases beyond the bounded provider request budget", async () => {
    const { binding } = await createFixture();
    const now = new Date("2026-07-30T12:00:00.000Z");
    await createWork(binding, { availableAt: now });

    const [claimed] = await claimIntegrationWork(prisma, { now, limit: 1 });

    expect(claimed?.leaseUntil).toEqual(new Date(now.getTime() + 120_000));
  });

  it("validates bounds and leases only due outbound queued or retry work", async () => {
    for (const options of [
      { limit: 0, leaseMs: 1 },
      { limit: 1.5, leaseMs: 1 },
      { limit: 1, leaseMs: 0 },
      { limit: 1, leaseMs: 1.5 },
    ]) {
      await expect(claimIntegrationWork(prisma, options)).rejects.toThrow(RangeError);
    }

    const { binding } = await createFixture();
    const now = new Date("2026-07-30T12:00:00.000Z");
    const queued = await createWork(binding, { availableAt: now, fence: 2 });
    const retry = await createWork(binding, {
      state: "retry",
      availableAt: new Date(now.getTime() - 1),
    });
    const future = await createWork(binding, { availableAt: new Date(now.getTime() + 1) });
    const inbound = await createWork(binding, { direction: "inbound", availableAt: now });
    const done = await createWork(binding, { state: "done", availableAt: now });

    const claimed = await claimIntegrationWork(prisma, { now, limit: 10, leaseMs: 2_000 });

    expect(claimed.map((row) => row.id)).toEqual([queued.id, retry.id]);
    expect(claimed.map((row) => row.leaseToken).every(Boolean)).toBe(true);
    expect(new Set(claimed.map((row) => row.leaseToken)).size).toBe(2);
    expect(claimed.map((row) => row.leaseUntil)).toEqual([
      new Date(now.getTime() + 2_000),
      new Date(now.getTime() + 2_000),
    ]);
    expect(claimed.map((row) => [row.state, row.fence])).toEqual([
      ["leased", 3],
      ["leased", 1],
    ]);
    await expect(
      prisma.integrationSyncWork.findMany({
        where: { id: { in: [future.id, inbound.id, done.id] } },
        orderBy: { sequence: "asc" },
        select: { state: true },
      })
    ).resolves.toEqual([{ state: "queued" }, { state: "queued" }, { state: "done" }]);
  });

  it("requires active parents and preserves stale uncertain lane barriers", async () => {
    const active = await createFixture();
    const paused = await createFixture("paused");
    const draftParent = await createFixture("active", "draft");
    const staleQueuedLane = randomUUID();
    const stale = await createWork(active.binding, { epoch: 2, laneKey: staleQueuedLane });
    const current = await createWork(active.binding, { laneKey: staleQueuedLane });
    const staleLeasedLane = randomUUID();
    const staleLeased = await createWork(active.binding, {
      epoch: 2,
      laneKey: staleLeasedLane,
      state: "leased",
      leaseToken: "stale-lease",
      leaseUntil: new Date(Date.now() + 60_000),
    });
    const afterStaleLease = await createWork(active.binding, { laneKey: staleLeasedLane });
    const staleAmbiguousLane = randomUUID();
    const staleAmbiguous = await createWork(active.binding, {
      epoch: 2,
      laneKey: staleAmbiguousLane,
      state: "ambiguous",
    });
    const afterStaleAmbiguous = await createWork(active.binding, { laneKey: staleAmbiguousLane });
    const inactive = await createWork(paused.binding);
    const parentInactive = await createWork(draftParent.binding);

    const claimed = await claimIntegrationWork(prisma, { limit: 10, leaseMs: 1_000 });

    expect(claimed.map((row) => row.id)).toEqual([current.id]);
    await expect(
      prisma.integrationSyncWork.findMany({
        where: {
          id: {
            in: [
              stale.id,
              staleLeased.id,
              afterStaleLease.id,
              staleAmbiguous.id,
              afterStaleAmbiguous.id,
              inactive.id,
              parentInactive.id,
            ],
          },
        },
        select: { state: true },
      })
    ).resolves.toEqual(
      expect.arrayContaining([{ state: "queued" }, { state: "leased" }, { state: "ambiguous" }])
    );
  });

  it("uses the oldest genuinely claimable head before the parent UUID", async () => {
    const fixtures = [await createFixture(), await createFixture(), await createFixture()].sort(
      (left, right) => left.connection.id.localeCompare(right.connection.id)
    );
    const [blocked, newer, oldest] = fixtures as [
      Awaited<ReturnType<typeof createFixture>>,
      Awaited<ReturnType<typeof createFixture>>,
      Awaited<ReturnType<typeof createFixture>>,
    ];
    const blockedLane = randomUUID();
    await createWork(blocked.binding, {
      laneKey: blockedLane,
      state: "leased",
      leaseToken: "blocked-parent",
      leaseUntil: new Date(Date.now() + 60_000),
    });
    await createWork(blocked.binding, { laneKey: blockedLane });
    const oldestHead = await createWork(oldest.binding);
    const newerHead = await createWork(newer.binding);

    const claimed = await claimIntegrationWork(prisma, { limit: 1, leaseMs: 1_000 });

    expect(claimed.map((row) => row.id)).toEqual([oldestHead.id]);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: newerHead.id } })
    ).resolves.toMatchObject({ state: "queued" });
  });

  it("coalesces only contiguous unleased updates while preserving lane barriers", async () => {
    const { binding } = await createFixture();
    const updateLane = randomUUID();
    const oldUpdate = await createWork(binding, { laneKey: updateLane });
    const newestUpdate = await createWork(binding, {
      laneKey: updateLane,
      correlationId: "newest-correlation",
    });
    const close = await createWork(binding, { laneKey: updateLane, operation: "close" });
    const afterClose = await createWork(binding, { laneKey: updateLane });
    const orderedLane = randomUUID();
    const create = await createWork(binding, { laneKey: orderedLane, operation: "create" });
    const afterCreate = await createWork(binding, { laneKey: orderedLane });
    const blockedLane = randomUUID();
    const leased = await createWork(binding, {
      laneKey: blockedLane,
      state: "leased",
      leaseToken: "existing-lease",
      leaseUntil: new Date(Date.now() + 60_000),
    });
    const afterLease = await createWork(binding, { laneKey: blockedLane });
    const terminalLane = randomUUID();
    const beforeTerminal = await createWork(binding, { laneKey: terminalLane });
    const terminal = await createWork(binding, { laneKey: terminalLane, state: "done" });
    const afterTerminal = await createWork(binding, { laneKey: terminalLane });
    const ambiguousLane = randomUUID();
    const ambiguous = await createWork(binding, { laneKey: ambiguousLane, state: "ambiguous" });
    const afterAmbiguous = await createWork(binding, { laneKey: ambiguousLane });

    const claimed = await claimIntegrationWork(prisma, { limit: 10, leaseMs: 1_000 });

    expect(claimed.map((row) => row.id)).toEqual([newestUpdate.id, create.id, beforeTerminal.id]);
    expect(claimed[0]).toMatchObject({
      actorKey: "member:actor",
      correlationId: "newest-correlation",
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: oldUpdate.id } })
    ).resolves.toMatchObject({ state: "superseded", leaseToken: null });
    for (const row of [close, afterClose, afterCreate, afterLease]) {
      await expect(
        prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: row.id } })
      ).resolves.toMatchObject({ state: "queued", leaseToken: null });
    }
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: leased.id } })
    ).resolves.toMatchObject({ state: "leased", leaseToken: "existing-lease" });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: terminal.id } })
    ).resolves.toMatchObject({ state: "done", leaseToken: null });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: afterTerminal.id } })
    ).resolves.toMatchObject({ state: "queued", leaseToken: null });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: ambiguous.id } })
    ).resolves.toMatchObject({ state: "ambiguous", leaseToken: null });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: afterAmbiguous.id } })
    ).resolves.toMatchObject({ state: "queued", leaseToken: null });
  });

  it("treats actor, credential, and non-canonical updates as coalescing barriers", async () => {
    const fixture = await createFixture();
    const credential = await createCredential(fixture);
    const actorLane = randomUUID();
    const actorHead = await createWork(fixture.binding, { laneKey: actorLane });
    const differentActor = await createWork(fixture.binding, {
      laneKey: actorLane,
      actorKey: "member:other",
    });
    const kindLane = randomUUID();
    const kindHead = await createWork(fixture.binding, { laneKey: kindLane });
    const differentKind = await createWork(fixture.binding, { laneKey: kindLane, actorKind: "ai" });
    const credentialLane = randomUUID();
    const credentialHead = await createWork(fixture.binding, { laneKey: credentialLane });
    const differentCredential = await createWork(fixture.binding, {
      laneKey: credentialLane,
      authCredentialId: credential.id,
    });
    const malformedLane = randomUUID();
    const canonicalHead = await createWork(fixture.binding, { laneKey: malformedLane });
    const malformed = await createWork(fixture.binding, {
      laneKey: malformedLane,
      payload: { version: 1, fields: [] },
    });

    const claimed = await claimIntegrationWork(prisma, { limit: 10, leaseMs: 1_000 });

    expect(claimed.map((row) => row.id)).toEqual([
      actorHead.id,
      kindHead.id,
      credentialHead.id,
      canonicalHead.id,
    ]);
    for (const row of [differentActor, differentKind, differentCredential, malformed]) {
      await expect(
        prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: row.id } })
      ).resolves.toMatchObject({ state: "queued", leaseToken: null });
    }
  });

  it("merges canonical partial fields into the newest row and snapshot", async () => {
    const { binding } = await createFixture();
    const laneKey = randomUUID();
    const first = await createWork(binding, {
      laneKey,
      payload: { version: 1, fields: { title: "first" }, issue: { title: "first", state: "todo" } },
    });
    const second = await createWork(binding, {
      laneKey,
      payload: {
        version: 1,
        fields: { state: "in_progress" },
        issue: { title: "first", state: "in_progress" },
      },
    });
    const newest = await createWork(binding, {
      laneKey,
      payload: {
        version: 1,
        fields: { title: "latest" },
        issue: { title: "latest", state: "in_progress" },
      },
    });

    const [claimed] = await claimIntegrationWork(prisma, { limit: 1, leaseMs: 1_000 });

    expect(claimed).toMatchObject({
      id: newest.id,
      payload: {
        version: 1,
        fields: { title: "latest", state: "in_progress" },
        issue: { title: "latest", state: "in_progress" },
      },
    });
    await expect(
      prisma.integrationSyncWork.count({
        where: { id: { in: [first.id, second.id] }, state: "superseded" },
      })
    ).resolves.toBe(2);
  });

  it("claims a retry individually before newer queued work", async () => {
    const { binding } = await createFixture();
    const laneKey = randomUUID();
    const retry = await createWork(binding, {
      laneKey,
      state: "retry",
      fence: 2,
    });
    const queued = await createWork(binding, { laneKey });

    const [claimed] = await claimIntegrationWork(prisma, { limit: 1, leaseMs: 1_000 });

    expect(claimed).toMatchObject({ id: retry.id, state: "leased", fence: 3 });
    expect(claimed?.leaseToken).toBeTruthy();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: queued.id } })
    ).resolves.toMatchObject({ state: "queued", leaseToken: null });
  });

  it("bounds coalescing independently of the claim limit", async () => {
    const { binding } = await createFixture();
    const laneKey = randomUUID();
    for (let start = 0; start < 10_000; start += 500) {
      await prisma.integrationSyncWork.createMany({
        data: Array.from({ length: 500 }, (_, offset) => ({
          bindingId: binding.id,
          entityType: "issue",
          entityId: randomUUID(),
          direction: "outbound" as const,
          operation: "update" as const,
          dedupeKey: randomUUID(),
          laneKey,
          actorKey: "member:actor",
          actorKind: "user" as const,
          payload: { version: 1, fields: { title: `${start + offset}` }, issue: {} },
          correlationId: randomUUID(),
          epoch: binding.lifecycleEpoch,
        })),
      });
    }
    const work = await prisma.integrationSyncWork.findMany({
      where: { bindingId: binding.id, laneKey },
      orderBy: { sequence: "asc" },
      select: { id: true },
    });
    const timedDatabase = beforeTransaction(
      prisma,
      (transaction) => transaction.$queryRaw`SELECT set_config('statement_timeout', '1000ms', true)`
    );

    const claimed = await claimIntegrationWork(timedDatabase, { limit: 1, leaseMs: 1_000 });
    const states = await prisma.integrationSyncWork.findMany({
      where: { id: { in: work.map(({ id }) => id) } },
      orderBy: { sequence: "asc" },
      select: { state: true },
    });

    expect(claimed.map((row) => row.id)).toEqual([work[31]!.id]);
    expect(states.filter(({ state }) => state !== "queued")).toHaveLength(32);
    expect(states.slice(32).every(({ state }) => state === "queued")).toBe(true);
  });

  it("starts a production-clock lease after a delayed final row lock", async () => {
    const { binding } = await createFixture();
    const laneKey = randomUUID();
    await createWork(binding, { laneKey });
    await createWork(binding, { laneKey });
    const locked = await createWork(binding, { laneKey });
    const newest = await createWork(binding, { laneKey });
    const lockStarted = deferred();
    const releaseLock = deferred();
    const locker = concurrentPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "integration_sync_work" WHERE "id" = ${locked.id}::uuid FOR UPDATE
      `;
      lockStarted.resolve();
      await releaseLock.promise;
    });
    await lockStarted.promise;
    const claimPid = deferred<number>();
    const observedDatabase = beforeTransaction(prisma, async (transaction) => {
      const [row] = await transaction.$queryRaw<
        Array<{ pid: number }>
      >`SELECT pg_backend_pid() AS "pid"`;
      claimPid.resolve(row!.pid);
    });
    const claim = claimIntegrationWork(observedDatabase, { limit: 1, leaseMs: 500 });
    const pid = await claimPid.promise;
    let blocked = false;
    try {
      for (let attempt = 0; attempt < 50 && !blocked; attempt += 1) {
        const [row] = await concurrentPrisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS "blocked"
        `;
        blocked = row!.blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await concurrentPrisma.$queryRaw`SELECT 1 AS "slept" FROM pg_sleep(0.75)`;
    } finally {
      releaseLock.resolve();
      await locker;
    }
    const [claimed] = await claim;
    const [clock] = await prisma.$queryRaw<Array<{ remainingMs: number }>>`
      SELECT (EXTRACT(EPOCH FROM (${claimed!.leaseUntil}::timestamp - clock_timestamp())) * 1000)::float8 AS "remainingMs"
    `;

    expect(claimed).toMatchObject({ id: newest.id, state: "leased" });
    expect(clock!.remainingMs).toBeGreaterThan(250);
  });

  it("bounds waits for a locked coalescing row", async () => {
    const { binding } = await createFixture();
    const laneKey = randomUUID();
    await createWork(binding, { laneKey });
    const locked = await createWork(binding, { laneKey });
    const started = deferred();
    const release = deferred();
    const locker = concurrentPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "integration_sync_work" WHERE "id" = ${locked.id}::uuid FOR UPDATE
      `;
      started.resolve();
      await release.promise;
    });
    await started.promise;

    try {
      await expect(claimIntegrationWork(prisma, { limit: 1 })).rejects.toThrow(/lock timeout/i);
    } finally {
      release.resolve();
      await locker;
    }
    await expect(
      prisma.integrationSyncWork.count({ where: { bindingId: binding.id, state: "queued" } }),
    ).resolves.toBe(2);
  });

  it("skips a binding while another claim is uncommitted", async () => {
    const { binding } = await createFixture();
    const work = await createWork(binding);
    const started = deferred();
    const release = deferred();
    const firstClaim = claimIntegrationWork(
      holdTransaction(prisma, started.resolve, release.promise),
      { limit: 1, leaseMs: 1_000 }
    );
    await started.promise;

    const competing = await claimIntegrationWork(concurrentPrisma, { limit: 1, leaseMs: 1_000 });
    release.resolve();

    expect(competing).toEqual([]);
    await expect(firstClaim).resolves.toMatchObject([{ id: work.id }]);
  });

  it("skips an in-flight capture and observes lane order after it commits", async () => {
    const fixture = await createFixture();
    const started = deferred();
    const release = deferred();
    const capture = (operation: "create" | "update", correlationId: string) => ({
      bindingId: fixture.binding.id,
      entityType: "issue",
      entityId: fixture.issue.id,
      direction: "outbound" as const,
      operation,
      actorKey: "member:actor",
      actorKind: "user" as const,
      payload: { version: 1, fields: { title: correlationId }, issue: { title: correlationId } },
      correlationId,
    });
    const firstCapture = prisma.$transaction(async (transaction) => {
      const row = await captureIntegrationWorkTx(transaction, capture("create", "first-capture"));
      started.resolve();
      await release.promise;
      return row;
    });
    await started.promise;
    const second = await concurrentPrisma.$transaction((transaction) =>
      captureIntegrationWorkTx(transaction, capture("update", "second-capture"))
    );

    const skipped = await claimIntegrationWork(concurrentPrisma, { limit: 1, leaseMs: 1_000 });
    release.resolve();
    const first = await firstCapture;
    const claimed = await claimIntegrationWork(concurrentPrisma, { limit: 1, leaseMs: 1_000 });

    expect(skipped).toEqual([]);
    expect(claimed.map((row) => row.id)).toEqual([first.id]);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: second.id } })
    ).resolves.toMatchObject({ state: "queued", leaseToken: null });
  });
});
