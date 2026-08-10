/**
 * KAN-41 — activity-log serializer + readStateChange helper tests.
 *
 * TDD: tests were written before the serializer implementation was wired
 * to readStateChange. The {from,to} cases were the initial RED state.
 */
import { describe, it, expect } from "vitest";
import { serializeActivityLog } from "./serializer.js";
import { readStateChange } from "../../shared/activity-log.js";

// ---------------------------------------------------------------------------
// readStateChange unit tests
// ---------------------------------------------------------------------------

describe("readStateChange", () => {
  it("reads canonical {from, to} shape", () => {
    const result = readStateChange({ from: "backlog", to: "in_progress" });
    expect(result).toEqual({ from: "backlog", to: "in_progress" });
  });

  it("falls back to legacy {oldValue, newValue} shape", () => {
    const result = readStateChange({ oldValue: "backlog", newValue: "in_progress" });
    expect(result).toEqual({ from: "backlog", to: "in_progress" });
  });

  it("canonical keys win over legacy when both present", () => {
    const result = readStateChange({
      from: "backlog",
      to: "in_progress",
      oldValue: "WRONG",
      newValue: "WRONG",
    });
    expect(result).toEqual({ from: "backlog", to: "in_progress" });
  });

  it("returns empty object for null details", () => {
    expect(readStateChange(null)).toEqual({});
  });

  it("returns empty object for non-object details", () => {
    expect(readStateChange("string")).toEqual({});
    expect(readStateChange(42)).toEqual({});
  });

  it("returns empty object for array details", () => {
    expect(readStateChange([])).toEqual({});
  });

  it("omits undefined from/to when keys are absent", () => {
    const result = readStateChange({ field: "assignee" });
    expect(result).toEqual({});
  });

  it("handles non-string from/to (e.g. null assignee id) — returns the raw value", () => {
    const result = readStateChange({ from: null, to: "member-1" });
    expect(result).toEqual({ from: null, to: "member-1" });
  });
});

// ---------------------------------------------------------------------------
// serializeActivityLog — state_changed rows
// ---------------------------------------------------------------------------

const baseActor = { id: "m1", username: "alice" };

describe("serializeActivityLog — state_changed (KAN-41)", () => {
  it("maps canonical {from, to} shape to oldValue/newValue in feed output", () => {
    // This is the canonical persisted shape written by transitionIssue et al.
    const log = {
      id: "log-1",
      action: "state_changed",
      details: { from: "backlog", to: "in_progress", regression: false },
      createdAt: new Date("2026-06-01T10:00:00Z"),
      member: baseActor,
    };

    const result = serializeActivityLog(log);

    expect(result.oldValue).toBe("backlog");
    expect(result.newValue).toBe("in_progress");
    expect(result.field).toBeUndefined();
    expect(result.actor).toEqual(baseActor);
  });

  it("falls back to legacy {oldValue, newValue} shape for old rows", () => {
    const log = {
      id: "log-2",
      action: "state_changed",
      details: { oldValue: "backlog", newValue: "done" },
      createdAt: new Date("2026-06-01T11:00:00Z"),
      member: baseActor,
    };

    const result = serializeActivityLog(log);

    expect(result.oldValue).toBe("backlog");
    expect(result.newValue).toBe("done");
  });

  it("omits oldValue/newValue when from/to are non-string (e.g. null assignee)", () => {
    // Assignee change writes { from: null, to: "member-uuid", source: "api" }
    // from is null — must not surface as oldValue string
    const log = {
      id: "log-3",
      action: "assigned",
      details: { from: null, to: "member-uuid", source: "api" },
      createdAt: new Date("2026-06-01T12:00:00Z"),
      member: baseActor,
    };

    const result = serializeActivityLog(log);

    expect(result.oldValue).toBeUndefined();
    expect(result.newValue).toBe("member-uuid");
  });

  it("returns no local or remote actor when both relations are null", () => {
    const log = {
      id: "log-4",
      action: "state_changed",
      details: { from: "backlog", to: "review" },
      createdAt: new Date("2026-06-01T13:00:00Z"),
      member: null,
    };

    const result = serializeActivityLog(log);

    expect(result.actor).toBeNull();
    expect(result.remoteActor).toBeNull();
    expect(result.oldValue).toBe("backlog");
    expect(result.newValue).toBe("review");
  });

  it("returns bounded remote actor metadata without provider identifiers", () => {
    const log = {
      id: "log-remote",
      action: "commented",
      details: { commentId: "comment-1" },
      createdAt: new Date("2026-06-01T13:00:00Z"),
      member: null,
      remoteActor: {
        remoteDisplayName: ` ${"r".repeat(250)} `,
        binding: { connection: { provider: "redmine" } },
      },
    };

    const result = serializeActivityLog(log);

    expect(result.actor).toBeNull();
    expect(result.remoteActor).toEqual({
      provider: "redmine",
      displayName: "r".repeat(200),
    });
    expect(result.remoteActor).not.toHaveProperty("id");
  });

  it("returns blank from/to when details is null", () => {
    const log = {
      id: "log-5",
      action: "created",
      details: null,
      createdAt: new Date("2026-06-01T14:00:00Z"),
      member: baseActor,
    };

    const result = serializeActivityLog(log);

    expect(result.oldValue).toBeUndefined();
    expect(result.newValue).toBeUndefined();
  });

  it("surfaces field string when present", () => {
    const log = {
      id: "log-6",
      action: "edited",
      details: { field: "title", oldValue: "Old", newValue: "New" },
      createdAt: new Date("2026-06-01T15:00:00Z"),
      member: baseActor,
    };

    const result = serializeActivityLog(log);

    expect(result.field).toBe("title");
    expect(result.oldValue).toBe("Old");
    expect(result.newValue).toBe("New");
  });
});

// ---------------------------------------------------------------------------
// serializeActivityLog — via passthrough (KAN-32, Scenarios 10 & 11)
// ---------------------------------------------------------------------------

describe("serializeActivityLog — via passthrough (KAN-32)", () => {
  it("Scenario 10: passes through via='cli' from raw log", () => {
    const log = {
      id: "log-via-1",
      action: "state_changed",
      details: { from: "backlog", to: "in_progress" },
      via: "cli",
      createdAt: new Date("2026-06-09T10:00:00Z"),
      member: baseActor,
    };

    const result = serializeActivityLog(log);

    expect(result.via).toBe("cli");
  });

  it("Scenario 11: passes through via=null for pre-provenance rows", () => {
    const log = {
      id: "log-via-2",
      action: "created",
      details: null,
      via: null,
      createdAt: new Date("2026-06-09T11:00:00Z"),
      member: baseActor,
    };

    const result = serializeActivityLog(log);

    expect(result.via).toBeNull();
  });

  it("defaults via to null when the field is absent from raw log", () => {
    const log = {
      id: "log-via-3",
      action: "edited",
      details: { field: "title" },
      createdAt: new Date("2026-06-09T12:00:00Z"),
      member: baseActor,
      // via not present — should default to null
    };

    const result = serializeActivityLog(log);

    expect(result.via).toBeNull();
  });
});
