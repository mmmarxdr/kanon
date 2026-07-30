import { describe, it, expect, vi, beforeEach } from "vitest";
import { closeCycleWithDisposition, normalizeDate, registerCycleTools } from "./cycles.js";
import type {
  KanonClient,
  KanonCycle,
  KanonCycleDetail,
  KanonCycleDeleteResult,
} from "../kanon-client.js";
import { KanonApiError } from "../kanon-client.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ─── Harness ────────────────────────────────────────────────────────────────

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

interface RegisteredTool {
  name: string;
  description: string;
  shape: unknown;
  handler: ToolHandler;
}

function captureTools(
  register: (server: McpServer, client: KanonClient) => void,
  client: KanonClient,
): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    tool: (name: string, description: string, shape: unknown, handler: ToolHandler) => {
      tools.set(name, { name, description, shape, handler });
    },
  } as unknown as McpServer;
  register(fakeServer, client);
  return tools;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const CYCLE_ID = "550e8400-e29b-41d4-a716-446655440001";
const NEXT_CYCLE_ID = "550e8400-e29b-41d4-a716-446655440002";

function makeClosed(overrides: Partial<KanonCycle> = {}): KanonCycle {
  return {
    id: CYCLE_ID,
    name: "Sprint 1",
    goal: null,
    state: "done",
    startDate: "2026-04-01T00:00:00.000Z",
    endDate: "2026-04-14T00:00:00.000Z",
    velocity: 5,
    projectId: "proj_001",
    createdAt: "2026-03-30T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
    ...overrides,
  };
}

function makeDetail(
  issues: Array<{ id: string; key: string; title: string; state: string; estimate?: number }>,
  overrides: Partial<KanonCycleDetail> = {},
): KanonCycleDetail {
  return {
    id: CYCLE_ID,
    name: "Sprint 1",
    goal: null,
    state: "active",
    startDate: "2026-04-01T00:00:00.000Z",
    endDate: "2026-04-14T00:00:00.000Z",
    velocity: null,
    projectId: "proj_001",
    createdAt: "2026-03-30T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    dayIndex: 5,
    days: 14,
    scope: issues.length,
    completed: issues.filter((i) => i.state === "done").length,
    scopeAdded: 0,
    scopeRemoved: 0,
    burnup: [],
    scopeLine: [],
    risks: [],
    issues,
    scopeEvents: [],
    ...overrides,
  };
}

interface MockClient {
  closeCycle: ReturnType<typeof vi.fn>;
  getCycle: ReturnType<typeof vi.fn>;
  attachIssuesToCycle: ReturnType<typeof vi.fn>;
  listCycles: ReturnType<typeof vi.fn>;
  deleteCycle: ReturnType<typeof vi.fn>;
}

function makeClient(): MockClient {
  return {
    closeCycle: vi.fn(),
    getCycle: vi.fn(),
    attachIssuesToCycle: vi.fn(),
    listCycles: vi.fn(),
    deleteCycle: vi.fn(),
  };
}

// ─── normalizeDate ──────────────────────────────────────────────────────────

describe("normalizeDate", () => {
  it("appends T00:00:00.000Z to YYYY-MM-DD", () => {
    expect(normalizeDate("2026-04-01")).toBe("2026-04-01T00:00:00.000Z");
  });

  it("passes through full ISO datetime unchanged", () => {
    expect(normalizeDate("2026-04-01T12:30:00.000Z")).toBe("2026-04-01T12:30:00.000Z");
  });
});

// ─── closeCycleWithDisposition ──────────────────────────────────────────────

describe("closeCycleWithDisposition — leave", () => {
  it("calls only closeCycle, no detail fetch", async () => {
    const client = makeClient();
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "leave",
    });

    expect(result).toEqual({
      closed: makeClosed(),
      movedIssueKeys: [],
      disposition: "leave",
    });
    expect(client.closeCycle).toHaveBeenCalledTimes(1);
    expect(client.getCycle).not.toHaveBeenCalled();
    expect(client.attachIssuesToCycle).not.toHaveBeenCalled();
  });
});

describe("closeCycleWithDisposition — move_to_backlog", () => {
  it("removes incomplete issues, then closes", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i1", key: "KAN-1", title: "Done", state: "done" },
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
      { id: "i3", key: "KAN-3", title: "WIP", state: "in_progress" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.attachIssuesToCycle.mockResolvedValueOnce(detail);
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "move_to_backlog",
      reason: "End of sprint",
    });

    expect(result.movedIssueKeys.length).toBe(2);
    expect(result.disposition).toBe("move_to_backlog");
    expect(client.attachIssuesToCycle).toHaveBeenCalledWith(CYCLE_ID, {
      remove: ["KAN-2", "KAN-3"],
      reason: "End of sprint",
    });
    expect(client.closeCycle).toHaveBeenCalledWith(CYCLE_ID);
  });

  it("skips attach call when no incomplete issues", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i1", key: "KAN-1", title: "Done", state: "done" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "move_to_backlog",
    });

    expect(result.movedIssueKeys.length).toBe(0);
    expect(client.attachIssuesToCycle).not.toHaveBeenCalled();
    expect(client.closeCycle).toHaveBeenCalledOnce();
  });
});

describe("closeCycleWithDisposition — move_to_next", () => {
  it("throws clearly when no upcoming cycle exists", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.listCycles.mockResolvedValueOnce([
      // Only the current cycle — no upcoming
      { ...makeClosed({ state: "active" }) },
    ]);

    await expect(
      closeCycleWithDisposition(client as unknown as KanonClient, {
        cycleId: CYCLE_ID,
        disposition: "move_to_next",
        projectKey: "KAN",
      }),
    ).rejects.toThrow("No upcoming cycle exists");

    expect(client.closeCycle).not.toHaveBeenCalled();
  });

  it("throws when projectKey missing", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);

    await expect(
      closeCycleWithDisposition(client as unknown as KanonClient, {
        cycleId: CYCLE_ID,
        disposition: "move_to_next",
      }),
    ).rejects.toThrow(/projectKey/);
  });

  it("happy path: detaches from current, attaches to next, closes", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i1", key: "KAN-1", title: "Done", state: "done" },
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.listCycles.mockResolvedValueOnce([
      // Next upcoming cycle starting after current end
      {
        id: NEXT_CYCLE_ID,
        name: "Sprint 2",
        goal: null,
        state: "upcoming",
        startDate: "2026-04-15T00:00:00.000Z",
        endDate: "2026-04-28T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      } as KanonCycle,
    ]);
    client.attachIssuesToCycle.mockResolvedValue(detail);
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "move_to_next",
      projectKey: "KAN",
      reason: "rollover",
    });

    expect(result.movedIssueKeys.length).toBe(1);
    expect(result.disposition).toBe("move_to_next");
    // First call: remove from current
    expect(client.attachIssuesToCycle).toHaveBeenNthCalledWith(1, CYCLE_ID, {
      remove: ["KAN-2"],
      reason: "rollover",
    });
    // Second call: add to next
    expect(client.attachIssuesToCycle).toHaveBeenNthCalledWith(2, NEXT_CYCLE_ID, {
      add: ["KAN-2"],
      reason: "rollover",
    });
    expect(client.closeCycle).toHaveBeenCalledWith(CYCLE_ID);
  });

  it("picks earliest upcoming cycle by startDate", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.listCycles.mockResolvedValueOnce([
      {
        id: "later-uuid",
        name: "Sprint 3",
        goal: null,
        state: "upcoming",
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-14T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      } as KanonCycle,
      {
        id: NEXT_CYCLE_ID,
        name: "Sprint 2",
        goal: null,
        state: "upcoming",
        startDate: "2026-04-15T00:00:00.000Z",
        endDate: "2026-04-28T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      } as KanonCycle,
    ]);
    client.attachIssuesToCycle.mockResolvedValue(detail);
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "move_to_next",
      projectKey: "KAN",
    });

    // Earliest matching cycle (NEXT_CYCLE_ID) should be the second arg target
    expect(client.attachIssuesToCycle).toHaveBeenNthCalledWith(2, NEXT_CYCLE_ID, {
      add: ["KAN-2"],
    });
  });
});

// ─── D5: create_cycle — attachIssueKeys forwarded to client ────────────

describe("create_cycle — attachIssueKeys (D5)", () => {
  let mockClient: { createCycle: ReturnType<typeof vi.fn> };
  let createCycleTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      createCycle: vi.fn().mockResolvedValue({
        id: CYCLE_ID,
        name: "Sprint 1",
        goal: null,
        state: "upcoming",
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-14T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      }),
    };
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("create_cycle");
    if (!tool) throw new Error("create_cycle not registered");
    createCycleTool = tool;
  });

  it("passes attachIssueKeys in the body sent to client.createCycle", async () => {
    await createCycleTool.handler({
      projectKey: "KAN",
      name: "Sprint 1",
      startDate: "2026-05-01",
      endDate: "2026-05-14",
      attachIssueKeys: ["KAN-1", "KAN-2"],
    });

    expect(mockClient.createCycle).toHaveBeenCalledWith(
      "KAN",
      expect.objectContaining({ attachIssueKeys: ["KAN-1", "KAN-2"] }),
    );
  });

  it("does not include attachIssueKeys in body when not provided", async () => {
    await createCycleTool.handler({
      projectKey: "KAN",
      name: "Sprint 1",
      startDate: "2026-05-01",
      endDate: "2026-05-14",
    });

    const [, body] = mockClient.createCycle.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty("attachIssueKeys");
  });
});

// ─── D7: get_cycle — includeAllScopeEvents forwarded ───────────────────

describe("get_cycle — includeAllScopeEvents (D7)", () => {
  let mockClient: { getCycle: ReturnType<typeof vi.fn> };
  let getCycleTool: RegisteredTool;

  const fakeDetail: KanonCycleDetail = {
    id: CYCLE_ID,
    name: "Sprint 1",
    goal: null,
    state: "active",
    startDate: "2026-05-01T00:00:00.000Z",
    endDate: "2026-05-14T00:00:00.000Z",
    velocity: null,
    projectId: "proj_001",
    createdAt: "",
    updatedAt: "",
    dayIndex: 0,
    days: 14,
    scope: 0,
    completed: 0,
    scopeAdded: 0,
    scopeRemoved: 0,
    burnup: [],
    scopeLine: [],
    risks: [],
    issues: [],
    scopeEvents: [],
  };

  beforeEach(() => {
    mockClient = { getCycle: vi.fn().mockResolvedValue(fakeDetail) };
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("get_cycle");
    if (!tool) throw new Error("get_cycle not registered");
    getCycleTool = tool;
  });

  it("passes includeAllScopeEvents:true to client.getCycle", async () => {
    await getCycleTool.handler({
      cycleId: CYCLE_ID,
      includeAllScopeEvents: true,
    });

    expect(mockClient.getCycle).toHaveBeenCalledWith(
      CYCLE_ID,
      expect.objectContaining({ includeAllScopeEvents: true }),
    );
  });

  it("calls getCycle without options when includeAllScopeEvents not provided", async () => {
    await getCycleTool.handler({ cycleId: CYCLE_ID });

    // Should not pass truthy includeAllScopeEvents
    const [, opts] = mockClient.getCycle.mock.calls[0] as [string, Record<string, unknown> | undefined];
    expect(opts?.includeAllScopeEvents).toBeFalsy();
  });
});

// ─── D11: closeCycleWithDisposition returns movedIssueKeys array ─────────────

describe("closeCycleWithDisposition — movedIssueKeys in return (D11)", () => {
  it("leave path: getCycle never called, movedIssueKeys is empty array", async () => {
    const client = makeClient();
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "leave",
    });

    expect(client.getCycle).not.toHaveBeenCalled();
    expect(result).toHaveProperty("movedIssueKeys");
    expect(result.movedIssueKeys).toEqual([]);
  });

  it("move_to_backlog: movedIssueKeys contains incomplete issue keys", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i1", key: "KAN-1", title: "Done", state: "done" },
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
      { id: "i3", key: "KAN-3", title: "WIP", state: "in_progress" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.attachIssuesToCycle.mockResolvedValueOnce(detail);
    client.closeCycle.mockResolvedValueOnce(makeClosed());

    const result = await closeCycleWithDisposition(client as unknown as KanonClient, {
      cycleId: CYCLE_ID,
      disposition: "move_to_backlog",
    });

    expect(result).toHaveProperty("movedIssueKeys");
    expect(result.movedIssueKeys).toEqual(["KAN-2", "KAN-3"]);
  });
});

// ─── D11: close_cycle ack includes actual movedIssueKeys ───────────────

describe("close_cycle — movedIssueKeys in ack (D11)", () => {
  it("ack includes movedIssueKeys from disposition result (move_to_backlog)", async () => {
    const mockClient = makeClient();
    const detail = makeDetail([
      { id: "i1", key: "KAN-1", title: "Done", state: "done" },
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    mockClient.getCycle.mockResolvedValueOnce(detail);
    mockClient.attachIssuesToCycle.mockResolvedValueOnce(detail);
    mockClient.closeCycle.mockResolvedValueOnce(makeClosed());

    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const closeTool = tools.get("close_cycle")!;

    const result = await closeTool.handler({
      cycleId: CYCLE_ID,
      disposition: "move_to_backlog",
      projectKey: "KAN",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("movedIssueKeys");
    expect(parsed.movedIssueKeys).toEqual(["KAN-2"]);
  });
});

// ─── C5: create_cycle — format tier ────────────────────────────────────

describe("create_cycle — format tier", () => {
  const fakeCycle: KanonCycle = {
    id: CYCLE_ID,
    name: "Sprint 1",
    goal: null,
    state: "upcoming",
    startDate: "2026-05-01T00:00:00.000Z",
    endDate: "2026-05-14T00:00:00.000Z",
    velocity: null,
    projectId: "proj_001",
    createdAt: "2026-04-28T00:00:00Z",
    updatedAt: "2026-04-28T00:00:00Z",
  };

  let mockClient: { createCycle: ReturnType<typeof vi.fn> };
  let createCycleTool: RegisteredTool;

  beforeEach(() => {
    mockClient = { createCycle: vi.fn().mockResolvedValue(fakeCycle) };
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("create_cycle");
    if (!tool) throw new Error("create_cycle not registered");
    createCycleTool = tool;
  });

  it("defaults to ack: returns { ok, id, name, state } with no other fields", async () => {
    const result = await createCycleTool.handler({
      projectKey: "KAN",
      name: "Sprint 1",
      startDate: "2026-05-01",
      endDate: "2026-05-14",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("id", CYCLE_ID);
    expect(parsed).toHaveProperty("name", "Sprint 1");
    expect(parsed).toHaveProperty("state", "upcoming");
    expect(parsed).not.toHaveProperty("startDate");
    expect(parsed).not.toHaveProperty("endDate");
    expect(parsed).not.toHaveProperty("projectId");
  });

  it("format: 'full' returns the raw cycle entity", async () => {
    const result = await createCycleTool.handler({
      projectKey: "KAN",
      name: "Sprint 1",
      startDate: "2026-05-01",
      endDate: "2026-05-14",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", CYCLE_ID);
    expect(parsed).toHaveProperty("startDate");
    expect(parsed).toHaveProperty("endDate");
    expect(parsed).toHaveProperty("projectId", "proj_001");
    expect(parsed).not.toHaveProperty("ok");
  });
});

// ─── C6: update_cycle_scope — format tier ──────────────────────────

describe("update_cycle_scope — format tier", () => {
  const fakeCycleDetail: KanonCycleDetail = {
    id: CYCLE_ID,
    name: "Sprint 1",
    goal: null,
    state: "active",
    startDate: "2026-05-01T00:00:00.000Z",
    endDate: "2026-05-14T00:00:00.000Z",
    velocity: null,
    projectId: "proj_001",
    createdAt: "2026-04-28T00:00:00Z",
    updatedAt: "2026-04-28T00:00:00Z",
    dayIndex: 0,
    days: 14,
    scope: 2,
    completed: 0,
    scopeAdded: 2,
    scopeRemoved: 0,
    burnup: [],
    scopeLine: [],
    risks: [],
    issues: [
      { id: "i1", key: "KAN-1", title: "Issue 1", state: "todo", estimate: null } as any,
      { id: "i2", key: "KAN-2", title: "Issue 2", state: "todo", estimate: null } as any,
    ],
    scopeEvents: [],
  };

  let mockClient: { attachIssuesToCycle: ReturnType<typeof vi.fn> };
  let attachTool: RegisteredTool;

  beforeEach(() => {
    mockClient = { attachIssuesToCycle: vi.fn().mockResolvedValue(fakeCycleDetail) };
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("update_cycle_scope");
    if (!tool) throw new Error("update_cycle_scope not registered");
    attachTool = tool;
  });

  it("defaults to ack: returns { ok, cycleId, added, removed, scope, completed }", async () => {
    const result = await attachTool.handler({
      cycleId: CYCLE_ID,
      add: ["KAN-1", "KAN-2"],
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("cycleId", CYCLE_ID);
    expect(parsed).toHaveProperty("scope", 2);
    expect(parsed).toHaveProperty("completed", 0);
    expect(parsed).not.toHaveProperty("name");
    expect(parsed).not.toHaveProperty("issues");
  });

  it("format: 'full' returns the full cycle detail entity", async () => {
    const result = await attachTool.handler({
      cycleId: CYCLE_ID,
      add: ["KAN-1", "KAN-2"],
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", CYCLE_ID);
    expect(parsed).toHaveProperty("issues");
    expect(parsed).toHaveProperty("burnup");
    expect(parsed).not.toHaveProperty("ok");
  });
});

// ─── C7: close_cycle — format tier ─────────────────────────────────────

describe("close_cycle — format tier", () => {
  let mockClient: MockClient;
  let closeTool: RegisteredTool;

  beforeEach(() => {
    mockClient = makeClient();
    // Default: leave disposition (no detail fetch)
    mockClient.closeCycle.mockResolvedValue(makeClosed());
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("close_cycle");
    if (!tool) throw new Error("close_cycle not registered");
    closeTool = tool;
  });

  it("defaults to ack: returns { ok, cycleId, disposition, movedIssueKeys }", async () => {
    const result = await closeTool.handler({
      cycleId: CYCLE_ID,
      disposition: "leave",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("cycleId", CYCLE_ID);
    expect(parsed).toHaveProperty("disposition", "leave");
    expect(parsed).toHaveProperty("movedIssueKeys");
    // No full entity fields
    expect(parsed).not.toHaveProperty("name");
    expect(parsed).not.toHaveProperty("startDate");
    expect(parsed).not.toHaveProperty("velocity");
  });

  it("format: 'full' returns the full {closed, moved, disposition} summary", async () => {
    const result = await closeTool.handler({
      cycleId: CYCLE_ID,
      disposition: "leave",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    // Full returns the {closed, movedIssueKeys, disposition} shape
    expect(parsed).toHaveProperty("closed");
    expect(parsed).toHaveProperty("movedIssueKeys");
    expect(parsed).toHaveProperty("disposition", "leave");
    expect(parsed).not.toHaveProperty("ok");
  });
});

// ─── D1–D5: delete_cycle ───────────────────────────────────────────────

const DELETE_CYCLE_ID = "a1b2c3d4-0001-0001-0001-000000000001";
const DELETE_AUDIT_ID = "aud-0099";

function makeDeleteResult(overrides: Partial<KanonCycleDeleteResult> = {}): KanonCycleDeleteResult {
  return {
    deletedCycleId: DELETE_CYCLE_ID,
    cycleName: "Sprint 7",
    detachedIssueKeys: ["KAN-12", "KAN-13", "KAN-14"],
    auditLogId: DELETE_AUDIT_ID,
    ...overrides,
  };
}

describe("delete_cycle — D.1 schema registration", () => {
  it("registers delete_cycle with cycleId, force?, reason?, format?", () => {
    const mockClient = makeClient();
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("delete_cycle");

    expect(tool).toBeDefined();
    expect(tool!.name).toBe("delete_cycle");

    const shape = tool!.shape as Record<string, { _def?: { typeName?: string; innerType?: unknown } }>;
    // cycleId should be a uuid string
    expect(shape["cycleId"]).toBeDefined();
    // force should be optional boolean
    expect(shape["force"]).toBeDefined();
    // reason should be optional string
    expect(shape["reason"]).toBeDefined();
    // format should be from WriteFormatField
    expect(shape["format"]).toBeDefined();
  });
});

describe("delete_cycle — D.2 delegates to client.deleteCycle", () => {
  it("calls client.deleteCycle with cycleId and normalized opts exactly once", async () => {
    const mockClient = makeClient();
    mockClient.deleteCycle.mockResolvedValueOnce(makeDeleteResult());
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("delete_cycle")!;

    await tool.handler({
      cycleId: DELETE_CYCLE_ID,
      reason: "cleanup placeholder",
    });

    expect(mockClient.deleteCycle).toHaveBeenCalledTimes(1);
    expect(mockClient.deleteCycle).toHaveBeenCalledWith(DELETE_CYCLE_ID, {
      force: false,
      reason: "cleanup placeholder",
    });
  });
});

describe("delete_cycle — D.3 ack format (default)", () => {
  it("ack format returns cycle name + detach count and does NOT include auditLogId", async () => {
    const mockClient = makeClient();
    mockClient.deleteCycle.mockResolvedValueOnce(makeDeleteResult());
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("delete_cycle")!;

    const result = await tool.handler({ cycleId: DELETE_CYCLE_ID });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain("Sprint 7");
    expect(text).toContain("3 issues detached");
    expect(text).not.toContain(DELETE_AUDIT_ID);
  });
});

describe("delete_cycle — D.4 slim and full formats", () => {
  it("slim format includes detachedIssueKeys list", async () => {
    const mockClient = makeClient();
    mockClient.deleteCycle.mockResolvedValueOnce(makeDeleteResult());
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("delete_cycle")!;

    const result = await tool.handler({ cycleId: DELETE_CYCLE_ID, format: "slim" });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain("KAN-12");
    expect(text).toContain("KAN-13");
    expect(text).toContain("KAN-14");
  });

  it("full format includes auditLogId", async () => {
    const mockClient = makeClient();
    mockClient.deleteCycle.mockResolvedValueOnce(makeDeleteResult());
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("delete_cycle")!;

    const result = await tool.handler({ cycleId: DELETE_CYCLE_ID, format: "full" });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain(DELETE_AUDIT_ID);
  });
});

describe("delete_cycle — D.5 KanonApiError propagated as error result", () => {
  it("propagates KanonApiError as errorResult (parity with sibling tools)", async () => {
    const mockClient = makeClient();
    mockClient.deleteCycle.mockRejectedValueOnce(
      new KanonApiError(409, "CYCLE_ACTIVE", "Cannot delete an active cycle"),
    );
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const tool = tools.get("delete_cycle")!;

    const result = await tool.handler({ cycleId: DELETE_CYCLE_ID });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("CYCLE_ACTIVE");
  });
});

// ─── KAN-20: 403 FORBIDDEN surfacing — cycle tools ───────────────────────────
//
// Confirms each tool FORWARDS the credential and SURFACES a 403 as
// { isError: true, code: "FORBIDDEN" }. Enforcement lives in the API layer.

describe("create_cycle — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      createCycle: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const handler = tools.get("create_cycle")!.handler;

    const result = await handler({
      projectKey: "KAN",
      name: "Sprint 1",
      startDate: "2026-05-01",
      endDate: "2026-05-14",
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

// ─── close_cycle binding consistency (Fix 2b) ────────────────────────────────
//
// move_to_next must route through resolveProjectKey → actionable .kanon guidance.
// leave / move_to_backlog must NOT require projectKey (no binding needed).

describe("close_cycle — move_to_next without projectKey or binding → actionable error", () => {
  it("returns isError with .kanon guidance when no projectKey and no binding", async () => {
    const mockClient = makeClient();
    // No closeCycle or listCycles needed — error fires before API call
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const handler = tools.get("close_cycle")!.handler;

    const result = await handler({
      cycleId: CYCLE_ID,
      disposition: "move_to_next",
      // no projectKey, captureTools passes no binding (null default)
    });

    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    // Must mention .kanon (binding guidance) not just "projectKey required"
    expect(text.toLowerCase()).toMatch(/\.kanon/);
    // Must NOT say "not found" — .kanon might exist but be malformed, or just absent
    expect(mockClient.listCycles).not.toHaveBeenCalled();
    expect(mockClient.closeCycle).not.toHaveBeenCalled();
  });
});

describe("close_cycle — leave works without projectKey or binding", () => {
  it("succeeds with disposition:leave and no projectKey", async () => {
    const mockClient = makeClient();
    mockClient.closeCycle.mockResolvedValueOnce(makeClosed());
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const handler = tools.get("close_cycle")!.handler;

    const result = await handler({
      cycleId: CYCLE_ID,
      disposition: "leave",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.ok).toBe(true);
  });
});

describe("close_cycle — move_to_backlog works without projectKey or binding", () => {
  it("succeeds with disposition:move_to_backlog and no projectKey", async () => {
    const mockClient = makeClient();
    const detail = makeDetail([
      { id: "i1", key: "KAN-1", title: "Open", state: "todo" },
    ]);
    mockClient.getCycle.mockResolvedValueOnce(detail);
    mockClient.attachIssuesToCycle.mockResolvedValueOnce(detail);
    mockClient.closeCycle.mockResolvedValueOnce(makeClosed());
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const handler = tools.get("close_cycle")!.handler;

    const result = await handler({
      cycleId: CYCLE_ID,
      disposition: "move_to_backlog",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.ok).toBe(true);
  });
});

// ─── KAN-123: closeCycleWithDisposition partial-mutation guard ───────────────
//
// When a mid-sequence API call fails, the tool must return an errorResult that
// names the failed step and describes the partial state so a human/agent can
// recover. For move_to_next: if the add-to-next step fails after the remove-
// from-current step succeeded, the compensating action (re-attach to current)
// must be attempted and reported.

describe("closeCycleWithDisposition — move_to_next: add-to-next fails → partial state reported", () => {
  it("returns errorResult naming the failed step and partial state; attempts compensation", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
      { id: "i3", key: "KAN-3", title: "WIP", state: "in_progress" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.listCycles.mockResolvedValueOnce([
      {
        id: NEXT_CYCLE_ID,
        name: "Sprint 2",
        goal: null,
        state: "upcoming",
        startDate: "2026-04-15T00:00:00.000Z",
        endDate: "2026-04-28T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      } as KanonCycle,
    ]);
    // remove-from-current succeeds
    client.attachIssuesToCycle.mockResolvedValueOnce(detail);
    // add-to-next FAILS
    client.attachIssuesToCycle.mockRejectedValueOnce(
      new KanonApiError(503, "UPSTREAM_ERROR", "Next cycle unavailable"),
    );
    // compensation re-attach to current succeeds
    client.attachIssuesToCycle.mockResolvedValueOnce(detail);

    await expect(
      closeCycleWithDisposition(client as unknown as KanonClient, {
        cycleId: CYCLE_ID,
        disposition: "move_to_next",
        projectKey: "KAN",
      }),
    ).rejects.toThrow(/step.*attach.*next|partial|compensation/i);
  });
});

describe("closeCycleWithDisposition — move_to_next: closeCycle fails after issues moved → partial state reported", () => {
  it("returns errorResult naming closeCycle as the failed step and what completed", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    client.listCycles.mockResolvedValueOnce([
      {
        id: NEXT_CYCLE_ID,
        name: "Sprint 2",
        goal: null,
        state: "upcoming",
        startDate: "2026-04-15T00:00:00.000Z",
        endDate: "2026-04-28T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      } as KanonCycle,
    ]);
    // remove-from-current succeeds
    client.attachIssuesToCycle.mockResolvedValueOnce(detail);
    // add-to-next succeeds
    client.attachIssuesToCycle.mockResolvedValueOnce(detail);
    // closeCycle FAILS
    client.closeCycle.mockRejectedValueOnce(
      new KanonApiError(500, "SERVER_ERROR", "Internal error"),
    );

    await expect(
      closeCycleWithDisposition(client as unknown as KanonClient, {
        cycleId: CYCLE_ID,
        disposition: "move_to_next",
        projectKey: "KAN",
      }),
    ).rejects.toThrow(/step.*close|partial|issues.*moved/i);
  });
});

describe("closeCycleWithDisposition — move_to_backlog: closeCycle fails after detach → partial state reported", () => {
  it("rejects with an error naming closeCycle as failed step and listing detached keys", async () => {
    const client = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    client.getCycle.mockResolvedValueOnce(detail);
    // detach succeeds
    client.attachIssuesToCycle.mockResolvedValueOnce(detail);
    // closeCycle FAILS
    client.closeCycle.mockRejectedValueOnce(
      new KanonApiError(500, "SERVER_ERROR", "Internal error"),
    );

    await expect(
      closeCycleWithDisposition(client as unknown as KanonClient, {
        cycleId: CYCLE_ID,
        disposition: "move_to_backlog",
      }),
    ).rejects.toThrow(/step.*close|partial|detach/i);
  });
});

describe("close_cycle — partial-mutation: tool returns isError with partial state description", () => {
  it("closeCycle failure after move_to_next attach returns isError with step info in text", async () => {
    const mockClient = makeClient();
    const detail = makeDetail([
      { id: "i2", key: "KAN-2", title: "Open", state: "todo" },
    ]);
    mockClient.getCycle.mockResolvedValueOnce(detail);
    mockClient.listCycles.mockResolvedValueOnce([
      {
        id: NEXT_CYCLE_ID,
        name: "Sprint 2",
        goal: null,
        state: "upcoming",
        startDate: "2026-04-15T00:00:00.000Z",
        endDate: "2026-04-28T00:00:00.000Z",
        velocity: null,
        projectId: "proj_001",
        createdAt: "",
        updatedAt: "",
      } as KanonCycle,
    ]);
    mockClient.attachIssuesToCycle.mockResolvedValueOnce(detail);
    mockClient.attachIssuesToCycle.mockResolvedValueOnce(detail);
    mockClient.closeCycle.mockRejectedValueOnce(
      new KanonApiError(500, "SERVER_ERROR", "Internal error"),
    );

    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const closeTool = tools.get("close_cycle")!;

    const result = await closeTool.handler({
      cycleId: CYCLE_ID,
      disposition: "move_to_next",
      projectKey: "KAN",
    });

    expect(result.isError).toBe(true);
    // The error text must identify what completed (issues moved) and what failed (close)
    const text = result.content[0]!.text;
    expect(text.toLowerCase()).toMatch(/partial|step|moved|close/);
  });
});

describe("list_cycles — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      listCycles: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerCycleTools, mockClient as unknown as KanonClient);
    const handler = tools.get("list_cycles")!.handler;

    const result = await handler({ projectKey: "KAN" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});
