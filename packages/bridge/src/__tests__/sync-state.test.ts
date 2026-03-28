import { describe, it, expect } from "vitest";
import { SyncStateManager, SyncStateSchema } from "../sync-state.js";
import type { SyncState } from "../types.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeValidSyncState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    engramId: 1,
    topicKey: "sdd/my-change/proposal",
    syncedAt: "2026-01-15T10:30:00Z",
    contentHash:
      "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    engramRevision: 0,
    direction: "exported",
    ...overrides,
  };
}

// ─── Zod Validation ──────────────────────────────────────────────────────

describe("SyncStateSchema", () => {
  it("parses a valid SyncState object", () => {
    const input = makeValidSyncState();
    const result = SyncStateSchema.safeParse(input);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(input);
  });

  it("accepts all valid direction values", () => {
    for (const direction of ["imported", "exported", "bidirectional"] as const) {
      const result = SyncStateSchema.safeParse(
        makeValidSyncState({ direction }),
      );
      expect(result.success).toBe(true);
    }
  });

  it("accepts engramRevision of zero", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({ engramRevision: 0 }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects negative engramId", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({ engramId: -1 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects zero engramId", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({ engramId: 0 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects non-integer engramId", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({ engramId: 1.5 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects empty topicKey", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({ topicKey: "" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid syncedAt (non-ISO datetime)", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({ syncedAt: "not-a-date" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects contentHash without sha256: prefix", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({
        contentHash:
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects contentHash with wrong hex length", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({ contentHash: "sha256:abcdef" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid direction", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({ direction: "unknown" as any }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects negative engramRevision", () => {
    const result = SyncStateSchema.safeParse(
      makeValidSyncState({ engramRevision: -1 }),
    );
    expect(result.success).toBe(false);
  });
});

// ─── SyncStateManager.parse ──────────────────────────────────────────────

describe("SyncStateManager.parse", () => {
  it("returns typed SyncState for valid input", () => {
    const input = makeValidSyncState();
    const result = SyncStateManager.parse(input);

    expect(result).toEqual(input);
  });

  it("returns null for null input", () => {
    expect(SyncStateManager.parse(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(SyncStateManager.parse(undefined)).toBeNull();
  });

  it("returns null for invalid object", () => {
    expect(SyncStateManager.parse({ foo: "bar" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(SyncStateManager.parse("not an object")).toBeNull();
    expect(SyncStateManager.parse(42)).toBeNull();
    expect(SyncStateManager.parse(true)).toBeNull();
  });
});

// ─── SyncStateManager.serialize ──────────────────────────────────────────

describe("SyncStateManager.serialize", () => {
  it("returns a plain object copy of the state", () => {
    const state = makeValidSyncState();
    const serialized = SyncStateManager.serialize(state);

    expect(serialized).toEqual(state);
    expect(serialized).not.toBe(state); // distinct object
  });
});

// ─── SyncStateManager.computeHash ────────────────────────────────────────

describe("SyncStateManager.computeHash", () => {
  it("returns a string in sha256:{hex} format", () => {
    const hash = SyncStateManager.computeHash("hello world");

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("is deterministic — same content produces same hash", () => {
    const hash1 = SyncStateManager.computeHash("test content");
    const hash2 = SyncStateManager.computeHash("test content");

    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different content", () => {
    const hash1 = SyncStateManager.computeHash("content A");
    const hash2 = SyncStateManager.computeHash("content B");

    expect(hash1).not.toBe(hash2);
  });

  it("normalizes leading and trailing whitespace", () => {
    const hash1 = SyncStateManager.computeHash("hello");
    const hash2 = SyncStateManager.computeHash("  hello  ");

    expect(hash1).toBe(hash2);
  });

  it("normalizes case to lowercase", () => {
    const hash1 = SyncStateManager.computeHash("Hello World");
    const hash2 = SyncStateManager.computeHash("hello world");

    expect(hash1).toBe(hash2);
  });

  it("collapses multiple whitespace characters into single space", () => {
    const hash1 = SyncStateManager.computeHash("hello world");
    const hash2 = SyncStateManager.computeHash("hello    world");
    const hash3 = SyncStateManager.computeHash("hello\t\nworld");

    expect(hash1).toBe(hash2);
    expect(hash1).toBe(hash3);
  });

  it("handles empty string", () => {
    const hash = SyncStateManager.computeHash("");

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

// ─── SyncStateManager.isDirty ────────────────────────────────────────────

describe("SyncStateManager.isDirty", () => {
  it("returns true when syncState is null (never synced)", () => {
    expect(SyncStateManager.isDirty("any content", null)).toBe(true);
  });

  it("returns false when content matches stored hash", () => {
    const content = "Hello World";
    const hash = SyncStateManager.computeHash(content);
    const syncState = makeValidSyncState({ contentHash: hash });

    expect(SyncStateManager.isDirty(content, syncState)).toBe(false);
  });

  it("returns true when content differs from stored hash", () => {
    const syncState = makeValidSyncState({
      contentHash: SyncStateManager.computeHash("original content"),
    });

    expect(SyncStateManager.isDirty("modified content", syncState)).toBe(true);
  });

  it("respects normalization — equivalent content is not dirty", () => {
    const syncState = makeValidSyncState({
      contentHash: SyncStateManager.computeHash("Hello World"),
    });

    // Same content with different casing and whitespace
    expect(SyncStateManager.isDirty("  hello   world  ", syncState)).toBe(
      false,
    );
  });

  it("detects change even with minor content difference", () => {
    const syncState = makeValidSyncState({
      contentHash: SyncStateManager.computeHash("hello world"),
    });

    expect(SyncStateManager.isDirty("hello world!", syncState)).toBe(true);
  });
});
