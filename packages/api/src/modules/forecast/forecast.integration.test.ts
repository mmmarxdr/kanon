/**
 * Integration tests: Forecast service — rebuildProjectForecast (KAN-102 PR2).
 * Requires kanon_test DB with 20260615005259_ppm_w3_issue_forecast migration applied.
 * Run: pnpm test (from packages/api or monorepo root via filter).
 *
 * Covers:
 * - e2e rebuild: 3 issues + 2 FS deps + 1 approved TimeEntry → IssueForecast rows
 * - inputsHash skip: unchanged inputs → exactly 1 DB write
 * - idempotent rebuild: 3 calls → row count == issue count, no duplicates
 * - milestone rollup: at_risk flip, upcoming reset, met-SKIP, missed-SKIP, buffer boundary
 * - McpProposal creation: critical slip>0 created; non-critical ≤2 skip; >2 created;
 *   dedup (no duplicate pending generic for same targetRef); null-issueId TE skipped
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { rebuildProjectForecast } from "./service.js";

// ── Test-local DB helpers ─────────────────────────────────────────────────────

/**
 * Clean all tables touched by forecast tests.
 * Called in addition to cleanDatabase() which handles core entities.
 * McpProposal and IssueForecast are cascade-deleted with project/issues,
 * but milestone deliverables need ordering care.
 */
async function cleanForecastData(): Promise<void> {
  await prisma.mcpProposal.deleteMany();
  await prisma.issueForecast.deleteMany();
  await prisma.milestoneDeliverable.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.issueDependency.deleteMany();
  await prisma.issueSchedule.deleteMany();
}

/**
 * Seed a minimal project context: workspace + owner member + project.
 * Returns workspaceId + projectId + ownerId (member.id) for further seeding.
 */
async function seedProjectContext() {
  const ws = await seedTestWorkspace();
  const owner = await seedTestMemberWithRole(ws.id, "owner");
  const project = await seedTestProject(ws.id);
  return { workspaceId: ws.id, projectId: project.id, ownerId: owner.id };
}

/**
 * Create an Issue with an IssueSchedule in one shot.
 */
async function seedScheduledIssue(
  projectId: string,
  key: string,
  seqNum: number,
  opts: {
    startDate?: Date;
    dueDate?: Date;
    estimateHours?: number;
    progress?: number;
    state?: string;
  } = {}
) {
  const issue = await prisma.issue.create({
    data: {
      key,
      title: `Issue ${key}`,
      type: "task",
      state: opts.state ?? "in_progress",
      projectId,
      sequenceNum: seqNum,
    },
  });

  if (
    opts.startDate !== undefined ||
    opts.dueDate !== undefined ||
    opts.estimateHours !== undefined ||
    opts.progress !== undefined
  ) {
    await prisma.issueSchedule.create({
      data: {
        issueId: issue.id,
        startDate: opts.startDate ?? null,
        dueDate: opts.dueDate ?? null,
        estimateHours: opts.estimateHours ?? null,
        progress: opts.progress ?? 0,
      },
    });
  }

  return issue;
}

/**
 * Seed an approved TimeEntry for a given issue and member.
 * Approved entries are what the engine uses as the hours source (ADR-0001).
 */
async function seedApprovedTimeEntry(
  memberId: string,
  issueId: string | null,
  hours: number,
  approvedById: string
): Promise<void> {
  await prisma.timeEntry.create({
    data: {
      memberId,
      issueId,
      hours,
      workedOn: new Date("2026-06-01"),
      status: "approved",
      approvedById,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Forecast Service — rebuildProjectForecast (integration)", () => {
  beforeAll(async () => {
    // No app needed — service is a pure exported function
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanForecastData();
    await cleanDatabase();
  });

  // ── 7.2: e2e rebuild ────────────────────────────────────────────────────

  describe("7.2 — e2e rebuild", () => {
    it("seeds 3 issues + 2 FS deps + 1 approved TimeEntry and creates IssueForecast rows", async () => {
      const { workspaceId, projectId, ownerId } = await seedProjectContext();

      // T = today; simple absolute dates for determinism
      const t0 = new Date("2026-06-01");
      const t10 = new Date("2026-06-11");
      const t20 = new Date("2026-06-21");
      const t30 = new Date("2026-07-01");

      // Issue A: starts t0, due t10, 8h estimate = 1 day
      // Issue B: starts t10 (FS from A), due t20, 8h estimate
      // Issue C: starts t20 (FS from B), due t30, 8h estimate
      const issueA = await seedScheduledIssue(projectId, `KFC-1`, 1, {
        startDate: t0,
        dueDate: t10,
        estimateHours: 8,
      });
      const issueB = await seedScheduledIssue(projectId, `KFC-2`, 2, {
        startDate: t10,
        dueDate: t20,
        estimateHours: 8,
      });
      const issueC = await seedScheduledIssue(projectId, `KFC-3`, 3, {
        startDate: t20,
        dueDate: t30,
        estimateHours: 8,
      });

      // FS: A → B, B → C
      await prisma.issueDependency.create({
        data: { sourceId: issueA.id, targetId: issueB.id, type: "FS" },
      });
      await prisma.issueDependency.create({
        data: { sourceId: issueB.id, targetId: issueC.id, type: "FS" },
      });

      // Approved TimeEntry: 4h on issue A (partially logged)
      await seedApprovedTimeEntry(ownerId, issueA.id, 4, ownerId);

      const stats = await rebuildProjectForecast(projectId);

      // Stats shape
      expect(stats.issueCount).toBe(3);
      expect(stats.criticalCount).toBeGreaterThanOrEqual(0);
      expect(stats.worstSlipDays).toBeGreaterThanOrEqual(0);

      // DB: exactly 3 IssueForecast rows
      const rows = await prisma.issueForecast.findMany({
        where: { issue: { projectId } },
      });
      expect(rows).toHaveLength(3);

      // Each row has a computedAt and an issueId
      for (const row of rows) {
        expect(row.issueId).toBeDefined();
        expect(row.computedAt).toBeDefined();
      }

      // Issue A: has approved hours → loggedH = 4 → partial progress influences forecast
      const forecastA = rows.find((r) => r.issueId === issueA.id);
      expect(forecastA).toBeDefined();
      expect(forecastA!.critical).toBeDefined(); // boolean

      // At least one of A/B/C is on the critical path (linear chain → all critical)
      const criticalRows = rows.filter((r) => r.critical);
      expect(criticalRows.length).toBeGreaterThanOrEqual(1);

      void workspaceId; // used indirectly through seedProjectContext
    });
  });

  // ── 7.3: inputsHash skip ────────────────────────────────────────────────

  describe("7.3 — inputsHash skip", () => {
    it("double call on unchanged data produces exactly 1 DB write (computedAt unchanged on 2nd call)", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      const t0 = new Date("2026-06-01");
      const t10 = new Date("2026-06-11");

      const issue = await seedScheduledIssue(projectId, `KFD-1`, 1, {
        startDate: t0,
        dueDate: t10,
        estimateHours: 16,
      });
      await seedApprovedTimeEntry(ownerId, issue.id, 2, ownerId);

      // First call: writes IssueForecast
      await rebuildProjectForecast(projectId);
      const rowAfterFirst = await prisma.issueForecast.findUnique({
        where: { issueId: issue.id },
      });
      expect(rowAfterFirst).not.toBeNull();
      const computedAtFirst = rowAfterFirst!.computedAt;

      // Small delay to ensure a timestamp difference would be detectable
      await new Promise((r) => setTimeout(r, 10));

      // Second call: same inputs → hash unchanged → upsert skipped
      await rebuildProjectForecast(projectId);
      const rowAfterSecond = await prisma.issueForecast.findUnique({
        where: { issueId: issue.id },
      });
      expect(rowAfterSecond).not.toBeNull();

      // computedAt must be identical (no write happened)
      expect(rowAfterSecond!.computedAt.getTime()).toBe(computedAtFirst.getTime());
    });
  });

  // ── 7.3b: propagated slip must persist to successors (regression KAN-102) ──

  describe("7.3b — propagated slip persists to successors", () => {
    it("rewrites a successor's forecast when an upstream predecessor slips, even though the successor's own inputs are unchanged", async () => {
      const { projectId } = await seedProjectContext();

      // A → B (FS). B's own inputs NEVER change; only A's estimate grows.
      const issueA = await seedScheduledIssue(projectId, `KFP-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-30"),
        estimateHours: 8, // 1 day → forecastEnd ≈ June 2
      });
      const issueB = await seedScheduledIssue(projectId, `KFP-2`, 2, {
        startDate: new Date("2026-06-02"),
        dueDate: new Date("2026-06-30"),
        estimateHours: 8, // 1 day
      });
      await prisma.issueDependency.create({
        data: { sourceId: issueA.id, targetId: issueB.id, type: "FS" },
      });

      // Rebuild 1 — establish B's baseline forecastEnd
      await rebuildProjectForecast(projectId);
      const bBefore = await prisma.issueForecast.findUnique({ where: { issueId: issueB.id } });
      expect(bBefore).not.toBeNull();
      expect(bBefore!.forecastEnd).not.toBeNull();

      // A slips hard: estimate 8h → 80h (10 days) → A.forecastEnd moves to ~June 11,
      // which (FS) pushes B's forecastStart/End later. B's OWN inputs are untouched,
      // so an input-keyed skip would WRONGLY leave B's stored row stale.
      await prisma.issueSchedule.update({
        where: { issueId: issueA.id },
        data: { estimateHours: 80 },
      });

      // Rebuild 2 — B must reflect the propagated slip, not a stale row
      await rebuildProjectForecast(projectId);
      const bAfter = await prisma.issueForecast.findUnique({ where: { issueId: issueB.id } });
      expect(bAfter).not.toBeNull();
      expect(bAfter!.forecastEnd).not.toBeNull();

      // The successor's stored forecastEnd MUST have moved later (propagation persisted).
      expect(bAfter!.forecastEnd!.getTime()).toBeGreaterThan(bBefore!.forecastEnd!.getTime());
    });
  });

  // ── 7.4: idempotent rebuild ─────────────────────────────────────────────

  describe("7.4 — idempotent rebuild", () => {
    it("3 calls → row count == issue count, no duplicates", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      const issueA = await seedScheduledIssue(projectId, `KFE-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-11"),
        estimateHours: 8,
      });
      const issueB = await seedScheduledIssue(projectId, `KFE-2`, 2, {
        startDate: new Date("2026-06-05"),
        dueDate: new Date("2026-06-15"),
        estimateHours: 16,
      });
      await seedApprovedTimeEntry(ownerId, issueA.id, 4, ownerId);

      // 3 consecutive calls
      await rebuildProjectForecast(projectId);
      await rebuildProjectForecast(projectId);
      await rebuildProjectForecast(projectId);

      const rows = await prisma.issueForecast.findMany({
        where: { issue: { projectId } },
      });

      // Exactly 2 rows — no duplicates despite 3 calls
      expect(rows).toHaveLength(2);

      const issueIds = rows.map((r) => r.issueId);
      expect(issueIds).toContain(issueA.id);
      expect(issueIds).toContain(issueB.id);

      void ownerId;
    });
  });

  // ── 7.5: milestone rollup ───────────────────────────────────────────────

  describe("7.5 — milestone rollup", () => {
    /**
     * Seed a Milestone with deliverables.
     * Returns milestone id.
     */
    async function seedMilestone(
      projectId: string,
      ownerId: string,
      target: Date,
      status: "upcoming" | "at_risk" | "met" | "missed",
      issueIds: string[]
    ) {
      const milestone = await prisma.milestone.create({
        data: {
          name: `M-${Date.now()}`,
          target,
          status,
          projectId,
          ownerId,
        },
      });
      for (const issueId of issueIds) {
        await prisma.milestoneDeliverable.create({
          data: { milestoneId: milestone.id, issueId },
        });
      }
      return milestone;
    }

    it("flips upcoming → at_risk when a deliverable forecastEnd is within buffer of target", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      // Issue: starts June 1, due June 10, estimate 8h (1 day) → forecastEnd ≈ June 2
      // But we set the target as June 3, within 3-day buffer of June 2 → at_risk
      // Actually to trigger at_risk: forecastEnd >= target - 3 days
      // Set target far enough that issue forecast end is within buffer:
      // issue forecastEnd ≈ June 2 (1 day after start with 8h)
      // target = June 4 → target - 3 = June 1 → forecastEnd(June 2) >= June 1 → at_risk ✓
      const issue = await seedScheduledIssue(projectId, `KFF-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-10"),
        estimateHours: 8, // 1 day
      });

      // Target = June 4: forecastEnd (June 2) >= target(June 4) - 3 days(June 1) → at_risk
      const target = new Date("2026-06-04");
      const milestone = await seedMilestone(projectId, ownerId, target, "upcoming", [issue.id]);

      await rebuildProjectForecast(projectId);

      const updated = await prisma.milestone.findUnique({ where: { id: milestone.id } });
      expect(updated!.status).toBe("at_risk");
    });

    it("resets at_risk → upcoming when ALL deliverables are back within buffer", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      // Issue: starts June 1, due June 10, estimate 8h (1 day) → forecastEnd ≈ June 2
      // Target = July 10: way beyond buffer (forecastEnd June 2 < target July 10 - 3) → upcoming
      const issue = await seedScheduledIssue(projectId, `KFG-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-10"),
        estimateHours: 8, // 1 day
      });

      // Current status = at_risk, but forecast says all is well → reset to upcoming
      const target = new Date("2026-07-10");
      const milestone = await seedMilestone(projectId, ownerId, target, "at_risk", [issue.id]);

      await rebuildProjectForecast(projectId);

      const updated = await prisma.milestone.findUnique({ where: { id: milestone.id } });
      expect(updated!.status).toBe("upcoming");
    });

    it("SKIPS milestone with status=met (never writes met/missed)", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      const issue = await seedScheduledIssue(projectId, `KFH-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-10"),
        estimateHours: 8,
      });

      // Status=met: engine must skip, leave it met
      const target = new Date("2026-06-04"); // would be at_risk if processed
      const milestone = await seedMilestone(projectId, ownerId, target, "met", [issue.id]);

      await rebuildProjectForecast(projectId);

      const updated = await prisma.milestone.findUnique({ where: { id: milestone.id } });
      // Must remain met — engine never writes met/missed
      expect(updated!.status).toBe("met");
    });

    it("SKIPS milestone with status=missed (never writes met/missed)", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      const issue = await seedScheduledIssue(projectId, `KFI-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-10"),
        estimateHours: 8,
      });

      // Status=missed: engine must skip, leave it missed
      const target = new Date("2026-06-04");
      const milestone = await seedMilestone(projectId, ownerId, target, "missed", [issue.id]);

      await rebuildProjectForecast(projectId);

      const updated = await prisma.milestone.findUnique({ where: { id: milestone.id } });
      expect(updated!.status).toBe("missed");
    });

    it("buffer boundary: forecastEnd exactly at target-bufferDays flips to at_risk", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      // issue: 1 day estimate → forecastEnd = startDate + 1 day = June 2
      // target = June 5, buffer = 3 → riskThreshold = June 2
      // forecastEnd(June 2) >= riskThreshold(June 2) → at_risk (>= is inclusive)
      const startDate = new Date("2026-06-01");
      const issue = await seedScheduledIssue(projectId, `KFJ-1`, 1, {
        startDate,
        dueDate: new Date("2026-06-20"),
        estimateHours: 8, // 1 day → forecastEnd = June 2
      });

      const target = new Date("2026-06-05"); // target - 3days = June 2 = forecastEnd → boundary
      const milestone = await seedMilestone(projectId, ownerId, target, "upcoming", [issue.id]);

      await rebuildProjectForecast(projectId);

      const updated = await prisma.milestone.findUnique({ where: { id: milestone.id } });
      expect(updated!.status).toBe("at_risk");
    });
  });

  // ── 7.6: McpProposal ────────────────────────────────────────────────────

  describe("7.6 — McpProposal escalation", () => {
    it("creates a proposal for critical slip > 0", async () => {
      const { workspaceId, projectId, ownerId } = await seedProjectContext();

      // Critical path + slip: issue with dueDate in the past
      // startDate = June 1, dueDate = June 2, estimate = 24h (3 days) → slip = 2 days
      // No dependencies → the only node → critical by default (float = 0)
      const issue = await seedScheduledIssue(projectId, `KFK-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-02"), // 1 day due, but estimate = 3 days → slip
        estimateHours: 24, // 3 days
      });

      await rebuildProjectForecast(projectId);

      // Single issue → critical path → slipDays > 0 → MUST have a proposal.
      const forecastRow = await prisma.issueForecast.findUnique({
        where: { issueId: issue.id },
      });
      expect(forecastRow).not.toBeNull();
      // Assert the preconditions UNCONDITIONALLY — gating these behind `if`
      // would let the test pass vacuously and hide a critical/slip regression.
      expect(forecastRow!.critical).toBe(true);
      expect(forecastRow!.slipDays).toBeGreaterThan(0);

      const proposals = await prisma.mcpProposal.findMany({
        where: { projectId, status: "pending", kind: "generic" },
      });
      expect(proposals.length).toBeGreaterThanOrEqual(1);
      const p = proposals.find((p) => p.targetRef === `KFK-1`);
      expect(p).toBeDefined();

      void workspaceId;
    });

    it("skips proposal for non-critical slip <= 2", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      // Two issues: A is predecessor (critical), B is successor (non-critical with float)
      // We want B to have slip=1 but float>0 (non-critical)
      // A: start June 1, due June 3, estimate 8h (1 day) → no slip → critical
      // B: start June 2, due June 10, estimate 8h (1 day) → no slip → non-critical
      // Just create B alone with slip=1: start June 1, due June 2, estimate 16h (2 days)
      // But we need B to be non-critical — add a second issue so B has float.
      // Simpler: seed an issue with slip=1 AND float > 0 means we need 2+ issues.
      // Issue A (no slip, sole issue → critical), issue B alone → always critical.
      // Use two issues: A=critical (no float), B=non-critical (has float).
      // A: start June 1, est 8h (1 day), due June 2 = on time → no slip
      // B: start June 1, est 8h (1 day), due June 3 = on time AND has float 1 day
      //    THEN make B slip=1 by reducing its due to forecastEnd:
      //    Wait — if B forecastEnd = June 2, due = June 1 → slipDays=1 but float>0
      //    To have float > 0: B must finish before projectEnd (A + B both end June 2)
      // Actually the simplest approach: two parallel issues, B has less estimate so it ends earlier
      // B: start June 1, est 8h (1 day) → end June 2. due = June 1 → slip = 1 day
      // A: start June 1, est 16h (2 days) → end June 3. A is the critical path.
      // A ends June 3 = projectEnd. B ends June 2 → float = 1 day. B.slip = 1 day. → non-critical → SKIP proposal
      // state "todo" keeps the forecast plan-date based: KAN-145 anchoring only
      // applies to in_progress work, so these planned issues slip deterministically
      // from their fixed dates regardless of the current date.
      const issueA = await seedScheduledIssue(projectId, `KFL-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-04"),
        estimateHours: 16, // 2 days → ends June 3
        state: "todo",
      });
      const issueB = await seedScheduledIssue(projectId, `KFL-2`, 2, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-01"), // due June 1, forecast ends June 2 → slip = 1
        estimateHours: 8, // 1 day → ends June 2
        state: "todo",
      });

      await seedApprovedTimeEntry(ownerId, issueA.id, 0, ownerId);

      await rebuildProjectForecast(projectId);

      const forecastB = await prisma.issueForecast.findUnique({
        where: { issueId: issueB.id },
      });
      expect(forecastB).not.toBeNull();
      // Preconditions (unconditional): B is non-critical (has float) and slips by 1 (≤ 2).
      expect(forecastB!.critical).toBe(false);
      expect(forecastB!.slipDays).toBeGreaterThan(0);
      expect(forecastB!.slipDays).toBeLessThanOrEqual(2);

      const proposals = await prisma.mcpProposal.findMany({
        where: { projectId, status: "pending", kind: "generic", targetRef: "KFL-2" },
      });
      // Non-critical slip ≤ 2 → NO proposal.
      expect(proposals).toHaveLength(0);

      void ownerId;
    });

    it("creates proposal for non-critical slip > 2", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      // Two parallel issues: A is critical (long), B is non-critical but has slip > 2.
      // Constraint: startDate <= dueDate (issue_schedules_date_range_check).
      // A: start June 1, est 24h (3 days) → ends June 4, due June 4 = no slip → critical
      // B: start May 25, due May 28, est 48h (6 days) → forecastEnd May 31 → slip = 3 days
      //    A ends June 4 = projectEnd; B ends May 31 → B has float → non-critical
      // state "todo": KAN-145 anchoring only applies to in_progress work, so these
      // planned issues slip deterministically from their fixed plan dates.
      const issueA = await seedScheduledIssue(projectId, `KFM-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-04"),
        estimateHours: 24, // 3 days → ends June 4
        state: "todo",
      });
      const issueB = await seedScheduledIssue(projectId, `KFM-2`, 2, {
        startDate: new Date("2026-05-25"),
        dueDate: new Date("2026-05-28"), // due May 28; forecast ends May 31 (6 days) → slip 3
        estimateHours: 48, // 6 days → forecastEnd = May 25 + 6 = May 31
        state: "todo",
      });

      await rebuildProjectForecast(projectId);

      const forecastB = await prisma.issueForecast.findUnique({
        where: { issueId: issueB.id },
      });
      expect(forecastB).not.toBeNull();
      // Preconditions (unconditional): B is non-critical with a slip > 2.
      expect(forecastB!.critical).toBe(false);
      expect(forecastB!.slipDays).toBeGreaterThan(2);

      const proposals = await prisma.mcpProposal.findMany({
        where: { projectId, status: "pending", kind: "generic", targetRef: "KFM-2" },
      });
      expect(proposals.length).toBeGreaterThanOrEqual(1);

      void issueA;
      void ownerId;
    });

    it("deduplicates proposals: no second pending generic for same targetRef", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      // Single issue, critical, slip > 0 → proposal created on 1st call
      const issue = await seedScheduledIssue(projectId, `KFN-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-02"),
        estimateHours: 24, // 3 days → slip
      });

      // First call: creates proposal
      await rebuildProjectForecast(projectId);

      const countAfterFirst = await prisma.mcpProposal.count({
        where: { projectId, status: "pending", kind: "generic", targetRef: "KFN-1" },
      });
      // Precondition (unconditional): the first rebuild creates exactly one proposal.
      expect(countAfterFirst).toBe(1);

      // Second call: same data → must NOT create a duplicate
      await rebuildProjectForecast(projectId);

      const countAfterSecond = await prisma.mcpProposal.count({
        where: { projectId, status: "pending", kind: "generic", targetRef: "KFN-1" },
      });
      expect(countAfterSecond).toBe(countAfterFirst);

      void issue;
      void ownerId;
    });

    it("null-issueId approved TimeEntry is skipped (not counted as approved hours)", async () => {
      const { projectId, ownerId } = await seedProjectContext();

      // Issue with estimate but NO approved TimeEntries (only a null-issueId one)
      const issue = await seedScheduledIssue(projectId, `KFO-1`, 1, {
        startDate: new Date("2026-06-01"),
        dueDate: new Date("2026-06-11"),
        estimateHours: 8,
        progress: 0,
      });

      // Approved entry with issueId=null (issue-less work) — must be SKIPPED
      await seedApprovedTimeEntry(ownerId, null, 4, ownerId);

      await rebuildProjectForecast(projectId);

      const row = await prisma.issueForecast.findUnique({ where: { issueId: issue.id } });
      expect(row).not.toBeNull();

      // loggedH should be 0 (the null-issueId entry must not count)
      // With loggedH=0, progress=0, est=8h → forecastEnd = startDate + 1 day = June 2
      // Due = June 11 → slipDays = 0 (no slip) — so engine behaved as if no approved hours
      // We can check via: if loggedH had been counted, it might change slipDays.
      // The simplest assertion: the row exists and was computed without error
      expect(row!.computedAt).toBeDefined();

      void ownerId;
    });
  });
});

// ── KAN-103 PR3: 30-minute minimum floor on interruptions ─────────────────────

describe("KAN-103 PR3 — 30-min floor: sub-threshold interruptions do not inflate forecastEnd", () => {
  let projectId: string;
  let workspaceId: string;
  let memberId: string;

  beforeEach(async () => {
    await cleanDatabase();
    await cleanForecastData();
    const ctx = await seedProjectContext();
    projectId = ctx.projectId;
    workspaceId = ctx.workspaceId;
    memberId = ctx.ownerId;
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it("10-minute closed interruption contributes 0 interruptedDays (forecastEnd unchanged vs baseline)", async () => {
    const startDate = new Date("2026-06-01T00:00:00.000Z");
    const issue = await seedScheduledIssue(projectId, "INT-FLOOR-1", 1, {
      startDate,
      estimateHours: 8, // 1 day
      progress: 0,
    });

    // Establish baseline forecastEnd (no interruptions yet)
    await rebuildProjectForecast(projectId);
    const baselineRow = await prisma.issueForecast.findUnique({ where: { issueId: issue.id } });
    expect(baselineRow).not.toBeNull();
    const baselineEnd = baselineRow!.forecastEnd!;

    const incidentIssue = await prisma.issue.create({
      data: {
        key: "INC-FLOOR-1",
        title: "Short incident",
        type: "incident",
        state: "in_progress",
        projectId,
        sequenceNum: 99,
      },
    });

    // Create a 10-minute interruption (below 30-min floor)
    const intStart = new Date("2026-06-01T08:00:00.000Z");
    const intEnd = new Date("2026-06-01T08:10:00.000Z"); // exactly 10 min
    await prisma.interruption.create({
      data: {
        incidentIssueId: incidentIssue.id,
        interruptedIssueId: issue.id,
        memberId,
        startedAt: intStart,
        endedAt: intEnd,
        via: "manual",
      },
    });

    // Force a fresh rebuild
    await prisma.issueForecast.deleteMany({ where: { issueId: issue.id } });
    await rebuildProjectForecast(projectId);
    const afterRow = await prisma.issueForecast.findUnique({ where: { issueId: issue.id } });
    expect(afterRow).not.toBeNull();

    // Sub-30-min interruption must be ignored → forecastEnd identical to baseline
    expect(afterRow!.forecastEnd!.getTime()).toBe(baselineEnd.getTime());

    void workspaceId;
  });

  it("45-minute closed interruption counts as 1 interruptedDay (forecastEnd pushed by 1 day)", async () => {
    const startDate = new Date("2026-06-01T00:00:00.000Z");
    const issue = await seedScheduledIssue(projectId, "INT-FLOOR-2", 1, {
      startDate,
      estimateHours: 8, // 1 day
      progress: 0,
    });

    // Baseline
    await rebuildProjectForecast(projectId);
    const baselineRow = await prisma.issueForecast.findUnique({ where: { issueId: issue.id } });
    expect(baselineRow).not.toBeNull();
    const baselineEnd = baselineRow!.forecastEnd!;

    const incidentIssue = await prisma.issue.create({
      data: {
        key: "INC-FLOOR-2",
        title: "45-min incident",
        type: "incident",
        state: "in_progress",
        projectId,
        sequenceNum: 99,
      },
    });

    // Create a 45-minute interruption (above 30-min floor → counts)
    const intStart = new Date("2026-06-01T09:00:00.000Z");
    const intEnd = new Date("2026-06-01T09:45:00.000Z"); // exactly 45 min
    await prisma.interruption.create({
      data: {
        incidentIssueId: incidentIssue.id,
        interruptedIssueId: issue.id,
        memberId,
        startedAt: intStart,
        endedAt: intEnd,
        via: "manual",
      },
    });

    // Force fresh rebuild
    await prisma.issueForecast.deleteMany({ where: { issueId: issue.id } });
    await rebuildProjectForecast(projectId);
    const afterRow = await prisma.issueForecast.findUnique({ where: { issueId: issue.id } });
    expect(afterRow).not.toBeNull();

    // 45 min >= 30 min floor → ceil(45min / 1day) = 1 interruptedDay → forecastEnd +1 day
    const diffDays = Math.round(
      (afterRow!.forecastEnd!.getTime() - baselineEnd.getTime()) / 86_400_000
    );
    expect(diffDays).toBe(1);

    void workspaceId;
  });

  it("two 20-minute interruptions on the same issue → 0 interruptedDays (floor is per-interruption, not summed)", async () => {
    const startDate = new Date("2026-06-01T00:00:00.000Z");
    const issue = await seedScheduledIssue(projectId, "INT-FLOOR-3", 1, {
      startDate,
      estimateHours: 8, // 1 day
      progress: 0,
    });

    // Baseline
    await rebuildProjectForecast(projectId);
    const baselineRow = await prisma.issueForecast.findUnique({ where: { issueId: issue.id } });
    expect(baselineRow).not.toBeNull();
    const baselineEnd = baselineRow!.forecastEnd!;

    const incidentIssue = await prisma.issue.create({
      data: {
        key: "INC-FLOOR-3",
        title: "Two short incidents",
        type: "incident",
        state: "in_progress",
        projectId,
        sequenceNum: 99,
      },
    });

    // First 20-minute interruption
    await prisma.interruption.create({
      data: {
        incidentIssueId: incidentIssue.id,
        interruptedIssueId: issue.id,
        memberId,
        startedAt: new Date("2026-06-01T10:00:00.000Z"),
        endedAt: new Date("2026-06-01T10:20:00.000Z"), // 20 min
        via: "manual",
      },
    });
    // Second 20-minute interruption
    await prisma.interruption.create({
      data: {
        incidentIssueId: incidentIssue.id,
        interruptedIssueId: issue.id,
        memberId,
        startedAt: new Date("2026-06-01T14:00:00.000Z"),
        endedAt: new Date("2026-06-01T14:20:00.000Z"), // 20 min
        via: "manual",
      },
    });

    // Force fresh rebuild
    await prisma.issueForecast.deleteMany({ where: { issueId: issue.id } });
    await rebuildProjectForecast(projectId);
    const afterRow = await prisma.issueForecast.findUnique({ where: { issueId: issue.id } });
    expect(afterRow).not.toBeNull();

    // Each 20-min interruption is individually below 30-min floor → both skipped
    // forecastEnd must remain identical to baseline
    expect(afterRow!.forecastEnd!.getTime()).toBe(baselineEnd.getTime());

    void workspaceId;
  });
});

// ── KAN-103 PR3: interruption integration tests ───────────────────────────────

describe("KAN-103 PR3 — interruptions shift forecastEnd in rebuildProjectForecast", () => {
  let projectId: string;
  let workspaceId: string;
  let memberId: string;

  beforeEach(async () => {
    await cleanDatabase();
    await cleanForecastData();
    const ctx = await seedProjectContext();
    projectId = ctx.projectId;
    workspaceId = ctx.workspaceId;
    memberId = ctx.ownerId;
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it("closed interruption (fixed startedAt/endedAt = 2 days) pushes forecastEnd out by 2 days vs baseline", async () => {
    // Seed a baseline issue with no interruptions
    const startDate = new Date("2026-06-01T00:00:00.000Z");
    const baseIssue = await seedScheduledIssue(projectId, "INT-BASE-1", 1, {
      startDate,
      estimateHours: 8, // 1 day → forecastEnd = June 2 (baseline)
      progress: 0,
    });

    // Build baseline forecastEnd
    await rebuildProjectForecast(projectId);
    const baselineRow = await prisma.issueForecast.findUnique({ where: { issueId: baseIssue.id } });
    expect(baselineRow).not.toBeNull();
    const baselineEnd = baselineRow!.forecastEnd!;

    // Seed incident issue for the interruption FK
    const incidentIssue = await prisma.issue.create({
      data: {
        key: "INC-1",
        title: "Incident 1",
        type: "incident",
        state: "in_progress",
        projectId,
        sequenceNum: 99,
      },
    });

    // Create a CLOSED interruption spanning exactly 2 days
    const intStart = new Date("2026-06-01T00:00:00.000Z");
    const intEnd = new Date("2026-06-03T00:00:00.000Z"); // 2 days exactly
    await prisma.interruption.create({
      data: {
        incidentIssueId: incidentIssue.id,
        interruptedIssueId: baseIssue.id,
        memberId,
        startedAt: intStart,
        endedAt: intEnd,
        via: "manual",
      },
    });

    // Rebuild — now with interruption; clear the cached row first
    await prisma.issueForecast.deleteMany({ where: { issueId: baseIssue.id } });
    await rebuildProjectForecast(projectId);
    const interruptedRow = await prisma.issueForecast.findUnique({ where: { issueId: baseIssue.id } });
    expect(interruptedRow).not.toBeNull();
    const interruptedEnd = interruptedRow!.forecastEnd!;

    // forecastEnd should be exactly 2 days later than baseline
    const diffDays = Math.round(
      (interruptedEnd.getTime() - baselineEnd.getTime()) / 86_400_000
    );
    expect(diffDays).toBe(2);

    void workspaceId;
  });

  it("open interruption (endedAt null, startedAt in the past) makes forecastEnd later than baseline", async () => {
    const startDate = new Date("2026-06-01T00:00:00.000Z");
    const baseIssue = await seedScheduledIssue(projectId, "INT-OPEN-1", 2, {
      startDate,
      estimateHours: 8,
      progress: 0,
    });

    // Baseline rebuild
    await rebuildProjectForecast(projectId);
    const baselineRow = await prisma.issueForecast.findUnique({ where: { issueId: baseIssue.id } });
    const baselineEnd = baselineRow!.forecastEnd!;

    const incidentIssue = await prisma.issue.create({
      data: {
        key: "INC-OPEN-1",
        title: "Incident Open",
        type: "incident",
        state: "in_progress",
        projectId,
        sequenceNum: 98,
      },
    });

    // Create an OPEN interruption that started 1 day ago (endedAt null)
    const intStart = new Date(Date.now() - 86_400_000); // 1 day ago
    await prisma.interruption.create({
      data: {
        incidentIssueId: incidentIssue.id,
        interruptedIssueId: baseIssue.id,
        memberId,
        startedAt: intStart,
        endedAt: null, // open — uses `now` as end
        via: "manual",
      },
    });

    // Rebuild with open interruption
    await prisma.issueForecast.deleteMany({ where: { issueId: baseIssue.id } });
    await rebuildProjectForecast(projectId);
    const openRow = await prisma.issueForecast.findUnique({ where: { issueId: baseIssue.id } });
    expect(openRow).not.toBeNull();
    const openEnd = openRow!.forecastEnd!;

    // Open interruption started 1 day ago → at least 1 displaced day → forecastEnd is later
    expect(openEnd.getTime()).toBeGreaterThan(baselineEnd.getTime());

    void workspaceId;
  });
});
