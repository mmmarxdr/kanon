import { describe, expect, it, vi } from "vitest";

const { lockPollSnapshot } = vi.hoisted(() => ({ lockPollSnapshot: vi.fn() }));
vi.mock("./inbound.js", () => ({ lockPollSnapshot }));

import { createPrismaAuditCensusRepository, type DurableAuditCensusLease } from "./audit-repository.js";

const observedAt = new Date("2026-08-13T12:00:00Z");
const repositoryOptions = { terminalFreshnessMs: 300_000, retentionDays: 30 };
const lease: DurableAuditCensusLease = {
  id: "binding-1", bindingId: "binding-1", connectionId: "connection-1", projectId: "project-1", remoteProjectId: "42", lifecycleEpoch: 2,
  pollLeaseToken: "lease-1", pollFence: 7, leaseToken: "lease-1", fence: 7, scopeFingerprint: "scope-1",
  baseUrl: "https://redmine.example", encryptedKey: "ciphertext", credentialId: "credential-1", credentialLastValidatedAt: observedAt,
};

function fakeDatabase(options: { stale?: boolean; existing?: Record<string, unknown> | null } = {}) {
  let run = options.existing ?? null;
  const checkpoint = { upsert: vi.fn().mockResolvedValue({}) };
  const observations = { createMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const binding = { update: vi.fn().mockResolvedValue({}) };
  const runs = {
    findFirst: vi.fn().mockImplementation(async () => run),
    findMany: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockImplementation(async ({ data }) => run = { id: "run-1", providerObservedAt: null, checkpoint: null, observations: [], ...data }),
    update: vi.fn().mockImplementation(async ({ data }) => run = { ...(run ?? {}), ...data }),
  };
  const transaction = { integrationAuditRun: runs, integrationAuditCheckpoint: checkpoint, integrationAuditObservation: observations, integrationProjectBinding: binding, $queryRaw: vi.fn().mockResolvedValue([{ now: observedAt }]) };
  lockPollSnapshot.mockResolvedValue(options.stale ? null : { id: lease.bindingId });
  return {
    database: { $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction) },
    transaction, runs, checkpoint, observations, binding,
  };
}

describe("Prisma audit census repository", () => {
  it("loads a durable partial run and atomically writes replay-safe observations with its checkpoint", async () => {
    const fake = fakeDatabase();
    const repository = createPrismaAuditCensusRepository(fake.database as never, repositoryOptions);

    await expect(repository.loadOrCreateRun(lease)).resolves.toMatchObject({ id: "run-1", checkpoint: null });
    await expect(repository.commitIssue(lease, {
      providerObservedAt: observedAt,
      observations: [
        { identityType: "issue", remoteId: "42", parentRemoteId: null, sourceUpdatedAt: observedAt },
        { identityType: "issue", remoteId: "42", parentRemoteId: null, sourceUpdatedAt: observedAt },
      ],
      replace: true,
      checkpoint: { pass: 1, offset: 0, itemIndex: 0, expectedTotal: 1, lastIssueUpdatedAt: observedAt, lastIssueId: "42" },
    })).resolves.toBe(true);

    expect(fake.observations.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(fake.observations.deleteMany).toHaveBeenCalledWith({ where: { runId: "run-1" } });
    expect(fake.checkpoint.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { runId: "run-1" }, create: expect.objectContaining({ fence: 7, lastIssueId: "42" }),
    }));
  });

  it("distinguishes migrated legacy checkpoints from versioned first-page checkpoints with null continuation", async () => {
    const legacy = fakeDatabase({ existing: {
      id: "legacy-run", providerObservedAt: observedAt,
      checkpoint: { pass: 0, offset: 0, itemIndex: 0, expectedTotal: 1, lastIssueUpdatedAt: observedAt, lastIssueId: "42", pageCheckpointUpdatedAt: null, pageCheckpointRemoteId: null, pageCheckpointToken: null, checkpointVersion: null },
    } });
    const versioned = fakeDatabase({ existing: {
      id: "versioned-run", providerObservedAt: observedAt,
      checkpoint: { pass: 0, offset: 0, itemIndex: 0, expectedTotal: 1, lastIssueUpdatedAt: observedAt, lastIssueId: "42", pageCheckpointUpdatedAt: null, pageCheckpointRemoteId: null, pageCheckpointToken: null, checkpointVersion: 1 },
    } });

    await expect(createPrismaAuditCensusRepository(legacy.database as never, repositoryOptions).loadOrCreateRun(lease))
      .resolves.toMatchObject({ checkpoint: { pageCheckpoint: undefined } });
    await expect(createPrismaAuditCensusRepository(versioned.database as never, repositoryOptions).loadOrCreateRun(lease))
      .resolves.toMatchObject({ checkpoint: { pageCheckpoint: null } });
  });

  it("resumes a prior matching scope, finalizes behind the same fence, and refuses stale ownership", async () => {
    const existing = { id: "run-old", leaseToken: "expired", fence: 6, providerObservedAt: observedAt, checkpoint: { pass: 0, offset: 4, itemIndex: 1, expectedTotal: 6, lastIssueUpdatedAt: observedAt, lastIssueId: "43" } };
    const fake = fakeDatabase({ existing });
    const repository = createPrismaAuditCensusRepository(fake.database as never, repositoryOptions);

    await expect(repository.loadOrCreateRun(lease)).resolves.toMatchObject({ id: "run-old", checkpoint: { offset: 4, lastIssueId: "43" } });
    await expect(repository.finish(lease, observedAt)).resolves.toBe(true);
    expect(fake.runs.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      state: "complete", completedAt: observedAt, validUntil: new Date("2026-08-13T12:05:00Z"),
    }) }));
    expect(fake.binding.update).toHaveBeenCalledWith(expect.objectContaining({ data: { auditCompletedAt: observedAt } }));

    const stale = fakeDatabase({ stale: true });
    await expect(createPrismaAuditCensusRepository(stale.database as never, repositoryOptions).commitIssue(lease, {
      providerObservedAt: observedAt, observations: [], checkpoint: { pass: 0, offset: 0, itemIndex: 0, expectedTotal: 0, lastIssueUpdatedAt: null, lastIssueId: null },
    })).resolves.toBe(false);
    expect(stale.observations.createMany).not.toHaveBeenCalled();

    lockPollSnapshot.mockRejectedValueOnce(Object.assign(new Error("credential changed"), { code: "INBOUND_CREDENTIAL_STALE" }));
    await expect(repository.commitIssue(lease, {
      providerObservedAt: observedAt, observations: [], checkpoint: { pass: 0, offset: 0, itemIndex: 0, expectedTotal: 0, lastIssueUpdatedAt: null, lastIssueId: null },
    })).resolves.toBe(false);
  });

  it("prunes historical complete bodies and expired evidence while preserving the current run", async () => {
    const fake = fakeDatabase({ existing: {
      id: "run-current", providerObservedAt: observedAt, scopeFingerprint: lease.scopeFingerprint,
    } });
    fake.runs.findMany.mockRejectedValue(new Error("audit history must not be materialized"));
    const repository = createPrismaAuditCensusRepository(fake.database as never, repositoryOptions);

    await expect(repository.finish(lease, observedAt)).resolves.toBe(true);

    expect(fake.runs.findMany).not.toHaveBeenCalled();
    expect(fake.observations.deleteMany).toHaveBeenNthCalledWith(1, { where: {
      run: {
        bindingId: lease.bindingId,
        id: { not: "run-current" },
        state: "complete",
      },
    } });
    expect(fake.observations.deleteMany).toHaveBeenNthCalledWith(2, { where: {
      observedAt: { lt: new Date("2026-07-14T12:00:00Z") },
      run: {
        bindingId: lease.bindingId,
        id: { not: "run-current" },
        OR: [
          { state: { in: ["failed", "stale"] } },
          { state: "complete", OR: [{ validUntil: null }, { validUntil: { lte: observedAt } }] },
        ],
      },
    } });
    expect(fake.runs.deleteMany).toHaveBeenNthCalledWith(1, { where: {
      bindingId: lease.bindingId,
      state: "partial",
      scopeFingerprint: { not: lease.scopeFingerprint },
    } });
    expect(fake.runs.deleteMany).toHaveBeenNthCalledWith(2, { where: {
      bindingId: lease.bindingId,
      id: { not: "run-current" },
      state: { in: ["failed", "stale"] },
    } });
    expect(fake.runs.deleteMany).toHaveBeenNthCalledWith(3, { where: {
      bindingId: lease.bindingId,
      id: { not: "run-current" },
      state: { in: ["complete", "failed", "stale"] },
      observations: { none: {} },
      OR: [
        { state: { in: ["failed", "stale"] } },
        { state: "complete", OR: [{ validUntil: null }, { validUntil: { lte: observedAt } }] },
      ],
    } });
  });

  it("derives bounded terminal freshness from the fenced database completion clock", async () => {
    const fake = fakeDatabase({ existing: { id: "run-current", providerObservedAt: observedAt, scopeFingerprint: lease.scopeFingerprint } });
    const repository = createPrismaAuditCensusRepository(fake.database as never, repositoryOptions);

    await expect(repository.finish(lease, observedAt)).resolves.toBe(true);
    expect(fake.runs.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      completedAt: observedAt, validUntil: new Date("2026-08-13T12:05:00Z"),
    }) }));
    await expect(repository.readTerminalTrust(lease)).resolves.toEqual({
      trust: { state: "complete", completedAt: observedAt, validUntil: new Date("2026-08-13T12:05:00Z"), scopeFingerprint: lease.scopeFingerprint },
      databaseNow: observedAt,
    });
  });

  it("keeps invalid or unbounded failure detail out of durable state", async () => {
    const fake = fakeDatabase({ existing: { id: "run-1", providerObservedAt: null } });
    await expect(createPrismaAuditCensusRepository(fake.database as never, repositoryOptions).markFailed(lease, "provider response: secret body"))
      .resolves.toBe(true);
    expect(fake.runs.update).toHaveBeenCalledWith(expect.objectContaining({ data: { state: "failed", reasonCode: "unknown" } }));

    const safe = fakeDatabase({ existing: { id: "run-2", providerObservedAt: null } });
    await expect(createPrismaAuditCensusRepository(safe.database as never, repositoryOptions).markFailed(lease, "timeout")).resolves.toBe(true);
    expect(safe.runs.update).toHaveBeenCalledWith(expect.objectContaining({ data: { state: "failed", reasonCode: "timeout" } }));
  });

  it("bounds repeated failed evidence with fenced set-based cleanup while retaining the current failure", async () => {
    const fake = fakeDatabase({ existing: {
      id: "run-current", providerObservedAt: observedAt, scopeFingerprint: lease.scopeFingerprint,
    } });
    fake.runs.findMany.mockRejectedValue(new Error("audit history must not be materialized"));
    const repository = createPrismaAuditCensusRepository(fake.database as never, repositoryOptions);

    await expect(repository.markFailed(lease, "provider_failure")).resolves.toBe(true);

    expect(fake.runs.findMany).not.toHaveBeenCalled();
    expect(fake.runs.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-current" }, data: { state: "failed", reasonCode: "provider_failure" },
    }));
    expect(fake.runs.deleteMany).toHaveBeenCalledWith({ where: {
      bindingId: lease.bindingId,
      id: { not: "run-current" },
      state: { in: ["failed", "stale"] },
    } });
  });

  it("rejects a structurally valid lease when its audit aliases target a different binding fence", async () => {
    const fake = fakeDatabase();
    const mismatchedLease = { ...lease, bindingId: "binding-2", leaseToken: "lease-2", fence: 8 };
    const repository = createPrismaAuditCensusRepository(fake.database as never, repositoryOptions);
    const lockCallsBefore = lockPollSnapshot.mock.calls.length;

    await expect(repository.commitIssue(mismatchedLease, {
      providerObservedAt: observedAt,
      observations: [{ identityType: "issue", remoteId: "42", parentRemoteId: null, sourceUpdatedAt: observedAt }],
      checkpoint: { pass: 0, offset: 0, itemIndex: 0, expectedTotal: 1, lastIssueUpdatedAt: observedAt, lastIssueId: "42" },
    })).resolves.toBe(false);

    expect(lockPollSnapshot).toHaveBeenCalledTimes(lockCallsBefore);
    expect(fake.observations.createMany).not.toHaveBeenCalled();
    expect(fake.checkpoint.upsert).not.toHaveBeenCalled();
  });

  it("reads terminal trust only behind the same binding lease and exact audit scope", async () => {
    const validUntil = new Date("2026-08-13T13:00:00Z");
    const fake = fakeDatabase({ existing: {
      id: "run-complete", state: "complete", scopeFingerprint: lease.scopeFingerprint,
      completedAt: observedAt, validUntil,
    } });
    const repository = createPrismaAuditCensusRepository(fake.database as never, repositoryOptions);

    await expect(repository.readTerminalTrust(lease)).resolves.toEqual({
      trust: { state: "complete", scopeFingerprint: lease.scopeFingerprint, completedAt: observedAt, validUntil }, databaseNow: observedAt,
    });
    expect(fake.runs.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      bindingId: lease.bindingId, scopeFingerprint: lease.scopeFingerprint, state: "complete", validUntil: { gt: observedAt },
    }) }));

    const stale = fakeDatabase({ stale: true });
    await expect(createPrismaAuditCensusRepository(stale.database as never, repositoryOptions).readTerminalTrust(lease)).resolves.toBeNull();
  });

  it("RET-001 removes an unreachable partial audit run after credential and scope rotation completes the current run", async () => {
    const fake = fakeDatabase({
      existing: { id: "run-current-scope", providerObservedAt: observedAt, scopeFingerprint: lease.scopeFingerprint },
    });
    const repository = createPrismaAuditCensusRepository(fake.database as never, repositoryOptions);

    await expect(repository.finish(lease, observedAt)).resolves.toBe(true);

    expect(fake.runs.deleteMany).toHaveBeenNthCalledWith(1, { where: {
      bindingId: lease.bindingId,
      state: "partial",
      scopeFingerprint: { not: lease.scopeFingerprint },
    } });
    expect(fake.runs.deleteMany).not.toHaveBeenCalledWith({ where: expect.objectContaining({
      state: "partial",
      scopeFingerprint: lease.scopeFingerprint,
    }) });
  });

});
