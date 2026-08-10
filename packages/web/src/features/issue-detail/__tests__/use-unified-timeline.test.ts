/**
 * KAN-32 — mergeTimeline pure-function tests (Strict TDD — RED first).
 *
 * Tests the exported `mergeTimeline(comments, activity)` pure function.
 * All scenarios reference design.md and spec.md acceptance criteria.
 *
 * AGENT_SOURCES = { mcp, engram_sync, system, adr } → agent-comment
 * All other sources → human-comment
 */
import { describe, it, expect } from "vitest";
import { mergeTimeline } from "../use-unified-timeline";
import type { Comment, ActivityLog } from "@/types/issue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(
  overrides: Partial<Comment> & { id: string; createdAt: string },
): Comment {
  return {
    id: overrides.id,
    body: overrides.body ?? "hello",
    source: overrides.source ?? "human",
    author:
      overrides.author === undefined
        ? { id: "u1", username: "alice" }
        : overrides.author,
    remoteAuthor: overrides.remoteAuthor ?? null,
    via: overrides.via ?? null,
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
  };
}

function makeActivity(
  overrides: Partial<ActivityLog> & {
    id: string;
    action: string;
    createdAt: string;
  },
): ActivityLog {
  return {
    id: overrides.id,
    action: overrides.action,
    field: overrides.field,
    oldValue: overrides.oldValue,
    newValue: overrides.newValue,
    via: overrides.via ?? null,
    actor:
      overrides.actor === undefined
        ? { id: "u1", username: "alice" }
        : overrides.actor,
    remoteActor: overrides.remoteActor ?? null,
    createdAt: overrides.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1 — interleaved by createdAt ASC
// ---------------------------------------------------------------------------

describe("mergeTimeline — Scenario 1: interleaved by createdAt ASC", () => {
  it("returns items sorted oldest-first across both sources", () => {
    const comments: Comment[] = [
      makeComment({ id: "c1", createdAt: "2026-06-01T10:00:00Z" }),
      makeComment({ id: "c2", createdAt: "2026-06-01T12:00:00Z" }),
    ];
    const activities: ActivityLog[] = [
      makeActivity({
        id: "a1",
        action: "state_changed",
        createdAt: "2026-06-01T09:00:00Z",
        oldValue: "backlog",
        newValue: "in_progress",
      }),
      makeActivity({
        id: "a2",
        action: "assigned",
        createdAt: "2026-06-01T11:00:00Z",
      }),
      makeActivity({
        id: "a3",
        action: "created",
        createdAt: "2026-06-01T13:00:00Z",
      }),
    ];

    const items = mergeTimeline(comments, activities);

    expect(items).toHaveLength(5);
    expect(items.map((i) => i.id)).toEqual(["a1", "c1", "a2", "c2", "a3"]);
  });
});

// ---------------------------------------------------------------------------
// Design correction 2 — drops `commented` activity rows
// ---------------------------------------------------------------------------

describe("mergeTimeline — design correction 2: drops commented activity rows", () => {
  it("filters out action=commented from activity stream to prevent duplicates", () => {
    const comments: Comment[] = [
      makeComment({ id: "c1", createdAt: "2026-06-01T10:00:00Z" }),
    ];
    const activities: ActivityLog[] = [
      // This shadow audit entry must be dropped
      makeActivity({
        id: "a-shadow",
        action: "commented",
        createdAt: "2026-06-01T10:00:00Z",
      }),
      makeActivity({
        id: "a1",
        action: "state_changed",
        createdAt: "2026-06-01T09:00:00Z",
        oldValue: "backlog",
        newValue: "in_progress",
      }),
    ];

    const items = mergeTimeline(comments, activities);

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).not.toContain("a-shadow");
    expect(items.map((i) => i.id)).toEqual(["a1", "c1"]);
  });
});

// ---------------------------------------------------------------------------
// Scenario 9 — stable tiebreak: equal createdAt → lower id first
// ---------------------------------------------------------------------------

describe("mergeTimeline — Scenario 9: stable tiebreak on equal createdAt", () => {
  it("sorts by id ASC (localeCompare) when createdAt values are equal", () => {
    const ts = "2026-06-01T10:00:00Z";
    const comments: Comment[] = [
      makeComment({ id: "z-comment", createdAt: ts }),
    ];
    const activities: ActivityLog[] = [
      makeActivity({ id: "a-activity", action: "created", createdAt: ts }),
    ];

    const items = mergeTimeline(comments, activities);

    // "a-activity" < "z-comment" lexicographically
    expect(items[0]!.id).toBe("a-activity");
    expect(items[1]!.id).toBe("z-comment");
  });
});

// ---------------------------------------------------------------------------
// Comment source classification — human-comment vs agent-comment
// ---------------------------------------------------------------------------

describe("mergeTimeline — comment source classification", () => {
  it("classifies source=human as human-comment", () => {
    const items = mergeTimeline(
      [makeComment({ id: "c1", createdAt: "2026-06-01T10:00:00Z", source: "human" })],
      [],
    );
    expect(items[0]!.kind).toBe("human-comment");
  });

  it.each(["mcp", "engram_sync", "system", "adr"] as const)(
    "classifies source=%s as agent-comment",
    (source) => {
      const items = mergeTimeline(
        [makeComment({ id: "c1", createdAt: "2026-06-01T10:00:00Z", source })],
        [],
      );
      const item = items[0]!;
      expect(item!.kind).toBe("agent-comment");
      if (item.kind === "agent-comment") {
        expect(item.source).toBe(source);
      }
    },
  );

  it("classifies a remote-authored system comment as human", () => {
    const items = mergeTimeline(
      [
        makeComment({
          id: "remote-comment",
          createdAt: "2026-06-01T10:00:00Z",
          source: "system",
          author: null,
          remoteAuthor: { provider: "redmine", displayName: "Remote author" },
        }),
      ],
      [],
    );

    expect(items[0]).toMatchObject({
      kind: "human-comment",
      author: {
        username: "Remote author",
        provider: "redmine",
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Action → kind mapping
// ---------------------------------------------------------------------------

describe("mergeTimeline — action → kind mapping", () => {
  it("maps state_changed → state-change with from/to", () => {
    const items = mergeTimeline(
      [],
      [
        makeActivity({
          id: "a1",
          action: "state_changed",
          createdAt: "2026-06-01T10:00:00Z",
          oldValue: "backlog",
          newValue: "in_progress",
        }),
      ],
    );
    const item = items[0]!;
    expect(item.kind).toBe("state-change");
    if (item.kind === "state-change") {
      expect(item.from).toBe("backlog");
      expect(item.to).toBe("in_progress");
    }
  });

  it("maps created → created", () => {
    const items = mergeTimeline(
      [],
      [
        makeActivity({
          id: "a1",
          action: "created",
          createdAt: "2026-06-01T10:00:00Z",
        }),
      ],
    );
    expect(items[0]!.kind).toBe("created");
  });

  it("maps assigned → assigned with field/newValue", () => {
    const items = mergeTimeline(
      [],
      [
        makeActivity({
          id: "a1",
          action: "assigned",
          createdAt: "2026-06-01T10:00:00Z",
          field: "assignee",
          newValue: "bob",
        }),
      ],
    );
    const item = items[0]!;
    expect(item.kind).toBe("assigned");
    if (item.kind === "assigned") {
      expect(item.field).toBe("assignee");
      expect(item.newValue).toBe("bob");
    }
  });

  it("maps edited → field-change with field/from/to", () => {
    const items = mergeTimeline(
      [],
      [
        makeActivity({
          id: "a1",
          action: "edited",
          createdAt: "2026-06-01T10:00:00Z",
          field: "title",
          oldValue: "Old",
          newValue: "New",
        }),
      ],
    );
    const item = items[0]!;
    expect(item.kind).toBe("field-change");
    if (item.kind === "field-change") {
      expect(item.field).toBe("title");
      expect(item.from).toBe("Old");
      expect(item.to).toBe("New");
    }
  });

  it("maps delete → deleted", () => {
    const items = mergeTimeline(
      [],
      [
        makeActivity({
          id: "a1",
          action: "delete",
          createdAt: "2026-06-01T10:00:00Z",
        }),
      ],
    );
    expect(items[0]!.kind).toBe("deleted");
  });

  it("maps document_added → document-added with field", () => {
    const items = mergeTimeline(
      [],
      [
        makeActivity({
          id: "a1",
          action: "document_added",
          createdAt: "2026-06-01T10:00:00Z",
          field: "adr",
        }),
      ],
    );
    const item = items[0]!;
    expect(item.kind).toBe("document-added");
    if (item.kind === "document-added") {
      expect(item.field).toBe("adr");
    }
  });

  it("maps unknown action → field-change fallback", () => {
    const items = mergeTimeline(
      [],
      [
        makeActivity({
          id: "a1",
          action: "some_future_action",
          createdAt: "2026-06-01T10:00:00Z",
        }),
      ],
    );
    expect(items[0]!.kind).toBe("field-change");
  });
});

// ---------------------------------------------------------------------------
// via passthrough
// ---------------------------------------------------------------------------

describe("mergeTimeline — via passthrough", () => {
  it("carries via from comment", () => {
    const items = mergeTimeline(
      [makeComment({ id: "c1", createdAt: "2026-06-01T10:00:00Z", via: "claude-code" })],
      [],
    );
    expect(items[0]!.via).toBe("claude-code");
  });

  it("carries via from activity", () => {
    const items = mergeTimeline(
      [],
      [
        makeActivity({
          id: "a1",
          action: "state_changed",
          createdAt: "2026-06-01T10:00:00Z",
          via: "cli",
        }),
      ],
    );
    expect(items[0]!.via).toBe("cli");
  });

  it("via=null passes through", () => {
    const items = mergeTimeline(
      [makeComment({ id: "c1", createdAt: "2026-06-01T10:00:00Z", via: null })],
      [],
    );
    expect(items[0]!.via).toBeNull();
  });
});
