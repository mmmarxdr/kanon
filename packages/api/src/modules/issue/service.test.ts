import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for issue service — focused on getIssue() cycle include.
 * Uses mocked Prisma and mocked work-session service.
 */

// Mock work-session service (imported indirectly by issue service)
vi.mock("../work-session/service.js", () => ({
  getActiveWorkers: vi.fn().mockResolvedValue([]),
  getActiveWorkersForIssues: vi.fn().mockResolvedValue({}),
}));

// Mock engram client (imported at module level)
vi.mock("../../config/engram.js", () => ({
  getEngramClient: vi.fn().mockReturnValue(null),
}));

// Mock event bus
vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

// Mock prisma
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    issue: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
    issueDependency: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../config/prisma.js";
import { getIssue } from "./service.js";

const mockIssueFindUnique = vi.mocked(prisma.issue.findUnique);

// Base minimal Prisma issue shape that getIssue spreads
function makeIssueRow(overrides?: Record<string, unknown>) {
  return {
    id: "issue-1",
    key: "TEST-1",
    sequenceNum: 1,
    title: "Test issue",
    description: null,
    type: "task",
    priority: "medium",
    state: "backlog",
    labels: [],
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    groupKey: null,
    engramContext: null,
    specArtifacts: null,
    estimate: null,
    cycleId: null,
    projectId: "project-1",
    assigneeId: null,
    parentId: null,
    assignee: null,
    project: { id: "project-1", key: "TEST", name: "Test Project" },
    children: [],
    blocks: [],
    blockedBy: [],
    cycle: null,
    ...overrides,
  };
}

describe("getIssue()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries Prisma with cycle: { select: { id, name } } in the include block", async () => {
    const cyclePayload = { id: "cycle-uuid-1", name: "Sprint Q2" };
    mockIssueFindUnique.mockResolvedValue(
      makeIssueRow({ cycleId: "cycle-uuid-1", cycle: cyclePayload }) as any,
    );

    await getIssue("TEST-1");

    expect(mockIssueFindUnique).toHaveBeenCalledOnce();
    const callArg = mockIssueFindUnique.mock.calls[0]![0] as any;
    // The include block MUST contain a cycle key so the relation is fetched
    expect(callArg.include).toHaveProperty("cycle");
    expect(callArg.include.cycle).toEqual({ select: { id: true, name: true } });
  });

  it("returns cycle: { id, name } when the issue has a cycleId", async () => {
    const cyclePayload = { id: "cycle-uuid-1", name: "Sprint Q2" };
    mockIssueFindUnique.mockResolvedValue(
      makeIssueRow({ cycleId: "cycle-uuid-1", cycle: cyclePayload }) as any,
    );

    const result = await getIssue("TEST-1");

    expect(result.cycle).toEqual(cyclePayload);
    expect(result.cycleId).toBe("cycle-uuid-1");
  });

  it("returns cycle: null when issue has no cycleId", async () => {
    mockIssueFindUnique.mockResolvedValue(
      makeIssueRow({ cycleId: null, cycle: null }) as any,
    );

    const result = await getIssue("TEST-1");

    expect(result.cycle).toBeNull();
    expect(result.cycleId).toBeNull();
  });

  it("throws 404 when issue does not exist", async () => {
    mockIssueFindUnique.mockResolvedValue(null);

    await expect(getIssue("MISSING-999")).rejects.toMatchObject({
      statusCode: 404,
      code: "ISSUE_NOT_FOUND",
    });
  });
});
