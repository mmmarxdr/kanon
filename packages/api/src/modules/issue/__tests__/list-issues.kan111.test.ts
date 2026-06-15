/**
 * KAN-111 — listIssues: q free-text, doc filters, documentKinds shape, no leak
 *
 * RED tests written first (strict TDD). These assert behaviours that do NOT
 * exist yet in service.ts or schema.ts. They are expected to FAIL until the
 * GREEN step adds the new query logic.
 *
 * Test seam (4) from design.md:
 *  - q title/key insensitive
 *  - document_kind=adr only some.kind=adr
 *  - has_documents filter
 *  - distinct documentKinds in response
 *  - q AND filters compose
 *  - regression: existing filters (state, type, priority, assignee_id) still work
 *  - raw `documents` relation array NOT present in response
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../config/prisma.js", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    issue: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../work-session/service.js", () => ({
  getActiveWorkersForIssues: vi.fn().mockResolvedValue(new Map()),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { prisma } from "../../../config/prisma.js";
import { listIssues } from "../service.js";

const mockProjectFindUnique = vi.mocked(prisma.project.findUnique);
const mockIssueFindMany = vi.mocked(prisma.issue.findMany);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProject() {
  return {
    id: "proj-uuid-1",
    key: "KAN",
    name: "Kanon",
    workspaceId: "ws-1",
    archived: false,
  };
}

/**
 * Minimal raw Prisma issue (what findMany returns BEFORE the service maps it).
 * Includes the new `documents` field that will be added in GREEN step.
 */
function makeRawIssue(
  overrides: Record<string, unknown> = {},
  documents: Array<{ kind: string }> = [],
) {
  return {
    id: "iss-1",
    key: "KAN-1",
    sequenceNum: 1,
    title: "Auth module refactor",
    description: null,
    type: "feature",
    priority: "high",
    state: "in_progress",
    labels: [],
    assigneeId: null,
    assignee: null,
    parentId: null,
    groupKey: null,
    projectId: "proj-uuid-1",
    cycleId: null,
    roadmapItemId: null,
    estimate: null,
    completedAt: null,
    createdAt: new Date("2026-06-15T00:00:00.000Z"),
    updatedAt: new Date("2026-06-15T00:00:00.000Z"),
    documents,
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockProjectFindUnique.mockResolvedValue(makeProject() as any);
});

// ─── q free-text filter ───────────────────────────────────────────────────────

describe("listIssues — q free-text filter (KAN-111)", () => {
  it("passes where.OR with contains+insensitive on title AND key when q provided", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", { q: "auth" });

    expect(mockIssueFindMany).toHaveBeenCalledOnce();
    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      OR: [
        { title: { contains: "auth", mode: "insensitive" } },
        { key: { contains: "auth", mode: "insensitive" } },
      ],
    });
  });

  it("does NOT add where.OR when q is absent", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", {});

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.where).not.toHaveProperty("OR");
  });

  it("does NOT add where.OR when q is empty string", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", { q: "" });

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.where).not.toHaveProperty("OR");
  });

  it("does NOT add where.OR when q is whitespace-only", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", { q: "   " });

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.where).not.toHaveProperty("OR");
  });
});

// ─── document_kind filter ─────────────────────────────────────────────────────

describe("listIssues — document_kind filter (KAN-111)", () => {
  it("sets where.documents = { some: { kind } } when document_kind provided", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", { document_kind: "adr" });

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      documents: { some: { kind: "adr" } },
    });
  });
});

// ─── has_documents filter ─────────────────────────────────────────────────────

describe("listIssues — has_documents filter (KAN-111)", () => {
  it("sets where.documents = { some: {} } when has_documents=true", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", { has_documents: true });

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      documents: { some: {} },
    });
  });

  it("does NOT set where.documents when has_documents is absent", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", {});

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.where).not.toHaveProperty("documents");
  });

  it("document_kind takes precedence over has_documents when both provided", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", { has_documents: true, document_kind: "adr" });

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    // document_kind's { some: { kind } } takes precedence
    expect(call.where).toMatchObject({
      documents: { some: { kind: "adr" } },
    });
  });
});

// ─── documentKinds in response ────────────────────────────────────────────────

describe("listIssues — documentKinds in response (KAN-111)", () => {
  it("returns documentKinds: [] when issue has no documents", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue({}, [])] as any);

    const result = await listIssues("proj-uuid-1", {});

    expect(result[0]!.documentKinds).toEqual([]);
  });

  it("returns documentKinds: ['adr', 'rfc'] when issue has two document kinds", async () => {
    mockIssueFindMany.mockResolvedValue([
      makeRawIssue({}, [{ kind: "adr" }, { kind: "rfc" }]),
    ] as any);

    const result = await listIssues("proj-uuid-1", {});

    expect(result[0]!.documentKinds).toEqual(["adr", "rfc"]);
  });

  it("does NOT leak raw 'documents' relation array in response", async () => {
    mockIssueFindMany.mockResolvedValue([
      makeRawIssue({}, [{ kind: "adr" }]),
    ] as any);

    const result = await listIssues("proj-uuid-1", {});

    // The raw `documents` property must be destructured OUT, not spread into the result
    expect((result[0] as Record<string, unknown>)["documents"]).toBeUndefined();
  });

  it("includes documents select+distinct in findMany call", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", {});

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.include).toMatchObject({
      documents: { select: { kind: true }, distinct: ["kind"] },
    });
  });
});

// ─── q + filters compose (AND) ────────────────────────────────────────────────

describe("listIssues — q and filters compose (KAN-111)", () => {
  it("combines q OR clause with state filter via AND", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", { q: "billing", state: "done" });

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    // Both present on the where object — Prisma ANDs them
    expect(call.where).toMatchObject({
      state: "done",
      OR: [
        { title: { contains: "billing", mode: "insensitive" } },
        { key: { contains: "billing", mode: "insensitive" } },
      ],
    });
  });
});

// ─── Regression: existing filters still work ─────────────────────────────────

describe("listIssues — regression: existing filters unaffected (KAN-111)", () => {
  it("state filter still sets where.state", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue({ state: "done" })] as any);

    await listIssues("proj-uuid-1", { state: "done" });

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({ state: "done" });
  });

  it("assignee_id filter still sets where.assigneeId", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", { assignee_id: "member-uuid-1" });

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({ assigneeId: "member-uuid-1" });
  });

  it("orderBy createdAt DESC is unchanged", async () => {
    mockIssueFindMany.mockResolvedValue([makeRawIssue()] as any);

    await listIssues("proj-uuid-1", {});

    const call = mockIssueFindMany.mock.calls[0]![0]!;
    expect(call.orderBy).toEqual({ createdAt: "desc" });
  });
});
