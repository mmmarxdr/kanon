// ─── Capture Tools — unit tests ───────────────────────────────────────────────
//
// Tools covered:
//   kanon_report_incident  (AC4)
//   kanon_propose_estimate (AC1)
//   kanon_apply_proposal   (AC1 confirm step)
//
// Pattern mirrors timesheet.test.ts — captureTools() harness + mocked KanonClient.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCaptureTools, CAPTURE_DEFERRED_TOOLS } from "./capture.js";
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

// ─── Fixtures ───────────────────────────────────────────────────────────────

const fakeIssue = {
  id: "issue-uuid-1",
  key: "KAN-99",
  title: "[Ops] Production database down",
  type: "incident",
  state: "todo",
  priority: "high",
};

const fakeSession = {
  session: { id: "ws-uuid-1", issueKey: "KAN-99", startedAt: "2026-06-22T10:00:00Z" },
  warnings: [],
  autoAssigned: true,
};

const fakeProposal = {
  id: "prop-uuid-1",
  workspaceId: "ws-uuid-1",
  kind: "generic",
  title: "Estimate KAN-42 at 3 hours",
  status: "pending",
  payload: { kind: "estimate", issueKey: "KAN-42", estimateHours: 3 },
  proposedAt: "2026-06-22T10:00:00Z",
};

const fakeAppliedProposal = {
  ...fakeProposal,
  status: "applied",
  appliedAt: "2026-06-22T10:01:00Z",
};

// ─── Registration test ───────────────────────────────────────────────────────

describe("registerCaptureTools — registration", () => {
  it("registers all 3 capture tools", () => {
    const mockClient = {} as unknown as KanonClient;
    const tools = captureTools(registerCaptureTools, mockClient);

    expect(tools.has("kanon_report_incident")).toBe(true);
    expect(tools.has("kanon_propose_estimate")).toBe(true);
    expect(tools.has("kanon_apply_proposal")).toBe(true);
    expect(tools.size).toBe(3);
  });

  it("CAPTURE_DEFERRED_TOOLS contains report_incident, propose_estimate, apply_proposal", () => {
    expect(CAPTURE_DEFERRED_TOOLS).toContain("kanon_report_incident");
    expect(CAPTURE_DEFERRED_TOOLS).toContain("kanon_propose_estimate");
    expect(CAPTURE_DEFERRED_TOOLS).toContain("kanon_apply_proposal");
  });
});

// ─── kanon_report_incident ───────────────────────────────────────────────────

describe("kanon_report_incident", () => {
  let mockClient: {
    createIssue: ReturnType<typeof vi.fn>;
    startWork: ReturnType<typeof vi.fn>;
  };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      createIssue: vi.fn().mockResolvedValue(fakeIssue),
      startWork: vi.fn().mockResolvedValue(fakeSession),
    };
    const tools = captureTools(registerCaptureTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_report_incident");
    if (!t) throw new Error("kanon_report_incident not registered");
    tool = t;
  });

  it("happy path: createIssue is called before startWork (order matters)", async () => {
    const callOrder: string[] = [];
    mockClient.createIssue = vi.fn().mockImplementation(async () => {
      callOrder.push("createIssue");
      return fakeIssue;
    });
    mockClient.startWork = vi.fn().mockImplementation(async () => {
      callOrder.push("startWork");
      return fakeSession;
    });

    await tool.handler({ projectKey: "KAN", title: "[Ops] Production database down" });

    expect(callOrder).toEqual(["createIssue", "startWork"]);
  });

  it("forces issue type to 'incident' regardless of input", async () => {
    await tool.handler({ projectKey: "KAN", title: "[Ops] DB down", description: "DB is down" });

    const createCall = mockClient.createIssue.mock.calls[0] as [string, Record<string, unknown>];
    expect(createCall[1]).toHaveProperty("type", "incident");
  });

  it("starts work on the newly created issue key", async () => {
    await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    expect(mockClient.startWork).toHaveBeenCalledWith("KAN-99", "mcp");
  });

  it("returns issueKey and sessionId on success", async () => {
    const result = await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("issueKey", "KAN-99");
    expect(parsed).toHaveProperty("sessionId");
    expect(parsed).toHaveProperty("ok", true);
  });

  it("passes optional description to createIssue", async () => {
    await tool.handler({
      projectKey: "KAN",
      title: "[Ops] DB down",
      description: "Postgres primary is unreachable",
    });

    const createCall = mockClient.createIssue.mock.calls[0] as [string, Record<string, unknown>];
    expect(createCall[1]).toHaveProperty("description", "Postgres primary is unreachable");
  });

  it("passes optional groupKey to createIssue", async () => {
    await tool.handler({
      projectKey: "KAN",
      title: "[Ops] DB down",
      groupKey: "ops-incidents",
    });

    const createCall = mockClient.createIssue.mock.calls[0] as [string, Record<string, unknown>];
    expect(createCall[1]).toHaveProperty("groupKey", "ops-incidents");
  });

  it("error path: startWork fails after issue created → error names the issue key", async () => {
    mockClient.startWork = vi.fn().mockRejectedValue(new Error("session conflict"));

    const result = await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    // Error must surface the created issue key so it's not silently orphaned
    expect(parsed.error).toContain("KAN-99");
  });

  it("error path: createIssue fails → returns errorResult (no startWork called)", async () => {
    mockClient.createIssue = vi.fn().mockRejectedValue(new Error("project not found"));

    const result = await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    expect(result.isError).toBe(true);
    expect(mockClient.startWork).not.toHaveBeenCalled();
  });
});

// ─── kanon_propose_estimate ──────────────────────────────────────────────────

describe("kanon_propose_estimate", () => {
  let mockClient: {
    createProposal: ReturnType<typeof vi.fn>;
  };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      createProposal: vi.fn().mockResolvedValue(fakeProposal),
    };
    const tools = captureTools(registerCaptureTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_propose_estimate");
    if (!t) throw new Error("kanon_propose_estimate not registered");
    tool = t;
  });

  it("happy path: creates a pending generic proposal with estimate payload", async () => {
    const result = await tool.handler({
      workspaceId: "ws-uuid-1",
      issueKey: "KAN-42",
      estimateHours: 3,
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "prop-uuid-1");
    expect(parsed).toHaveProperty("status", "pending");
  });

  it("calls createProposal with kind:generic and estimate payload — does NOT write estimate directly", async () => {
    await tool.handler({
      workspaceId: "ws-uuid-1",
      issueKey: "KAN-42",
      estimateHours: 3,
    });

    expect(mockClient.createProposal).toHaveBeenCalledOnce();
    const [wsId, body] = mockClient.createProposal.mock.calls[0] as [string, Record<string, unknown>];
    expect(wsId).toBe("ws-uuid-1");
    expect(body).toHaveProperty("kind", "generic");
    expect(body).toHaveProperty("payload");
    const payload = body["payload"] as Record<string, unknown>;
    expect(payload).toHaveProperty("kind", "estimate");
    expect(payload).toHaveProperty("issueKey", "KAN-42");
    expect(payload).toHaveProperty("estimateHours", 3);
    // targetRef ties the proposal to the issue so the KAN-116 dedup index
    // rejects a second pending estimate for the same issue (NULL targetRef
    // would bypass the partial unique index entirely).
    expect(body).toHaveProperty("targetRef", "estimate:KAN-42");
    // Must NOT directly update the issue
    expect(body).not.toHaveProperty("hours");
    expect(body).not.toHaveProperty("estimate");
  });

  it("passes optional rationale as reason field", async () => {
    await tool.handler({
      workspaceId: "ws-uuid-1",
      issueKey: "KAN-42",
      estimateHours: 5,
      rationale: "Based on similar past work",
    });

    const [, body] = mockClient.createProposal.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toHaveProperty("reason", "Based on similar past work");
  });

  it("error path: createProposal throws → returns errorResult", async () => {
    mockClient.createProposal = vi.fn().mockRejectedValue(new Error("workspace not found"));

    const result = await tool.handler({
      workspaceId: "ws-uuid-1",
      issueKey: "KAN-42",
      estimateHours: 3,
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("error");
  });
});

// ─── kanon_apply_proposal ────────────────────────────────────────────────────

describe("kanon_apply_proposal", () => {
  let mockClient: {
    applyProposal: ReturnType<typeof vi.fn>;
  };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      applyProposal: vi.fn().mockResolvedValue(fakeAppliedProposal),
    };
    const tools = captureTools(registerCaptureTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_apply_proposal");
    if (!t) throw new Error("kanon_apply_proposal not registered");
    tool = t;
  });

  it("happy path: calls applyProposal with proposalId, returns applied proposal", async () => {
    const result = await tool.handler({ proposalId: "prop-uuid-1" });

    expect(mockClient.applyProposal).toHaveBeenCalledWith("prop-uuid-1");
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("status", "applied");
  });

  it("error path: 409 already applied → surfaces as errorResult", async () => {
    const { KanonApiError } = await import("../kanon-client.js");
    mockClient.applyProposal = vi.fn().mockRejectedValue(
      new KanonApiError(409, "PROPOSAL_NOT_PENDING", "Proposal already applied"),
    );

    const result = await tool.handler({ proposalId: "prop-uuid-1" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("code", "PROPOSAL_NOT_PENDING");
  });

  it("error path: 404 not found → surfaces as errorResult", async () => {
    const { KanonApiError } = await import("../kanon-client.js");
    mockClient.applyProposal = vi.fn().mockRejectedValue(
      new KanonApiError(404, "PROPOSAL_NOT_FOUND", "Proposal not found"),
    );

    const result = await tool.handler({ proposalId: "prop-uuid-1" });

    expect(result.isError).toBe(true);
  });
});
