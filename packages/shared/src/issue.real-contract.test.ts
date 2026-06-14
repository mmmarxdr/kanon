/**
 * Real-contract tests for the @kanon/shared issue schemas (KAN-91 regression fix).
 *
 * These tests use the EXACT serialized shapes the API service returns, derived
 * directly from the Prisma selects and the service map() functions in
 * packages/api/src/modules/issue/service.ts and
 * packages/api/src/modules/work-session/service.ts.
 *
 * They prove the schema accepts every valid real response shape, including the
 * nullable fields that caused the original board-breaking regression:
 *   - assignee: null  (no assignee set — most common case on the board)
 *   - assigneeId: null
 *   - description: null
 *
 * WHY: The full E2E stack (Postgres + seeded API + Playwright) is not available
 * in the CI agent environment. These tests are the authoritative proof that the
 * schema matches the real API contract.
 */

import { describe, it, expect } from "vitest";
import {
  issueSchema,
  issueListSchema,
  groupSummaryListSchema,
  issueDetailSchema,
  childIssueSummarySchema,
  activeWorkerSchema,
} from "./issue.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertParses<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

// ─── Realistic API fixtures (match actual Prisma serialization) ───────────────

/**
 * The minimum issue returned by listIssues() when NO assignee is set.
 * This is the MOST COMMON board card shape — no assignee, no description.
 * Previously this failed with: assignee = null is not assignable to { username } | undefined
 */
const ISSUE_NO_ASSIGNEE = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  key: "KAN-1",
  sequenceNum: 1,            // extra field from Prisma — must be stripped, not rejected
  title: "Board test issue 1",
  description: null,         // ← was BREAKING: null not accepted by z.string().optional()
  type: "task",
  priority: "medium",
  state: "backlog",
  labels: [],
  assigneeId: null,          // ← was BREAKING: null not accepted by z.string().optional()
  assignee: null,            // ← was BREAKING: null not accepted by z.object({...}).optional()
  parentId: null,
  groupKey: null,
  projectId: "proj-uuid-1",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z",
  completedAt: null,         // extra Prisma field — stripped
  cycleId: null,             // extra Prisma field — stripped
  roadmapItemId: null,       // extra Prisma field — stripped
  estimate: null,            // extra Prisma field — stripped
  engramContext: null,       // extra Prisma field — stripped
  specArtifacts: null,       // extra Prisma field — stripped
  activeWorkers: [],
};

/** Issue with assignee set — the assignee include returns { id, username, user: { email } } */
const ISSUE_WITH_ASSIGNEE = {
  ...ISSUE_NO_ASSIGNEE,
  key: "KAN-2",
  assigneeId: "member-uuid-1",
  assignee: {
    id: "member-uuid-1",
    username: "dev",
    user: { email: "dev@kanon.io" },  // Prisma nested include shape
  },
  state: "in_progress",
};

/** Issue with active workers — from getActiveWorkersForIssues() mapSession() */
const ISSUE_WITH_ACTIVE_WORKER = {
  ...ISSUE_NO_ASSIGNEE,
  key: "KAN-3",
  activeWorkers: [
    {
      userId: "user-uuid-1",       // ← was MISSING from schema: caused strip but now explicit
      memberId: "member-uuid-1",
      username: "dev",
      isAgent: false,
      startedAt: "2026-06-12T13:00:00.000Z",
      source: "web",
    },
  ],
};

/** Group summary from listIssueGroups() — uses toISOString() for updatedAt */
const GROUP_SUMMARY = {
  groupKey: "sdd/my-feature",
  count: 3,
  latestState: "in_progress",
  title: "My feature group",
  updatedAt: "2026-06-12T00:00:00.000Z",
};

/**
 * Issue detail from getIssue() — children are the slim select shape.
 * Children select: { id, key, title, state, labels } only (not full Issue).
 */
const ISSUE_DETAIL_NO_ASSIGNEE = {
  ...ISSUE_NO_ASSIGNEE,
  key: "KAN-10",
  // detail endpoint includes project relation
  project: { id: "proj-uuid-1", key: "KAN", name: "Kanon" },
  // children use the slim select (id, key, title, state, labels)
  children: [
    { id: "child-uuid-1", key: "KAN-11", title: "Sub-task", state: "todo", labels: ["frontend"] },
  ],
  blocks: [],
  blockedBy: [],
  cycle: null,
  subscribed: false,
};

const ISSUE_DETAIL_WITH_ASSIGNEE = {
  ...ISSUE_DETAIL_NO_ASSIGNEE,
  key: "KAN-20",
  assigneeId: "member-uuid-1",
  assignee: {
    id: "member-uuid-1",
    username: "dev",
    user: { email: "dev@kanon.io" },
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("issueSchema — real API shapes", () => {
  it("parses an issue with null assignee and null description (most common board card)", () => {
    const result = assertParses(issueSchema, ISSUE_NO_ASSIGNEE);
    expect(result.key).toBe("KAN-1");
    expect(result.assignee).toBeNull();
    expect(result.assigneeId).toBeNull();
    expect(result.description).toBeNull();
    // Extra Prisma fields stripped
    expect((result as Record<string, unknown>)["sequenceNum"]).toBeUndefined();
    // TOMBSTONE: dueDate was hard-removed from Issue in PR2b (KAN-99) and moved to IssueSchedule.
    // issueSchema never exposed dueDate — this assertion is vacuous today but kept as a contract
    // marker to document that dueDate must NEVER reappear on the shared issue schema.
    expect((result as Record<string, unknown>)["dueDate"]).toBeUndefined();
  });

  it("parses an issue with assignee (nested { id, username, user: { email } })", () => {
    const result = assertParses(issueSchema, ISSUE_WITH_ASSIGNEE);
    expect(result.assignee).toBeDefined();
    expect(result.assignee?.username).toBe("dev");
  });

  it("parses an issue with active workers including userId", () => {
    const result = assertParses(issueSchema, ISSUE_WITH_ACTIVE_WORKER);
    expect(result.activeWorkers).toHaveLength(1);
    expect(result.activeWorkers![0]!.userId).toBe("user-uuid-1");
    expect(result.activeWorkers![0]!.memberId).toBe("member-uuid-1");
  });

  it("rejects an issue missing required field 'key'", () => {
    const bad = { ...ISSUE_NO_ASSIGNEE, key: undefined };
    expect(() => issueSchema.parse(bad)).toThrow();
  });

  it("rejects an issue with invalid state enum", () => {
    const bad = { ...ISSUE_NO_ASSIGNEE, state: "wont_fix" };
    expect(() => issueSchema.parse(bad)).toThrow();
  });
});

describe("issueListSchema — real board query response", () => {
  it("parses a list of real board issues (the exact query used by useIssuesQuery)", () => {
    const list = [ISSUE_NO_ASSIGNEE, ISSUE_WITH_ASSIGNEE, ISSUE_WITH_ACTIVE_WORKER];
    const result = assertParses(issueListSchema, list);
    expect(result).toHaveLength(3);
    expect(result[0]!.assignee).toBeNull();
    expect(result[1]!.assignee?.username).toBe("dev");
    expect(result[2]!.activeWorkers![0]!.userId).toBe("user-uuid-1");
  });

  it("rejects a list containing a malformed item", () => {
    const bad = [{ id: "x" }]; // missing required fields
    expect(() => issueListSchema.parse(bad)).toThrow();
  });
});

describe("groupSummaryListSchema — real groups query response", () => {
  it("parses a valid group summary list", () => {
    const result = assertParses(groupSummaryListSchema, [GROUP_SUMMARY]);
    expect(result[0]!.groupKey).toBe("sdd/my-feature");
    expect(result[0]!.count).toBe(3);
  });

  it("rejects a group summary with invalid latestState", () => {
    const bad = [{ ...GROUP_SUMMARY, latestState: "archived" }];
    expect(() => groupSummaryListSchema.parse(bad)).toThrow();
  });
});

describe("activeWorkerSchema — real work-session mapSession() output", () => {
  it("parses a worker with userId (present since work-session service mapSession)", () => {
    const worker = {
      userId: "user-uuid-1",
      memberId: "member-uuid-1",
      username: "dev",
      isAgent: false,
      startedAt: "2026-06-12T13:00:00.000Z",
      source: "web",
    };
    const result = assertParses(activeWorkerSchema, worker);
    expect(result.userId).toBe("user-uuid-1");
  });

  it("rejects a worker missing isAgent", () => {
    const bad = { userId: "u", memberId: "m", username: "x", startedAt: "2026-01-01T00:00:00Z", source: "web" };
    expect(() => activeWorkerSchema.parse(bad)).toThrow();
  });
});

describe("issueDetailSchema — real GET /api/issues/:key response", () => {
  it("parses detail with null assignee (most common case)", () => {
    const result = assertParses(issueDetailSchema, ISSUE_DETAIL_NO_ASSIGNEE);
    expect(result.assignee).toBeNull();
    expect(result.project.key).toBe("KAN");
    expect(result.cycle).toBeNull();
    expect(result.subscribed).toBe(false);
  });

  it("parses detail with assignee (nested user.email shape)", () => {
    const result = assertParses(issueDetailSchema, ISSUE_DETAIL_WITH_ASSIGNEE);
    // Intersection result: assignee satisfies both base { username } AND detail { id, username, user }
    expect(result.assignee).toBeDefined();
  });

  it("parses detail with slim children (id/key/title/state/labels only)", () => {
    const result = assertParses(issueDetailSchema, ISSUE_DETAIL_NO_ASSIGNEE);
    expect(result.children).toHaveLength(1);
    expect(result.children![0]!.key).toBe("KAN-11");
  });

  it("rejects detail missing required project field", () => {
    const bad = { ...ISSUE_DETAIL_NO_ASSIGNEE, project: undefined };
    expect(() => issueDetailSchema.parse(bad)).toThrow();
  });
});

describe("childIssueSummarySchema — slim children from getIssue select", () => {
  it("parses the slim child shape returned by getIssue children select", () => {
    const child = { id: "c1", key: "KAN-11", title: "Sub-task", state: "todo", labels: ["frontend"] };
    const result = assertParses(childIssueSummarySchema, child);
    expect(result.key).toBe("KAN-11");
  });

  it("rejects a child missing state", () => {
    const bad = { id: "c1", key: "KAN-11", title: "x", labels: [] };
    expect(() => childIssueSummarySchema.parse(bad)).toThrow();
  });
});
