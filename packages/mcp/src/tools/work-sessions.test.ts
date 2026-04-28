// ─── Work Session Tools — format-tier behavior ───────────────────────────────
//
// C16: kanon_start_work — ack default
// C17: kanon_stop_work — ack default

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkSessionTools } from "./work-sessions.js";
import type { KanonClient } from "../kanon-client.js";

// Mock heartbeat module at the top level (hoisted by vitest automatically)
vi.mock("../heartbeat.js", () => ({
  startAutoHeartbeat: vi.fn(),
  stopAutoHeartbeat: vi.fn(),
}));

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

const fakeStartResult = {
  id: "ws_001",
  issueKey: "KAN-1",
  startedAt: "2026-04-28T12:00:00Z",
  autoAssigned: false,
  warnings: [],
};

const fakeStopResult = {
  deleted: true,
  issueKey: "KAN-1",
};

// ─── C16: kanon_start_work — format tier ─────────────────────────────────────

describe("kanon_start_work — format tier (C16)", () => {
  let mockClient: {
    startWork: ReturnType<typeof vi.fn>;
  };
  let startTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      startWork: vi.fn().mockResolvedValue(fakeStartResult),
    };
    const tools = captureTools(registerWorkSessionTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_start_work");
    if (!tool) throw new Error("kanon_start_work not registered");
    startTool = tool;
  });

  it("defaults to ack: returns { ok, sessionId, action: 'started' }", async () => {
    const result = await startTool.handler({ issue_key: "KAN-1" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("sessionId");
    expect(parsed).toHaveProperty("action", "started");
    expect(parsed).not.toHaveProperty("autoAssigned");
    expect(parsed).not.toHaveProperty("warnings");
  });
});

// ─── C17: kanon_stop_work — format tier ──────────────────────────────────────

describe("kanon_stop_work — format tier (C17)", () => {
  let mockClient: {
    stopWork: ReturnType<typeof vi.fn>;
  };
  let stopTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      stopWork: vi.fn().mockResolvedValue(fakeStopResult),
    };
    const tools = captureTools(registerWorkSessionTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_stop_work");
    if (!tool) throw new Error("kanon_stop_work not registered");
    stopTool = tool;
  });

  it("defaults to ack: returns { ok, deleted, issueKey }", async () => {
    const result = await stopTool.handler({ issue_key: "KAN-1" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("deleted", true);
    expect(parsed).toHaveProperty("issueKey", "KAN-1");
  });
});
