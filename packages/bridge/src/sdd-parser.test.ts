import { describe, it, expect } from "vitest";
import { SddParser } from "./sdd-parser.js";
import type { EngramObservation, SddPhase } from "./types.js";

// ─── Helper to create minimal EngramObservation ────────────────────────────

function makeObs(
  overrides: Partial<EngramObservation> & { id: number; content: string },
): EngramObservation {
  return {
    sync_id: "sync-1",
    session_id: "sess-1",
    type: "architecture",
    title: "test",
    project: "kanon",
    scope: "project",
    revision_count: 0,
    duplicate_count: 0,
    last_seen_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── extractChangeName ─────────────────────────────────────────────────────

describe("SddParser.extractChangeName", () => {
  it("extracts change name from valid topic key", () => {
    expect(SddParser.extractChangeName("sdd/kanon-engram-bridge/tasks")).toBe(
      "kanon-engram-bridge",
    );
  });

  it("extracts change name from different phases", () => {
    expect(SddParser.extractChangeName("sdd/my-feature/spec")).toBe(
      "my-feature",
    );
    expect(SddParser.extractChangeName("sdd/my-feature/design")).toBe(
      "my-feature",
    );
    expect(
      SddParser.extractChangeName("sdd/my-feature/apply-progress"),
    ).toBe("my-feature");
  });

  it("returns null for non-SDD topic keys", () => {
    expect(SddParser.extractChangeName("not/a/valid/key")).toBeNull();
    expect(SddParser.extractChangeName("sdd-init/kanon")).toBeNull();
    expect(SddParser.extractChangeName("")).toBeNull();
  });

  it("returns null for keys with extra segments", () => {
    expect(
      SddParser.extractChangeName("sdd/change/phase/extra"),
    ).toBeNull();
  });
});

// ─── extractPhase ──────────────────────────────────────────────────────────

describe("SddParser.extractPhase", () => {
  it("extracts valid phases", () => {
    const cases: [string, SddPhase][] = [
      ["sdd/change/explore", "explore"],
      ["sdd/change/proposal", "proposal"],
      ["sdd/change/spec", "spec"],
      ["sdd/change/design", "design"],
      ["sdd/change/tasks", "tasks"],
      ["sdd/change/apply-progress", "apply-progress"],
      ["sdd/change/verify-report", "verify-report"],
      ["sdd/change/archive-report", "archive-report"],
      ["sdd/change/state", "state"],
    ];

    for (const [key, expected] of cases) {
      expect(SddParser.extractPhase(key)).toBe(expected);
    }
  });

  it("returns null for unrecognized phase", () => {
    expect(SddParser.extractPhase("sdd/change/unknown-phase")).toBeNull();
  });

  it("returns null for invalid topic key format", () => {
    expect(SddParser.extractPhase("not-sdd-key")).toBeNull();
    expect(SddParser.extractPhase("")).toBeNull();
  });
});

// ─── parseTasks ────────────────────────────────────────────────────────────

describe("SddParser.parseTasks", () => {
  it("parses incomplete and complete tasks", () => {
    const md = `
- [ ] 1.1 Create the config file
- [x] 1.2 Write the parser
- [X] 1.3 Add tests
`;
    const tasks = SddParser.parseTasks(md);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toEqual({ title: "Create the config file", done: false });
    expect(tasks[1]).toEqual({ title: "Write the parser", done: true });
    expect(tasks[2]).toEqual({ title: "Add tests", done: true });
  });

  it("parses tasks without numbering", () => {
    const md = `- [ ] Do something\n- [x] Done thing`;
    const tasks = SddParser.parseTasks(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({ title: "Do something", done: false });
    expect(tasks[1]).toEqual({ title: "Done thing", done: true });
  });

  it("collects description lines between tasks", () => {
    const md = `
- [ ] 1.1 First task
  Some description line
  Another description line
- [ ] 1.2 Second task
`;
    const tasks = SddParser.parseTasks(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.description).toBe(
      "Some description line\nAnother description line",
    );
  });

  it("skips heading lines in descriptions", () => {
    const md = `
- [ ] 1.1 First task
## Phase 2
- [ ] 2.1 Second task
`;
    const tasks = SddParser.parseTasks(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.description).toBeUndefined();
  });

  it("returns empty array for empty input", () => {
    expect(SddParser.parseTasks("")).toEqual([]);
  });

  it("returns empty array for content with no checkboxes", () => {
    expect(SddParser.parseTasks("Just some text\nNo tasks here")).toEqual([]);
  });

  it("skips malformed checkbox lines", () => {
    const md = `
- [ ] Valid task
- [] Missing space
-[ ] No space after dash
- [y] Invalid marker
`;
    const tasks = SddParser.parseTasks(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("Valid task");
  });

  it("handles asterisk bullet markers", () => {
    const md = `* [ ] Star task\n* [x] Star done`;
    const tasks = SddParser.parseTasks(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.done).toBe(false);
    expect(tasks[1]!.done).toBe(true);
  });
});

// ─── parseRequirements ─────────────────────────────────────────────────────

describe("SddParser.parseRequirements", () => {
  it("extracts requirement IDs from content", () => {
    const result = SddParser.parseRequirements(
      "Implements R-BRG-01 and R-BRG-02",
    );
    expect(result).toEqual(["R-BRG-01", "R-BRG-02"]);
  });

  it("deduplicates requirement IDs", () => {
    const result = SddParser.parseRequirements(
      "R-BRG-01 mentioned twice R-BRG-01",
    );
    expect(result).toEqual(["R-BRG-01"]);
  });

  it("returns empty array for no matches", () => {
    expect(SddParser.parseRequirements("No requirements here")).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(SddParser.parseRequirements("")).toEqual([]);
  });

  it("handles various requirement prefix lengths", () => {
    const result = SddParser.parseRequirements(
      "R-AB-01 R-ABCDE-99",
    );
    expect(result).toEqual(["R-AB-01", "R-ABCDE-99"]);
  });
});

// ─── groupByChange ─────────────────────────────────────────────────────────

describe("SddParser.groupByChange", () => {
  it("groups observations by change name", () => {
    const observations = [
      makeObs({
        id: 1,
        content: "# Proposal\nSome content",
        topic_key: "sdd/my-change/proposal",
      }),
      makeObs({
        id: 2,
        content: "# Spec\nSpec content",
        topic_key: "sdd/my-change/spec",
      }),
    ];

    const changes = SddParser.groupByChange(observations);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.name).toBe("my-change");
    expect(changes[0]!.artifacts.size).toBe(2);
    expect(changes[0]!.artifacts.has("proposal")).toBe(true);
    expect(changes[0]!.artifacts.has("spec")).toBe(true);
  });

  it("separates different changes", () => {
    const observations = [
      makeObs({
        id: 1,
        content: "content",
        topic_key: "sdd/change-a/proposal",
      }),
      makeObs({
        id: 2,
        content: "content",
        topic_key: "sdd/change-b/proposal",
      }),
    ];

    const changes = SddParser.groupByChange(observations);
    expect(changes).toHaveLength(2);
    const names = changes.map((c) => c.name).sort();
    expect(names).toEqual(["change-a", "change-b"]);
  });

  it("tracks latest phase in pipeline order", () => {
    const observations = [
      makeObs({
        id: 1,
        content: "content",
        topic_key: "sdd/my-change/explore",
      }),
      makeObs({
        id: 2,
        content: "content",
        topic_key: "sdd/my-change/design",
      }),
    ];

    const changes = SddParser.groupByChange(observations);
    expect(changes[0]!.latestPhase).toBe("design");
  });

  it("parses tasks when tasks artifact is present", () => {
    const tasksMd = `- [ ] 1.1 First task\n- [x] 1.2 Second task`;
    const observations = [
      makeObs({
        id: 1,
        content: tasksMd,
        topic_key: "sdd/my-change/tasks",
      }),
    ];

    const changes = SddParser.groupByChange(observations);
    expect(changes[0]!.tasks).toHaveLength(2);
    expect(changes[0]!.tasks[0]!.done).toBe(false);
    expect(changes[0]!.tasks[1]!.done).toBe(true);
  });

  it("skips observations without topic_key", () => {
    const observations = [
      makeObs({ id: 1, content: "no key" }),
    ];

    const changes = SddParser.groupByChange(observations);
    expect(changes).toHaveLength(0);
  });

  it("skips observations with non-SDD topic_keys", () => {
    const observations = [
      makeObs({
        id: 1,
        content: "not sdd",
        topic_key: "sdd-init/kanon",
      }),
    ];

    const changes = SddParser.groupByChange(observations);
    expect(changes).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(SddParser.groupByChange([])).toEqual([]);
  });
});
