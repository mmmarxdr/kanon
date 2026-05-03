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
    // $transaction used by nextIssueKey — mock to call the callback immediately
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

vi.mock("../../../config/engram.js", () => ({
  getEngramClient: vi.fn().mockReturnValue(null),
}));

import { prisma } from "../../../config/prisma.js";
import { parseAndUpsertMentions } from "../../mentions/service.js";
import { createIssue, updateIssue } from "../service.js";

const mockPrismaTransaction = vi.mocked(prisma.$transaction);
const mockProjectFindFirst = vi.mocked(prisma.project.findFirst);
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

    // $transaction: execute the callback immediately with a fake tx client
    mockPrismaTransaction.mockImplementation(async (fn: any) => {
      // nextIssueKey calls tx.issue.aggregate — return a mock result
      const fakeTx = {
        issue: {
          aggregate: vi.fn().mockResolvedValue({ _max: { sequenceNum: 0 } }),
        },
      };
      return fn(fakeTx);
    });

    mockProjectFindFirst.mockResolvedValue(makeProject() as any);
  });

  it("calls parseAndUpsertMentions with commentId=null when description is non-empty", async () => {
    const created = makeCreatedIssue({ description: "@bob check this" });
    mockIssueCreate.mockResolvedValue(created as any);

    await createIssue(
      "TEST",
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
      "TEST",
      { title: "Test issue" }, // no description
      "m-alice",
    );

    expect(mockParseAndUpsertMentions).not.toHaveBeenCalled();
  });

  it("does NOT call parseAndUpsertMentions when description is empty string", async () => {
    const created = makeCreatedIssue({ description: "" });
    mockIssueCreate.mockResolvedValue(created as any);

    await createIssue(
      "TEST",
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
      createIssue("TEST", { title: "Test issue", description: "@carol hi" }, "m-alice"),
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
