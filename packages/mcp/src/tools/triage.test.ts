// ─── Triage Tools — unit tests (KAN-193 PR10) ────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { registerTriageTools, TRIAGE_DEFERRED_TOOLS } from "./triage.js";
import type { KanonClient } from "../kanon-client.js";
import { KanonApiError } from "../kanon-client.js";
import {
  TRIAGE_PREVIEW_COMPACT_BUDGET_BYTES,
  TRIAGE_PREVIEW_FULL_BUDGET_BYTES,
  TRIAGE_LIST_BUDGET_BYTES,
  TRIAGE_GET_BUDGET_BYTES,
  TRIAGE_DISMISS_BUDGET_BYTES,
  TRIAGE_MCP_CONTRACT_VERSION,
} from "../types.js";

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

interface RegisteredTool {
  name: string;
  description: string;
  shape: unknown;
  annotations?: ToolAnnotations;
  handler: ToolHandler;
}

function triageTools(
  register: (server: McpServer, client: KanonClient) => void,
  client: KanonClient,
): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    tool: (
      name: string,
      description: string,
      shapeOrAnnotations: unknown,
      annotationsOrHandler: unknown,
      maybeHandler?: ToolHandler,
    ) => {
      if (typeof annotationsOrHandler === "function") {
        tools.set(name, {
          name,
          description,
          shape: shapeOrAnnotations,
          handler: annotationsOrHandler as ToolHandler,
        });
        return;
      }
      tools.set(name, {
        name,
        description,
        shape: shapeOrAnnotations,
        annotations: annotationsOrHandler as ToolAnnotations,
        handler: maybeHandler as ToolHandler,
      });
    },
  } as unknown as McpServer;
  register(fakeServer, client);
  return tools;
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

const CORRELATION = "550e8400-e29b-41d4-a716-446655440000";
const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";

describe("registerTriageTools — registration", () => {
  it("registers all five deferred triage tools", () => {
    const tools = triageTools(registerTriageTools, {} as KanonClient);
    expect([...tools.keys()].sort()).toEqual([...TRIAGE_DEFERRED_TOOLS].sort());
    expect(tools.size).toBe(5);
  });

  it("TRIAGE_DEFERRED_TOOLS names match design (no apply/approval/execution wording)", () => {
    expect(TRIAGE_DEFERRED_TOOLS).toEqual([
      "preview_issue_triage",
      "persist_triage_proposal",
      "get_triage_proposal",
      "list_triage_proposals",
      "dismiss_triage_proposal",
    ]);
    for (const name of TRIAGE_DEFERRED_TOOLS) {
      expect(name).not.toMatch(/apply|approv|execut|autonomous/i);
    }
  });

  it("annotations match design table", () => {
    const tools = triageTools(registerTriageTools, {} as KanonClient);
    expect(tools.get("preview_issue_triage")!.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.get("persist_triage_proposal")!.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.get("get_triage_proposal")!.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.get("list_triage_proposals")!.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.get("dismiss_triage_proposal")!.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("descriptions avoid apply/approval/execution/autonomous-triage wording", () => {
    const tools = triageTools(registerTriageTools, {} as KanonClient);
    for (const t of tools.values()) {
      expect(t.description).not.toMatch(/\b(apply|approval|execution|autonomous)\b/i);
      expect(Buffer.byteLength(t.description, "utf8")).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("preview_issue_triage", () => {
  let mockClient: { previewIssueTriage: ReturnType<typeof vi.fn> };
  let tools: Map<string, RegisteredTool>;

  beforeEach(() => {
    mockClient = { previewIssueTriage: vi.fn() };
    tools = triageTools(registerTriageTools, mockClient as unknown as KanonClient);
  });

  it("prepare forwards body, 2900ms timeout, and correlation", async () => {
    mockClient.previewIssueTriage.mockResolvedValue({
      contractVersion: "triage-preview.v1",
      previewSeal: "seal.v1",
      correlationId: CORRELATION,
      recommendations: [],
      candidates: [],
    });
    const result = await tools.get("preview_issue_triage")!.handler({
      phase: "prepare",
      issueKey: "KAN-42",
      aiIntent: "none",
      correlationId: CORRELATION,
    });
    expect(result.isError).toBeUndefined();
    expect(mockClient.previewIssueTriage).toHaveBeenCalledWith(
      "KAN-42",
      { phase: "prepare", format: "compact", aiIntent: "none" },
      { timeoutMs: 2900, correlationId: CORRELATION },
    );
    const body = parseResult(result);
    expect(body["mcpContractVersion"]).toBe(TRIAGE_MCP_CONTRACT_VERSION);
    expect(body["previewSeal"]).toBe("seal.v1");
  });

  it("prepare host_assisted is still a valid deterministic preview path", async () => {
    mockClient.previewIssueTriage.mockResolvedValue({
      previewSeal: "seal",
      contextToken: "ctx.v1",
      correlationId: CORRELATION,
    });
    const result = await tools.get("preview_issue_triage")!.handler({
      phase: "prepare",
      issueKey: "KAN-42",
      aiIntent: "host_assisted",
      correlationId: CORRELATION,
    });
    expect(result.isError).toBeUndefined();
    expect(mockClient.previewIssueTriage.mock.calls[0]![1]).toMatchObject({
      aiIntent: "host_assisted",
    });
    expect(parseResult(result)["contextToken"]).toBe("ctx.v1");
  });

  it("validate forwards seal context, hostOutcome, and suggestions", async () => {
    mockClient.previewIssueTriage.mockResolvedValue({ previewSeal: "seal2" });
    await tools.get("preview_issue_triage")!.handler({
      phase: "validate",
      issueKey: "KAN-42",
      contextToken: "ctx.v1",
      hostOutcome: {
        status: "completed",
        provider: "host",
        model: "m",
        modelVersion: "1",
      },
      suggestions: [{ evidenceRefId: "e1", concept: "priority" }],
      correlationId: CORRELATION,
    });
    expect(mockClient.previewIssueTriage.mock.calls[0]![1]).toMatchObject({
      phase: "validate",
      contextToken: "ctx.v1",
      hostOutcome: { status: "completed" },
    });
  });

  it("rejects completed validate without suggestions", async () => {
    const result = await tools.get("preview_issue_triage")!.handler({
      phase: "validate",
      issueKey: "KAN-42",
      contextToken: "ctx.v1",
      hostOutcome: {
        status: "completed",
        provider: "host",
        model: "m",
        modelVersion: "1",
      },
    });
    expect(result.isError).toBe(true);
    expect(mockClient.previewIssueTriage).not.toHaveBeenCalled();
  });

  it("rejects suggestion-bearing failed hostOutcome", async () => {
    const result = await tools.get("preview_issue_triage")!.handler({
      phase: "validate",
      issueKey: "KAN-42",
      contextToken: "ctx.v1",
      hostOutcome: { status: "timed_out" },
      suggestions: [{ x: 1 }],
    });
    expect(result.isError).toBe(true);
  });

  it("surfaces semantic preview errors with retry guidance", async () => {
    mockClient.previewIssueTriage.mockRejectedValue(
      new KanonApiError(404, "NOT_FOUND_OR_NOT_VISIBLE", "missing", undefined, {
        category: "not_found_or_not_visible",
        retry: "none",
        correlationId: CORRELATION,
        apiContractVersion: "triage-api.v1",
      }),
    );
    const result = await tools.get("preview_issue_triage")!.handler({
      phase: "prepare",
      issueKey: "KAN-404",
      correlationId: CORRELATION,
    });
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body["category"]).toBe("not_found_or_not_visible");
    expect(body["retry"]).toBe("none");
    expect(body["mcpContractVersion"]).toBe(TRIAGE_MCP_CONTRACT_VERSION);
  });
});

describe("persist_triage_proposal", () => {
  it("forwards exact preview + seal", async () => {
    const mockClient = {
      persistTriageProposal: vi.fn().mockResolvedValue({
        id: PROPOSAL_ID,
        nonExecutable: true,
        lifecycle: "pending",
      }),
    };
    const tools = triageTools(registerTriageTools, mockClient as unknown as KanonClient);
    const preview = { contractVersion: "triage-preview.v1", previewSeal: "seal" };
    const result = await tools.get("persist_triage_proposal")!.handler({
      issueKey: "KAN-42",
      preview,
      previewSeal: "seal",
      correlationId: CORRELATION,
    });
    expect(result.isError).toBeUndefined();
    expect(mockClient.persistTriageProposal).toHaveBeenCalledWith(
      "KAN-42",
      { preview, previewSeal: "seal" },
      { timeoutMs: 2900, correlationId: CORRELATION },
    );
    expect(parseResult(result)["nonExecutable"]).toBe(true);
  });
});

describe("get_triage_proposal", () => {
  it("forwards proposal UUID and format", async () => {
    const mockClient = {
      getTriageProposal: vi.fn().mockResolvedValue({ id: PROPOSAL_ID, lifecycle: "pending" }),
    };
    const tools = triageTools(registerTriageTools, mockClient as unknown as KanonClient);
    await tools.get("get_triage_proposal")!.handler({
      proposalId: PROPOSAL_ID,
      format: "full",
      correlationId: CORRELATION,
    });
    expect(mockClient.getTriageProposal).toHaveBeenCalledWith(PROPOSAL_ID, "full", {
      timeoutMs: 2900,
      correlationId: CORRELATION,
    });
  });
});

describe("list_triage_proposals", () => {
  it("requires projectKey and encodes filters + cursor pass-through", async () => {
    const mockClient = {
      listTriageProposals: vi.fn().mockResolvedValue({
        rows: [],
        returnedCount: 0,
        nextCursor: "cur.v1",
      }),
    };
    const tools = triageTools(registerTriageTools, mockClient as unknown as KanonClient);

    const missing = await tools.get("list_triage_proposals")!.handler({ limit: 10 });
    expect(missing.isError).toBe(true);

    await tools.get("list_triage_proposals")!.handler({
      projectKey: "KAN",
      state: "current",
      targetIssueKey: "KAN-42",
      generatorSource: "deterministic_policy",
      degraded: true,
      limit: 20,
      cursor: "opaque-cursor",
      correlationId: CORRELATION,
    });
    expect(mockClient.listTriageProposals).toHaveBeenCalledWith(
      "KAN",
      {
        state: "current",
        targetIssueKey: "KAN-42",
        generatorSource: "deterministic_policy",
        degraded: true,
        limit: 20,
        cursor: "opaque-cursor",
      },
      { timeoutMs: 2900, correlationId: CORRELATION },
    );
  });

  it("defaults limit to 20 and rejects >50", async () => {
    const mockClient = {
      listTriageProposals: vi.fn().mockResolvedValue({ rows: [], returnedCount: 0 }),
    };
    const tools = triageTools(registerTriageTools, mockClient as unknown as KanonClient);
    await tools.get("list_triage_proposals")!.handler({ projectKey: "KAN" });
    expect(mockClient.listTriageProposals.mock.calls[0]![1].limit).toBe(20);

    const over = await tools.get("list_triage_proposals")!.handler({
      projectKey: "KAN",
      limit: 51,
    });
    expect(over.isError).toBe(true);
  });
});

describe("dismiss_triage_proposal", () => {
  it("trims reason and enforces 1..1000 codepoints", async () => {
    const mockClient = {
      dismissTriageProposal: vi.fn().mockResolvedValue({ ok: true, status: "dismissed" }),
    };
    const tools = triageTools(registerTriageTools, mockClient as unknown as KanonClient);

    const empty = await tools.get("dismiss_triage_proposal")!.handler({
      proposalId: PROPOSAL_ID,
      reason: "   ",
    });
    expect(empty.isError).toBe(true);

    const tooLong = await tools.get("dismiss_triage_proposal")!.handler({
      proposalId: PROPOSAL_ID,
      reason: "x".repeat(1001),
    });
    expect(tooLong.isError).toBe(true);

    await tools.get("dismiss_triage_proposal")!.handler({
      proposalId: PROPOSAL_ID,
      reason: "  stale duplicate  ",
      correlationId: CORRELATION,
    });
    expect(mockClient.dismissTriageProposal).toHaveBeenCalledWith(
      PROPOSAL_ID,
      { reason: "stale duplicate" },
      { timeoutMs: 2000, correlationId: CORRELATION },
    );
  });
});

describe("output budgets", () => {
  it("exposes fixed budget ceilings", () => {
    expect(TRIAGE_PREVIEW_COMPACT_BUDGET_BYTES).toBe(16 * 1024);
    expect(TRIAGE_PREVIEW_FULL_BUDGET_BYTES).toBe(48 * 1024);
    expect(TRIAGE_LIST_BUDGET_BYTES).toBe(32 * 1024);
    expect(TRIAGE_GET_BUDGET_BYTES).toBe(64 * 1024);
    expect(TRIAGE_DISMISS_BUDGET_BYTES).toBe(8 * 1024);
  });

  it("marks over-budget preview with output_truncated degradation", async () => {
    const huge = {
      contractVersion: "triage-preview.v1",
      previewSeal: "seal",
      evidence: [{ excerpt: "x".repeat(20_000) }],
      recommendations: [],
      candidates: [],
    };
    const mockClient = {
      previewIssueTriage: vi.fn().mockResolvedValue(huge),
    };
    const tools = triageTools(registerTriageTools, mockClient as unknown as KanonClient);
    const result = await tools.get("preview_issue_triage")!.handler({
      phase: "prepare",
      issueKey: "KAN-42",
      correlationId: CORRELATION,
    });
    const body = parseResult(result);
    const serialized = JSON.stringify(body);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(
      TRIAGE_PREVIEW_COMPACT_BUDGET_BYTES,
    );
    expect(body["degradation"]).toContain("output_truncated");
  });
});
