import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatCommentBody, registerCommentTools } from "./comments.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";

// ─── formatCommentBody ────────────────────────────────────────────────────────

const MAX_BODY_CHARS = 9900;
const FOOTER_RESERVE = 200;
const MAX_CONTENT = MAX_BODY_CHARS - FOOTER_RESERVE; // 9700

describe("formatCommentBody", () => {
  it("full input — produces correct markdown with all metadata footer items", () => {
    const result = formatCommentBody({
      title: "Architecture Decision",
      content: "Chose Zod for validation.",
      observationType: "decision",
      observationId: 42,
      topicKey: "architecture/auth-model",
    });

    expect(result).toBe(
      [
        "## 🧠 Architecture Decision",
        "",
        "Chose Zod for validation.",
        "",
        "---",
        "*Synced from Engram • decision • #42 • `architecture/auth-model`*",
      ].join("\n"),
    );
  });

  it("minimal input (title + content only) — footer has no optional items", () => {
    const result = formatCommentBody({
      title: "Simple Note",
      content: "Just a note.",
    });

    expect(result).toBe(
      [
        "## 🧠 Simple Note",
        "",
        "Just a note.",
        "",
        "---",
        "*Synced from Engram*",
      ].join("\n"),
    );
  });

  it("content over 9700 chars — truncated with marker", () => {
    const longContent = "x".repeat(MAX_CONTENT + 1);
    const result = formatCommentBody({ title: "T", content: longContent });

    const expectedContent = "x".repeat(MAX_CONTENT) + "\n\n*[content truncated]*";
    expect(result).toContain(expectedContent);
    expect(result).not.toContain("x".repeat(MAX_CONTENT + 1));
  });

  it("content exactly at 9700 chars — NOT truncated", () => {
    const exactContent = "y".repeat(MAX_CONTENT);
    const result = formatCommentBody({ title: "T", content: exactContent });

    expect(result).toContain(exactContent);
    expect(result).not.toContain("[content truncated]");
  });

  it("short content — passes through unchanged", () => {
    const shortContent = "Short message.";
    const result = formatCommentBody({ title: "T", content: shortContent });

    expect(result).toContain(shortContent);
    expect(result).not.toContain("[content truncated]");
  });

  it("observationId=0 — included in footer (falsy but defined)", () => {
    const result = formatCommentBody({
      title: "T",
      content: "C",
      observationId: 0,
    });

    expect(result).toContain("#0");
  });

  it("empty string optional fields — omitted from footer", () => {
    const result = formatCommentBody({
      title: "T",
      content: "C",
      observationType: "",
      topicKey: "",
    });

    // Empty strings are falsy — they should not appear in the footer
    expect(result).toBe(
      [
        "## 🧠 T",
        "",
        "C",
        "",
        "---",
        "*Synced from Engram*",
      ].join("\n"),
    );
  });

  it("only observationType provided — footer has type but no id or topicKey", () => {
    const result = formatCommentBody({
      title: "T",
      content: "C",
      observationType: "bugfix",
    });

    const footerLine = result.split("\n").at(-1)!;
    expect(footerLine).toContain("bugfix");
    expect(footerLine).not.toContain("#");
    expect(footerLine).not.toContain("`");
  });

  it("only topicKey provided — footer has topicKey but no type or id", () => {
    const result = formatCommentBody({
      title: "T",
      content: "C",
      topicKey: "sdd/my-change/design",
    });

    const footerLine = result.split("\n").at(-1)!;
    expect(footerLine).toContain("`sdd/my-change/design`");
    expect(footerLine).not.toContain("#");
  });

  it("output always starts with the heading line", () => {
    const result = formatCommentBody({ title: "My Title", content: "Body text." });
    expect(result.startsWith("## 🧠 My Title\n")).toBe(true);
  });

  it("output always ends with the footer italic line", () => {
    const result = formatCommentBody({ title: "T", content: "C" });
    expect(result.endsWith("*Synced from Engram*")).toBe(true);
  });
});

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

// ─── C15: kanon_sync_observation — format tier ───────────────────────────────

describe("kanon_sync_observation — format tier (C15)", () => {
  const fakeComment = {
    id: "cmt_001",
    issueKey: "KAN-1",
    source: "engram_sync",
    body: "## 🧠 Title\n\nContent\n\n---\n*Synced from Engram*",
    authorId: "user_001",
    createdAt: "2026-04-28T00:00:00Z",
  };

  let mockClient: { createComment: ReturnType<typeof vi.fn> };
  let syncTool: RegisteredTool;

  beforeEach(() => {
    mockClient = { createComment: vi.fn().mockResolvedValue(fakeComment) };
    const tools = captureTools(registerCommentTools, mockClient as unknown as KanonClient);
    const tool = tools.get("kanon_sync_observation");
    if (!tool) throw new Error("kanon_sync_observation not registered");
    syncTool = tool;
  });

  it("defaults to ack: returns { ok, id, issueKey } with no heavy fields", async () => {
    const result = await syncTool.handler({
      issueKey: "KAN-1",
      title: "Architecture Decision",
      content: "Chose hexagonal architecture.",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("id", "cmt_001");
    expect(parsed).toHaveProperty("issueKey", "KAN-1");
    expect(parsed).not.toHaveProperty("body");
    expect(parsed).not.toHaveProperty("authorId");
    expect(parsed).not.toHaveProperty("source");
  });

  it("format: 'full' returns the raw comment entity", async () => {
    const result = await syncTool.handler({
      issueKey: "KAN-1",
      title: "Architecture Decision",
      content: "Chose hexagonal architecture.",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "cmt_001");
    expect(parsed).toHaveProperty("body");
    expect(parsed).toHaveProperty("authorId", "user_001");
    expect(parsed).toHaveProperty("source", "engram_sync");
    expect(parsed).not.toHaveProperty("ok");
  });
});
