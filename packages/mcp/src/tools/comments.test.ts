// ─── Comment Tools — unit tests ───────────────────────────────────────────────
//
// Tools covered:
//   create_issue_comment
//
// Pattern mirrors members.test.ts — captureTools() harness + mocked KanonClient.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCommentTools, COMMENTS_DEFERRED_TOOLS } from "./comments.js";
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

const fakeComment = {
  id: "comment-uuid-1",
  body: "Work started on authentication module.",
  source: "mcp",
  issueId: "issue-uuid-1",
  authorId: "user-uuid-1",
  createdAt: "2026-06-16T10:00:00.000Z",
  updatedAt: "2026-06-16T10:00:00.000Z",
};

// ─── Registration tests ───────────────────────────────────────────────────────

describe("registerCommentTools — registration", () => {
  it("registers create_issue_comment tool", () => {
    const mockClient = {} as unknown as KanonClient;
    const tools = captureTools(registerCommentTools, mockClient);

    expect(tools.has("create_issue_comment")).toBe(true);
    expect(tools.size).toBe(1);
  });

  it("COMMENTS_DEFERRED_TOOLS contains create_issue_comment (deferred — not daily board-flow core)", () => {
    expect(COMMENTS_DEFERRED_TOOLS).toContain("create_issue_comment");
  });
});

// ─── create_issue_comment ─────────────────────────────────────────────────────

describe("create_issue_comment", () => {
  let mockClient: { createComment: ReturnType<typeof vi.fn> };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = { createComment: vi.fn().mockResolvedValue(fakeComment) };
    const tools = captureTools(registerCommentTools, mockClient as unknown as KanonClient);
    const t = tools.get("create_issue_comment");
    if (!t) throw new Error("create_issue_comment not registered");
    tool = t;
  });

  it("happy path: calls createComment with issueKey, body, 'mcp' source and returns dataResult", async () => {
    const result = await tool.handler({ issueKey: "KAN-42", body: "Work started on authentication module." });

    expect(mockClient.createComment).toHaveBeenCalledWith("KAN-42", "Work started on authentication module.", "mcp");
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "comment-uuid-1");
    expect(parsed).toHaveProperty("body", "Work started on authentication module.");
    expect(parsed).toHaveProperty("source", "mcp");
  });

  it("happy path: returned comment has expected shape fields", async () => {
    const result = await tool.handler({ issueKey: "KAN-42", body: "Status update." });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id");
    expect(parsed).toHaveProperty("body");
    expect(parsed).toHaveProperty("source");
    expect(parsed).toHaveProperty("issueId");
    expect(parsed).toHaveProperty("authorId");
    expect(parsed).toHaveProperty("createdAt");
  });

  it("error path: client throws generic error → returns errorResult", async () => {
    mockClient.createComment = vi.fn().mockRejectedValue(new Error("network failure"));
    const tools = captureTools(registerCommentTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("create_issue_comment")!;

    const result = await errorTool.handler({ issueKey: "KAN-42", body: "test" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("error");
  });

  it("error path: 403 from API → surfaces as errorResult with code", async () => {
    const { KanonApiError } = await import("../kanon-client.js");
    mockClient.createComment = vi.fn().mockRejectedValue(
      new KanonApiError(403, "FORBIDDEN", "Not a project member"),
    );
    const tools = captureTools(registerCommentTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("create_issue_comment")!;

    const result = await errorTool.handler({ issueKey: "KAN-42", body: "test" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("code", "FORBIDDEN");
    expect(parsed.error).toContain("403");
  });
});
