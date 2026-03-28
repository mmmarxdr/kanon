import { describe, it, expect } from "vitest";
import {
  slimIssue,
  slimIssueDetail,
  slimRoadmapItem,
  slimProject,
  slimGroup,
  formatEntity,
  formatList,
  DEFAULT_LIMIT,
} from "./transforms.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "iss_001",
    key: "KAN-1",
    title: "Fix login bug",
    state: "in_progress",
    type: "bug",
    priority: "high",
    labels: ["auth"],
    groupKey: "backlog",
    dueDate: "2026-04-01",
    description: "Full description of the bug",
    parentId: "iss_000",
    projectId: "proj_001",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
    sequenceNum: 42,
    sortOrder: 5,
    engramContext: { session: "abc" },
    specArtifacts: { spec: "v1" },
    assignee: { username: "marxdr", name: "Dr. Marx", email: "m@x.com" },
    ...overrides,
  };
}

function makeRoadmapItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "rm_001",
    title: "Roadmap feature",
    description: "Detailed roadmap desc",
    horizon: "near",
    status: "planned",
    effort: 3,
    impact: 5,
    labels: ["infra"],
    sortOrder: 1,
    targetDate: "2026-06-01",
    promoted: true,
    projectId: "proj_001",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
    ...overrides,
  };
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj_001",
    key: "KAN",
    name: "Kanon",
    description: "Project management tool",
    engramNamespace: "kanon-ns",
    workspaceId: "ws_001",
    ...overrides,
  };
}

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    groupKey: "backlog",
    count: 12,
    latestState: "todo",
    title: "Backlog",
    updatedAt: "2026-03-20T00:00:00Z",
    ...overrides,
  };
}

// ─── slimIssue ───────────────────────────────────────────────────────────────

describe("slimIssue", () => {
  it("keeps only allowlisted fields", () => {
    const result = slimIssue(makeIssue() as any);
    expect(result).toHaveProperty("key", "KAN-1");
    expect(result).toHaveProperty("title", "Fix login bug");
    expect(result).toHaveProperty("state", "in_progress");
    expect(result).toHaveProperty("type", "bug");
    expect(result).toHaveProperty("priority", "high");
    expect(result).toHaveProperty("labels");
    expect(result).toHaveProperty("groupKey", "backlog");
  });

  it("strips id, projectId, createdAt, updatedAt, sequenceNum, sortOrder, engramContext, specArtifacts", () => {
    const result = slimIssue(makeIssue() as any);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("projectId");
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("updatedAt");
    expect(result).not.toHaveProperty("sequenceNum");
    expect(result).not.toHaveProperty("sortOrder");
    expect(result).not.toHaveProperty("engramContext");
    expect(result).not.toHaveProperty("specArtifacts");
  });

  it("flattens assignee object to username string", () => {
    const result = slimIssue(makeIssue() as any);
    expect(result["assignee"]).toBe("marxdr");
  });

  it("flattens assignee to name when username is absent", () => {
    const result = slimIssue(makeIssue({ assignee: { name: "Dr. Marx" } }) as any);
    expect(result["assignee"]).toBe("Dr. Marx");
  });

  it("passes through string assignee as-is", () => {
    const result = slimIssue(makeIssue({ assignee: "marxdr" }) as any);
    expect(result["assignee"]).toBe("marxdr");
  });

  it("does not include assignee key when assignee is undefined", () => {
    const issue = makeIssue();
    delete (issue as any).assignee;
    const result = slimIssue(issue as any);
    expect(result).not.toHaveProperty("assignee");
  });
});

// ─── slimIssueDetail ─────────────────────────────────────────────────────────

describe("slimIssueDetail", () => {
  it("includes all list fields plus description", () => {
    const result = slimIssueDetail(makeIssue() as any);
    // List fields
    expect(result).toHaveProperty("key", "KAN-1");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("state");
    // Detail fields
    expect(result).toHaveProperty("description", "Full description of the bug");
  });

  it("includes children as {key, title, state} objects", () => {
    const children = [
      { id: "c1", key: "KAN-2", title: "Sub-task", state: "todo", priority: "low", sortOrder: 1 },
      { id: "c2", key: "KAN-3", title: "Sub-task 2", state: "done", priority: "med", sortOrder: 2 },
    ];
    const result = slimIssueDetail(makeIssue({ children }) as any);
    expect(result["children"]).toEqual([
      { key: "KAN-2", title: "Sub-task", state: "todo" },
      { key: "KAN-3", title: "Sub-task 2", state: "done" },
    ]);
  });

  it("returns empty children array when children is absent", () => {
    const result = slimIssueDetail(makeIssue() as any);
    expect(result["children"]).toEqual([]);
  });

  it("includes parentKey when present", () => {
    const result = slimIssueDetail(makeIssue({ parentKey: "KAN-0" }) as any);
    expect(result).toHaveProperty("parentKey", "KAN-0");
  });

  it("omits parentKey when not present", () => {
    const result = slimIssueDetail(makeIssue() as any);
    expect(result).not.toHaveProperty("parentKey");
  });
});

// ─── slimRoadmapItem ─────────────────────────────────────────────────────────

describe("slimRoadmapItem", () => {
  it("keeps title, horizon, status, effort, impact, labels, promoted, targetDate", () => {
    const result = slimRoadmapItem(makeRoadmapItem() as any);
    expect(result).toHaveProperty("title", "Roadmap feature");
    expect(result).toHaveProperty("horizon", "near");
    expect(result).toHaveProperty("status", "planned");
    expect(result).toHaveProperty("effort", 3);
    expect(result).toHaveProperty("impact", 5);
    expect(result).toHaveProperty("labels");
    expect(result).toHaveProperty("promoted", true);
    expect(result).toHaveProperty("targetDate", "2026-06-01");
  });

  it("strips id, projectId, createdAt, updatedAt, description, sortOrder", () => {
    const result = slimRoadmapItem(makeRoadmapItem() as any);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("projectId");
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("updatedAt");
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("sortOrder");
  });
});

// ─── slimProject ─────────────────────────────────────────────────────────────

describe("slimProject", () => {
  it("keeps key, name, description only", () => {
    const result = slimProject(makeProject() as any);
    expect(result).toEqual({
      key: "KAN",
      name: "Kanon",
      description: "Project management tool",
    });
  });

  it("strips id, engramNamespace, workspaceId", () => {
    const result = slimProject(makeProject() as any);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("engramNamespace");
    expect(result).not.toHaveProperty("workspaceId");
  });
});

// ─── slimGroup ───────────────────────────────────────────────────────────────

describe("slimGroup", () => {
  it("keeps groupKey, count, latestState, title", () => {
    const result = slimGroup(makeGroup() as any);
    expect(result).toEqual({
      groupKey: "backlog",
      count: 12,
      latestState: "todo",
      title: "Backlog",
    });
  });

  it("strips updatedAt", () => {
    const result = slimGroup(makeGroup() as any);
    expect(result).not.toHaveProperty("updatedAt");
  });
});

// ─── formatEntity ────────────────────────────────────────────────────────────

describe("formatEntity", () => {
  it("applies slim transform when format is 'slim'", () => {
    const raw = makeIssue();
    const result = formatEntity(raw, "issue", "slim") as Record<string, unknown>;
    expect(result).not.toHaveProperty("id");
    expect(result).toHaveProperty("key", "KAN-1");
  });

  it("returns raw data unchanged when format is 'full'", () => {
    const raw = makeIssue();
    const result = formatEntity(raw, "issue", "full");
    expect(result).toBe(raw); // same reference
  });

  it("defaults to slim when format is omitted", () => {
    const raw = makeProject();
    const result = formatEntity(raw, "project") as Record<string, unknown>;
    expect(result).not.toHaveProperty("id");
    expect(result).toHaveProperty("key", "KAN");
  });

  it("dispatches correctly for each entity type", () => {
    expect(formatEntity(makeRoadmapItem(), "roadmap", "slim")).not.toHaveProperty("id");
    expect(formatEntity(makeGroup(), "group", "slim")).not.toHaveProperty("updatedAt");
    expect(formatEntity(makeIssue(), "issue-detail", "slim")).toHaveProperty("description");
  });
});

// ─── formatList / pagination ─────────────────────────────────────────────────

describe("formatList", () => {
  function makeIssues(n: number) {
    return Array.from({ length: n }, (_, i) =>
      makeIssue({ key: `KAN-${i + 1}`, title: `Issue ${i + 1}` }),
    );
  }

  it("default pagination: 20 items from array of 50", () => {
    const items = makeIssues(50);
    const result = formatList(items, "issue");
    expect(result.items).toHaveLength(DEFAULT_LIMIT);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
  });

  it("custom offset: offset=20, limit=10 returns correct slice", () => {
    const items = makeIssues(50);
    const result = formatList(items, "issue", "slim", 10, 20);
    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
    // Verify it's the right slice — first item should be issue 21
    expect((result.items[0] as Record<string, unknown>)["key"]).toBe("KAN-21");
  });

  it("offset beyond total returns empty items, hasMore=false", () => {
    const items = makeIssues(10);
    const result = formatList(items, "issue", "slim", 20, 100);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(10);
    expect(result.hasMore).toBe(false);
  });

  it("small dataset: 5 items, default limit", () => {
    const items = makeIssues(5);
    const result = formatList(items, "issue");
    expect(result.items).toHaveLength(5);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(false);
  });

  it("includes hint when hasMore=true", () => {
    const items = makeIssues(50);
    const result = formatList(items, "issue");
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain("offset=");
  });

  it("does not include hint when hasMore=false", () => {
    const items = makeIssues(5);
    const result = formatList(items, "issue");
    expect(result.hint).toBeUndefined();
  });

  it("items are slim-transformed, not raw", () => {
    const items = makeIssues(3);
    const result = formatList(items, "issue", "slim");
    for (const item of result.items) {
      const obj = item as Record<string, unknown>;
      expect(obj).not.toHaveProperty("id");
      expect(obj).not.toHaveProperty("engramContext");
      expect(obj).toHaveProperty("key");
      expect(obj).toHaveProperty("title");
    }
  });

  it("format='full' returns raw objects, still paginated", () => {
    const items = makeIssues(50);
    const result = formatList(items, "issue", "full", 10, 0);
    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
    // Raw objects should still have id, engramContext, etc.
    const first = result.items[0] as Record<string, unknown>;
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("engramContext");
    expect(first).toHaveProperty("key");
  });
});
