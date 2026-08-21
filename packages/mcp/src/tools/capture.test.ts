// ─── Capture Tools — unit tests ───────────────────────────────────────────────
//
// Tools covered:
//   report_incident  (AC4)
//   propose_estimate (AC1)
//   apply_proposal   (AC1 confirm step)
//
// Pattern mirrors timesheet.test.ts — captureTools() harness + mocked KanonClient.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCaptureTools, CAPTURE_DEFERRED_TOOLS } from "./capture.js";
import type { KanonClient } from "../kanon-client.js";

vi.mock("../heartbeat.js", () => ({
  startAutoHeartbeat: vi.fn(),
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
  captureIntent: null,
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

    expect(tools.has("report_incident")).toBe(true);
    expect(tools.has("propose_estimate")).toBe(true);
    expect(tools.has("apply_proposal")).toBe(true);
    expect(tools.size).toBe(3);
  });

  it("CAPTURE_DEFERRED_TOOLS contains report_incident, propose_estimate, apply_proposal", () => {
    expect(CAPTURE_DEFERRED_TOOLS).toContain("report_incident");
    expect(CAPTURE_DEFERRED_TOOLS).toContain("propose_estimate");
    expect(CAPTURE_DEFERRED_TOOLS).toContain("apply_proposal");
  });
});

// ─── report_incident ───────────────────────────────────────────────────

describe("report_incident", () => {
  let mockClient: {
    createIssue: ReturnType<typeof vi.fn>;
    startWork: ReturnType<typeof vi.fn>;
  };
  let tool: RegisteredTool;

  beforeEach(() => {
    vi.mocked(heartbeatMod.startAutoHeartbeat).mockReset();
    mockClient = {
      createIssue: vi.fn().mockResolvedValue(fakeIssue),
      startWork: vi.fn().mockResolvedValue(fakeSession),
    };
    const tools = captureTools(registerCaptureTools, mockClient as unknown as KanonClient);
    const t = tools.get("report_incident");
    if (!t) throw new Error("report_incident not registered");
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
    // Assert the exact value (not just presence) — a mutant that replaces the
    // session id lookup / `?? null` fallback must change this and be killed.
    expect(parsed.sessionId).toBe("ws-uuid-1");
    expect(parsed).toHaveProperty("ok", true);
  });

  it("treats a session without an id as a capture failure", async () => {
    mockClient.startWork = vi.fn().mockResolvedValue({
      session: {},
      warnings: [],
      autoAssigned: false,
      captureIntent: null,
    });

    const result = await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(result.isError).toBe(true);
    expect(parsed.error).toMatch(/no work session/i);
    expect(heartbeatMod.startAutoHeartbeat).not.toHaveBeenCalled();
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

  it("omits description from createIssue body when not provided", async () => {
    await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    const createCall = mockClient.createIssue.mock.calls[0] as [string, Record<string, unknown>];
    // The `description !== undefined` guard must NOT add the key when absent —
    // a mutant forcing the conditional true would set description:undefined.
    expect(createCall[1]).not.toHaveProperty("description");
  });

  it("omits groupKey from createIssue body when not provided", async () => {
    await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    const createCall = mockClient.createIssue.mock.calls[0] as [string, Record<string, unknown>];
    expect(createCall[1]).not.toHaveProperty("groupKey");
  });

  it("error path: startWork fails after issue created → error names the issue key", async () => {
    mockClient.startWork = vi.fn().mockRejectedValue(new Error("session conflict"));

    const result = await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    // Error must surface the created issue key AND the recovery guidance, so it's
    // not silently orphaned. Assert content from BOTH template lines + the
    // underlying failure reason so mutating either line to empty is caught.
    expect(parsed.error).toContain("KAN-99");
    expect(parsed.error).toContain("was created but");
    expect(parsed.error).toContain("session conflict");
    expect(parsed.error).toContain("start_work");
  });

  it("error path: createIssue fails → returns errorResult (no startWork called)", async () => {
    mockClient.createIssue = vi.fn().mockRejectedValue(new Error("project not found"));

    const result = await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    expect(result.isError).toBe(true);
    expect(mockClient.startWork).not.toHaveBeenCalled();
  });

  it("registers only the created incident with its returned capture snapshot", async () => {
    const captureIntent = {
      epoch: "550e8400-e29b-41d4-a716-446655440000",
      leaseGeneration: 1,
      state: "capturing" as const,
    };
    mockClient.startWork.mockResolvedValueOnce({ ...fakeSession, captureIntent });

    await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    expect(heartbeatMod.startAutoHeartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeatMod.startAutoHeartbeat).toHaveBeenCalledWith(
      "KAN-99",
      mockClient,
      captureIntent
    );
  });

  it("treats a null session as an incident capture failure and does not register it", async () => {
    mockClient.startWork.mockResolvedValueOnce({
      session: null,
      warnings: [],
      autoAssigned: false,
      captureIntent: null,
    });

    const result = await tool.handler({ projectKey: "KAN", title: "[Ops] DB down" });

    expect(result.isError).toBe(true);
    expect(heartbeatMod.startAutoHeartbeat).not.toHaveBeenCalled();
  });
});

// ─── propose_estimate ──────────────────────────────────────────────────

describe("propose_estimate", () => {
  let mockClient: {
    createProposal: ReturnType<typeof vi.fn>;
  };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      createProposal: vi.fn().mockResolvedValue(fakeProposal),
    };
    const tools = captureTools(registerCaptureTools, mockClient as unknown as KanonClient);
    const t = tools.get("propose_estimate");
    if (!t) throw new Error("propose_estimate not registered");
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
    const [wsId, body] = mockClient.createProposal.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
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

  it("omits reason from the proposal body when no rationale is given", async () => {
    await tool.handler({ workspaceId: "ws-uuid-1", issueKey: "KAN-42", estimateHours: 3 });

    const [, body] = mockClient.createProposal.mock.calls[0] as [string, Record<string, unknown>];
    // The `rationale !== undefined` guard must NOT add the key when absent.
    expect(body).not.toHaveProperty("reason");
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

// ─── apply_proposal ────────────────────────────────────────────────────

describe("apply_proposal", () => {
  let mockClient: {
    applyProposal: ReturnType<typeof vi.fn>;
  };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = {
      applyProposal: vi.fn().mockResolvedValue(fakeAppliedProposal),
    };
    const tools = captureTools(registerCaptureTools, mockClient as unknown as KanonClient);
    const t = tools.get("apply_proposal");
    if (!t) throw new Error("apply_proposal not registered");
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
    mockClient.applyProposal = vi
      .fn()
      .mockRejectedValue(
        new KanonApiError(409, "PROPOSAL_NOT_PENDING", "Proposal already applied")
      );

    const result = await tool.handler({ proposalId: "prop-uuid-1" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("code", "PROPOSAL_NOT_PENDING");
  });

  it("error path: 404 not found → surfaces as errorResult", async () => {
    const { KanonApiError } = await import("../kanon-client.js");
    mockClient.applyProposal = vi
      .fn()
      .mockRejectedValue(new KanonApiError(404, "PROPOSAL_NOT_FOUND", "Proposal not found"));

    const result = await tool.handler({ proposalId: "prop-uuid-1" });

    expect(result.isError).toBe(true);
  });
});
