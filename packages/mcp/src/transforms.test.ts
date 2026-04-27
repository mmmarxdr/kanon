import { describe, it, expect, beforeAll } from "vitest";
import {
  slimIssue,
  slimIssueDetail,
  slimRoadmapItem,
  slimProject,
  slimGroup,
  slimPick,
  formatEntity,
  formatList,
  toCompactTable,
  formatCycle,
  formatCycleDetail,
  formatAck,
  DEFAULT_LIMIT,
  ISSUE_WRITE_FIELDS,
  ROADMAP_WRITE_FIELDS,
  PROJECT_WRITE_FIELDS,
  COMMENT_WRITE_FIELDS,
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

  it("includes id (needed for update/delete)", () => {
    const result = slimRoadmapItem(makeRoadmapItem() as any);
    expect(result).toHaveProperty("id", "rm_001");
  });

  it("strips projectId, createdAt, updatedAt, description, sortOrder", () => {
    const result = slimRoadmapItem(makeRoadmapItem() as any);
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
    expect(formatEntity(makeRoadmapItem(), "roadmap", "slim")).toHaveProperty("id");
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
    const result = formatList(items, "issue", "full", 10, 0) as any;
    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
    // Raw objects should still have id, engramContext, etc.
    const first = result.items[0] as Record<string, unknown>;
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("engramContext");
    expect(first).toHaveProperty("key");
  });

  it("format='compact' returns CompactResult with table string", () => {
    const items = makeIssues(3);
    const result = formatList(items, "issue", "compact") as any;
    expect(result).toHaveProperty("table");
    expect(result).toHaveProperty("total", 3);
    expect(result).toHaveProperty("hasMore", false);
    expect(typeof result.table).toBe("string");
    expect(result.table).toContain("| key |");
    expect(result.table).toContain("KAN-1");
  });

  it("compact format with pagination returns hasMore and hint", () => {
    const items = makeIssues(50);
    const result = formatList(items, "issue", "compact", 10, 0) as any;
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
    expect(result.hint).toContain("offset=10");
  });

  it("compact format with empty list returns empty table", () => {
    const result = formatList([], "issue", "compact") as any;
    expect(result.table).toBe("");
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});

// ─── Write-Slim Transforms ────────────────────────────────────────────────────

describe("write-slim transforms", () => {
  it("issue-write keeps only key, title, state, type, priority", () => {
    const raw = makeIssue();
    const result = formatEntity(raw, "issue-write") as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(
      ["key", "priority", "state", "title", "type"],
    );
    expect(result).toEqual({
      key: "KAN-1",
      title: "Fix login bug",
      state: "in_progress",
      type: "bug",
      priority: "high",
    });
  });

  it("issue-write strips description, id, labels, assignee, timestamps", () => {
    const raw = makeIssue();
    const result = formatEntity(raw, "issue-write") as Record<string, unknown>;
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("labels");
    expect(result).not.toHaveProperty("assignee");
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("updatedAt");
  });

  it("roadmap-write keeps only id, title, horizon, status, promoted", () => {
    const raw = makeRoadmapItem();
    const result = formatEntity(raw, "roadmap-write") as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(
      ["horizon", "id", "promoted", "status", "title"],
    );
    expect(result).toEqual({
      id: "rm_001",
      title: "Roadmap feature",
      horizon: "near",
      status: "planned",
      promoted: true,
    });
  });

  it("roadmap-write strips description, effort, impact, timestamps", () => {
    const raw = makeRoadmapItem();
    const result = formatEntity(raw, "roadmap-write") as Record<string, unknown>;
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("effort");
    expect(result).not.toHaveProperty("impact");
    expect(result).not.toHaveProperty("createdAt");
  });

  it("project-write keeps only key, name", () => {
    const raw = makeProject();
    const result = formatEntity(raw, "project-write") as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(["key", "name"]);
    expect(result).toEqual({ key: "KAN", name: "Kanon" });
  });

  it("project-write strips description, id, engramNamespace", () => {
    const raw = makeProject();
    const result = formatEntity(raw, "project-write") as Record<string, unknown>;
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("engramNamespace");
  });

  it("comment-write keeps only id, issueKey, source", () => {
    const raw = { id: "c1", issueKey: "KAN-1", source: "engram_sync", body: "long text", createdAt: "2026-01-01" };
    const result = formatEntity(raw, "comment-write") as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(["id", "issueKey", "source"]);
    expect(result).not.toHaveProperty("body");
    expect(result).not.toHaveProperty("createdAt");
  });

  it("write-slim with format='full' bypasses transform", () => {
    const raw = makeIssue();
    const result = formatEntity(raw, "issue-write", "full");
    expect(result).toBe(raw); // same reference — no transform applied
  });
});

// ─── toCompactTable ─────��───────────────────────────────────────────────────

describe("toCompactTable", () => {
  it("renders header, separator, and data rows", () => {
    const items = [
      { key: "KAN-1", title: "First", state: "todo" },
      { key: "KAN-2", title: "Second", state: "done" },
    ];
    const table = toCompactTable(items);
    const lines = table.split("\n");
    expect(lines).toHaveLength(4); // header + separator + 2 data rows
    expect(lines[0]).toBe("| key | title | state |");
    expect(lines[1]).toBe("|---|---|---|");
    expect(lines[2]).toBe("| KAN-1 | First | todo |");
    expect(lines[3]).toBe("| KAN-2 | Second | done |");
  });

  it("escapes pipe characters in values", () => {
    const items = [{ title: "A | B", count: 5 }];
    const table = toCompactTable(items);
    expect(table).toContain("A \\| B");
    expect(table).not.toContain("A | B |");
  });

  it("handles null and undefined values as empty strings", () => {
    const items = [{ a: null, b: undefined, c: "ok" }];
    const table = toCompactTable(items);
    expect(table).toContain("|  |  | ok |");
  });

  it("returns empty string for empty array", () => {
    expect(toCompactTable([])).toBe("");
  });

  it("handles single item", () => {
    const items = [{ x: 1 }];
    const table = toCompactTable(items);
    const lines = table.split("\n");
    expect(lines).toHaveLength(3); // header + separator + 1 row
    expect(lines[2]).toBe("| 1 |");
  });
});

// ─── Cycle Transforms ────────────────────────────────────────────────────────

function makeCycle(overrides: Record<string, unknown> = {}) {
  return {
    id: "cyc_001",
    name: "Sprint 1",
    goal: "Ship cycles",
    state: "active",
    startDate: "2026-04-01T00:00:00.000Z",
    endDate: "2026-04-14T00:00:00.000Z",
    velocity: null,
    projectId: "proj_001",
    createdAt: "2026-03-30T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function makeCycleDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...makeCycle(),
    dayIndex: 3,
    days: 14,
    scope: 10,
    completed: 4,
    scopeAdded: 2,
    scopeRemoved: 1,
    burnup: [0, 1, 2, 4],
    scopeLine: [10, 11, 11, 10],
    risks: [{ id: "r1", severity: "medium" as const, title: "Slow", detail: "details" }],
    issues: [
      { id: "i1", key: "KAN-1", title: "A", state: "done", estimate: 2 },
      { id: "i2", key: "KAN-2", title: "B", state: "in_progress", estimate: 3 },
    ],
    scopeEvents: [
      { id: "e1", issueId: "i1", type: "added" as const, reason: "plan", createdAt: "2026-04-01T00:00:00Z", authorId: "u1" },
    ],
    ...overrides,
  };
}

describe("formatCycle", () => {
  it("keeps id, name, state, dates, velocity and adds isActive", () => {
    const result = formatCycle(makeCycle() as any) as Record<string, unknown>;
    expect(result["id"]).toBe("cyc_001");
    expect(result["name"]).toBe("Sprint 1");
    expect(result["state"]).toBe("active");
    expect(result["startDate"]).toBeDefined();
    expect(result["endDate"]).toBeDefined();
    expect(result["isActive"]).toBe(true);
  });

  it("isActive is false for upcoming/done cycles", () => {
    const upcoming = formatCycle(makeCycle({ state: "upcoming" }) as any) as Record<string, unknown>;
    const done = formatCycle(makeCycle({ state: "done" }) as any) as Record<string, unknown>;
    expect(upcoming["isActive"]).toBe(false);
    expect(done["isActive"]).toBe(false);
  });

  it("returns raw object when format='full'", () => {
    const raw = makeCycle();
    const result = formatCycle(raw as any, "full");
    expect(result).toBe(raw);
  });
});

describe("formatCycleDetail", () => {
  it("includes burnup, scopeLine, risks, slimmed issues, slimmed scopeEvents", () => {
    const result = formatCycleDetail(makeCycleDetail() as any) as Record<string, unknown>;
    expect(result["burnup"]).toEqual([0, 1, 2, 4]);
    expect(result["scopeLine"]).toEqual([10, 11, 11, 10]);
    expect(result["scope"]).toBe(10);
    expect(result["completed"]).toBe(4);
    expect((result["risks"] as unknown[]).length).toBe(1);
    expect(result["issues"]).toEqual([
      { key: "KAN-1", title: "A", state: "done" },
      { key: "KAN-2", title: "B", state: "in_progress" },
    ]);
    expect((result["scopeEvents"] as Array<Record<string, unknown>>)[0]).not.toHaveProperty("authorId");
    expect((result["scopeEvents"] as Array<Record<string, unknown>>)[0]).toHaveProperty("type", "added");
  });

  it("preserves isActive flag from slimCycle base", () => {
    const result = formatCycleDetail(makeCycleDetail() as any) as Record<string, unknown>;
    expect(result["isActive"]).toBe(true);
  });
});

describe("formatEntity for cycles", () => {
  it("dispatches 'cycle' type to slimCycle", () => {
    const result = formatEntity(makeCycle(), "cycle", "slim") as Record<string, unknown>;
    expect(result).toHaveProperty("isActive");
    expect(result).not.toHaveProperty("projectId");
  });

  it("dispatches 'cycle-detail' type to slimCycleDetail", () => {
    const result = formatEntity(makeCycleDetail(), "cycle-detail", "slim") as Record<string, unknown>;
    expect(result).toHaveProperty("burnup");
    expect(result).toHaveProperty("isActive");
  });
});

// ─── formatAck ───────────────────────────────────────────────────────────────

describe("formatAck", () => {
  it("issue → { ok: true, id, key }", () => {
    const issue = makeIssue();
    const result = formatAck(issue, "issue");
    expect(result).toEqual({ ok: true, id: "iss_001", key: "KAN-1" });
    expect(Object.keys(result)).toEqual(["ok", "id", "key"]);
  });

  it("cycle → { ok: true, id, name, state }", () => {
    const cycle = makeCycle();
    const result = formatAck(cycle, "cycle");
    expect(result).toEqual({
      ok: true,
      id: "cyc_001",
      name: "Sprint 1",
      state: "active",
    });
    expect(Object.keys(result)).toEqual(["ok", "id", "name", "state"]);
  });

  it("roadmap-item → { ok: true, id, title, horizon }", () => {
    const item = makeRoadmapItem();
    const result = formatAck(item, "roadmap-item");
    expect(result).toEqual({
      ok: true,
      id: "rm_001",
      title: "Roadmap feature",
      horizon: "near",
    });
    expect(Object.keys(result)).toEqual(["ok", "id", "title", "horizon"]);
  });

  it("work-session → { ok: true, id, issueId, startedAt }", () => {
    const session = {
      id: "ws_001",
      issueId: "iss_001",
      startedAt: "2026-04-27T10:00:00Z",
      memberId: "m_001",
      source: "mcp",
    };
    const result = formatAck(session, "work-session");
    expect(result).toEqual({
      ok: true,
      id: "ws_001",
      issueId: "iss_001",
      startedAt: "2026-04-27T10:00:00Z",
    });
    expect(Object.keys(result)).toEqual(["ok", "id", "issueId", "startedAt"]);
  });

  it("project → { ok: true, id, key, name }", () => {
    const project = makeProject();
    const result = formatAck(project, "project");
    expect(result).toEqual({
      ok: true,
      id: "proj_001",
      key: "KAN",
      name: "Kanon",
    });
    expect(Object.keys(result)).toEqual(["ok", "id", "key", "name"]);
  });

  it("cycle-attach → passes through cycleId, added, removed, scope, completed", () => {
    const payload = {
      cycleId: "cyc_001",
      added: ["KAN-1", "KAN-2"],
      removed: [],
      scope: 5,
      completed: 2,
    };
    const result = formatAck(payload, "cycle-attach");
    expect(result).toEqual({
      ok: true,
      cycleId: "cyc_001",
      added: ["KAN-1", "KAN-2"],
      removed: [],
      scope: 5,
      completed: 2,
    });
    expect(Object.keys(result)).toEqual([
      "ok", "cycleId", "added", "removed", "scope", "completed",
    ]);
  });

  it("cycle-close → passes through cycleId, disposition, movedIssueKeys", () => {
    const payload = {
      cycleId: "cyc_001",
      disposition: "move_to_next",
      movedIssueKeys: ["KAN-3", "KAN-4"],
    };
    const result = formatAck(payload, "cycle-close");
    expect(result).toEqual({
      ok: true,
      cycleId: "cyc_001",
      disposition: "move_to_next",
      movedIssueKeys: ["KAN-3", "KAN-4"],
    });
    expect(Object.keys(result)).toEqual([
      "ok", "cycleId", "disposition", "movedIssueKeys",
    ]);
  });

  it("issue-dependency → { ok: true, id, projectId }", () => {
    const dep = { id: "dep_001", projectId: "proj_001", type: "blocks", sourceId: "x", targetId: "y" };
    const result = formatAck(dep, "issue-dependency");
    expect(result).toEqual({
      ok: true,
      id: "dep_001",
      projectId: "proj_001",
    });
    expect(Object.keys(result)).toEqual(["ok", "id", "projectId"]);
  });

  it("batch-transition → passes through count + keys", () => {
    const payload = {
      count: 3,
      keys: ["KAN-1", "KAN-2", "KAN-3"],
      state: "in_progress",
    };
    const result = formatAck(payload, "batch-transition");
    expect(result).toEqual({
      ok: true,
      count: 3,
      keys: ["KAN-1", "KAN-2", "KAN-3"],
    });
    expect(Object.keys(result)).toEqual(["ok", "count", "keys"]);
  });

  it("comment → { ok: true, id, issueKey }", () => {
    const comment = {
      id: "c_001",
      issueKey: "KAN-1",
      source: "engram_sync",
      body: "long body content",
      createdAt: "2026-04-27T00:00:00Z",
    };
    const result = formatAck(comment, "comment");
    expect(result).toEqual({
      ok: true,
      id: "c_001",
      issueKey: "KAN-1",
    });
    expect(Object.keys(result)).toEqual(["ok", "id", "issueKey"]);
  });

  it("work-session-stop → { ok: true, deleted, issueKey }", () => {
    const payload = { ok: true, deleted: true, issueKey: "KAN-42" };
    const result = formatAck(payload, "work-session-stop");
    expect(result).toEqual({
      ok: true,
      deleted: true,
      issueKey: "KAN-42",
    });
    expect(Object.keys(result)).toEqual(["ok", "deleted", "issueKey"]);
  });

  it("always places ok: true as the first key", () => {
    const result = formatAck(makeIssue(), "issue");
    expect(Object.keys(result)[0]).toBe("ok");
    expect(result["ok"]).toBe(true);
  });
});

// ─── dataResult shape ─────────────────────────────────────────────────────────

describe("dataResult", () => {
  // Import here to keep test file focused — dataResult is in errors.ts
  let dataResult: (data: unknown) => { content: Array<{ type: string; text: string }>; isError?: boolean };

  beforeAll(async () => {
    const mod = await import("./errors.js");
    dataResult = mod.dataResult;
  });

  it("returns JSON text content without success/data wrapper", () => {
    const input = { key: "KAN-1", title: "Test" };
    const result = dataResult(input);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    // Data is returned directly — no wrapper
    expect(parsed).toEqual(input);
    expect(parsed).not.toHaveProperty("success");
    expect(parsed).not.toHaveProperty("data");
  });

  it("does not set isError flag", () => {
    const result = dataResult({ ok: true });
    expect(result.isError).toBeUndefined();
  });

  it("handles arrays directly", () => {
    const input = [1, 2, 3];
    const result = dataResult(input);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it("handles strings directly", () => {
    const result = dataResult("hello");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toBe("hello");
  });
});
