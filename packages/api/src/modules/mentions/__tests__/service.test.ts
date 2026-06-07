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
  const memberList = overrides?.memberFindMany ?? [];
  return {
    member: {
      findMany: vi.fn().mockResolvedValue(memberList),
    },
    mention: {
      // mention.findMany used for prior-set query (S3 delta, returns prior mentionedMemberIds)
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue(overrides?.deleteManyResult ?? { count: 0 }),
      // mention.create replaces createMany for individual ID return
      create: vi.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: `generated-id-${args.data.mentionedMemberId}`, ...args.data }),
      ),
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
  it("body '@alice @bob' with both members in workspace → mention.create called twice (once per target)", async () => {
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

    // create is called once per target (alice + bob)
    expect(stub.mention.create).toHaveBeenCalledTimes(2);
    const createCalls = stub.mention.create.mock.calls.map((c: any) => c[0].data.mentionedMemberId);
    expect(createCalls).toEqual(expect.arrayContaining(["m-alice", "m-bob"]));
  });

  it("body '@phantom' with no matching member → mention.create NOT called", async () => {
    const stub = makePrismaStub({ memberFindMany: [] });

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@phantom review please",
      tx: stub as any,
    });

    expect(stub.member.findMany).toHaveBeenCalledOnce();
    expect(stub.mention.create).not.toHaveBeenCalled();
  });

  it("body with no @ symbols → member.findMany NOT called, mention.create NOT called", async () => {
    const stub = makePrismaStub();

    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "just a plain comment with no mentions",
      tx: stub as any,
    });

    expect(stub.member.findMany).not.toHaveBeenCalled();
    expect(stub.mention.create).not.toHaveBeenCalled();
  });
});

// ── A3.2 — Deduplicates same username mentioned twice ─────────────────────────

describe("A3.1 (dedup) — parseAndUpsertMentions: deduplicates same username twice", () => {
  it("body '@alice @alice' → member.findMany called with ['alice'] (no duplicate), mention.create called once", async () => {
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

    expect(stub.mention.create).toHaveBeenCalledTimes(1);
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

    // deleteMany must still run (cleanup), mention.create must NOT be called
    expect(stub.mention.deleteMany).toHaveBeenCalledOnce();
    expect(stub.mention.create).not.toHaveBeenCalled();
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

    // mention.create called once for bob only
    expect(stub.mention.create).toHaveBeenCalledTimes(1);
    const createCall = stub.mention.create.mock.calls[0]![0] as any;
    expect(createCall.data.mentionedMemberId).toBe("m-bob");
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
    stub.mention.create.mockClear();
    stub.member.findMany.mockClear();

    // Second call with SAME body
    await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@alice check this",
      tx: stub as any,
    });

    // deleteMany must have been called again to clear before re-insert
    expect(stub.mention.deleteMany).toHaveBeenCalledOnce();
    // mention.create called once for alice (second sweep — she was in prior set, delta = 0,
    // but create is still called to persist the row — delta only affects emitted events)
    expect(stub.mention.create).toHaveBeenCalledTimes(1);
  });
});

// ── A3.4 — Update removes mentions (body changes to remove @mention) ───────────

describe("A3.4 — parseAndUpsertMentions: update removes existing mentions", () => {
  it("body changed from '@alice ...' to 'ok' → deleteMany called with commentId, mention.create NOT called", async () => {
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

    expect(stub.mention.create).not.toHaveBeenCalled();
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

// ── Fix 3 — Atomicity: partial create failure must not orphan rows ────────────
//
// If mention.create fails on the 2nd target after the 1st has been inserted,
// and the deleteMany already ran, we end up with 1 orphan row + 0 emitted events.
// Fix: when called WITHOUT an external tx, wrap the delete+create loop in a
// prisma.$transaction so all-or-nothing semantics are preserved.
// (When an external tx IS provided the caller owns atomicity — no wrapping needed.)

describe("Fix 3 — parseAndUpsertMentions: all-or-nothing on induced failure", () => {
  it("create failure propagates out of the function (all-or-nothing semantics)", async () => {
    // Create a stub where the 2nd mention.create call throws
    let createCount = 0;
    const stub = {
      member: {
        findMany: vi.fn().mockResolvedValue([
          { id: "m-alice", username: "alice" },
          { id: "m-bob", username: "bob" },
        ]),
      },
      mention: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockImplementation((args: any) => {
          createCount++;
          if (createCount === 2) return Promise.reject(new Error("DB error on 2nd create"));
          return Promise.resolve({ id: `id-${args.data.mentionedMemberId}`, ...args.data });
        }),
      },
    };

    // The function must propagate the error (not silently succeed with partial state)
    await expect(
      parseAndUpsertMentions({
        ...BASE_ARGS,
        body: "@alice and @bob",
        tx: stub as any,
      }),
    ).rejects.toThrow("DB error on 2nd create");
  });
});

// ── S3 Delta return (KAN-27) ──────────────────────────────────────────────────
//
// parseAndUpsertMentions must now return:
//   { created: Array<{ mentionId: string; mentionedMemberId: string; context: string }> }
// so callers can emit mention.created per new mention (D1).
//
// Delta logic: query prior mentionedMemberId set BEFORE sweep; created = targets not in prior set.

function makePrismaStubWithCreate(overrides?: {
  memberFindMany?: Array<{ id: string; username: string }>;
  existingMentionIds?: string[];
}) {
  const existingMentionedMemberIds = overrides?.existingMentionIds ?? [];
  return {
    member: {
      findMany: vi.fn().mockResolvedValue(overrides?.memberFindMany ?? []),
    },
    mention: {
      findMany: vi.fn().mockResolvedValue(
        existingMentionedMemberIds.map((id) => ({ mentionedMemberId: id })),
      ),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: `generated-id-${args.data.mentionedMemberId}`, ...args.data }),
      ),
    },
  };
}

describe("S3 — parseAndUpsertMentions: delta return value (KAN-27)", () => {
  it("returns { created: [] } when body has no mentions", async () => {
    const stub = makePrismaStubWithCreate({ memberFindMany: [] });
    const result = await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "no mentions",
      tx: stub as any,
    });
    expect(result).toEqual({ created: [] });
  });

  it("returns { created: [entry] } for a genuinely new mention (not in prior set)", async () => {
    // Prior set is empty → alice is a new mention
    const stub = makePrismaStubWithCreate({
      memberFindMany: [{ id: "m-alice", username: "alice" }],
      existingMentionIds: [], // no prior mentions
    });
    const result = await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@alice check this",
      tx: stub as any,
    });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.mentionedMemberId).toBe("m-alice");
    expect(result.created[0]!.mentionId).toBeDefined();
    expect(result.created[0]!.context).toContain("alice");
  });

  it("returns { created: [] } for a re-mention after edit (alice already in prior set)", async () => {
    // Prior set contains alice → she was already notified, skip
    const stub = makePrismaStubWithCreate({
      memberFindMany: [{ id: "m-alice", username: "alice" }],
      existingMentionIds: ["m-alice"], // alice already mentioned
    });
    const result = await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@alice check this again",
      tx: stub as any,
    });
    // Alice is re-mentioned but was in prior set → NOT in created delta
    expect(result.created).toHaveLength(0);
  });

  it("returns only new mentions in delta when edit adds a new target", async () => {
    // alice already mentioned, bob is new
    const stub = makePrismaStubWithCreate({
      memberFindMany: [
        { id: "m-alice", username: "alice" },
        { id: "m-bob", username: "bob" },
      ],
      existingMentionIds: ["m-alice"],
    });
    const result = await parseAndUpsertMentions({
      ...BASE_ARGS,
      body: "@alice and @bob",
      tx: stub as any,
    });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.mentionedMemberId).toBe("m-bob");
  });
});
