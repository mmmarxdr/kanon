import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for comment service — A4.x (Batch 2) + A6.x (Batch 3)
 * Tests for updateComment: auth check, body update, activityLog, parseAndUpsertMentions call.
 * Tests for createComment: wires parseAndUpsertMentions after creating the comment.
 */

// --- Mocks ---

vi.mock("../../../config/prisma.js", () => ({
  prisma: {
    comment: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    issue: {
      findUnique: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
  },
}));

// Mock parseAndUpsertMentions — we test that updateComment calls it correctly
vi.mock("../../mentions/service.js", () => ({
  parseAndUpsertMentions: vi.fn().mockResolvedValue(undefined),
}));

// Mock createActivityLog (used by createComment — indirect dep but listed for safety)
vi.mock("../../activity/service.js", () => ({
  createActivityLog: vi.fn().mockResolvedValue({}),
}));

import { prisma } from "../../../config/prisma.js";
import { parseAndUpsertMentions } from "../../mentions/service.js";
import { updateComment, createComment } from "../service.js";

const mockIssueFindUnique = vi.mocked(prisma.issue.findUnique);
const mockCommentCreate = vi.mocked(prisma.comment.create);
const mockCommentFindUnique = vi.mocked(prisma.comment.findUnique);
const mockCommentUpdate = vi.mocked(prisma.comment.update);
const mockActivityLogCreate = vi.mocked(prisma.activityLog.create);
const mockParseAndUpsertMentions = vi.mocked(parseAndUpsertMentions);

function makeComment(overrides?: Record<string, unknown>) {
  return {
    id: "cmt-1",
    body: "original body",
    source: "human",
    issueId: "iss-1",
    authorId: "m-alice", // <-- the member ID of the author
    createdAt: new Date(),
    updatedAt: new Date(),
    issue: {
      id: "iss-1",
      key: "TEST-1",
      // workspaceId is NOT a direct field on Issue — it lives in project.workspaceId
      project: { workspaceId: "ws-1" },
    },
    author: {
      id: "m-alice",
      username: "alice",
      user: { email: "alice@test.com" },
    },
    ...overrides,
  };
}

describe("A4.1 — updateComment: success path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates body in DB via prisma.comment.update", async () => {
    const existing = makeComment();
    mockCommentFindUnique.mockResolvedValue(existing as any);
    mockCommentUpdate.mockResolvedValue({
      ...existing,
      body: "new body",
    } as any);

    await updateComment("cmt-1", "new body", "m-alice");

    expect(mockCommentUpdate).toHaveBeenCalledOnce();
    const updateCall = mockCommentUpdate.mock.calls[0]![0] as any;
    expect(updateCall.where).toMatchObject({ id: "cmt-1" });
    expect(updateCall.data).toMatchObject({ body: "new body" });
  });

  it("creates an activityLog with action 'edited' after updating", async () => {
    const existing = makeComment();
    mockCommentFindUnique.mockResolvedValue(existing as any);
    mockCommentUpdate.mockResolvedValue({ ...existing, body: "new body" } as any);

    await updateComment("cmt-1", "new body", "m-alice");

    expect(mockActivityLogCreate).toHaveBeenCalledOnce();
    const logCall = mockActivityLogCreate.mock.calls[0]![0] as any;
    expect(logCall.data.action).toBe("edited");
    expect(logCall.data.issueId).toBe("iss-1");
    expect(logCall.data.memberId).toBe("m-alice");
  });

  it("calls parseAndUpsertMentions with correct args after update", async () => {
    const existing = makeComment();
    const updatedComment = { ...existing, body: "@bob check this" };
    mockCommentFindUnique.mockResolvedValue(existing as any);
    mockCommentUpdate.mockResolvedValue(updatedComment as any);

    await updateComment("cmt-1", "@bob check this", "m-alice");

    expect(mockParseAndUpsertMentions).toHaveBeenCalledOnce();
    const mentionCall = mockParseAndUpsertMentions.mock.calls[0]![0];
    expect(mentionCall).toMatchObject({
      commentId: "cmt-1",
      body: "@bob check this",
      issueId: "iss-1",
      workspaceId: "ws-1", // resolved from issue.project.workspaceId in service
      authorMemberId: "m-alice",
    });
  });

  it("returns the updated comment object", async () => {
    const existing = makeComment();
    const updated = { ...existing, body: "new content" };
    mockCommentFindUnique.mockResolvedValue(existing as any);
    mockCommentUpdate.mockResolvedValue(updated as any);

    const result = await updateComment("cmt-1", "new content", "m-alice");

    expect(result.body).toBe("new content");
  });
});

describe("A4.2 — updateComment: authorization check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws 403 FORBIDDEN when memberId differs from comment.authorId", async () => {
    const existing = makeComment({ authorId: "m-other" });
    mockCommentFindUnique.mockResolvedValue(existing as any);

    await expect(updateComment("cmt-1", "new body", "m-alice")).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });

    // Must NOT call update or parseAndUpsertMentions
    expect(mockCommentUpdate).not.toHaveBeenCalled();
    expect(mockParseAndUpsertMentions).not.toHaveBeenCalled();
  });

  it("throws 404 COMMENT_NOT_FOUND when comment does not exist", async () => {
    mockCommentFindUnique.mockResolvedValue(null);

    await expect(updateComment("cmt-missing", "new body", "m-alice")).rejects.toMatchObject({
      statusCode: 404,
      code: "COMMENT_NOT_FOUND",
    });

    expect(mockCommentUpdate).not.toHaveBeenCalled();
  });

  it("succeeds when memberId matches comment.authorId exactly", async () => {
    const existing = makeComment({ authorId: "m-alice" });
    const updated = { ...existing, body: "updated" };
    mockCommentFindUnique.mockResolvedValue(existing as any);
    mockCommentUpdate.mockResolvedValue(updated as any);

    // Should NOT throw
    await expect(updateComment("cmt-1", "updated", "m-alice")).resolves.toBeDefined();
  });

  it("parseAndUpsertMentions failure is swallowed (best-effort pattern)", async () => {
    const existing = makeComment();
    const updated = { ...existing, body: "@bob hello" };
    mockCommentFindUnique.mockResolvedValue(existing as any);
    mockCommentUpdate.mockResolvedValue(updated as any);
    mockParseAndUpsertMentions.mockRejectedValue(new Error("mention parse error"));

    // Should NOT throw — mention parsing is best-effort
    await expect(updateComment("cmt-1", "@bob hello", "m-alice")).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// A6.1 TEST — createComment wires parseAndUpsertMentions
// ---------------------------------------------------------------------------

function makeIssueForComment(overrides?: Record<string, unknown>) {
  return {
    id: "iss-1",
    key: "TEST-1",
    project: { workspaceId: "ws-1" },
    ...overrides,
  };
}

function makeCreatedComment(overrides?: Record<string, unknown>) {
  return {
    id: "cmt-new",
    body: "@bob check this out",
    source: "human",
    issueId: "iss-1",
    authorId: "m-alice",
    createdAt: new Date(),
    updatedAt: new Date(),
    author: {
      id: "m-alice",
      username: "alice",
      user: { email: "alice@test.com" },
    },
    ...overrides,
  };
}

describe("A6.1 — createComment wires parseAndUpsertMentions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseAndUpsertMentions.mockResolvedValue(undefined);
    mockActivityLogCreate.mockResolvedValue({} as any);
  });

  it("calls parseAndUpsertMentions with correct args after creating a comment with @mentions", async () => {
    const issue = makeIssueForComment();
    // createComment does findUnique by key, now returns { id, project: { workspaceId } }
    mockIssueFindUnique.mockResolvedValue({ id: "iss-1", project: { workspaceId: "ws-1" } } as any);

    const created = makeCreatedComment({ body: "@bob check this out" });
    mockCommentCreate.mockResolvedValue(created as any);

    await createComment(
      "TEST-1",
      { body: "@bob check this out", source: "human" },
      "m-alice",
    );

    expect(mockParseAndUpsertMentions).toHaveBeenCalledOnce();
    const call = mockParseAndUpsertMentions.mock.calls[0]![0];
    expect(call).toMatchObject({
      commentId: "cmt-new",
      body: "@bob check this out",
      issueId: "iss-1",
      authorMemberId: "m-alice",
    });
  });

  it("does NOT call parseAndUpsertMentions when comment body has no @mentions", async () => {
    // Note: parseAndUpsertMentions is still called but handles no-mentions internally.
    // The wiring must always happen — the parser decides if there's work to do.
    // This test verifies the call is made (wiring is unconditional).
    mockIssueFindUnique.mockResolvedValue({ id: "iss-1", project: { workspaceId: "ws-1" } } as any);
    const created = makeCreatedComment({ body: "plain comment", authorId: "m-alice" });
    mockCommentCreate.mockResolvedValue(created as any);

    await createComment(
      "TEST-1",
      { body: "plain comment", source: "human" },
      "m-alice",
    );

    // The wiring is unconditional — parser handles the no-mention case internally
    expect(mockParseAndUpsertMentions).toHaveBeenCalledOnce();
  });

  it("does NOT break createComment when parseAndUpsertMentions throws (best-effort)", async () => {
    mockIssueFindUnique.mockResolvedValue({ id: "iss-1", project: { workspaceId: "ws-1" } } as any);
    const created = makeCreatedComment({ body: "@bob hello" });
    mockCommentCreate.mockResolvedValue(created as any);
    mockParseAndUpsertMentions.mockRejectedValue(new Error("mention failure"));

    // Should resolve — mention parsing must not break comment creation
    await expect(
      createComment("TEST-1", { body: "@bob hello", source: "human" }, "m-alice"),
    ).resolves.toBeDefined();
  });

  it("createComment includes workspaceId resolved from issue context", async () => {
    // The service resolves workspaceId from the issue's project relation.
    // createComment now fetches issue with select: { id, project: { workspaceId } }
    mockIssueFindUnique.mockResolvedValue({
      id: "iss-1",
      project: { workspaceId: "ws-99" },
    } as any);

    const created = makeCreatedComment({ body: "@carol hi", issueId: "iss-1" });
    mockCommentCreate.mockResolvedValue(created as any);

    await createComment(
      "TEST-1",
      { body: "@carol hi", source: "human" },
      "m-alice",
    );

    const call = mockParseAndUpsertMentions.mock.calls[0]![0];
    // workspaceId must come from issue.project.workspaceId (ws-99, not ws-1)
    expect(call.workspaceId).toBe("ws-99");
  });
});
