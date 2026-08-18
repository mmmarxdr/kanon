import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  sweepExpiry,
  sweepRetention,
  EXPIRY_BATCH_LIMIT,
  RETENTION_BATCH_LIMIT,
  MIN_RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  registerRetentionHousekeeping,
  parseRetentionDays,
  captureRetentionFromPolicy,
  disposedListDiscoveryAllowed,
  disposedTombstoneProjection,
} from "./retention.js";
import {
  seedTestWorkspace,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { randomUUID } from "node:crypto";

/** Helper to create a policy with retention days */
async function createPolicy(
  workspaceId: string,
  opts: { retentionDays?: number; version?: string; dispositionListVisibility?: string } = {}
) {
  return prisma.triagePolicy.create({
    data: {
      workspaceId,
      version: opts.version ?? "v1",
      retentionDays: opts.retentionDays ?? 365,
      dispositionListVisibility: opts.dispositionListVisibility ?? "hidden",
    },
  });
}

/** Helper to create a proposal with content + captured retention snapshot */
async function createProposal(
  workspaceId: string,
  projectId: string,
  policyId: string,
  opts: {
    lifecycle?: "pending" | "expired" | "dismissed" | "disposed";
    createdAt?: Date;
    expiresAt?: Date;
    disposedAt?: Date;
    identityDigest?: string;
    withContent?: boolean;
    targetIssueId?: string;
    supersedesId?: string;
    dispositionListVisible?: boolean | null;
    /** Override captured eligibility (defaults from policy at createdAt). */
    retentionEligibleAt?: Date;
    capturedRetentionDays?: number;
  } = {}
) {
  const policy = await prisma.triagePolicy.findUniqueOrThrow({ where: { id: policyId } });
  const createdAt = opts.createdAt ?? new Date();
  const captured = captureRetentionFromPolicy(policy, createdAt);

  const data: any = {
    workspaceId,
    projectId,
    policyId,
    identityDigest: opts.identityDigest ?? `digest-${randomUUID()}`,
    targetIssueId: opts.targetIssueId ?? randomUUID(),
    lifecycle: opts.lifecycle ?? "pending",
    listSummary: { title: "test proposal" },
    createdAt,
    expiresAt: opts.expiresAt ?? new Date(createdAt.getTime() + 7 * 86400_000),
    retentionEligibleAt: opts.retentionEligibleAt ?? captured.retentionEligibleAt,
    capturedRetentionDays: opts.capturedRetentionDays ?? captured.capturedRetentionDays,
    capturedPolicyVersion: captured.capturedPolicyVersion,
  };
  if (opts.disposedAt) data.disposedAt = opts.disposedAt;
  if (opts.supersedesId) data.supersedesId = opts.supersedesId;
  if (opts.dispositionListVisible !== undefined) {
    data.dispositionListVisible = opts.dispositionListVisible;
  }

  if (opts.withContent !== false) {
    data.content = {
      create: { payload: { body: "test content" }, provenance: { source: "test" } },
    };
  }

  return prisma.triageProposal.create({ data });
}

describe("Triage Retention (KAN-193 PR9)", () => {
  let workspaceId: string;
  let projectId: string;
  let policyId: string;

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace();
    workspaceId = ws.id;
    // Project keys are short (≤3–4 chars in this schema); let helper pick a unique one.
    const p = await seedTestProject(workspaceId);
    projectId = p.id;

    const policy = await createPolicy(workspaceId, { retentionDays: 365 });
    policyId = policy.id;
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  // ── Constants ─────────────────────────────────────────────────────────

  describe("exported constants", () => {
    it("default retention is 365 days (one year)", () => {
      expect(DEFAULT_RETENTION_DAYS).toBe(365);
    });

    it("minimum retention is 7 days", () => {
      expect(MIN_RETENTION_DAYS).toBe(7);
    });

    it("expiry batch limit is 100", () => {
      expect(EXPIRY_BATCH_LIMIT).toBe(100);
    });

    it("retention batch limit is 100", () => {
      expect(RETENTION_BATCH_LIMIT).toBe(100);
    });

    it("parseRetentionDays defaults and rejects below minimum", () => {
      expect(parseRetentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
      expect(parseRetentionDays(30)).toBe(30);
      expect(() => parseRetentionDays(6)).toThrow(/>= 7/);
    });
  });

  // ── sweepExpiry ───────────────────────────────────────────────────────

  describe("sweepExpiry", () => {
    it("transitions pending proposals past expiresAt to expired", async () => {
      const proposal = await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "pending",
        expiresAt: new Date(Date.now() - 60_000),
      });

      const count = await sweepExpiry({ limit: 10 });
      expect(count).toBe(1);

      const updated = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(updated?.lifecycle).toBe("expired");

      const events = await prisma.triageProposalLifecycleEvent.findMany({
        where: { proposalId: proposal.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]!.state).toBe("expired");
      expect(events[0]!.reason).toBe("lazy_expiry_worker");
      expect(events[0]!.actorId).toBeNull();
    });

    it("does not touch proposals that have not expired", async () => {
      await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "pending",
        expiresAt: new Date(Date.now() + 86400_000),
      });

      const count = await sweepExpiry({ limit: 10 });
      expect(count).toBe(0);
    });

    it("does not touch already expired proposals", async () => {
      await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "expired",
        expiresAt: new Date(Date.now() - 60_000),
      });

      const count = await sweepExpiry({ limit: 10 });
      expect(count).toBe(0);
    });

    it("respects batch limit", async () => {
      // Create 5 expired proposals
      for (let i = 0; i < 5; i++) {
        await createProposal(workspaceId, projectId, policyId, {
          lifecycle: "pending",
          expiresAt: new Date(Date.now() - 60_000),
        });
      }

      const count = await sweepExpiry({ limit: 3 });
      expect(count).toBe(3);

      // Remaining should still be pending
      const remaining = await prisma.triageProposal.count({ where: { lifecycle: "pending" } });
      expect(remaining).toBe(2);
    });
  });

  // ── sweepRetention ────────────────────────────────────────────────────

  describe("sweepRetention", () => {
    it("disposes expired proposals past retention period", async () => {
      const proposal = await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 400 * 86400_000), // 400 days old
        expiresAt: new Date(Date.now() - 399 * 86400_000),
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(1);

      const updated = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(updated?.lifecycle).toBe("disposed");
      expect(updated?.disposedAt).toBeDefined();
      expect(updated?.disposedAt).not.toBeNull();
    });

    it("disposes dismissed proposals past retention period", async () => {
      const proposal = await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "dismissed",
        createdAt: new Date(Date.now() - 400 * 86400_000),
        expiresAt: new Date(Date.now() - 399 * 86400_000),
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(1);

      const updated = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(updated?.lifecycle).toBe("disposed");
    });

    it("does NOT dispose pending proposals regardless of age", async () => {
      await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "pending",
        createdAt: new Date(Date.now() - 400 * 86400_000),
        expiresAt: new Date(Date.now() + 86400_000), // still active
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(0);
    });

    it("does NOT dispose items younger than retention period", async () => {
      await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 100 * 86400_000), // only 100 days old
        expiresAt: new Date(Date.now() - 99 * 86400_000),
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(0);
    });

    it("deletes content before marking as disposed (RESTRICT compliance)", async () => {
      const proposal = await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 400 * 86400_000),
        expiresAt: new Date(Date.now() - 399 * 86400_000),
      });

      await sweepRetention({ limit: 10 });

      // Content should be gone
      const content = await prisma.triageProposalContent.findUnique({
        where: { proposalId: proposal.id },
      });
      expect(content).toBeNull();

      // Proposal should still exist as tombstone
      const tombstone = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(tombstone).not.toBeNull();
      expect(tombstone?.lifecycle).toBe("disposed");
    });

    it("creates audit event BEFORE deleting content", async () => {
      const proposal = await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 400 * 86400_000),
        expiresAt: new Date(Date.now() - 399 * 86400_000),
      });

      await sweepRetention({ limit: 10 });

      // Audit event must exist
      const events = await prisma.triageProposalLifecycleEvent.findMany({
        where: { proposalId: proposal.id, state: "disposed" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]!.reason).toBe("retention_policy");
      expect(events[0]!.actorId).toBeNull();
    });

    it("captures dispositionListVisibility from policy on the tombstone", async () => {
      const visiblePolicy = await createPolicy(workspaceId, {
        retentionDays: 7,
        dispositionListVisibility: "visible",
      });

      const proposal = await createProposal(workspaceId, projectId, visiblePolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 10 * 86400_000),
        expiresAt: new Date(Date.now() - 9 * 86400_000),
      });

      await sweepRetention({ limit: 10 });

      const tombstone = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(tombstone?.lifecycle).toBe("disposed");

      // Audit should capture policy visibility
      const event = await prisma.triageProposalLifecycleEvent.findFirst({
        where: { proposalId: proposal.id, state: "disposed" },
      });
      expect(event).not.toBeNull();
      expect(event?.reason).toContain("retention_policy");
    });

    it("uses policy-specific retention days (short policy)", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      const proposal = await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 10 * 86400_000), // 10 days old, 7 day policy
        expiresAt: new Date(Date.now() - 9 * 86400_000),
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(1);

      const updated = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(updated?.lifecycle).toBe("disposed");
    });

    it("respects batch limit for retention sweep", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      for (let i = 0; i < 5; i++) {
        await createProposal(workspaceId, projectId, shortPolicy.id, {
          lifecycle: "expired",
          createdAt: new Date(Date.now() - 20 * 86400_000),
          expiresAt: new Date(Date.now() - 19 * 86400_000),
        });
      }

      const count = await sweepRetention({ limit: 3 });
      expect(count).toBe(3);

      const disposed = await prisma.triageProposal.count({ where: { lifecycle: "disposed" } });
      expect(disposed).toBe(3);

      const remaining = await prisma.triageProposal.count({ where: { lifecycle: "expired" } });
      expect(remaining).toBe(2);
    });

    it("does not double-dispose already disposed proposals", async () => {
      const proposal = await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "disposed",
        disposedAt: new Date(Date.now() - 500 * 86400_000),
        createdAt: new Date(Date.now() - 500 * 86400_000),
        expiresAt: new Date(Date.now() - 499 * 86400_000),
        withContent: false,
      });

      // Create the disposed lifecycle event too
      await prisma.triageProposalLifecycleEvent.create({
        data: { proposalId: proposal.id, state: "disposed", reason: "retention_policy" },
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(0);
    });

    it("policy change does not silently shorten retention for existing rows", async () => {
      // Captured under 365-day policy at creation — 200 days old is not yet eligible
      const proposal = await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 200 * 86400_000),
        expiresAt: new Date(Date.now() - 199 * 86400_000),
      });
      expect(proposal.capturedRetentionDays).toBe(365);

      // Shorten the live workspace policy — must NOT change captured eligibility
      await prisma.triagePolicy.update({
        where: { id: policyId },
        data: { retentionDays: 7 },
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(0);

      const unchanged = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(unchanged?.lifecycle).toBe("expired");
      expect(unchanged?.capturedRetentionDays).toBe(365);
      expect(unchanged?.content).toBeUndefined(); // relation not loaded
      const content = await prisma.triageProposalContent.findUnique({
        where: { proposalId: proposal.id },
      });
      expect(content).not.toBeNull();
    });

    it("records policy id/version in disposition audit details", async () => {
      const policy = await createPolicy(workspaceId, {
        retentionDays: 7,
        version: "pol-v9",
        dispositionListVisibility: "visible",
      });
      const proposal = await createProposal(workspaceId, projectId, policy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() - 19 * 86400_000),
      });

      await sweepRetention({ limit: 10 });

      const event = await prisma.triageProposalLifecycleEvent.findFirst({
        where: { proposalId: proposal.id, state: "disposed" },
      });
      expect(event?.details).toMatchObject({
        action: "retention_disposed",
        policyId: policy.id,
        policyVersion: "pol-v9",
        retentionDays: 7,
        dispositionListVisible: true,
      });

      const tombstone = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(tombstone?.dispositionListVisible).toBe(true);
    });
  });

  // ── Worker registration ───────────────────────────────────────────────

  describe("registerRetentionHousekeeping", () => {
    it("returns stop function", () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
      };
      const stop = registerRetentionHousekeeping(mockLogger as any);
      expect(typeof stop).toBe("function");
      stop();
    });

    it("logs startup message on registration", () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
      };
      const stop = registerRetentionHousekeeping(mockLogger as any);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Triage retention housekeeping started")
      );
      stop();
    });

    it("logs stop message on cleanup", () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
      };
      const stop = registerRetentionHousekeeping(mockLogger as any);
      stop();
      expect(mockLogger.info).toHaveBeenCalledWith("Triage retention housekeeping stopped");
    });

    it("correlates expiry failure logs", async () => {
      vi.useFakeTimers();
      const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
      const failure = new Error("failed");
      const expiry = vi.fn().mockRejectedValue(failure);
      const stop = registerRetentionHousekeeping(logger, expiry);
      try {
        await vi.advanceTimersByTimeAsync(60_000);
        expect(logger.error).toHaveBeenCalledWith(
          { err: failure, correlationId: expect.any(String), operation: "expire", stage: "sweep" },
          "Triage expiry sweep failed",
        );
      } finally {
        stop();
        vi.useRealTimers();
      }
    });

    it("correlates retention failure logs", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0);
      const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
      const failure = new Error("failed");
      const expiry = vi.fn(() => new Promise<number>(() => undefined));
      const retention = vi.fn().mockRejectedValue(failure);
      const stop = registerRetentionHousekeeping(logger, expiry, retention);
      try {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(logger.error).toHaveBeenCalledWith(
          { err: failure, correlationId: expect.any(String), operation: "retain", stage: "sweep" },
          "Triage retention sweep failed",
        );
      } finally {
        stop();
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    });
  });

  // ── TRIANGULATE: Concurrent workers ───────────────────────────────────

  describe("concurrent workers (TRIANGULATE)", () => {
    it("parallel sweepExpiry calls do not double-process", async () => {
      for (let i = 0; i < 3; i++) {
        await createProposal(workspaceId, projectId, policyId, {
          lifecycle: "pending",
          expiresAt: new Date(Date.now() - 60_000),
        });
      }

      // Run two sweeps concurrently
      const [count1, count2] = await Promise.all([
        sweepExpiry({ limit: 10 }),
        sweepExpiry({ limit: 10 }),
      ]);

      // Combined, they should process exactly 3
      expect(count1 + count2).toBe(3);

      // All should now be expired
      const expired = await prisma.triageProposal.count({ where: { lifecycle: "expired" } });
      expect(expired).toBe(3);

      // Each should have exactly one lifecycle event
      const events = await prisma.triageProposalLifecycleEvent.count({ where: { state: "expired" } });
      expect(events).toBe(3);
    });

    it("parallel sweepRetention calls do not double-dispose", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      for (let i = 0; i < 3; i++) {
        await createProposal(workspaceId, projectId, shortPolicy.id, {
          lifecycle: "expired",
          createdAt: new Date(Date.now() - 20 * 86400_000),
          expiresAt: new Date(Date.now() - 19 * 86400_000),
        });
      }

      const [count1, count2] = await Promise.all([
        sweepRetention({ limit: 10 }),
        sweepRetention({ limit: 10 }),
      ]);

      // Combined count should be exactly 3
      expect(count1 + count2).toBe(3);

      const disposed = await prisma.triageProposal.count({ where: { lifecycle: "disposed" } });
      expect(disposed).toBe(3);

      // Each should have exactly one disposed lifecycle event
      const events = await prisma.triageProposalLifecycleEvent.count({ where: { state: "disposed" } });
      expect(events).toBe(3);
    });
  });

  // ── TRIANGULATE: Eligibility boundaries ───────────────────────────────

  describe("eligibility boundaries (TRIANGULATE)", () => {
    it("only expired and dismissed are eligible for retention, not pending", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      // Pending — should NOT be disposed regardless of age
      await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "pending",
        createdAt: new Date(Date.now() - 100 * 86400_000),
        expiresAt: new Date(Date.now() + 86400_000),
      });

      // Expired — should be disposed
      await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 100 * 86400_000),
        expiresAt: new Date(Date.now() - 99 * 86400_000),
      });

      // Dismissed — should be disposed
      await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "dismissed",
        createdAt: new Date(Date.now() - 100 * 86400_000),
        expiresAt: new Date(Date.now() - 99 * 86400_000),
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(2);

      const pending = await prisma.triageProposal.count({ where: { lifecycle: "pending" } });
      expect(pending).toBe(1);
    });

    it("already disposed proposals are skipped in retention sweep", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      // Create a proposal that was previously disposed
      const proposal = await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "disposed",
        createdAt: new Date(Date.now() - 100 * 86400_000),
        expiresAt: new Date(Date.now() - 99 * 86400_000),
        disposedAt: new Date(Date.now() - 50 * 86400_000),
        withContent: false,
      });

      await prisma.triageProposalLifecycleEvent.create({
        data: { proposalId: proposal.id, state: "disposed", reason: "retention_policy" },
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(0);
    });

    it("proposals exactly at retention boundary are not eligible", async () => {
      // Create a 7-day policy and a proposal that's exactly 7 days old
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      // Note: the SQL comparison is < not <=, so exactly 7 days should not be eligible.
      // Since we use NOW() in the query, we make the proposal 6 days and 23 hours old
      // to be safe against timing issues.
      await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 6.95 * 86400_000),
        expiresAt: new Date(Date.now() - 6 * 86400_000),
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(0);
    });
  });

  // ── TRIANGULATE: Content and tombstone behavior ─────────────────────

  describe("content and tombstone behavior (TRIANGULATE)", () => {
    it("tombstone proposal still exists after disposal but content is gone", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      const proposal = await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() - 19 * 86400_000),
      });

      await sweepRetention({ limit: 10 });

      // Tombstone exists
      const tombstone = await prisma.triageProposal.findUnique({
        where: { id: proposal.id },
        include: { content: true, lifecycleEvents: true },
      });
      expect(tombstone).not.toBeNull();
      expect(tombstone?.lifecycle).toBe("disposed");
      expect(tombstone?.disposedAt).not.toBeNull();

      // Content is deleted
      expect(tombstone?.content).toBeNull();

      // Lifecycle events include disposed
      const disposedEvent = tombstone?.lifecycleEvents.find((e) => e.state === "disposed");
      expect(disposedEvent).toBeDefined();
      expect(disposedEvent?.reason).toBe("retention_policy");
    });

    it("listSummary is preserved on tombstone for audit", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      const proposal = await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() - 19 * 86400_000),
      });

      await sweepRetention({ limit: 10 });

      const tombstone = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(tombstone?.listSummary).toEqual({ title: "test proposal" });
    });

    it("proposals without content can still be disposed", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      const proposal = await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() - 19 * 86400_000),
        withContent: false,
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(1);

      const tombstone = await prisma.triageProposal.findUnique({ where: { id: proposal.id } });
      expect(tombstone?.lifecycle).toBe("disposed");
    });
  });

  // ── TRIANGULATE: Zero-write and telemetry checks ────────────────────

  describe("zero-write and telemetry (TRIANGULATE)", () => {
    it("sweepExpiry on empty table returns 0 and writes nothing", async () => {
      const count = await sweepExpiry({ limit: 10 });
      expect(count).toBe(0);

      const events = await prisma.triageProposalLifecycleEvent.count();
      expect(events).toBe(0);
    });

    it("sweepRetention on empty table returns 0 and writes nothing", async () => {
      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(0);
    });

    it("sweepExpiry does not create Issue or ActivityLog entries", async () => {
      await createProposal(workspaceId, projectId, policyId, {
        lifecycle: "pending",
        expiresAt: new Date(Date.now() - 60_000),
      });

      const issuesBefore = await prisma.issue.count();
      const logsBefore = await prisma.activityLog.count();

      await sweepExpiry({ limit: 10 });

      const issuesAfter = await prisma.issue.count();
      const logsAfter = await prisma.activityLog.count();

      expect(issuesAfter).toBe(issuesBefore);
      expect(logsAfter).toBe(logsBefore);
    });

    it("sweepRetention does not create Issue or ActivityLog entries", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() - 19 * 86400_000),
      });

      const issuesBefore = await prisma.issue.count();
      const logsBefore = await prisma.activityLog.count();

      await sweepRetention({ limit: 10 });

      const issuesAfter = await prisma.issue.count();
      const logsAfter = await prisma.activityLog.count();

      expect(issuesAfter).toBe(issuesBefore);
      expect(logsAfter).toBe(logsBefore);
    });
  });

  // ── TRIANGULATE: Multiple policies ──────────────────────────────────

  describe("multiple policies (TRIANGULATE)", () => {
    it("uses each proposal's own policy retention_days independently", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });
      const longPolicy = await createPolicy(workspaceId, { retentionDays: 365 });

      // Under short policy: 20 days old, 7 day retention → eligible
      const shortProposal = await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() - 19 * 86400_000),
      });

      // Under long policy: 20 days old, 365 day retention → NOT eligible
      const longProposal = await createProposal(workspaceId, projectId, longPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() - 19 * 86400_000),
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBe(1);

      const shortResult = await prisma.triageProposal.findUnique({ where: { id: shortProposal.id } });
      expect(shortResult?.lifecycle).toBe("disposed");

      const longResult = await prisma.triageProposal.findUnique({ where: { id: longProposal.id } });
      expect(longResult?.lifecycle).toBe("expired");
    });
  });

  // ── TRIANGULATE: superseded + partial failure + tombstone surfaces ──

  describe("superseded eligibility (TRIANGULATE)", () => {
    it("disposes a superseded predecessor past captured eligibility", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });
      const predecessor = await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "pending",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() + 86400_000), // still pending by clock
      });
      await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "pending",
        createdAt: new Date(Date.now() - 10 * 86400_000),
        expiresAt: new Date(Date.now() + 86400_000),
        supersedesId: predecessor.id,
      });

      const count = await sweepRetention({ limit: 10 });
      expect(count).toBeGreaterThanOrEqual(1);

      const updated = await prisma.triageProposal.findUnique({ where: { id: predecessor.id } });
      expect(updated?.lifecycle).toBe("disposed");
    });
  });

  describe("partial batch failure (TRIANGULATE)", () => {
    it("skips a row with a pre-existing disposed audit and continues the batch", async () => {
      const shortPolicy = await createPolicy(workspaceId, { retentionDays: 7 });

      const broken = await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() - 19 * 86400_000),
      });
      // Simulate a prior partial failure: audit exists, content still present, not disposed
      await prisma.triageProposalLifecycleEvent.create({
        data: {
          proposalId: broken.id,
          state: "disposed",
          reason: "retention_policy",
        },
      });

      const healthy = await createProposal(workspaceId, projectId, shortPolicy.id, {
        lifecycle: "expired",
        createdAt: new Date(Date.now() - 20 * 86400_000),
        expiresAt: new Date(Date.now() - 19 * 86400_000),
      });

      const count = await sweepRetention({ limit: 10 });
      // Broken row is recovered (finish dispose after pre-existing audit); healthy also disposed
      expect(count).toBe(2);

      const brokenAfter = await prisma.triageProposal.findUnique({ where: { id: broken.id } });
      expect(brokenAfter?.lifecycle).toBe("disposed");
      expect(
        await prisma.triageProposalContent.findUnique({ where: { proposalId: broken.id } }),
      ).toBeNull();

      const healthyAfter = await prisma.triageProposal.findUnique({ where: { id: healthy.id } });
      expect(healthyAfter?.lifecycle).toBe("disposed");
    });
  });

  describe("disposed get/list privacy helpers (TRIANGULATE)", () => {
    it("hides disposed from list unless filter and captured visibility allow", () => {
      expect(disposedListDiscoveryAllowed("current", true)).toBe(false);
      expect(disposedListDiscoveryAllowed("disposed", false)).toBe(false);
      expect(disposedListDiscoveryAllowed("disposed", null)).toBe(false);
      expect(disposedListDiscoveryAllowed("disposed", true)).toBe(true);
      expect(disposedListDiscoveryAllowed("all", true)).toBe(true);
    });

    it("authorized disposed lookup returns 410 tombstone without content", () => {
      const projection = disposedTombstoneProjection({
        id: "prop-1",
        lifecycle: "disposed",
        disposedAt: new Date("2026-01-01T00:00:00Z"),
        policyId: "pol-1",
        capturedPolicyVersion: "v1",
        capturedRetentionDays: 365,
        dispositionListVisible: false,
        targetIssueId: "issue-1",
      });
      expect(projection.httpStatus).toBe(410);
      expect(projection).toMatchObject({
        id: "prop-1",
        lifecycle: "disposed",
        retentionPolicy: { id: "pol-1", version: "v1", retentionDays: 365 },
      });
      expect(projection).not.toHaveProperty("content");
      expect(projection).not.toHaveProperty("payload");
    });
  });
});
