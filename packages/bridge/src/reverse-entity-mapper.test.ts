import { describe, it, expect } from "vitest";
import { ReverseEntityMapper } from "./reverse-entity-mapper.js";
import type {
  ReverseMapperIssue,
  ReverseMapperChild,
} from "./reverse-entity-mapper.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<ReverseMapperIssue> = {}): ReverseMapperIssue {
  return {
    key: "KAN-5",
    title: "Add User Authentication",
    type: "feature",
    state: "apply",
    priority: "high",
    description: "Implement OAuth2 login flow.",
    labels: ["sync", "backend"],
    ...overrides,
  };
}

function makeChild(overrides: Partial<ReverseMapperChild> = {}): ReverseMapperChild {
  return {
    key: "KAN-6",
    title: "Create login endpoint",
    state: "archived",
    ...overrides,
  };
}

// ─── issueToObservationContent ────────────────────────────────────────────

describe("ReverseEntityMapper.issueToObservationContent", () => {
  it("produces correct H1 heading with key and title", () => {
    const content = ReverseEntityMapper.issueToObservationContent(makeIssue());

    expect(content).toContain("# KAN-5: Add User Authentication");
  });

  it("includes metadata block with type, priority, and state", () => {
    const content = ReverseEntityMapper.issueToObservationContent(makeIssue());

    expect(content).toContain("**Type:** feature");
    expect(content).toContain("**Priority:** high");
    expect(content).toContain("**State:** apply");
  });

  it("includes labels when present", () => {
    const content = ReverseEntityMapper.issueToObservationContent(makeIssue());

    expect(content).toContain("**Labels:** sync, backend");
  });

  it("omits labels line when labels array is empty", () => {
    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue({ labels: [] }),
    );

    expect(content).not.toContain("**Labels:**");
  });

  it("omits labels line when labels is undefined", () => {
    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue({ labels: undefined }),
    );

    expect(content).not.toContain("**Labels:**");
  });

  it("includes description section with issue description", () => {
    const content = ReverseEntityMapper.issueToObservationContent(makeIssue());

    expect(content).toContain("## Description");
    expect(content).toContain("Implement OAuth2 login flow.");
  });

  it("shows placeholder when description is null", () => {
    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue({ description: null }),
    );

    expect(content).toContain("_No description._");
  });

  it("shows placeholder when description is undefined", () => {
    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue({ description: undefined }),
    );

    expect(content).toContain("_No description._");
  });

  it("shows placeholder when description is empty string", () => {
    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue({ description: "   " }),
    );

    expect(content).toContain("_No description._");
  });

  it("renders children checklist with [x] for archived children", () => {
    const children: ReverseMapperChild[] = [
      makeChild({ key: "KAN-6", title: "Completed task", state: "archived" }),
    ];

    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue(),
      children,
    );

    expect(content).toContain("## Children");
    expect(content).toContain("- [x] KAN-6: Completed task");
  });

  it("renders children checklist with [ ] for non-archived children", () => {
    const children: ReverseMapperChild[] = [
      makeChild({ key: "KAN-7", title: "Pending task", state: "apply" }),
    ];

    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue(),
      children,
    );

    expect(content).toContain("- [ ] KAN-7: Pending task");
  });

  it("renders mixed done and not-done children correctly", () => {
    const children: ReverseMapperChild[] = [
      makeChild({ key: "KAN-6", title: "Done task", state: "archived" }),
      makeChild({ key: "KAN-7", title: "In progress", state: "apply" }),
      makeChild({ key: "KAN-8", title: "Backlog item", state: "backlog" }),
    ];

    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue(),
      children,
    );

    expect(content).toContain("- [x] KAN-6: Done task");
    expect(content).toContain("- [ ] KAN-7: In progress");
    expect(content).toContain("- [ ] KAN-8: Backlog item");
  });

  it("omits children section when no children provided", () => {
    const content = ReverseEntityMapper.issueToObservationContent(makeIssue());

    expect(content).not.toContain("## Children");
  });

  it("omits children section when children array is empty", () => {
    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue(),
      [],
    );

    expect(content).not.toContain("## Children");
  });

  it("produces well-formed markdown with correct section ordering", () => {
    const children: ReverseMapperChild[] = [
      makeChild({ key: "KAN-6", title: "Child task", state: "archived" }),
    ];

    const content = ReverseEntityMapper.issueToObservationContent(
      makeIssue(),
      children,
    );

    const headingIdx = content.indexOf("# KAN-5:");
    const typeIdx = content.indexOf("**Type:**");
    const descIdx = content.indexOf("## Description");
    const childrenIdx = content.indexOf("## Children");

    expect(headingIdx).toBeLessThan(typeIdx);
    expect(typeIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(childrenIdx);
  });
});

// ─── issueToTopicKey ──────────────────────────────────────────────────────

describe("ReverseEntityMapper.issueToTopicKey", () => {
  it("produces correct format kanon/{projectKey}/{issueKey}", () => {
    const issue = makeIssue({ key: "KAN-5" });
    const topicKey = ReverseEntityMapper.issueToTopicKey(issue, "KAN");

    expect(topicKey).toBe("kanon/KAN/KAN-5");
  });

  it("works with different project keys", () => {
    const issue = makeIssue({ key: "PROJ-42" });
    const topicKey = ReverseEntityMapper.issueToTopicKey(issue, "PROJ");

    expect(topicKey).toBe("kanon/PROJ/PROJ-42");
  });
});

// ─── issueToCreatePayload ─────────────────────────────────────────────────

describe("ReverseEntityMapper.issueToCreatePayload", () => {
  it("produces correct payload structure", () => {
    const issue = makeIssue();
    const payload = ReverseEntityMapper.issueToCreatePayload(
      issue,
      "KAN",
      "kanon-project",
    );

    expect(payload.title).toBe("KAN-5: Add User Authentication");
    expect(payload.type).toBe("kanon-issue");
    expect(payload.project).toBe("kanon-project");
    expect(payload.scope).toBe("project");
    expect(payload.topic_key).toBe("kanon/KAN/KAN-5");
  });

  it("content matches issueToObservationContent output", () => {
    const issue = makeIssue();
    const children: ReverseMapperChild[] = [
      makeChild({ key: "KAN-6", title: "Sub-task", state: "backlog" }),
    ];

    const payload = ReverseEntityMapper.issueToCreatePayload(
      issue,
      "KAN",
      "kanon-project",
      children,
    );

    const expectedContent = ReverseEntityMapper.issueToObservationContent(
      issue,
      children,
    );

    expect(payload.content).toBe(expectedContent);
  });

  it("topic_key matches issueToTopicKey output", () => {
    const issue = makeIssue();
    const payload = ReverseEntityMapper.issueToCreatePayload(
      issue,
      "KAN",
      "kanon-project",
    );

    const expectedKey = ReverseEntityMapper.issueToTopicKey(issue, "KAN");

    expect(payload.topic_key).toBe(expectedKey);
  });

  it("works without children", () => {
    const issue = makeIssue();
    const payload = ReverseEntityMapper.issueToCreatePayload(
      issue,
      "KAN",
      "kanon-project",
    );

    expect(payload.content).not.toContain("## Children");
  });
});

// ─── Round-trip verification ──────────────────────────────────────────────

describe("ReverseEntityMapper round-trip", () => {
  it("exported content contains parseable metadata", () => {
    const issue = makeIssue({
      key: "KAN-10",
      title: "Build Dashboard",
      type: "feature",
      priority: "critical",
      state: "design",
      labels: ["ui", "frontend"],
      description: "Create the main dashboard view.",
    });

    const content = ReverseEntityMapper.issueToObservationContent(issue);

    // Verify H1 can be parsed back for key and title
    const headingMatch = content.match(/^# (.+?): (.+)$/m);
    expect(headingMatch).not.toBeNull();
    expect(headingMatch![1]).toBe("KAN-10");
    expect(headingMatch![2]).toBe("Build Dashboard");

    // Verify metadata fields can be parsed back
    const typeMatch = content.match(/^\*\*Type:\*\* (.+)$/m);
    expect(typeMatch).not.toBeNull();
    expect(typeMatch![1]).toBe("feature");

    const priorityMatch = content.match(/^\*\*Priority:\*\* (.+)$/m);
    expect(priorityMatch).not.toBeNull();
    expect(priorityMatch![1]).toBe("critical");

    const stateMatch = content.match(/^\*\*State:\*\* (.+)$/m);
    expect(stateMatch).not.toBeNull();
    expect(stateMatch![1]).toBe("design");

    const labelsMatch = content.match(/^\*\*Labels:\*\* (.+)$/m);
    expect(labelsMatch).not.toBeNull();
    expect(labelsMatch![1]).toBe("ui, frontend");
  });

  it("exported children checklist can be parsed back", () => {
    const issue = makeIssue();
    const children: ReverseMapperChild[] = [
      makeChild({ key: "KAN-11", title: "Task A", state: "archived" }),
      makeChild({ key: "KAN-12", title: "Task B", state: "backlog" }),
    ];

    const content = ReverseEntityMapper.issueToObservationContent(
      issue,
      children,
    );

    // Parse checklist items back
    const checklistPattern = /^- \[(x| )\] (.+?): (.+)$/gm;
    const items: Array<{ done: boolean; key: string; title: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = checklistPattern.exec(content)) !== null) {
      items.push({
        done: match[1]! === "x",
        key: match[2]!,
        title: match[3]!,
      });
    }

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ done: true, key: "KAN-11", title: "Task A" });
    expect(items[1]).toEqual({ done: false, key: "KAN-12", title: "Task B" });
  });

  it("full payload contains all information needed for re-import", () => {
    const issue = makeIssue();
    const payload = ReverseEntityMapper.issueToCreatePayload(
      issue,
      "KAN",
      "kanon-project",
    );

    // topic_key encodes the project and issue key
    const keyParts = payload.topic_key.split("/");
    expect(keyParts).toEqual(["kanon", "KAN", "KAN-5"]);

    // title encodes key and title
    expect(payload.title).toContain("KAN-5");
    expect(payload.title).toContain("Add User Authentication");

    // content has structured metadata
    expect(payload.content).toContain("**Type:** feature");
    expect(payload.content).toContain("**Priority:** high");
    expect(payload.content).toContain("**State:** apply");
  });
});
