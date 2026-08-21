// ─── Work Session Tools — format-tier behavior ───────────────────────────────
//
// C16: start_work — ack default
// C17: stop_work — ack default

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkSessionTools } from "./work-sessions.js";
import type { KanonClient } from "../kanon-client.js";

// Mock heartbeat module at the top level (hoisted by vitest automatically)
vi.mock("../heartbeat.js", () => ({
  startAutoHeartbeat: vi.fn(),
  stopAutoHeartbeat: vi.fn(),
  closeTrackedCapture: vi.fn(async (issueKey: string, client: KanonClient) =>
    client.stopWork(issueKey)
  ),
}));

import * as heartbeatMod from "../heartbeat.js";

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
  client: KanonClient
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
  session: {
    id: "ws_001",
    issueKey: "KAN-1",
    startedAt: "2026-04-28T12:00:00Z",
  },
  autoAssigned: false,
  warnings: [],
  captureIntent: null,
};

const fakeStopResult = {
  ok: true,
  deleted: true,
  workLog: { id: "wl-1", durationS: 90 },
};

const fakeStopResultNoLog = {
  ok: true,
  deleted: true,
  workLog: null,
};

// ─── C16: start_work — format tier ─────────────────────────────────────

describe("start_work — format tier (C16)", () => {
  let mockClient: {
    startWork: ReturnType<typeof vi.fn>;
  };
  let startTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      startWork: vi.fn().mockResolvedValue(fakeStartResult),
    };
    const tools = captureTools(registerWorkSessionTools, mockClient as unknown as KanonClient);
    const tool = tools.get("start_work");
    if (!tool) throw new Error("start_work not registered");
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

// ─── C17: stop_work — format tier ──────────────────────────────────────

describe("stop_work — format tier (C17)", () => {
  let mockClient: {
    stopWork: ReturnType<typeof vi.fn>;
  };
  let stopTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      stopWork: vi.fn().mockResolvedValue(fakeStopResult),
    };
    const tools = captureTools(registerWorkSessionTools, mockClient as unknown as KanonClient);
    const tool = tools.get("stop_work");
    if (!tool) throw new Error("stop_work not registered");
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

  it("includes logged: true and durationSeconds when WorkLog captured (≥ 60s session)", async () => {
    // fakeStopResult.workLog is non-null (90s session)
    const result = await stopTool.handler({ issue_key: "KAN-1" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("logged", true);
    expect(parsed).toHaveProperty("durationSeconds", 90);
  });

  it("includes logged: false and no durationSeconds when no WorkLog captured (< 60s session)", async () => {
    // Override mock to return no workLog
    mockClient.stopWork = vi.fn().mockResolvedValue(fakeStopResultNoLog);
    const tools = captureTools(registerWorkSessionTools, mockClient as unknown as KanonClient);
    const tool = tools.get("stop_work")!;

    const result = await tool.handler({ issue_key: "KAN-1" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("logged", false);
    expect(parsed).not.toHaveProperty("durationSeconds");
  });
});

describe("KAN-243 versioned work-session capture policy", () => {
  const captureIntent = {
    epoch: "550e8400-e29b-41d4-a716-446655440000",
    leaseGeneration: 1,
    state: "capturing" as const,
  };

  beforeEach(() => {
    vi.mocked(heartbeatMod.startAutoHeartbeat).mockReset();
    vi.mocked(heartbeatMod.closeTrackedCapture).mockReset();
  });

  it("adopts the start snapshot without asking for a duplicate immediate heartbeat", async () => {
    const client = {
      startWork: vi.fn().mockResolvedValue({
        session: { id: "session-1" },
        warnings: [],
        autoAssigned: false,
        captureIntent,
      }),
    };
    const tool = captureTools(registerWorkSessionTools, client as unknown as KanonClient).get(
      "start_work"
    )!;

    const result = await tool.handler({ issue_key: "KAN-1" });

    expect(result.isError).toBeUndefined();
    expect(heartbeatMod.startAutoHeartbeat).toHaveBeenCalledWith("KAN-1", client, captureIntent);
  });

  it("rejects a successful start response with a null session and does not register capture", async () => {
    const client = {
      startWork: vi.fn().mockResolvedValue({
        session: null,
        warnings: [],
        autoAssigned: false,
        captureIntent,
      }),
    };
    const tool = captureTools(registerWorkSessionTools, client as unknown as KanonClient).get(
      "start_work"
    )!;

    const result = await tool.handler({ issue_key: "KAN-1" });

    expect(result.isError).toBe(true);
    expect(heartbeatMod.startAutoHeartbeat).not.toHaveBeenCalled();
  });

  it("returns the durable close acknowledgement when a fence is tracked", async () => {
    const accepted = {
      ok: true as const,
      commandId: "550e8400-e29b-41d4-a716-446655440001",
      deliveryStatus: "pending" as const,
      captureIntent: { ...captureIntent, state: "closing" as const },
    };
    vi.mocked(heartbeatMod.closeTrackedCapture).mockResolvedValue(accepted as any);
    const client = {} as KanonClient;
    const tool = captureTools(registerWorkSessionTools, client).get("stop_work")!;

    const result = await tool.handler({ issue_key: "KAN-1" });

    expect(JSON.parse(result.content[0]!.text)).toEqual({
      ok: true,
      issueKey: "KAN-1",
      action: "close_requested",
      commandId: accepted.commandId,
      deliveryStatus: "pending",
      captureIntent: accepted.captureIntent,
    });
  });
});
