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

describe("kanon_create_issue — format tier", () => {
  let mockClient: { createIssue: ReturnType<typeof vi.fn> };
  let createTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      createIssue: vi.fn().mockResolvedValue(makeFullIssue()),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_create_issue");
    if (!tool) throw new Error("kanon_create_issue not registered");
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

// ─── C2: kanon_update_issue — format tier ────────────────────────────────────

describe("kanon_update_issue — format tier", () => {
  let mockClient: { updateIssue: ReturnType<typeof vi.fn> };
  let updateTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      updateIssue: vi.fn().mockResolvedValue(makeFullIssue()),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_update_issue");
    if (!tool) throw new Error("kanon_update_issue not registered");
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

// ─── C3: kanon_transition_issue — format tier ────────────────────────────────

describe("kanon_transition_issue — format tier", () => {
  let mockClient: { transitionIssue: ReturnType<typeof vi.fn> };
  let transitionTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      transitionIssue: vi.fn().mockResolvedValue(makeFullIssue({ state: "done" })),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_transition_issue");
    if (!tool) throw new Error("kanon_transition_issue not registered");
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

// ─── D3: kanon_list_issues — keys[] filter ───────────────────────────────────

describe("kanon_list_issues — keys[] filter (D3)", () => {
  let mockClient: { listIssues: ReturnType<typeof vi.fn> };
  let listTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      listIssues: vi.fn().mockResolvedValue([makeFullIssue()]),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_list_issues");
    if (!tool) throw new Error("kanon_list_issues not registered");
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

describe("kanon_create_issue — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      createIssue: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("kanon_create_issue")!.handler;

    const result = await handler({ projectKey: "KAN", title: "Test" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

describe("kanon_update_issue — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      updateIssue: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("kanon_update_issue")!.handler;

    const result = await handler({ issueKey: "KAN-1", title: "Updated" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

describe("kanon_transition_issue — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      transitionIssue: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("kanon_transition_issue")!.handler;

    const result = await handler({ issueKey: "KAN-1", state: "done" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

describe("kanon_list_issues — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      listIssues: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerIssueTools, mockClient as unknown as KanonClient);
    const handler = tools.get("kanon_list_issues")!.handler;

    const result = await handler({ projectKey: "KAN" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
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

describe("kanon_list_issues — .kanon binding fallback", () => {
  const binding: KanonBinding = {
    projectKey: "BOUND",
    workspaceId: "ws_abc",
    apiUrl: "https://api.example.com",
  };

  it("uses binding.projectKey when no explicit projectKey is passed", async () => {
    const mockClient = { listIssues: vi.fn().mockResolvedValue([]) };
    const tools = captureToolsWithBinding(registerIssueTools, mockClient as unknown as KanonClient, binding);
    const handler = tools.get("kanon_list_issues")!.handler;

    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(mockClient.listIssues).toHaveBeenCalledWith("BOUND", expect.any(Object));
  });

  it("explicit projectKey overrides binding", async () => {
    const mockClient = { listIssues: vi.fn().mockResolvedValue([]) };
    const tools = captureToolsWithBinding(registerIssueTools, mockClient as unknown as KanonClient, binding);
    const handler = tools.get("kanon_list_issues")!.handler;

    await handler({ projectKey: "EXPLICIT" });

    expect(mockClient.listIssues).toHaveBeenCalledWith("EXPLICIT", expect.any(Object));
  });

  it("returns isError when no projectKey and no binding", async () => {
    const mockClient = { listIssues: vi.fn().mockResolvedValue([]) };
    const tools = captureToolsWithBinding(registerIssueTools, mockClient as unknown as KanonClient, null);
    const handler = tools.get("kanon_list_issues")!.handler;

    const result = await handler({});

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.error).toMatch(/projectKey/i);
    expect(mockClient.listIssues).not.toHaveBeenCalled();
  });
});
