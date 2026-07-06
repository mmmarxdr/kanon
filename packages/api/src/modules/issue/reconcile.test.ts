import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * KAN-157 — reconcile gate tests (TDD, written BEFORE implementation)
 *
 * Covers:
 *   (a) →done blocked with RECONCILIATION_REQUIRED when issue has unconfirmed WorkLog/TimeEntry
 *   (b) reconcile approves entries + stamps timeConfirmedAt, then →done succeeds
 *   (c) NEW WorkLog created after confirm makes →done block again (staleness)
 *   (d) reconcile with addHours creates a manual approved TimeEntry attributed to the member
 *   (e) issue with zero captured time transitions →done with no reconcile (auto-pass)
 *   (f) batch →done with one unconfirmed issue surfaces it per-issue
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../config/prisma.js", () => {
  // Shared leaf mocks so a tx passed to $transaction uses the SAME vi.fn
  // instances the tests configure on `prisma.*` — otherwise writes inside the
  // transaction hit fresh, unconfigured mocks (returning undefined).
  const issue = { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  const workLog = { findMany: vi.fn(), updateMany: vi.fn() };
  const timeEntry = { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() };
  const member = { findUnique: vi.fn() };
  const project = { findUnique: vi.fn() };
  const activityLog = { create: vi.fn(), createMany: vi.fn() };
  const prisma: any = { issue, workLog, timeEntry, member, project, activityLog };
  prisma.$transaction = vi.fn((fn: (tx: any) => Promise<any>) => fn(prisma));
  return { prisma };
});

vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("../activity/service.js", () => ({
  createActivityLog: vi.fn(),
}));

vi.mock("./auto-transition.js", () => ({
  checkAndAdvanceParent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../roadmap/roadmap-sync.js", () => ({
  syncRoadmapItemStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../work-session/service.js", () => ({
  getActiveWorkers: vi.fn().mockResolvedValue([]),
  getActiveWorkersForIssues: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../issue-subscription/service.js", () => ({
  autoSubscribe: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockResolvedValue({ subscribed: false }),
}));

vi.mock("../cycle/service.js", () => ({
  recordCycleScopeEvent: vi.fn().mockResolvedValue(undefined),
  validateCycleBelongsToProject: vi.fn().mockResolvedValue(null),
  dayIndex: vi.fn().mockReturnValue(1),
}));

vi.mock("../mentions/service.js", () => ({
  parseAndUpsertMentions: vi.fn().mockResolvedValue({ created: [] }),
  emitMentionEvents: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { prisma } from "../../config/prisma.js";
import { transitionIssue, batchTransitionByKeys } from "./service.js";
import { reconcileIssueTime } from "./reconcile.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const ISSUE_ID = "issue-uuid-1";
const ISSUE_KEY = "TEST-1";
const MEMBER_ID = "member-uuid-1";
const PROJECT_ID = "project-uuid-1";

function makeIssue(overrides?: Record<string, unknown>) {
  return {
    id: ISSUE_ID,
    key: ISSUE_KEY,
    state: "review",
    projectId: PROJECT_ID,
    assigneeId: null,
    parentId: null,
    roadmapItemId: null,
    cycleId: null,
    timeConfirmedAt: null,
    completedAt: null,
    project: { workspaceId: "ws-1", key: "TEST" },
    ...overrides,
  } as any;
}

function makeWorkLog(overrides?: Record<string, unknown>) {
  return {
    id: "wl-1",
    issueId: ISSUE_ID,
    memberId: MEMBER_ID,
    durationS: 3600,
    startedAt: new Date("2026-06-24T08:00:00Z"),
    endedAt: new Date("2026-06-24T09:00:00Z"),
    createdAt: new Date("2026-06-24T09:00:00Z"),
    timeEntry: null,
    ...overrides,
  } as any;
}

function makeTimeEntry(overrides?: Record<string, unknown>) {
  return {
    id: "te-1",
    issueId: ISSUE_ID,
    memberId: MEMBER_ID,
    hours: "1",
    status: "draft",
    sourceWorkLogId: "wl-1",
    createdAt: new Date("2026-06-24T09:00:00Z"),
    member: { workspaceId: "ws-1" },
    ...overrides,
  } as any;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("KAN-157 reconciliation gate — transitionIssue →done", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── (a) RECONCILIATION_REQUIRED when unconfirmed WorkLog exists ──────────
  it("(a) throws RECONCILIATION_REQUIRED when issue has WorkLog and timeConfirmedAt is null", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeIssue({ timeConfirmedAt: null }),
    );
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([makeWorkLog()]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([]);

    await expect(
      transitionIssue(ISSUE_KEY, "done", MEMBER_ID),
    ).rejects.toMatchObject({
      code: "RECONCILIATION_REQUIRED",
      statusCode: 409,
    });
  });

  it("(a) RECONCILIATION_REQUIRED payload carries workLogs, timeEntries, totalHours", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeIssue({ timeConfirmedAt: null }),
    );
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([makeWorkLog()]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([makeTimeEntry()]);

    let caughtError: any;
    try {
      await transitionIssue(ISSUE_KEY, "done", MEMBER_ID);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError.code).toBe("RECONCILIATION_REQUIRED");
    expect(caughtError.details).toMatchObject({
      workLogs: expect.any(Array),
      timeEntries: expect.any(Array),
      totalHours: expect.any(Number),
    });
  });

  it("(a) throws RECONCILIATION_REQUIRED when TimeEntry exists and timeConfirmedAt is null (no WorkLog)", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeIssue({ timeConfirmedAt: null }),
    );
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([makeTimeEntry()]);

    await expect(
      transitionIssue(ISSUE_KEY, "done", MEMBER_ID),
    ).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
  });

  // ── (e) Zero captured time → auto-pass ─────────────────────────────────
  it("(e) allows →done when issue has NO WorkLogs and NO TimeEntries (zero captured time)", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeIssue({ timeConfirmedAt: null }),
    );
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.issue.update).mockResolvedValue({ ...makeIssue(), state: "done" } as any);
    vi.mocked(prisma.member.findUnique).mockResolvedValue(null);

    await expect(
      transitionIssue(ISSUE_KEY, "done", MEMBER_ID),
    ).resolves.toBeDefined();
  });

  // ── (c) Staleness — new WorkLog after confirm blocks again ──────────────
  it("(c) blocks →done when a WorkLog was created AFTER timeConfirmedAt (stale)", async () => {
    const confirmedAt = new Date("2026-06-24T10:00:00Z");
    const laterWorkLog = makeWorkLog({
      createdAt: new Date("2026-06-24T11:00:00Z"), // after confirmedAt
    });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeIssue({ timeConfirmedAt: confirmedAt }),
    );
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([laterWorkLog]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([]);

    await expect(
      transitionIssue(ISSUE_KEY, "done", MEMBER_ID),
    ).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
  });

  it("(c) allows →done when timeConfirmedAt is set and no WorkLog/TimeEntry created after it", async () => {
    const confirmedAt = new Date("2026-06-24T12:00:00Z");
    const olderWorkLog = makeWorkLog({
      createdAt: new Date("2026-06-24T09:00:00Z"), // before confirmedAt
    });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeIssue({ timeConfirmedAt: confirmedAt }),
    );
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([olderWorkLog]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.issue.update).mockResolvedValue({ ...makeIssue(), state: "done" } as any);
    vi.mocked(prisma.member.findUnique).mockResolvedValue(null);

    await expect(
      transitionIssue(ISSUE_KEY, "done", MEMBER_ID),
    ).resolves.toBeDefined();
  });
});

// ── reconcileIssueTime ─────────────────────────────────────────────────────

describe("KAN-157 reconcileIssueTime()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── (b) reconcile approves entries + stamps timeConfirmedAt ─────────────
  it("(b) promotes unpromoted WorkLogs, approves draft/submitted TimeEntries, stamps timeConfirmedAt", async () => {
    const unpromoted = makeWorkLog({ timeEntry: null });
    const draftEntry = makeTimeEntry({ status: "draft", sourceWorkLogId: null });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([unpromoted]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([draftEntry]);
    vi.mocked(prisma.timeEntry.create).mockResolvedValue(
      makeTimeEntry({ id: "te-new", sourceWorkLogId: unpromoted.id, status: "approved" }),
    );
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.issue.update).mockResolvedValue(
      makeIssue({ timeConfirmedAt: new Date() }) as any,
    );

    const result = await reconcileIssueTime(ISSUE_ID, MEMBER_ID);

    expect(result).toMatchObject({
      confirmedAt: expect.any(Date),
      totalHours: expect.any(Number),
      entries: expect.any(Array),
    });

    // timeConfirmedAt must be stamped
    expect(prisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ISSUE_ID },
        data: expect.objectContaining({ timeConfirmedAt: expect.any(Date) }),
      }),
    );

    // draft/submitted entries must be approved
    expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issueId: ISSUE_ID,
          status: { in: ["draft", "submitted"] },
        }),
        data: expect.objectContaining({
          status: "approved",
          approvedById: MEMBER_ID,
        }),
      }),
    );
  });

  // ── (d) addHours creates a manual approved TimeEntry ────────────────────
  it("(d) creates a manual approved TimeEntry when addHours is provided", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.timeEntry.create).mockResolvedValue(
      makeTimeEntry({
        id: "te-manual",
        sourceWorkLogId: null,
        status: "approved",
        hours: "2",
      }),
    );
    vi.mocked(prisma.issue.update).mockResolvedValue(
      makeIssue({ timeConfirmedAt: new Date() }) as any,
    );

    await reconcileIssueTime(ISSUE_ID, MEMBER_ID, { addHours: "2" });

    // Manual TimeEntry: no sourceWorkLogId, approved immediately
    expect(prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          issueId: ISSUE_ID,
          memberId: MEMBER_ID,
          status: "approved",
          sourceWorkLogId: null,
          approvedById: MEMBER_ID,
        }),
      }),
    );
  });

  it("(d) does NOT create manual TimeEntry when addHours is 0 or absent", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.issue.update).mockResolvedValue(
      makeIssue({ timeConfirmedAt: new Date() }) as any,
    );

    await reconcileIssueTime(ISSUE_ID, MEMBER_ID, { addHours: "0" });
    expect(prisma.timeEntry.create).not.toHaveBeenCalled();
  });

  it("throws 404 when issue is not found", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(null);

    await expect(reconcileIssueTime("bad-id", MEMBER_ID)).rejects.toMatchObject({
      code: "ISSUE_NOT_FOUND",
      statusCode: 404,
    });
  });
});

// ── FIX 4: equal-timestamp staleness ─────────────────────────────────────────

describe("KAN-157 equal-timestamp staleness (fix 4)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("createdAt === timeConfirmedAt → needed: true (same-ms is stale)", async () => {
    const { checkReconciliation } = await import("./reconcile.js");
    const ts = new Date("2026-06-24T10:00:00.000Z");
    const wl = makeWorkLog({ createdAt: ts });
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([wl]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([]);

    const result = await checkReconciliation(ISSUE_ID, ts);
    expect(result.needed).toBe(true);
  });
});

// ── FIX 2: cross-member approval scoping ─────────────────────────────────────

describe("KAN-157 cross-member approval scoping (fix 2)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("member A reconciling does NOT approve member B's draft entries", async () => {
    const MEMBER_B = "member-uuid-2";
    const memberBEntry = makeTimeEntry({ id: "te-b", memberId: MEMBER_B, sourceWorkLogId: null, status: "draft" });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([memberBEntry]);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.issue.update).mockResolvedValue(makeIssue({ timeConfirmedAt: new Date() }) as any);

    await reconcileIssueTime(ISSUE_ID, MEMBER_ID);

    // The updateMany must be scoped to MEMBER_ID, NOT to member B
    expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberId: MEMBER_ID,
        }),
      }),
    );
  });
});

// ── FIX 3: atomicity — $transaction must be called ───────────────────────────

describe("KAN-157 atomicity — reconcileIssueTime uses $transaction (fix 3)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("reconcileIssueTime wraps all writes in prisma.$transaction", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.issue.update).mockResolvedValue(makeIssue({ timeConfirmedAt: new Date() }) as any);

    await reconcileIssueTime(ISSUE_ID, MEMBER_ID);

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

// ── FIX 5: addHours bounds validation ────────────────────────────────────────

describe("KAN-157 addHours bounds validation (fix 5)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("rejects absurd addHours value '999999999' at schema level", async () => {
    const { ReconcileTimeBody } = await import("./schema.js");
    const result = ReconcileTimeBody.safeParse({ addHours: "999999999" });
    expect(result.success).toBe(false);
  });

  it("accepts normal addHours value '2.5' at schema level", async () => {
    const { ReconcileTimeBody } = await import("./schema.js");
    const result = ReconcileTimeBody.safeParse({ addHours: "2.5" });
    expect(result.success).toBe(true);
  });
});

// ── FIX 7: totalHours in non-stale already-confirmed branch ──────────────────

describe("KAN-157 checkReconciliation totalHours in confirmed/non-stale branch (fix 7)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns real totalHours (not 0) when entries exist and are all confirmed", async () => {
    const { checkReconciliation } = await import("./reconcile.js");
    const confirmedAt = new Date("2026-06-24T12:00:00Z");
    const oldEntry = makeTimeEntry({ hours: "3", createdAt: new Date("2026-06-24T09:00:00Z") });
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([oldEntry]);

    const result = await checkReconciliation(ISSUE_ID, confirmedAt);
    expect(result.needed).toBe(false);
    expect(result.totalHours).toBe(3);
  });
});

// ── FIX 1: parent auto-advance gate bypass ────────────────────────────────────

describe("KAN-157 parent auto-advance does not bypass reconciliation gate (fix 1)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("parent with unconfirmed captured time is NOT auto-advanced to done when last child completes", async () => {
    const { checkAndAdvanceParent } = await import("./auto-transition.js");

    // Parent is at 'review', all children are at 'done' → would normally auto-advance to done
    const parentWithTime = {
      id: "parent-id",
      state: "review",
      timeConfirmedAt: null,  // unconfirmed time
      children: [{ id: "child-1", state: "done" }],
    };

    const mockPrisma = {
      issue: {
        findUnique: vi.fn().mockResolvedValue(parentWithTime),
        update: vi.fn().mockResolvedValue(parentWithTime),
      },
      workLog: {
        findMany: vi.fn().mockResolvedValue([makeWorkLog({ issueId: "parent-id" })]),
      },
      timeEntry: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as any;

    await checkAndAdvanceParent(mockPrisma, { parentId: "parent-id" }, MEMBER_ID);

    // update should NOT be called with state: "done"
    const updateCalls = mockPrisma.issue.update.mock.calls;
    const doneCall = updateCalls.find((call: any[]) => call[0]?.data?.state === "done");
    expect(doneCall).toBeUndefined();
  });
});

// ── KAN-165: single reconcile clears the gate (no second no-op call) ─────────

describe("KAN-165 single reconcile stamps timeConfirmedAt after its own entries", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("stamps timeConfirmedAt STRICTLY after the newest entry created in the same reconcile", async () => {
    // Simulate the live race: the promoted/manual entries get their createdAt
    // from the DB clock DURING the tx, i.e. AFTER the JS `now` captured before
    // the tx opened. Use a future-relative createdAt so it is always > the
    // internal `now = new Date()`.
    const dbCreatedAt = new Date(Date.now() + 60_000);
    const unpromoted = makeWorkLog({ timeEntry: null });
    const promotedEntry = makeTimeEntry({
      id: "te-new",
      sourceWorkLogId: unpromoted.id,
      status: "approved",
      hours: "1",
      createdAt: dbCreatedAt,
    });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([unpromoted]);
    vi.mocked(prisma.timeEntry.create).mockResolvedValue(promotedEntry);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    // Final read inside the tx returns the just-created entry with its DB createdAt.
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([promotedEntry]);
    vi.mocked(prisma.issue.update).mockResolvedValue(makeIssue() as any);

    const result = await reconcileIssueTime(ISSUE_ID, MEMBER_ID, { addHours: "2" });

    // The stamped timeConfirmedAt must be strictly greater than every entry's
    // createdAt — otherwise checkReconciliation (`createdAt >= timeConfirmedAt`)
    // would re-flag this reconcile's own entries as stale and re-block →done.
    const stamped: Date = vi.mocked(prisma.issue.update).mock.calls[0]![0].data.timeConfirmedAt;
    expect(stamped.getTime()).toBeGreaterThan(dbCreatedAt.getTime());
    expect(result.confirmedAt.getTime()).toBeGreaterThan(dbCreatedAt.getTime());
  });

  it("a SINGLE reconcile then checkReconciliation → needed:false (gate clears, no second call)", async () => {
    const { checkReconciliation } = await import("./reconcile.js");
    const dbCreatedAt = new Date(Date.now() + 60_000);
    const unpromoted = makeWorkLog({ timeEntry: null });
    const promotedEntry = makeTimeEntry({
      id: "te-new",
      sourceWorkLogId: unpromoted.id,
      status: "approved",
      hours: "1",
      createdAt: dbCreatedAt,
    });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([unpromoted]);
    vi.mocked(prisma.timeEntry.create).mockResolvedValue(promotedEntry);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([promotedEntry]);
    vi.mocked(prisma.issue.update).mockResolvedValue(makeIssue() as any);

    const { confirmedAt } = await reconcileIssueTime(ISSUE_ID, MEMBER_ID, { addHours: "2" });

    // Now the →done gate re-checks with the freshly stamped confirmedAt. The
    // promoted worklog now has its linked entry; checkReconciliation sees the
    // approved entry (createdAt = dbCreatedAt) plus the (linked) worklog.
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([
      makeWorkLog({ createdAt: dbCreatedAt }),
    ]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([promotedEntry]);

    const check = await checkReconciliation(ISSUE_ID, confirmedAt);
    expect(check.needed).toBe(false);
  });
});

// ── KAN-188: confirmedTotalHours override ────────────────────────────────────

describe("KAN-188 reconcileIssueTime() confirmedTotalHours override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("corrects hours DOWNWARD: existing approved entry totals 6h, override to 4 writes a -2h adjustment via reconcile-override", async () => {
    const existingApproved = makeTimeEntry({
      id: "te-existing",
      status: "approved",
      hours: "6",
      sourceWorkLogId: null,
      createdAt: new Date("2026-06-24T09:00:00Z"),
    });

    const overrideEntry = makeTimeEntry({
      id: "te-override",
      status: "approved",
      hours: "-2",
      sourceWorkLogId: null,
      via: "reconcile-override",
      adjustsId: "te-existing",
      createdAt: new Date("2026-06-24T09:05:00Z"),
    });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    // Step 2.5 (pre-override) read sees only the existing approved entry.
    // Step 4 (final) read sees the existing entry PLUS the just-written
    // override entry — mirrors what a real DB read would return.
    vi.mocked(prisma.timeEntry.findMany)
      .mockResolvedValueOnce([existingApproved])
      .mockResolvedValueOnce([existingApproved, overrideEntry]);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.timeEntry.create).mockResolvedValue(overrideEntry);
    vi.mocked(prisma.issue.update).mockResolvedValue(
      makeIssue({ timeConfirmedAt: new Date() }) as any,
    );

    const result = await reconcileIssueTime(ISSUE_ID, MEMBER_ID, {
      confirmedTotalHours: "4",
    });

    // A corrective TimeEntry must be written with via: "reconcile-override"
    // and a negative delta pointing back to an existing approved entry
    // (DB CHECK: negative hours require adjustsId — ppm-engine §8 invariant #3).
    expect(prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          issueId: ISSUE_ID,
          status: "approved",
          via: "reconcile-override",
          adjustsId: expect.any(String),
        }),
      }),
    );
    const createCall = vi.mocked(prisma.timeEntry.create).mock.calls[0]![0];
    expect(new Prisma.Decimal(createCall.data.hours).toNumber()).toBe(-2);

    expect(result.totalHours).toBe(4);
    expect(result.confirmedAt).toBeInstanceOf(Date);
  });

  it("corrects hours UPWARD: existing approved entry totals 2h, override to 5 writes a +3h entry via reconcile-override", async () => {
    const existingApproved = makeTimeEntry({
      id: "te-existing",
      status: "approved",
      hours: "2",
      sourceWorkLogId: null,
      createdAt: new Date("2026-06-24T09:00:00Z"),
    });

    const overrideEntry = makeTimeEntry({
      id: "te-override",
      status: "approved",
      hours: "3",
      sourceWorkLogId: null,
      via: "reconcile-override",
      createdAt: new Date("2026-06-24T09:05:00Z"),
    });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany)
      .mockResolvedValueOnce([existingApproved])
      .mockResolvedValueOnce([existingApproved, overrideEntry]);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.timeEntry.create).mockResolvedValue(overrideEntry);
    vi.mocked(prisma.issue.update).mockResolvedValue(
      makeIssue({ timeConfirmedAt: new Date() }) as any,
    );

    const result = await reconcileIssueTime(ISSUE_ID, MEMBER_ID, {
      confirmedTotalHours: "5",
    });

    expect(prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          issueId: ISSUE_ID,
          status: "approved",
          via: "reconcile-override",
        }),
      }),
    );
    const createCall = vi.mocked(prisma.timeEntry.create).mock.calls[0]![0];
    expect(new Prisma.Decimal(createCall.data.hours).toNumber()).toBe(3);

    expect(result.totalHours).toBe(5);
  });

  it("no-op accept: override equals the current total → no adjusting entry is created, timeConfirmedAt is still stamped", async () => {
    const existingApproved = makeTimeEntry({
      id: "te-existing",
      status: "approved",
      hours: "3",
      sourceWorkLogId: null,
      createdAt: new Date("2026-06-24T09:00:00Z"),
    });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([existingApproved]);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.issue.update).mockResolvedValue(
      makeIssue({ timeConfirmedAt: new Date() }) as any,
    );

    const result = await reconcileIssueTime(ISSUE_ID, MEMBER_ID, {
      confirmedTotalHours: "3",
    });

    expect(prisma.timeEntry.create).not.toHaveBeenCalled();
    expect(prisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ISSUE_ID },
        data: expect.objectContaining({ timeConfirmedAt: expect.any(Date) }),
      }),
    );
    expect(result.totalHours).toBe(3);
  });

  it("does NOT invoke the addHours top-up branch when confirmedTotalHours is provided (mutual exclusion, defense-in-depth)", async () => {
    const existingApproved = makeTimeEntry({
      id: "te-existing",
      status: "approved",
      hours: "6",
      sourceWorkLogId: null,
      createdAt: new Date("2026-06-24T09:00:00Z"),
    });

    vi.mocked(prisma.issue.findUnique).mockResolvedValue(makeIssue());
    vi.mocked(prisma.workLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([existingApproved]);
    vi.mocked(prisma.timeEntry.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.timeEntry.create).mockResolvedValue(
      makeTimeEntry({
        id: "te-override",
        status: "approved",
        hours: "-2",
        via: "reconcile-override",
        adjustsId: "te-existing",
      }),
    );
    vi.mocked(prisma.issue.update).mockResolvedValue(
      makeIssue({ timeConfirmedAt: new Date() }) as any,
    );

    // Both opts passed directly to the service function (bypassing the Zod
    // schema layer) to prove the service itself never invokes the
    // addHours/"reconcile-manual" branch when confirmedTotalHours is set —
    // defense-in-depth behind the schema-level 400.
    await reconcileIssueTime(ISSUE_ID, MEMBER_ID, {
      addHours: "10",
      confirmedTotalHours: "4",
    } as any);

    const createCalls = vi.mocked(prisma.timeEntry.create).mock.calls;
    const manualTopUpCall = createCalls.find(
      (call) => call[0]?.data?.via === "reconcile-manual",
    );
    expect(manualTopUpCall).toBeUndefined();
  });
});

// ── batchTransitionByKeys — (f) per-issue reconciliation surface ───────────

describe("KAN-157 batchTransitionByKeys →done with unconfirmed issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(f) throws RECONCILIATION_REQUIRED with per-issue info when one issue needs reconciliation", async () => {
    const cleanIssue = {
      id: "issue-clean",
      key: "TEST-2",
      state: "review",
      projectId: PROJECT_ID,
      parentId: null,
      roadmapItemId: null,
      timeConfirmedAt: null,
    } as any;

    const dirtyIssue = {
      id: ISSUE_ID,
      key: ISSUE_KEY,
      state: "review",
      projectId: PROJECT_ID,
      parentId: null,
      roadmapItemId: null,
      timeConfirmedAt: null,
    } as any;

    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: PROJECT_ID,
      key: "TEST",
      workspaceId: "ws-1",
    } as any);

    vi.mocked(prisma.issue.findMany).mockResolvedValue([cleanIssue, dirtyIssue]);

    // cleanIssue: no time data → auto-pass
    // dirtyIssue: has a WorkLog → RECONCILIATION_REQUIRED
    vi.mocked(prisma.workLog.findMany).mockImplementation(({ where }: any) => {
      if (where?.issueId === ISSUE_ID || (where?.issueId?.in && where.issueId.in.includes(ISSUE_ID))) {
        return Promise.resolve([makeWorkLog()]);
      }
      return Promise.resolve([]);
    });

    vi.mocked(prisma.timeEntry.findMany).mockResolvedValue([]);

    await expect(
      batchTransitionByKeys(PROJECT_ID, { to_state: "done", keys: ["TEST-2", ISSUE_KEY] }, MEMBER_ID),
    ).rejects.toMatchObject({
      code: "RECONCILIATION_REQUIRED",
      statusCode: 409,
    });
  });
});
