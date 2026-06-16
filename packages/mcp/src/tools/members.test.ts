// ─── Member Tools — unit tests ────────────────────────────────────────────────
//
// Tools covered:
//   kanon_list_members
//
// Pattern mirrors timesheet.test.ts — captureTools() harness + mocked KanonClient.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemberTools, MEMBERS_DEFERRED_TOOLS } from "./members.js";
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

const fakeMemberList = {
  members: [
    {
      userId: "user-uuid-1",
      email: "alice@example.com",
      displayName: "Alice",
      role: "admin",
      source: "project",
      pmId: "pm-uuid-1",
    },
    {
      userId: "user-uuid-2",
      email: "bob@example.com",
      displayName: null,
      role: "member",
      source: "project",
      pmId: "pm-uuid-2",
    },
    {
      userId: "user-uuid-3",
      email: "carol@example.com",
      displayName: "Carol Owner",
      role: "owner",
      source: "workspace",
      implicit: true,
    },
  ],
};

// ─── Registration test ───────────────────────────────────────────────────────

describe("registerMemberTools — registration", () => {
  it("registers kanon_list_members tool", () => {
    const mockClient = {} as unknown as KanonClient;
    const tools = captureTools(registerMemberTools, mockClient);

    expect(tools.has("kanon_list_members")).toBe(true);
    expect(tools.size).toBe(1);
  });

  it("MEMBERS_DEFERRED_TOOLS contains kanon_list_members (deferred — not daily-flow core)", () => {
    expect(MEMBERS_DEFERRED_TOOLS).toContain("kanon_list_members");
  });
});

// ─── kanon_list_members ──────────────────────────────────────────────────────

describe("kanon_list_members", () => {
  let mockClient: { listProjectMembers: ReturnType<typeof vi.fn> };
  let tool: RegisteredTool;

  beforeEach(() => {
    mockClient = { listProjectMembers: vi.fn().mockResolvedValue(fakeMemberList) };
    const tools = captureTools(registerMemberTools, mockClient as unknown as KanonClient);
    const t = tools.get("kanon_list_members");
    if (!t) throw new Error("kanon_list_members not registered");
    tool = t;
  });

  it("happy path: calls listProjectMembers with projectKey and returns member list", async () => {
    const result = await tool.handler({ projectKey: "KAN" });

    expect(mockClient.listProjectMembers).toHaveBeenCalledWith("KAN");
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("members");
    expect(parsed.members).toHaveLength(3);
  });

  it("returns members with userId, displayName, email, and role fields", async () => {
    const result = await tool.handler({ projectKey: "KAN" });

    const parsed = JSON.parse(result.content[0]!.text);
    const alice = parsed.members.find((m: { userId: string }) => m.userId === "user-uuid-1");
    expect(alice).toBeDefined();
    expect(alice).toHaveProperty("userId", "user-uuid-1");
    expect(alice).toHaveProperty("displayName", "Alice");
    expect(alice).toHaveProperty("email", "alice@example.com");
    expect(alice).toHaveProperty("role", "admin");
  });

  it("returns workspace-implicit members (source:workspace, no pmId)", async () => {
    const result = await tool.handler({ projectKey: "KAN" });

    const parsed = JSON.parse(result.content[0]!.text);
    const carol = parsed.members.find((m: { userId: string }) => m.userId === "user-uuid-3");
    expect(carol).toBeDefined();
    expect(carol).toHaveProperty("source", "workspace");
    expect(carol).not.toHaveProperty("pmId");
  });

  it("error path: client throws → returns errorResult", async () => {
    mockClient.listProjectMembers = vi.fn().mockRejectedValue(new Error("network failure"));
    const tools = captureTools(registerMemberTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("kanon_list_members")!;

    const result = await errorTool.handler({ projectKey: "KAN" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("error");
  });

  it("error path: 403 from API → surfaces as errorResult with code", async () => {
    const { KanonApiError } = await import("../kanon-client.js");
    mockClient.listProjectMembers = vi.fn().mockRejectedValue(
      new KanonApiError(403, "FORBIDDEN", "Not a project member"),
    );
    const tools = captureTools(registerMemberTools, mockClient as unknown as KanonClient);
    const errorTool = tools.get("kanon_list_members")!;

    const result = await errorTool.handler({ projectKey: "KAN" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("code", "FORBIDDEN");
    expect(parsed.error).toContain("403");
  });
});
