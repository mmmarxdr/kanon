// ─── kanon_create_issue — format-tier behavior ──────────────────────────────
//
// Proof-of-concept tests for the ack-tier wiring on a single write tool.
// Mirrors the harness pattern in `kanon-client.test.ts`: stub the MCP server's
// tool registration, capture the handler, then drive it with a mock client.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerIssueTools } from "./issues.js";
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
    dueDate: "2026-04-01",
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
