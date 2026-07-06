// ─── Group Tools — format-tier behavior ──────────────────────────────────────
//
// C4: kanon_batch_transition — ack-default + format:full regression

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGroupTools } from "./groups.js";
import { KanonApiError } from "../kanon-client.js";
import type { KanonClient } from "../kanon-client.js";

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

// ─── D9: kanon_batch_transition — keys-mode XOR validation ───────────────────

describe("kanon_batch_transition — keys-mode XOR validation (D9)", () => {
  let mockClient: {
    batchTransition: ReturnType<typeof vi.fn>;
    batchTransitionByKeys: ReturnType<typeof vi.fn>;
  };
  let batchTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      batchTransition: vi.fn().mockResolvedValue([]),
      batchTransitionByKeys: vi.fn().mockResolvedValue({ count: 2, keys: ["KAN-1", "KAN-2"] }),
    };
    const tools = captureTools(registerGroupTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_batch_transition");
    if (!tool) throw new Error("kanon_batch_transition not registered");
    batchTool = tool;
  });

  it("accepts groupKey-only input and routes to batchTransition", async () => {
    const result = await batchTool.handler({
      projectKey: "KAN",
      groupKey: "backlog",
      state: "done",
    });
    expect(result.isError).toBeUndefined();
    expect(mockClient.batchTransition).toHaveBeenCalled();
    expect(mockClient.batchTransitionByKeys).not.toHaveBeenCalled();
  });

  it("accepts keys-only input and routes to batchTransitionByKeys", async () => {
    const result = await batchTool.handler({
      projectKey: "KAN",
      keys: ["KAN-1", "KAN-2"],
      state: "done",
    });
    expect(result.isError).toBeUndefined();
    expect(mockClient.batchTransitionByKeys).toHaveBeenCalledWith(
      "KAN",
      ["KAN-1", "KAN-2"],
      "done",
    );
    expect(mockClient.batchTransition).not.toHaveBeenCalled();
  });

  it("returns error when both groupKey and keys are provided", async () => {
    const result = await batchTool.handler({
      projectKey: "KAN",
      groupKey: "backlog",
      keys: ["KAN-1"],
      state: "done",
    });
    expect(result.isError).toBe(true);
  });

  it("returns error when neither groupKey nor keys are provided", async () => {
    const result = await batchTool.handler({
      projectKey: "KAN",
      state: "done",
    });
    expect(result.isError).toBe(true);
  });
});

// ─── C4: kanon_batch_transition — format tier ────────────────────────────────

describe("kanon_batch_transition — format tier", () => {
  // Simulated result from the API (could be array or {count, keys} shape)
  const fakeResult = [
    { id: "i1", key: "KAN-1", state: "done" },
    { id: "i2", key: "KAN-2", state: "done" },
  ];

  let mockClient: { batchTransition: ReturnType<typeof vi.fn> };
  let batchTool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      batchTransition: vi.fn().mockResolvedValue(fakeResult),
    };
    const tools = captureTools(registerGroupTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_batch_transition");
    if (!tool) throw new Error("kanon_batch_transition not registered");
    batchTool = tool;
  });

  it("defaults to ack: returns { ok, count, keys }", async () => {
    const result = await batchTool.handler({
      projectKey: "KAN",
      groupKey: "backlog",
      state: "done",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("count");
    expect(parsed).not.toHaveProperty("title");
    expect(parsed).not.toHaveProperty("state");
  });

  it("format: 'full' returns the raw result from client", async () => {
    const result = await batchTool.handler({
      projectKey: "KAN",
      groupKey: "backlog",
      state: "done",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    // full returns raw result (array or object)
    expect(parsed).not.toHaveProperty("ok");
  });
});

// ─── KAN-188 regression pin: batch reconcile-gate is not made worse ──────────
//
// kanon_batch_transition does not yet have reconcile-aware 409 handling
// (full batch reconcile-awareness is deferred, tracked separately). This
// test pins the current "no worse than before" contract: when the
// underlying batch call rejects with RECONCILIATION_REQUIRED, the tool
// surfaces it via the existing errorResult path — it must not crash and
// must not report the transition as having succeeded.

describe("kanon_batch_transition — RECONCILIATION_REQUIRED regression pin (KAN-188)", () => {
  it("surfaces a RECONCILIATION_REQUIRED 409 via errorResult without crashing or reporting success", async () => {
    const mockClient = {
      batchTransition: vi.fn().mockRejectedValue(
        new KanonApiError(
          409,
          "RECONCILIATION_REQUIRED",
          "Unconfirmed captured time must be reconciled",
          { blockedIssues: [{ issueKey: "KAN-1", totalHours: 5 }] },
        ),
      ),
    };
    const tools = captureTools(registerGroupTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_batch_transition");
    if (!tool) throw new Error("kanon_batch_transition not registered");

    const result = await tool.handler({
      projectKey: "KAN",
      groupKey: "backlog",
      state: "done",
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("RECONCILIATION_REQUIRED");
    expect(parsed).not.toHaveProperty("ok", true);
  });
});
