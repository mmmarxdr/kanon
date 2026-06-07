import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for document service (PR-4a TDD).
 * Tests: createDocument (404/201/SSE), listDocuments (404/list),
 *        updateDocument (404/403/200, author-only).
 */

// --- Mocks ---

vi.mock("../../../config/prisma.js", () => ({
  prisma: {
    issueDocument: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    issue: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../../services/event-bus/index.js", () => ({
  eventBus: {
    emit: vi.fn(),
  },
}));

vi.mock("../../activity/service.js", () => ({
  createActivityLog: vi.fn().mockResolvedValue({}),
}));

import { prisma } from "../../../config/prisma.js";
import { eventBus } from "../../../services/event-bus/index.js";
import { createDocument, listDocuments, updateDocument } from "../service.js";

const mockIssueFindUnique = vi.mocked(prisma.issue.findUnique);
const mockDocumentCreate = vi.mocked(prisma.issueDocument.create);
const mockDocumentFindMany = vi.mocked(prisma.issueDocument.findMany);
const mockDocumentFindUnique = vi.mocked(prisma.issueDocument.findUnique);
const mockDocumentUpdate = vi.mocked(prisma.issueDocument.update);
const mockEventBusEmit = vi.mocked(eventBus.emit);

function makeIssue(overrides?: Record<string, unknown>) {
  return {
    id: "iss-1",
    key: "TEST-1",
    project: { workspaceId: "ws-1" },
    ...overrides,
  };
}

function makeDocument(overrides?: Record<string, unknown>) {
  return {
    id: "doc-1",
    kind: "adr",
    title: "Use Postgres",
    body: "## Decision\n\nUse Postgres.",
    issueId: "iss-1",
    authorId: "m-alice",
    createdAt: new Date(),
    updatedAt: new Date(),
    author: {
      id: "m-alice",
      username: "alice",
      user: { email: "alice@test.com" },
    },
    issue: {
      id: "iss-1",
      key: "TEST-1",
      project: { workspaceId: "ws-1" },
    },
    ...overrides,
  };
}

// ─── createDocument ───────────────────────────────────────────────────────────

describe("createDocument — success path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws 404 ISSUE_NOT_FOUND when issue does not exist", async () => {
    mockIssueFindUnique.mockResolvedValue(null);

    await expect(
      createDocument("MISSING-1", { kind: "adr", title: "T", body: "B" }, "m-alice"),
    ).rejects.toMatchObject({ statusCode: 404, code: "ISSUE_NOT_FOUND" });

    expect(mockDocumentCreate).not.toHaveBeenCalled();
  });

  it("creates document with correct data", async () => {
    mockIssueFindUnique.mockResolvedValue(makeIssue() as any);
    const doc = makeDocument();
    mockDocumentCreate.mockResolvedValue(doc as any);

    await createDocument("TEST-1", { kind: "adr", title: "Use Postgres", body: "## Decision" }, "m-alice");

    expect(mockDocumentCreate).toHaveBeenCalledOnce();
    const call = mockDocumentCreate.mock.calls[0]![0] as any;
    expect(call.data).toMatchObject({
      kind: "adr",
      title: "Use Postgres",
      body: "## Decision",
      issueId: "iss-1",
      authorId: "m-alice",
    });
  });

  it("returns the created document", async () => {
    mockIssueFindUnique.mockResolvedValue(makeIssue() as any);
    const doc = makeDocument();
    mockDocumentCreate.mockResolvedValue(doc as any);

    const result = await createDocument("TEST-1", { kind: "adr", title: "Use Postgres", body: "B" }, "m-alice");

    expect(result.id).toBe("doc-1");
    expect(result.kind).toBe("adr");
  });

  it("emits issue.updated SSE event with field: documents after create", async () => {
    mockIssueFindUnique.mockResolvedValue(makeIssue() as any);
    mockDocumentCreate.mockResolvedValue(makeDocument() as any);

    await createDocument("TEST-1", { kind: "adr", title: "T", body: "B" }, "m-alice");

    expect(mockEventBusEmit).toHaveBeenCalledOnce();
    const emitCall = mockEventBusEmit.mock.calls[0]![0] as any;
    expect(emitCall.type).toBe("issue.updated");
    expect(emitCall.payload).toMatchObject({ issueKey: "TEST-1", field: "documents" });
  });

  it("SSE emit failure does not break createDocument (fire-and-forget)", async () => {
    mockIssueFindUnique.mockResolvedValue(makeIssue() as any);
    mockDocumentCreate.mockResolvedValue(makeDocument() as any);
    mockEventBusEmit.mockImplementationOnce(() => { throw new Error("SSE failure"); });

    await expect(
      createDocument("TEST-1", { kind: "adr", title: "T", body: "B" }, "m-alice"),
    ).resolves.toBeDefined();
  });
});

// ─── listDocuments ────────────────────────────────────────────────────────────

describe("listDocuments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws 404 when issue not found", async () => {
    mockIssueFindUnique.mockResolvedValue(null);

    await expect(listDocuments("MISSING-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "ISSUE_NOT_FOUND",
    });
  });

  it("returns documents ordered by createdAt asc", async () => {
    mockIssueFindUnique.mockResolvedValue(makeIssue() as any);
    const docs = [makeDocument(), makeDocument({ id: "doc-2", title: "Second" })];
    mockDocumentFindMany.mockResolvedValue(docs as any);

    const result = await listDocuments("TEST-1");

    expect(mockDocumentFindMany).toHaveBeenCalledOnce();
    const call = mockDocumentFindMany.mock.calls[0]![0] as any;
    expect(call.orderBy).toMatchObject({ createdAt: "asc" });
    expect(result).toHaveLength(2);
  });

  it("returns empty array when issue has no documents", async () => {
    mockIssueFindUnique.mockResolvedValue(makeIssue() as any);
    mockDocumentFindMany.mockResolvedValue([]);

    const result = await listDocuments("TEST-1");
    expect(result).toEqual([]);
  });
});

// ─── updateDocument ───────────────────────────────────────────────────────────

describe("updateDocument — authorization + update", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws 404 when document not found", async () => {
    mockDocumentFindUnique.mockResolvedValue(null);

    await expect(
      updateDocument("doc-missing", { title: "New" }, "m-alice"),
    ).rejects.toMatchObject({ statusCode: 404, code: "DOCUMENT_NOT_FOUND" });

    expect(mockDocumentUpdate).not.toHaveBeenCalled();
  });

  it("throws 403 FORBIDDEN when memberId differs from document.authorId", async () => {
    mockDocumentFindUnique.mockResolvedValue(makeDocument({ authorId: "m-other" }) as any);

    await expect(
      updateDocument("doc-1", { title: "New" }, "m-alice"),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    expect(mockDocumentUpdate).not.toHaveBeenCalled();
  });

  it("updates only the provided fields", async () => {
    const existing = makeDocument();
    mockDocumentFindUnique.mockResolvedValue(existing as any);
    mockDocumentUpdate.mockResolvedValue({ ...existing, title: "New title" } as any);

    await updateDocument("doc-1", { title: "New title" }, "m-alice");

    expect(mockDocumentUpdate).toHaveBeenCalledOnce();
    const call = mockDocumentUpdate.mock.calls[0]![0] as any;
    expect(call.data).toMatchObject({ title: "New title" });
    expect(call.data.body).toBeUndefined();
  });

  it("returns updated document", async () => {
    const existing = makeDocument();
    const updated = { ...existing, body: "new body" };
    mockDocumentFindUnique.mockResolvedValue(existing as any);
    mockDocumentUpdate.mockResolvedValue(updated as any);

    const result = await updateDocument("doc-1", { body: "new body" }, "m-alice");
    expect(result.body).toBe("new body");
  });

  it("emits issue.updated SSE after update", async () => {
    const existing = makeDocument();
    mockDocumentFindUnique.mockResolvedValue(existing as any);
    mockDocumentUpdate.mockResolvedValue(existing as any);

    await updateDocument("doc-1", { title: "Updated" }, "m-alice");

    expect(mockEventBusEmit).toHaveBeenCalledOnce();
    const emitCall = mockEventBusEmit.mock.calls[0]![0] as any;
    expect(emitCall.type).toBe("issue.updated");
    expect(emitCall.payload).toMatchObject({ field: "documents" });
  });
});
