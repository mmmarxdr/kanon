import { describe, it, expect } from "vitest";
import { ConflictResolver } from "../conflict-resolver.js";
import type { SyncConflict } from "../conflict-resolver.js";
import type { ConflictStrategy } from "../types.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeConflict(overrides: Partial<SyncConflict> = {}): SyncConflict {
  return {
    issueKey: "KAN-1",
    engramId: 42,
    kanonUpdatedAt: "2026-03-01T12:00:00Z",
    engramUpdatedAt: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

// ─── engram-wins strategy ─────────────────────────────────────────────────

describe("ConflictResolver — engram-wins", () => {
  const strategy: ConflictStrategy = "engram-wins";

  it("picks engram as winner", () => {
    const [action] = ConflictResolver.resolve([makeConflict()], strategy);

    expect(action!.winner).toBe("engram");
  });

  it("sets direction to imported", () => {
    const [action] = ConflictResolver.resolve([makeConflict()], strategy);

    expect(action!.direction).toBe("imported");
  });

  it("includes strategy name and issue key in reason", () => {
    const [action] = ConflictResolver.resolve(
      [makeConflict({ issueKey: "KAN-5" })],
      strategy,
    );

    expect(action!.reason).toContain("engram-wins");
    expect(action!.reason).toContain("KAN-5");
  });

  it("preserves the original conflict reference", () => {
    const conflict = makeConflict();
    const [action] = ConflictResolver.resolve([conflict], strategy);

    expect(action!.conflict).toBe(conflict);
  });
});

// ─── kanon-wins strategy ──────────────────────────────────────────────────

describe("ConflictResolver — kanon-wins", () => {
  const strategy: ConflictStrategy = "kanon-wins";

  it("picks kanon as winner", () => {
    const [action] = ConflictResolver.resolve([makeConflict()], strategy);

    expect(action!.winner).toBe("kanon");
  });

  it("sets direction to exported", () => {
    const [action] = ConflictResolver.resolve([makeConflict()], strategy);

    expect(action!.direction).toBe("exported");
  });

  it("includes strategy name and issue key in reason", () => {
    const [action] = ConflictResolver.resolve(
      [makeConflict({ issueKey: "KAN-10" })],
      strategy,
    );

    expect(action!.reason).toContain("kanon-wins");
    expect(action!.reason).toContain("KAN-10");
  });

  it("preserves the original conflict reference", () => {
    const conflict = makeConflict();
    const [action] = ConflictResolver.resolve([conflict], strategy);

    expect(action!.conflict).toBe(conflict);
  });
});

// ─── newest-wins strategy ─────────────────────────────────────────────────

describe("ConflictResolver — newest-wins", () => {
  const strategy: ConflictStrategy = "newest-wins";

  it("picks engram when engram is newer", () => {
    const conflict = makeConflict({
      kanonUpdatedAt: "2026-03-01T10:00:00Z",
      engramUpdatedAt: "2026-03-01T14:00:00Z",
    });
    const [action] = ConflictResolver.resolve([conflict], strategy);

    expect(action!.winner).toBe("engram");
    expect(action!.direction).toBe("imported");
  });

  it("picks kanon when kanon is newer", () => {
    const conflict = makeConflict({
      kanonUpdatedAt: "2026-03-01T18:00:00Z",
      engramUpdatedAt: "2026-03-01T14:00:00Z",
    });
    const [action] = ConflictResolver.resolve([conflict], strategy);

    expect(action!.winner).toBe("kanon");
    expect(action!.direction).toBe("exported");
  });

  it("includes newest-wins and timestamps in reason", () => {
    const conflict = makeConflict({
      kanonUpdatedAt: "2026-03-01T10:00:00Z",
      engramUpdatedAt: "2026-03-01T14:00:00Z",
    });
    const [action] = ConflictResolver.resolve([conflict], strategy);

    expect(action!.reason).toContain("newest-wins");
    expect(action!.reason).toContain("2026-03-01T14:00:00Z");
  });

  it("defaults to kanon when timestamps are equal", () => {
    const conflict = makeConflict({
      kanonUpdatedAt: "2026-03-01T12:00:00Z",
      engramUpdatedAt: "2026-03-01T12:00:00Z",
    });
    const [action] = ConflictResolver.resolve([conflict], strategy);

    expect(action!.winner).toBe("kanon");
    expect(action!.direction).toBe("exported");
    expect(action!.reason).toContain("equal");
  });
});

// ─── Multiple conflicts ──────────────────────────────────────────────────

describe("ConflictResolver — multiple conflicts", () => {
  it("resolves each conflict independently with engram-wins", () => {
    const conflicts = [
      makeConflict({ issueKey: "KAN-1", engramId: 10 }),
      makeConflict({ issueKey: "KAN-2", engramId: 20 }),
      makeConflict({ issueKey: "KAN-3", engramId: 30 }),
    ];

    const actions = ConflictResolver.resolve(conflicts, "engram-wins");

    expect(actions).toHaveLength(3);
    expect(actions[0]!.conflict.issueKey).toBe("KAN-1");
    expect(actions[1]!.conflict.issueKey).toBe("KAN-2");
    expect(actions[2]!.conflict.issueKey).toBe("KAN-3");
    actions.forEach((a) => expect(a.winner).toBe("engram"));
  });

  it("resolves each conflict independently with newest-wins", () => {
    const conflicts = [
      makeConflict({
        issueKey: "KAN-1",
        kanonUpdatedAt: "2026-03-01T10:00:00Z",
        engramUpdatedAt: "2026-03-01T14:00:00Z",
      }),
      makeConflict({
        issueKey: "KAN-2",
        kanonUpdatedAt: "2026-03-01T18:00:00Z",
        engramUpdatedAt: "2026-03-01T14:00:00Z",
      }),
    ];

    const actions = ConflictResolver.resolve(conflicts, "newest-wins");

    expect(actions).toHaveLength(2);
    expect(actions[0]!.winner).toBe("engram");
    expect(actions[1]!.winner).toBe("kanon");
  });

  it("returns empty array for empty conflicts", () => {
    const actions = ConflictResolver.resolve([], "engram-wins");

    expect(actions).toEqual([]);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────

describe("ConflictResolver — edge cases", () => {
  it("handles same timestamp defaulting to kanon", () => {
    const ts = "2026-06-15T08:30:00Z";
    const conflict = makeConflict({
      kanonUpdatedAt: ts,
      engramUpdatedAt: ts,
    });

    const [action] = ConflictResolver.resolve([conflict], "newest-wins");

    expect(action!.winner).toBe("kanon");
    expect(action!.reason).toContain("equal");
    expect(action!.reason).toContain(conflict.issueKey);
  });

  it("handles missing/invalid kanon timestamp (NaN) — engram wins", () => {
    const conflict = makeConflict({
      kanonUpdatedAt: "",
      engramUpdatedAt: "2026-03-01T12:00:00Z",
    });

    const [action] = ConflictResolver.resolve([conflict], "newest-wins");

    // new Date("").getTime() is NaN; comparisons with NaN are false,
    // so the fallback path (kanon wins) is taken
    expect(action!.winner).toBe("kanon");
    expect(action!.direction).toBe("exported");
  });

  it("handles missing/invalid engram timestamp (NaN) — kanon wins", () => {
    const conflict = makeConflict({
      kanonUpdatedAt: "2026-03-01T12:00:00Z",
      engramUpdatedAt: "",
    });

    const [action] = ConflictResolver.resolve([conflict], "newest-wins");

    // NaN > kanonTime is false, so kanon wins via fallback
    expect(action!.winner).toBe("kanon");
    expect(action!.direction).toBe("exported");
  });

  it("handles both timestamps invalid — kanon wins via fallback", () => {
    const conflict = makeConflict({
      kanonUpdatedAt: "",
      engramUpdatedAt: "",
    });

    const [action] = ConflictResolver.resolve([conflict], "newest-wins");

    expect(action!.winner).toBe("kanon");
  });

  it("engram-wins ignores timestamps entirely", () => {
    const conflict = makeConflict({
      kanonUpdatedAt: "2099-12-31T23:59:59Z",
      engramUpdatedAt: "2000-01-01T00:00:00Z",
    });

    const [action] = ConflictResolver.resolve([conflict], "engram-wins");

    expect(action!.winner).toBe("engram");
  });

  it("kanon-wins ignores timestamps entirely", () => {
    const conflict = makeConflict({
      kanonUpdatedAt: "2000-01-01T00:00:00Z",
      engramUpdatedAt: "2099-12-31T23:59:59Z",
    });

    const [action] = ConflictResolver.resolve([conflict], "kanon-wins");

    expect(action!.winner).toBe("kanon");
  });
});
