import { describe, it, expect } from "vitest";
import { EntityMapper } from "./entity-mapper.js";
import type {
  SddChange,
  SddPhase,
  SddArtifact,
  KanonIssueState,
} from "./types.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeArtifact(
  changeName: string,
  phase: SddPhase,
  content = "",
): SddArtifact {
  return {
    changeName,
    phase,
    observationId: 1,
    content,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function makeChange(overrides: Partial<SddChange> = {}): SddChange {
  return {
    name: "my-change",
    artifacts: new Map(),
    tasks: [],
    latestPhase: "proposal",
    ...overrides,
  };
}

// ─── changeToParentIssue ───────────────────────────────────────────────────

describe("EntityMapper.changeToParentIssue", () => {
  it("creates a feature issue with humanized name when no proposal", () => {
    const change = makeChange({ name: "kanon-engram-bridge" });
    const issue = EntityMapper.changeToParentIssue(change, "KANON");

    expect(issue.title).toBe("Kanon Engram Bridge");
    expect(issue.type).toBe("feature");
    expect(issue.priority).toBe("medium");
  });

  it("extracts title from proposal heading", () => {
    const artifacts = new Map<SddPhase, SddArtifact>();
    artifacts.set(
      "proposal",
      makeArtifact(
        "my-change",
        "proposal",
        "# Proposal: Add User Authentication\n\nSome content",
      ),
    );

    const change = makeChange({ artifacts });
    const issue = EntityMapper.changeToParentIssue(change, "KANON");

    expect(issue.title).toBe("Add User Authentication");
  });

  it("maps latest phase to issue state", () => {
    const change = makeChange({ latestPhase: "design" });
    const issue = EntityMapper.changeToParentIssue(change, "KANON");

    expect(issue.state).toBe("design");
  });

  it("includes specArtifacts when proposal exists", () => {
    const artifacts = new Map<SddPhase, SddArtifact>();
    artifacts.set(
      "proposal",
      makeArtifact("my-change", "proposal", "# Proposal\nContent"),
    );

    const change = makeChange({
      name: "my-change",
      artifacts,
      latestPhase: "spec",
    });
    const issue = EntityMapper.changeToParentIssue(change, "KANON");

    expect(issue.specArtifacts).toBeDefined();
    expect(issue.specArtifacts!.topicKey).toBe("sdd/my-change/proposal");
    expect(issue.specArtifacts!.phase).toBe("spec");
  });

  it("does not include specArtifacts when no proposal", () => {
    const change = makeChange();
    const issue = EntityMapper.changeToParentIssue(change, "KANON");

    expect(issue.specArtifacts).toBeUndefined();
  });

  it("applies sdd label with change name to parent issue", () => {
    const change = makeChange({ name: "board-view" });
    const issue = EntityMapper.changeToParentIssue(change, "KANON");

    expect(issue.labels).toEqual(["sdd:board-view"]);
  });

  it("includes task progress in description", () => {
    const change = makeChange({
      tasks: [
        { title: "Task 1", done: true },
        { title: "Task 2", done: false },
        { title: "Task 3", done: true },
      ],
    });
    const issue = EntityMapper.changeToParentIssue(change, "KANON");

    expect(issue.description).toContain("2/3 complete");
  });
});

// ─── taskToChildIssue ──────────────────────────────────────────────────────

describe("EntityMapper.taskToChildIssue", () => {
  it("maps incomplete task to backlog state", () => {
    const issue = EntityMapper.taskToChildIssue(
      { title: "Implement feature", done: false },
      "my-change",
      "KANON",
    );

    expect(issue.title).toBe("Implement feature");
    expect(issue.type).toBe("task");
    expect(issue.state).toBe("backlog");
    expect(issue.priority).toBe("medium");
  });

  it("maps completed task to archived state", () => {
    const issue = EntityMapper.taskToChildIssue(
      { title: "Done task", done: true },
      "my-change",
      "KANON",
    );

    expect(issue.state).toBe("archived");
  });

  it("includes task description when present", () => {
    const issue = EntityMapper.taskToChildIssue(
      {
        title: "Task with desc",
        done: false,
        description: "Some extra detail",
      },
      "my-change",
      "KANON",
    );

    expect(issue.description).toBe("Some extra detail");
  });

  it("omits description when not provided", () => {
    const issue = EntityMapper.taskToChildIssue(
      { title: "No desc", done: false },
      "my-change",
      "KANON",
    );

    expect(issue.description).toBeUndefined();
  });

  it("applies sdd label with change name to child issues", () => {
    const issue = EntityMapper.taskToChildIssue(
      { title: "Some task", done: false },
      "board-view",
      "KANON",
    );

    expect(issue.labels).toEqual(["sdd:board-view"]);
  });
});

// ─── deriveGroupKey ───────────────────────────────────────────────────────

describe("EntityMapper.deriveGroupKey", () => {
  it("extracts group key from SDD topic_key", () => {
    expect(EntityMapper.deriveGroupKey("sdd/auth-model/spec")).toBe(
      "sdd/auth-model",
    );
  });

  it("extracts group key from topic_key with different phases", () => {
    expect(EntityMapper.deriveGroupKey("sdd/kanon-bridge/tasks")).toBe(
      "sdd/kanon-bridge",
    );
    expect(EntityMapper.deriveGroupKey("sdd/grouped-cards/design")).toBe(
      "sdd/grouped-cards",
    );
    expect(
      EntityMapper.deriveGroupKey("sdd/my-feature/apply-progress"),
    ).toBe("sdd/my-feature");
  });

  it("returns null for undefined topic_key", () => {
    expect(EntityMapper.deriveGroupKey(undefined)).toBeNull();
  });

  it("returns null for empty string topic_key", () => {
    expect(EntityMapper.deriveGroupKey("")).toBeNull();
  });

  it("returns null for non-SDD topic_key", () => {
    expect(EntityMapper.deriveGroupKey("random-key")).toBeNull();
    expect(EntityMapper.deriveGroupKey("bugfix/something")).toBeNull();
  });

  it("returns null for topic_key with too few segments", () => {
    expect(EntityMapper.deriveGroupKey("sdd/only-one")).toBeNull();
  });
});

// ─── groupKey in changeToParentIssue ──────────────────────────────────────

describe("EntityMapper.changeToParentIssue groupKey", () => {
  it("includes groupKey derived from change name", () => {
    const change = makeChange({ name: "kanon-bridge" });
    const issue = EntityMapper.changeToParentIssue(change, "KANON");

    expect(issue.groupKey).toBe("sdd/kanon-bridge");
  });
});

// ─── groupKey in taskToChildIssue ─────────────────────────────────────────

describe("EntityMapper.taskToChildIssue groupKey", () => {
  it("includes groupKey derived from change name", () => {
    const issue = EntityMapper.taskToChildIssue(
      { title: "Some task", done: false },
      "board-view",
      "KANON",
    );

    expect(issue.groupKey).toBe("sdd/board-view");
  });
});

// ─── phaseToIssueState ─────────────────────────────────────────────────────

describe("EntityMapper.phaseToIssueState", () => {
  it("maps all phases to correct issue states", () => {
    const expected: [SddPhase, KanonIssueState][] = [
      ["explore", "explore"],
      ["proposal", "propose"],
      ["spec", "spec"],
      ["design", "design"],
      ["tasks", "tasks"],
      ["apply-progress", "apply"],
      ["verify-report", "verify"],
      ["archive-report", "archived"],
      ["state", "backlog"],
    ];

    for (const [phase, issueState] of expected) {
      expect(EntityMapper.phaseToIssueState(phase)).toBe(issueState);
    }
  });
});
