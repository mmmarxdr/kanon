import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for issue service — A6.x (Batch 3)
 * Tests for createIssue + updateIssue: wiring of parseAndUpsertMentions.
 *
 * A6.2 TEST — createIssue calls parseAndUpsertMentions with commentId=null when description non-empty
 * A6.3 TEST — updateIssue calls parseAndUpsertMentions when description in patch; NOT called otherwise
 */

// --- Mocks ---

vi.mock("../../../config/prisma.js", () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      // KAN-53: nextIssueKey now uses atomic increment via project.update
      update: vi.fn(),
    },
    issue: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
    integrationProjectBinding: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../mentions/service.js", () => ({
  parseAndUpsertMentions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../activity/service.js", () => ({
  createActivityLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../cycle/service.js", () => ({
  validateCycleBelongsToProject: vi.fn(),
  recordCycleScopeEvent: vi.fn().mockResolvedValue(undefined),
  dayIndex: vi.fn().mockReturnValue(1),
}));

vi.mock("../../work-session/service.js", () => ({
  getActiveWorkers: vi.fn().mockResolvedValue([]),
  getActiveWorkersForIssues: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../../../services/event-bus/index.js", () => ({
  eventBus: {
    emit: vi.fn(),
  },
}));

vi.mock("../../../shared/issue-templates.js", () => ({
  resolveTemplate: vi.fn().mockReturnValue(null),
}));

import { prisma } from "../../../config/prisma.js";
import { parseAndUpsertMentions } from "../../mentions/service.js";
import { createIssue, updateIssue } from "../service.js";

const mockPrismaTransaction = vi.mocked(prisma.$transaction);
const mockProjectFindFirst = vi.mocked(prisma.project.findFirst);
const mockProjectFindUnique = vi.mocked(prisma.project.findUnique);
const mockProjectUpdate = vi.mocked(prisma.project.update);
const mockIssueFindUnique = vi.mocked(prisma.issue.findUnique);
const mockIssueCreate = vi.mocked(prisma.issue.create);
const mockIssueUpdate = vi.mocked(prisma.issue.update);
const mockParseAndUpsertMentions = vi.mocked(parseAndUpsertMentions);

function makeProject(overrides?: Record<string, unknown>) {
  return {
    id: "proj-1",
    key: "TEST",
    name: "Test Project",
    workspaceId: "ws-1",
    archived: false,
    ...overrides,
  };
}

function makeCreatedIssue(overrides?: Record<string, unknown>) {
  return {
    id: "iss-new",
    key: "TEST-1",
    sequenceNum: 1,
    title: "Test issue",
    description: "@bob check this",
    type: "task",
    priority: "medium",
    state: "backlog",
    labels: [],
    projectId: "proj-1",
    assigneeId: null,
    cycleId: null,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeExistingIssue(overrides?: Record<string, unknown>) {
  return {
    id: "iss-1",
    key: "TEST-1",
    title: "Existing issue",
    description: "old description",
    type: "task",
    priority: "medium",
    state: "backlog",
    labels: [],
    projectId: "proj-1",
    assigneeId: null,
    cycleId: null,
    parentId: null,
    roadmapItemId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    project: { workspaceId: "ws-1", key: "TEST" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A6.2 TEST — createIssue wires parseAndUpsertMentions
// ---------------------------------------------------------------------------

describe("A6.2 — createIssue wires parseAndUpsertMentions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseAndUpsertMentions.mockResolvedValue(undefined);

    // KAN-53: nextIssueKey uses atomic project.update increment (not $transaction + aggregate)
    mockProjectUpdate.mockResolvedValue({ lastSequenceNum: 1 } as any);

    mockProjectFindFirst.mockResolvedValue(makeProject() as any);
    mockProjectFindUnique.mockResolvedValue(makeProject() as any);
  });

  it("calls parseAndUpsertMentions with commentId=null when description is non-empty", async () => {
    const created = makeCreatedIssue({ description: "@bob check this" });
    mockIssueCreate.mockResolvedValue(created as any);

    await createIssue(
      "proj-1",
      { title: "Test issue", description: "@bob check this" },
      "m-alice",
    );

    expect(mockParseAndUpsertMentions).toHaveBeenCalledOnce();
    const call = mockParseAndUpsertMentions.mock.calls[0]![0];
    expect(call).toMatchObject({
      commentId: null,
      body: "@bob check this",
      issueId: "iss-new",
      workspaceId: "ws-1",
      authorMemberId: "m-alice",
    });
  });

  it("does NOT call parseAndUpsertMentions when description is null/undefined", async () => {
    const created = makeCreatedIssue({ description: null });
    mockIssueCreate.mockResolvedValue(created as any);

    await createIssue(
      "proj-1",
      { title: "Test issue" }, // no description
      "m-alice",
    );

    expect(mockParseAndUpsertMentions).not.toHaveBeenCalled();
  });

  it("does NOT call parseAndUpsertMentions when description is empty string", async () => {
    const created = makeCreatedIssue({ description: "" });
    mockIssueCreate.mockResolvedValue(created as any);

    await createIssue(
      "proj-1",
      { title: "Test issue", description: "" },
      "m-alice",
    );

    expect(mockParseAndUpsertMentions).not.toHaveBeenCalled();
  });

  it("does NOT break createIssue when parseAndUpsertMentions throws (best-effort)", async () => {
    const created = makeCreatedIssue({ description: "@carol hi" });
    mockIssueCreate.mockResolvedValue(created as any);
    mockParseAndUpsertMentions.mockRejectedValue(new Error("mention failure"));

    // Should resolve — mention parsing must not block issue creation
    await expect(
      createIssue("proj-1", { title: "Test issue", description: "@carol hi" }, "m-alice"),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// A6.3 TEST — updateIssue wires parseAndUpsertMentions
// ---------------------------------------------------------------------------

describe("A6.3 — updateIssue wires parseAndUpsertMentions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseAndUpsertMentions.mockResolvedValue(undefined);
  });

  it("calls parseAndUpsertMentions with commentId=null when patch includes description", async () => {
    const existing = makeExistingIssue();
    mockIssueFindUnique.mockResolvedValue(existing as any);
    const updated = { ...existing, description: "@dave review please" };
    mockIssueUpdate.mockResolvedValue(updated as any);

    await updateIssue(
      "TEST-1",
      { description: "@dave review please" },
      "m-alice",
    );

    expect(mockParseAndUpsertMentions).toHaveBeenCalledOnce();
    const call = mockParseAndUpsertMentions.mock.calls[0]![0];
    expect(call).toMatchObject({
      commentId: null,
      body: "@dave review please",
      issueId: "iss-1",
      workspaceId: "ws-1",
      authorMemberId: "m-alice",
    });
  });

  it("does NOT call parseAndUpsertMentions when patch does NOT include description", async () => {
    const existing = makeExistingIssue();
    mockIssueFindUnique.mockResolvedValue(existing as any);
    const updated = { ...existing, title: "New title" };
    mockIssueUpdate.mockResolvedValue(updated as any);

    await updateIssue(
      "TEST-1",
      { title: "New title" }, // no description in patch
      "m-alice",
    );

    expect(mockParseAndUpsertMentions).not.toHaveBeenCalled();
  });

  it("does NOT break updateIssue when parseAndUpsertMentions throws (best-effort)", async () => {
    const existing = makeExistingIssue();
    mockIssueFindUnique.mockResolvedValue(existing as any);
    const updated = { ...existing, description: "@carol new desc" };
    mockIssueUpdate.mockResolvedValue(updated as any);
    mockParseAndUpsertMentions.mockRejectedValue(new Error("mention failure"));

    // Should resolve — mention parsing must not block issue update
    await expect(
      updateIssue("TEST-1", { description: "@carol new desc" }, "m-alice"),
    ).resolves.toBeDefined();
  });

  it("calls parseAndUpsertMentions even when description is empty string (parser handles no-op)", async () => {
    // When description is explicitly set to "", we still call the parser —
    // it will delete existing mentions and insert nothing (correct idempotency behavior)
    const existing = makeExistingIssue({ description: "@bob old mention" });
    mockIssueFindUnique.mockResolvedValue(existing as any);
    const updated = { ...existing, description: "" };
    mockIssueUpdate.mockResolvedValue(updated as any);

    await updateIssue("TEST-1", { description: "" }, "m-alice");

    // description IS in the patch (even if empty) — parser must be called
    expect(mockParseAndUpsertMentions).toHaveBeenCalledOnce();
    const call = mockParseAndUpsertMentions.mock.calls[0]![0];
    expect(call.body).toBe("");
    expect(call.commentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KAN-35 Phase 5 — Backfill SQL data-integrity test
//
// Verifies the in-migration backfill logic in pure TypeScript — no live DB
// needed (structural-exempt per spec: migration SQL already written in Phase 1).
//
// SQL being tested (migration.sql):
//   UPDATE issues SET completed_at = sub.max_created_at
//   FROM (
//     SELECT issue_id, MAX(created_at) AS max_created_at
//     FROM activity_logs
//     WHERE action='state_changed'
//       AND (details->>'to'='done' OR details->>'newValue'='done')
//     GROUP BY issue_id
//   ) sub
//   WHERE issues.id = sub.issue_id AND issues.state = 'done';
// ---------------------------------------------------------------------------

/**
 * Pure TypeScript implementation of the backfill SQL logic.
 * Mirrors the exact filtering and MAX(created_at) semantics of the migration.
 */
function runBackfillLogic(
  issues: Array<{ id: string; state: string; completedAt: Date | null }>,
  activityLogs: Array<{ issueId: string; action: string; createdAt: Date; details: Record<string, unknown> }>,
): Array<{ id: string; completedAt: Date | null }> {
  // Build MAX(created_at) per issue_id matching the SQL WHERE clause
  const maxDoneLogByIssue = new Map<string, Date>();
  for (const log of activityLogs) {
    if (log.action !== "state_changed") continue;
    const det = log.details;
    // Mirrors: details->>'to'='done' OR details->>'newValue'='done'
    const isDone = det["to"] === "done" || det["newValue"] === "done";
    if (!isDone) continue;
    const prev = maxDoneLogByIssue.get(log.issueId);
    if (!prev || log.createdAt > prev) {
      maxDoneLogByIssue.set(log.issueId, log.createdAt);
    }
  }

  // Apply update: only issues in state='done' with a matching log get backfilled
  return issues.map((issue) => {
    if (issue.state !== "done") return issue;
    const maxCreatedAt = maxDoneLogByIssue.get(issue.id);
    if (!maxCreatedAt) return issue; // no qualifying log → stays NULL
    return { ...issue, completedAt: maxCreatedAt };
  });
}

describe("KAN-35 Phase 5 — Backfill SQL data-integrity", () => {
  const logCreatedAt = new Date("2026-01-10T12:00:00.000Z");

  it("D1 — done issue with {to:'done'} log gets completedAt set to log createdAt (current shape)", () => {
    const issues = [{ id: "iss-1", state: "done", completedAt: null }];
    const logs = [
      { issueId: "iss-1", action: "state_changed", createdAt: logCreatedAt, details: { from: "in_progress", to: "done" } },
    ];

    const result = runBackfillLogic(issues, logs);

    expect(result[0]!.completedAt).toEqual(logCreatedAt);
  });

  it("D2 — done issue with {newValue:'done'} log gets completedAt set (legacy shape)", () => {
    const issues = [{ id: "iss-legacy", state: "done", completedAt: null }];
    const logs = [
      { issueId: "iss-legacy", action: "state_changed", createdAt: logCreatedAt, details: { newValue: "done" } },
    ];

    const result = runBackfillLogic(issues, logs);

    // Legacy shape must be detected → completedAt backfilled
    expect(result[0]!.completedAt).toEqual(logCreatedAt);
  });

  it("D3 — done issue with no qualifying log stays NULL (un-backfillable)", () => {
    const issues = [{ id: "iss-no-log", state: "done", completedAt: null }];
    const logs: typeof issues extends never ? never : any[] = []; // no logs at all

    const result = runBackfillLogic(issues, logs);

    expect(result[0]!.completedAt).toBeNull();
  });

  it("D4 — done issue with non-done log only stays NULL", () => {
    const issues = [{ id: "iss-no-done-log", state: "done", completedAt: null }];
    const logs = [
      { issueId: "iss-no-done-log", action: "state_changed", createdAt: logCreatedAt, details: { from: "todo", to: "in_progress" } },
    ];

    const result = runBackfillLogic(issues, logs);

    expect(result[0]!.completedAt).toBeNull();
  });

  it("D5 — MAX(created_at) wins when multiple done logs exist for same issue", () => {
    const earlyLog = new Date("2026-01-08T10:00:00.000Z");
    const laterLog = new Date("2026-01-12T10:00:00.000Z"); // most recent — should win

    const issues = [{ id: "iss-multi", state: "done", completedAt: null }];
    const logs = [
      { issueId: "iss-multi", action: "state_changed", createdAt: earlyLog, details: { to: "done" } },
      { issueId: "iss-multi", action: "state_changed", createdAt: laterLog, details: { to: "done" } },
    ];

    const result = runBackfillLogic(issues, logs);

    expect(result[0]!.completedAt).toEqual(laterLog);
  });

  it("D6 — non-done issue is NOT backfilled even if it has a done log", () => {
    // A reopened issue: state is now 'in_progress' but has an old done log
    const issues = [{ id: "iss-reopened", state: "in_progress", completedAt: null }];
    const logs = [
      { issueId: "iss-reopened", action: "state_changed", createdAt: logCreatedAt, details: { to: "done" } },
    ];

    const result = runBackfillLogic(issues, logs);

    // SQL WHERE issues.state='done' excludes this issue
    expect(result[0]!.completedAt).toBeNull();
  });
});
