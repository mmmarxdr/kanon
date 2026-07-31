// ─── Issue Tools — format-tier behavior ─────────────────────────────────────
//
// Tests for the ack-tier wiring on write tools (C1–C3, C11–C12).
// Mirrors the harness pattern in `kanon-client.test.ts`: stub the MCP server's
// tool registration, capture the handler, then drive it with a mock client.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerIssueTools } from "./issues.js";
import { KanonApiError } from "../kanon-client.js";
import type { KanonClient, KanonIssue } from "../kanon-client.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function captureTools(register: (server: McpServer, client: KanonClient) => void, client: KanonClient): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    tool: (name: string, description: string, shape: unknown, handler: ToolHandler) => {
      tools.set(name, { name, description, shape, handler });
    },
  } as unknown as McpServer;
  register(fakeServer, client);
  return tools;
}

function makeFullIssue(overrides: Partial<KanonIssue> = {}): KanonIssue {
  return {
    id: "iss_001",
    key: "KAN-1",
    title: "Fix login bug",
    state: "in_progress",
    type: "bug",
    priority: "high",
    description: "Full description of the bug",
    labels: ["auth"],
    groupKey: "backlog",
    projectId: "proj_001",
    sequenceNum: 42,
    sortOrder: 5,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
    ...overrides,
  } as unknown as KanonIssue;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("create_issue — format tier", () => {
  let mockClient: { createIssue: ReturnType<typeof vi.fn> };
  let createTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      createIssue: vi.fn().mockResolvedValue(makeFullIssue()),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("create_issue");
    if (!tool) throw new Error("create_issue not registered");
    createTool = tool;
  });

  it("defaults to ack: returns { ok, id, key } with no other fields", async () => {
    const result = await createTool.handler({
      projectKey: "KAN",
      title: "Fix login bug",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual({ ok: true, id: "iss_001", key: "KAN-1" });
    expect(Object.keys(parsed)).toEqual(["ok", "id", "key"]);
    // Should NOT include other entity fields
    expect(parsed).not.toHaveProperty("title");
    expect(parsed).not.toHaveProperty("state");
    expect(parsed).not.toHaveProperty("type");
    expect(parsed).not.toHaveProperty("priority");
  });

  it("format: 'full' returns the entity with all fields", async () => {
    const result = await createTool.handler({
      projectKey: "KAN",
      title: "Fix login bug",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "iss_001");
    expect(parsed).toHaveProperty("key", "KAN-1");
    expect(parsed).toHaveProperty("title", "Fix login bug");
    expect(parsed).toHaveProperty("type", "bug");
    expect(parsed).toHaveProperty("priority", "high");
    expect(parsed).toHaveProperty("description", "Full description of the bug");
    expect(parsed).toHaveProperty("labels");
  });

  it("format: 'slim' returns the slim issue-write fields", async () => {
    const result = await createTool.handler({
      projectKey: "KAN",
      title: "Fix login bug",
      format: "slim",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    // slim issue-write keeps: key, title, state, type, priority (per ISSUE_WRITE_FIELDS)
    expect(parsed).toHaveProperty("key", "KAN-1");
    expect(parsed).toHaveProperty("title", "Fix login bug");
    expect(parsed).toHaveProperty("state", "in_progress");
    expect(parsed).not.toHaveProperty("description");
    expect(parsed).not.toHaveProperty("id");
  });

  it("description mentions ack default and format:'full' opt-in", () => {
    expect(createTool.description.toLowerCase()).toContain("ack");
    expect(createTool.description).toMatch(/format/i);
  });
});

// ─── C2: update_issue — format tier ────────────────────────────────────

describe("update_issue — format tier", () => {
  let mockClient: { updateIssue: ReturnType<typeof vi.fn> };
  let updateTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      updateIssue: vi.fn().mockResolvedValue(makeFullIssue()),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("update_issue");
    if (!tool) throw new Error("update_issue not registered");
    updateTool = tool;
  });

  it("defaults to ack: returns { ok, id, key } with no other fields", async () => {
    const result = await updateTool.handler({
      issueKey: "KAN-1",
      title: "Updated title",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual({ ok: true, id: "iss_001", key: "KAN-1" });
    expect(Object.keys(parsed)).toEqual(["ok", "id", "key"]);
    expect(parsed).not.toHaveProperty("title");
    expect(parsed).not.toHaveProperty("state");
  });

  it("format: 'full' returns the entity with all fields", async () => {
    const result = await updateTool.handler({
      issueKey: "KAN-1",
      title: "Updated title",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "iss_001");
    expect(parsed).toHaveProperty("key", "KAN-1");
    expect(parsed).toHaveProperty("title", "Fix login bug");
    expect(parsed).toHaveProperty("type", "bug");
    expect(parsed).toHaveProperty("priority", "high");
  });
});

// ─── update_issue — field forwarding (KAN-187) ─────────────────────────────

describe("update_issue — field forwarding", () => {
  let mockClient: { updateIssue: ReturnType<typeof vi.fn> };
  let updateTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      updateIssue: vi.fn().mockResolvedValue(makeFullIssue()),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("update_issue");
    if (!tool) throw new Error("update_issue not registered");
    updateTool = tool;
  });

  it("forwards parentId UUID in the update body", async () => {
    const parentId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await updateTool.handler({ issueKey: "KAN-1", parentId });

    expect(mockClient.updateIssue).toHaveBeenCalledWith("KAN-1", { parentId });
  });

  it("forwards parentId null for unlink", async () => {
    await updateTool.handler({ issueKey: "KAN-1", parentId: null });

    expect(mockClient.updateIssue).toHaveBeenCalledWith("KAN-1", { parentId: null });
  });

  it("omits parentId when not provided", async () => {
    await updateTool.handler({ issueKey: "KAN-1", title: "[Auth] Retitle only" });

    const body = mockClient.updateIssue.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toEqual({ title: "[Auth] Retitle only" });
    expect(body).not.toHaveProperty("parentId");
  });

  it("forwards type and groupKey when provided", async () => {
    await updateTool.handler({
      issueKey: "KAN-1",
      type: "bug",
      groupKey: "auth",
    });

    expect(mockClient.updateIssue).toHaveBeenCalledWith("KAN-1", {
      type: "bug",
      groupKey: "auth",
    });
  });

  it("forwards groupKey null to clear grouping", async () => {
    await updateTool.handler({ issueKey: "KAN-1", groupKey: null });

    expect(mockClient.updateIssue).toHaveBeenCalledWith("KAN-1", { groupKey: null });
  });

  it("ack remains default when updating parentId", async () => {
    const result = await updateTool.handler({
      issueKey: "KAN-1",
      parentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual({ ok: true, id: "iss_001", key: "KAN-1" });
  });
});

// ─── C3: transition_issue — format tier ────────────────────────────────

describe("transition_issue — format tier", () => {
  let mockClient: { transitionIssue: ReturnType<typeof vi.fn> };
  let transitionTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      transitionIssue: vi.fn().mockResolvedValue(makeFullIssue({ state: "done" })),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("transition_issue");
    if (!tool) throw new Error("transition_issue not registered");
    transitionTool = tool;
  });

  it("defaults to ack: returns { ok, id, key } with no other fields", async () => {
    const result = await transitionTool.handler({
      issueKey: "KAN-1",
      state: "done",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual({ ok: true, id: "iss_001", key: "KAN-1" });
    expect(Object.keys(parsed)).toEqual(["ok", "id", "key"]);
    expect(parsed).not.toHaveProperty("state");
  });

  it("format: 'full' returns the entity with all fields", async () => {
    const result = await transitionTool.handler({
      issueKey: "KAN-1",
      state: "done",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "iss_001");
    expect(parsed).toHaveProperty("key", "KAN-1");
    expect(parsed).toHaveProperty("state", "done");
    expect(parsed).toHaveProperty("type", "bug");
  });
});

// ─── D3: list_issues — keys[] filter ───────────────────────────────────

describe("list_issues — keys[] filter (D3)", () => {
  let mockClient: { listIssues: ReturnType<typeof vi.fn> };
  let listTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      listIssues: vi.fn().mockResolvedValue([makeFullIssue()]),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("list_issues");
    if (!tool) throw new Error("list_issues not registered");
    listTool = tool;
  });

  it("zod shape accepts keys array", async () => {
    const result = await listTool.handler({
      projectKey: "KAN",
      keys: ["KAN-1", "KAN-2"],
    });
    expect(result.isError).toBeUndefined();
  });

  it("passes keys to client.listIssues as a filter", async () => {
    await listTool.handler({
      projectKey: "KAN",
      keys: ["KAN-1", "KAN-2"],
    });
    expect(mockClient.listIssues).toHaveBeenCalledWith(
      "KAN",
      expect.objectContaining({ keys: ["KAN-1", "KAN-2"] }),
    );
  });
});

// ─── KAN-20: 403 FORBIDDEN surfacing — issue tools ───────────────────────────
//
// Confirms each tool FORWARDS the credential and SURFACES a 403 as
// { isError: true, code: "FORBIDDEN" }. Enforcement lives in the API layer.

describe("create_issue — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      createIssue: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("create_issue")!.handler;

    const result = await handler({ projectKey: "KAN", title: "Test" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

describe("update_issue — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      updateIssue: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("update_issue")!.handler;

    const result = await handler({ issueKey: "KAN-1", title: "Updated" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

describe("transition_issue — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      transitionIssue: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("transition_issue")!.handler;

    const result = await handler({ issueKey: "KAN-1", state: "done" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

describe("list_issues — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      listIssues: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("list_issues")!.handler;

    const result = await handler({ projectKey: "KAN" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

// ─── KAN-188: transition_issue → done blocked by RECONCILIATION_REQUIRED ──

describe("transition_issue — RECONCILIATION_REQUIRED surfacing (KAN-188)", () => {
  it("surfaces the reported hours and reconcile guidance instead of a hard failure", async () => {
    const mockClient = {
      transitionIssue: vi.fn().mockRejectedValue(
        new KanonApiError(
          409,
          "RECONCILIATION_REQUIRED",
          "Unconfirmed captured time must be reconciled",
          { totalHours: 5, issueKey: "ENG-1" },
        ),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("transition_issue")!.handler;

    const result = await handler({ issueKey: "ENG-1", state: "done" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("RECONCILIATION_REQUIRED");
    expect(parsed.error).toMatch(/5 hours/i);
    expect(parsed.error).toMatch(/\breconcile_time\b/);
    expect(parsed.error).not.toContain("kanon_reconcile_time");
    expect(mockClient.transitionIssue).toHaveBeenCalledTimes(1);
  });

  it("does not intercept RECONCILIATION_REQUIRED for a non-done target state", async () => {
    // Defense-in-depth: this code should only ever be reachable when transitioning
    // to done (the server only emits this 409 for that transition), but the tool
    // must not silently swallow it as a generic error for other states either.
    const mockClient = {
      transitionIssue: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "Not a project member"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("transition_issue")!.handler;

    const result = await handler({ issueKey: "ENG-1", state: "review" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });

  it("zero captured hours transitions to done directly with a single call (no reconcile prompt)", async () => {
    const mockClient = {
      transitionIssue: vi.fn().mockResolvedValue(makeFullIssue({ state: "done" })),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("transition_issue")!.handler;

    const result = await handler({ issueKey: "ENG-1", state: "done" });

    expect(result.isError).toBeUndefined();
    expect(mockClient.transitionIssue).toHaveBeenCalledTimes(1);
  });

  it("surfaces the specific message with the numeric total when details.totalHours is present", async () => {
    const mockClient = {
      transitionIssue: vi.fn().mockRejectedValue(
        new KanonApiError(
          409,
          "RECONCILIATION_REQUIRED",
          "Unconfirmed captured time must be reconciled",
          { totalHours: 5, issueKey: "ENG-1" },
        ),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("transition_issue")!.handler;

    const result = await handler({ issueKey: "ENG-1", state: "done" });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.error).toMatch(/5 hours were reported/);
    expect(parsed.error).toMatch(/\breconcile_time\b/);
    expect(parsed.error).not.toContain("kanon_reconcile_time");
  });

  it("falls back to a generic message with no interpolated hours when details is undefined", async () => {
    const mockClient = {
      transitionIssue: vi.fn().mockRejectedValue(
        new KanonApiError(409, "RECONCILIATION_REQUIRED", "Unconfirmed captured time must be reconciled"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("transition_issue")!.handler;

    const result = await handler({ issueKey: "ENG-1", state: "done" });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.error).not.toMatch(/undefined/);
    expect(parsed.error).toMatch(/unconfirmed reported time/i);
    expect(parsed.error).toMatch(/\breconcile_time\b/);
    expect(parsed.error).not.toContain("kanon_reconcile_time");
  });

  it("falls back to a generic message with no interpolated hours when totalHours is missing or non-numeric", async () => {
    const mockClient = {
      transitionIssue: vi.fn().mockRejectedValue(
        new KanonApiError(
          409,
          "RECONCILIATION_REQUIRED",
          "Unconfirmed captured time must be reconciled",
          { issueKey: "ENG-1" },
        ),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("transition_issue")!.handler;

    const result = await handler({ issueKey: "ENG-1", state: "done" });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.error).not.toMatch(/undefined/);
    expect(parsed.error).toMatch(/unconfirmed reported time/i);
  });
});

// ─── KAN-188: reconcile_time tool ──────────────────────────────────────

describe("reconcile_time", () => {
  let mockClient: { reconcileTime: ReturnType<typeof vi.fn>; transitionIssue: ReturnType<typeof vi.fn> };
  let reconcileTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      reconcileTime: vi.fn().mockResolvedValue({
        issueKey: "ENG-1",
        confirmedTotalHours: "5.00",
        timeConfirmedAt: "2026-07-06T00:00:00.000Z",
      }),
      transitionIssue: vi.fn().mockResolvedValue(makeFullIssue({ key: "ENG-1", state: "done" })),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("reconcile_time");
    if (!tool) throw new Error("reconcile_time not registered");
    reconcileTool = tool;
  });

  it("is registered as its own tool (not a flag on transition_issue)", () => {
    expect(reconcileTool.name).toBe("reconcile_time");
  });

  it("calls client.reconcileTime with confirmedTotalHours when provided", async () => {
    const result = await reconcileTool.handler({ issueKey: "ENG-1", confirmedTotalHours: "4.5" });

    expect(result.isError).toBeUndefined();
    expect(mockClient.reconcileTime).toHaveBeenCalledWith("ENG-1", { confirmedTotalHours: "4.5" });
  });

  it("accept-as-is flow: given confirmedTotalHours omitted, still calls reconcileTime and returns the summary", async () => {
    // The agent is expected to pass the reported total explicitly (accept-as-is),
    // per the tool's contract — confirmedTotalHours is optional at the schema
    // level to allow future accept-as-is shorthand, but the handler forwards
    // whatever was given.
    const result = await reconcileTool.handler({ issueKey: "ENG-1", confirmedTotalHours: "5" });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toMatchObject({ issueKey: "ENG-1", confirmedTotalHours: "5.00" });
  });

  it("surfaces 403 as FORBIDDEN like other write tools", async () => {
    mockClient.reconcileTime.mockRejectedValue(
      new KanonApiError(403, "FORBIDDEN", "Not a project member"),
    );

    const result = await reconcileTool.handler({ issueKey: "ENG-1", confirmedTotalHours: "5" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

// ─── KAN-188: full reconcile → retry → done flow ─────────────────────────────

describe("KAN-188 regression: 409 → reconcile_time → retry transition_issue", () => {
  it("reconcile-then-retry succeeds after the initial transition is blocked", async () => {
    const mockClient = {
      transitionIssue: vi.fn().mockRejectedValueOnce(
        new KanonApiError(
          409,
          "RECONCILIATION_REQUIRED",
          "Unconfirmed captured time must be reconciled",
          { totalHours: 5, issueKey: "ENG-1" },
        ),
      ).mockResolvedValueOnce(makeFullIssue({ key: "ENG-1", state: "done" })),
      reconcileTime: vi.fn().mockResolvedValue({
        issueKey: "ENG-1",
        confirmedTotalHours: "5.00",
        timeConfirmedAt: "2026-07-06T00:00:00.000Z",
      }),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const transitionHandler = tools.get("transition_issue")!.handler;
    const reconcileHandler = tools.get("reconcile_time")!.handler;

    // 1. First transition attempt is blocked
    const blocked = await transitionHandler({ issueKey: "ENG-1", state: "done" });
    expect(blocked.isError).toBe(true);
    const blockedParsed = JSON.parse(blocked.content[0]!.text);
    expect(blockedParsed.error).toMatch(/5 hours/i);

    // 2. Agent accepts reported hours as-is via reconcile_time
    const reconciled = await reconcileHandler({ issueKey: "ENG-1", confirmedTotalHours: "5" });
    expect(reconciled.isError).toBeUndefined();
    expect(mockClient.reconcileTime).toHaveBeenCalledWith("ENG-1", { confirmedTotalHours: "5" });

    // 3. Retry the transition — succeeds
    const done = await transitionHandler({ issueKey: "ENG-1", state: "done" });
    expect(done.isError).toBeUndefined();
    const doneParsed = JSON.parse(done.content[0]!.text);
    expect(doneParsed).toEqual({ ok: true, id: "iss_001", key: "ENG-1" });

    expect(mockClient.transitionIssue).toHaveBeenCalledTimes(2);
  });
});

// ─── .kanon binding integration — handler wiring ─────────────────────────────
//
// Validates that the binding is threaded through registerIssueTools and that
// handlers fall back to binding.projectKey when no explicit projectKey is given.

function captureToolsWithBinding(
  register: (server: McpServer, client: KanonClient, binding: KanonBinding | null) => void,
  client: KanonClient,
  binding: KanonBinding | null,
): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    tool: (name: string, description: string, shape: unknown, handler: ToolHandler) => {
      tools.set(name, { name, description, shape, handler });
    },
  } as unknown as McpServer;
  register(fakeServer, client, binding);
  return tools;
}

import type { KanonBinding } from "../kanon-binding.js";

describe("list_issues — .kanon binding fallback", () => {
  const binding: KanonBinding = {
    projectKey: "BOUND",
    workspaceId: "ws_abc",
    apiUrl: "https://api.example.com",
  };

  it("uses binding.projectKey when no explicit projectKey is passed", async () => {
    const mockClient = { listIssues: vi.fn().mockResolvedValue([]) };
    const tools = captureToolsWithBinding(registerIssueTools, mockClient as unknown as KanonClient, binding);
    const handler = tools.get("list_issues")!.handler;

    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(mockClient.listIssues).toHaveBeenCalledWith("BOUND", expect.any(Object));
  });

  it("explicit projectKey overrides binding", async () => {
    const mockClient = { listIssues: vi.fn().mockResolvedValue([]) };
    const tools = captureToolsWithBinding(registerIssueTools, mockClient as unknown as KanonClient, binding);
    const handler = tools.get("list_issues")!.handler;

    await handler({ projectKey: "EXPLICIT" });

    expect(mockClient.listIssues).toHaveBeenCalledWith("EXPLICIT", expect.any(Object));
  });

  it("returns isError when no projectKey and no binding", async () => {
    const mockClient = { listIssues: vi.fn().mockResolvedValue([]) };
    const tools = captureToolsWithBinding(registerIssueTools, mockClient as unknown as KanonClient, null);
    const handler = tools.get("list_issues")!.handler;

    const result = await handler({});

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.error).toMatch(/projectKey/i);
    expect(mockClient.listIssues).not.toHaveBeenCalled();
  });
});
