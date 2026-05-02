import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for parseAndUpsertMentions — A3.x (Batch 2)
 *
 * Strategy: mock the prisma client passed as argument (tx-style).
 * The function signature accepts { tx?: PrismaTransactionClient } — in tests
 * we pass a hand-crafted mock object that stubs only the methods the function calls:
 *   - member.findMany  (resolve usernames → members)
 *   - mention.deleteMany (idempotency sweep)
 *   - mention.createMany (insert resolved targets)
 */

// --- Mock prisma module (used as fallback when tx is NOT provided) ---
vi.mock("../../../config/prisma.js", () => ({
  prisma: {
    member: { findMany: vi.fn() },
    mention: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
}));

import { parseAndUpsertMentions } from "../service.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePrismaStub(overrides?: {
  memberFindMany?: unknown[];
  deleteManyResult?: unknown;
  createManyResult?: unknown;
}) {
  return {
    member: {
      findMany: vi.fn().mockResolvedValue(overrides?.memberFindMany ?? []),
    },
    mention: {
      deleteMany: vi.fn().mockResolvedValue(overrides?.deleteManyResult ?? { count: 0 }),
      createMany: vi.fn().mockResolvedValue(overrides?.createManyResult ?? { count: 0 }),
    },
  };
}

const BASE_ARGS = {
  workspaceId: "ws-1",
  issueId: "iss-1",
  commentId: "cmt-1" as string | null,
  body: "",
  authorMemberId: "m-author",
};

// ── A3.1 — Extrae exactamente las @menciones que coinciden con usernames activos ──

describe("A3.1 — parseAndUpsertMentions: resolves workspace members by username", () => {
  it("body '@alice @bob' with both members in workspace → createMany with 2 entries", async () => {
    const stub = makePrismaStub({
      memberFindMany: [
        { id: "m-alice", username: "alice" },
        { id: "m-bob", username: "bob" },
      ],
    });

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@alice @bob hello",
      tx: stub as any,
    });

    expect(stub.member.findMany).toHaveBeenCalledOnce();
    const findCall = stub.member.findMany.mock.calls[0]![0] as any;
    expect(findCall.where.username.in).toEqual(expect.arrayContaining(["alice", "bob"]));

    expect(stub.mention.createMany).toHaveBeenCalledOnce();
    const createCall = stub.mention.createMany.mock.calls[0]![0] as any;
    expect(createCall.data).toHaveLength(2);
    const mentionedIds = createCall.data.map((d: any) => d.mentionedMemberId);
    expect(mentionedIds).toEqual(expect.arrayContaining(["m-alice", "m-bob"]));
  });

  it("body '@phantom' with no matching member → createMany NOT called", async () => {
    const stub = makePrismaStub({ memberFindMany: [] });

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@phantom review please",
      tx: stub as any,
    });

    expect(stub.member.findMany).toHaveBeenCalledOnce();
    expect(stub.mention.createMany).not.toHaveBeenCalled();
  });

  it("body with no @ symbols → member.findMany NOT called, createMany NOT called", async () => {
    const stub = makePrismaStub();

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "just a plain comment with no mentions",
      tx: stub as any,
    });

    expect(stub.member.findMany).not.toHaveBeenCalled();
    expect(stub.mention.createMany).not.toHaveBeenCalled();
  });
});

// ── A3.2 — Deduplicates same username mentioned twice ─────────────────────────

describe("A3.1 (dedup) — parseAndUpsertMentions: deduplicates same username twice", () => {
  it("body '@alice @alice' → member.findMany called with ['alice'] (no duplicate), createMany with 1 entry", async () => {
    const stub = makePrismaStub({
      memberFindMany: [{ id: "m-alice", username: "alice" }],
    });

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@alice and @alice again",
      tx: stub as any,
    });

    const findCall = stub.member.findMany.mock.calls[0]![0] as any;
    // Must deduplicate before querying — only one "alice" in the `in` array
    expect(findCall.where.username.in).toEqual(["alice"]);

    expect(stub.mention.createMany).toHaveBeenCalledOnce();
    const createCall = stub.mention.createMany.mock.calls[0]![0] as any;
    expect(createCall.data).toHaveLength(1);
  });
});

// ── A3.2 — Excluye auto-menciones (mentionedMemberId === authorMemberId) ───────

describe("A3.2 — parseAndUpsertMentions: excludes self-mentions", () => {
  it("author '@alice' in body and alice IS the author → no row created", async () => {
    const stub = makePrismaStub({
      memberFindMany: [{ id: "m-author", username: "alice" }],
    });

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@alice reminder for myself",
      authorMemberId: "m-author", // alice = author
      tx: stub as any,
    });

    // deleteMany must still run (cleanup), createMany must NOT be called
    expect(stub.mention.deleteMany).toHaveBeenCalledOnce();
    expect(stub.mention.createMany).not.toHaveBeenCalled();
  });

  it("body '@bob @alice', alice is author → only bob gets a mention row", async () => {
    const stub = makePrismaStub({
      memberFindMany: [
        { id: "m-bob", username: "bob" },
        { id: "m-author", username: "alice" },
      ],
    });

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@bob and @alice",
      authorMemberId: "m-author", // alice = author
      tx: stub as any,
    });

    expect(stub.mention.createMany).toHaveBeenCalledOnce();
    const createCall = stub.mention.createMany.mock.calls[0]![0] as any;
    expect(createCall.data).toHaveLength(1);
    expect(createCall.data[0].mentionedMemberId).toBe("m-bob");
  });
});

// ── A3.3 — Idempotencia DELETE+INSERT ─────────────────────────────────────────

describe("A3.3 — parseAndUpsertMentions: idempotency (delete before insert)", () => {
  it("calling twice with same body → deleteMany called each time (sweeps before insert)", async () => {
    const stub = makePrismaStub({
      memberFindMany: [{ id: "m-alice", username: "alice" }],
    });

    // First call
    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@alice check this",
      tx: stub as any,
    });

    // Reset call counts
    stub.mention.deleteMany.mockClear();
    stub.mention.createMany.mockClear();
    stub.member.findMany.mockClear();

    // Second call with SAME body
    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@alice check this",
      tx: stub as any,
    });

    // deleteMany must have been called again to clear before re-insert
    expect(stub.mention.deleteMany).toHaveBeenCalledOnce();
    expect(stub.mention.createMany).toHaveBeenCalledOnce();
    const createCall = stub.mention.createMany.mock.calls[0]![0] as any;
    // Still only 1 row (alice) — no duplicate rows from double-call
    expect(createCall.data).toHaveLength(1);
  });
});

// ── A3.4 — Update removes mentions (body changes to remove @mention) ───────────

describe("A3.4 — parseAndUpsertMentions: update removes existing mentions", () => {
  it("body changed from '@alice ...' to 'ok' → deleteMany called with commentId, createMany NOT called", async () => {
    const stub = makePrismaStub({
      memberFindMany: [], // no new mentions in new body
    });

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      commentId: "cmt-1",
      body: "ok",
      tx: stub as any,
    });

    expect(stub.mention.deleteMany).toHaveBeenCalledOnce();
    const deleteCall = stub.mention.deleteMany.mock.calls[0]![0] as any;
    expect(deleteCall.where).toMatchObject({ commentId: "cmt-1" });

    expect(stub.mention.createMany).not.toHaveBeenCalled();
  });
});

// ── A3.5 — Description mode: commentId = null → deleteMany uses issueId + commentId null ──

describe("A3.5 — parseAndUpsertMentions: description mode (commentId = null)", () => {
  it("commentId = null → deleteMany where { issueId, commentId: null } NOT { commentId: 'cmt' }", async () => {
    const stub = makePrismaStub({
      memberFindMany: [],
    });

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      commentId: null,
      body: "no mentions here",
      tx: stub as any,
    });

    expect(stub.mention.deleteMany).toHaveBeenCalledOnce();
    const deleteCall = stub.mention.deleteMany.mock.calls[0]![0] as any;
    expect(deleteCall.where).toMatchObject({ issueId: "iss-1", commentId: null });
    // Must NOT have a bare commentId key pointing to a string value
    expect(typeof deleteCall.where.commentId).toBe("object"); // null
  });
});
