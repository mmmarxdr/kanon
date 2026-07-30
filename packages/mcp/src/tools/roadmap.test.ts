// ─── Roadmap Tools — format-tier behavior ────────────────────────────────────
//
// C8: create_roadmap_item — ack default
// C9: update_roadmap_item — ack default
// C10: promote_roadmap_item — ack default (promotes to issue)

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRoadmapTools } from "./roadmap.js";
import { KanonApiError } from "../kanon-client.js";
import type { KanonClient, KanonRoadmapItem } from "../kanon-client.js";

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

function makeRoadmapItem(overrides: Partial<KanonRoadmapItem> = {}): KanonRoadmapItem {
  return {
    id: "item_001",
    title: "Add dark mode",
    horizon: "next",
    status: "planned",
    effort: 3,
    impact: 4,
    labels: ["ux"],
    promoted: false,
    targetDate: "2026-06-01",
    description: "Full description of the roadmap item",
    projectId: "proj_001",
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  } as unknown as KanonRoadmapItem;
}

function makeIssueFromPromotion() {
  return {
    id: "iss_002",
    key: "KAN-10",
    title: "Add dark mode",
    state: "todo",
    type: "task",
    priority: "medium",
    labels: [],
    projectId: "proj_001",
  };
}

// ─── C8: create_roadmap_item — format tier ─────────────────────────────

describe("create_roadmap_item — format tier", () => {
  let mockClient: { createRoadmapItem: ReturnType<typeof vi.fn> };
  let createTool: RegisteredTool;

  beforeEach(() => {
    mockClient = { createRoadmapItem: vi.fn().mockResolvedValue(makeRoadmapItem()) };
    const tools = captureTools(registerRoadmapTools, mockClient as unknown as KanonClient);
    const tool = tools.get("create_roadmap_item");
    if (!tool) throw new Error("create_roadmap_item not registered");
    createTool = tool;
  });

  it("defaults to ack: returns { ok, id, status } with no heavy fields", async () => {
    const result = await createTool.handler({
      projectKey: "KAN",
      title: "Add dark mode",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("id", "item_001");
    expect(parsed).toHaveProperty("status", "planned");
    expect(parsed).not.toHaveProperty("description");
    expect(parsed).not.toHaveProperty("projectId");
    expect(parsed).not.toHaveProperty("effort");
  });

  it("format: 'full' returns the raw entity with all fields", async () => {
    const result = await createTool.handler({
      projectKey: "KAN",
      title: "Add dark mode",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "item_001");
    expect(parsed).toHaveProperty("description", "Full description of the roadmap item");
    expect(parsed).toHaveProperty("effort", 3);
    expect(parsed).toHaveProperty("projectId", "proj_001");
    expect(parsed).not.toHaveProperty("ok");
  });
});

// ─── C9: update_roadmap_item — format tier ─────────────────────────────

describe("update_roadmap_item — format tier", () => {
  let mockClient: { updateRoadmapItem: ReturnType<typeof vi.fn> };
  let updateTool: RegisteredTool;

  beforeEach(() => {
    mockClient = { updateRoadmapItem: vi.fn().mockResolvedValue(makeRoadmapItem()) };
    const tools = captureTools(registerRoadmapTools, mockClient as unknown as KanonClient);
    const tool = tools.get("update_roadmap_item");
    if (!tool) throw new Error("update_roadmap_item not registered");
    updateTool = tool;
  });

  it("defaults to ack: returns { ok, id, status } with no heavy fields", async () => {
    const result = await updateTool.handler({
      projectKey: "KAN",
      itemId: "item_001",
      title: "Add dark mode v2",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("id", "item_001");
    expect(parsed).toHaveProperty("status", "planned");
    expect(parsed).not.toHaveProperty("description");
    expect(parsed).not.toHaveProperty("projectId");
  });

  it("format: 'full' returns the raw entity with all fields", async () => {
    const result = await updateTool.handler({
      projectKey: "KAN",
      itemId: "item_001",
      title: "Add dark mode v2",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "item_001");
    expect(parsed).toHaveProperty("description", "Full description of the roadmap item");
    expect(parsed).not.toHaveProperty("ok");
  });
});

// ─── C10: promote_roadmap_item — format tier ───────────────────────────

describe("promote_roadmap_item — format tier", () => {
  let mockClient: { promoteRoadmapItem: ReturnType<typeof vi.fn> };
  let promoteTool: RegisteredTool;

  const fakeIssue = makeIssueFromPromotion();

  beforeEach(() => {
    mockClient = { promoteRoadmapItem: vi.fn().mockResolvedValue(fakeIssue) };
    const tools = captureTools(registerRoadmapTools, mockClient as unknown as KanonClient);
    const tool = tools.get("promote_roadmap_item");
    if (!tool) throw new Error("promote_roadmap_item not registered");
    promoteTool = tool;
  });

  it("defaults to ack: returns { ok, id, key } from the created issue", async () => {
    const result = await promoteTool.handler({
      projectKey: "KAN",
      itemId: "item_001",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("id", "iss_002");
    expect(parsed).toHaveProperty("key", "KAN-10");
    expect(parsed).not.toHaveProperty("title");
    expect(parsed).not.toHaveProperty("state");
  });

  it("format: 'full' returns the full issue entity", async () => {
    const result = await promoteTool.handler({
      projectKey: "KAN",
      itemId: "item_001",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "iss_002");
    expect(parsed).toHaveProperty("key", "KAN-10");
    expect(parsed).toHaveProperty("title", "Add dark mode");
    expect(parsed).toHaveProperty("type", "task");
    expect(parsed).not.toHaveProperty("ok");
  });
});

// ─── C11: add_dependency — format tier ─────────────────────────────────

describe("add_dependency — format tier (C11)", () => {
  const fakeDep = { id: "dep_001", type: "blocks", projectId: "proj_001" };

  let mockClient: { addDependency: ReturnType<typeof vi.fn> };
  let addDepTool: RegisteredTool;

  beforeEach(() => {
    mockClient = { addDependency: vi.fn().mockResolvedValue(fakeDep) };
    const tools = captureTools(registerRoadmapTools, mockClient as unknown as KanonClient);
    const tool = tools.get("add_dependency");
    if (!tool) throw new Error("add_dependency not registered");
    addDepTool = tool;
  });

  it("defaults to ack: returns { ok, id, projectId } with no type field", async () => {
    const result = await addDepTool.handler({
      projectKey: "KAN",
      sourceItemId: "item_001",
      targetItemId: "item_002",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("id", "dep_001");
    expect(parsed).toHaveProperty("projectId", "proj_001");
    expect(parsed).not.toHaveProperty("type");
  });

  it("format: 'full' returns the raw dependency entity", async () => {
    const result = await addDepTool.handler({
      projectKey: "KAN",
      sourceItemId: "item_001",
      targetItemId: "item_002",
      format: "full",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("id", "dep_001");
    expect(parsed).toHaveProperty("type", "blocks");
    expect(parsed).toHaveProperty("projectId", "proj_001");
    expect(parsed).not.toHaveProperty("ok");
  });
});

// ─── C12: remove_dependency — format tier ──────────────────────────────

describe("remove_dependency — format tier (C12)", () => {
  let mockClient: { removeDependency: ReturnType<typeof vi.fn> };
  let removeDepTool: RegisteredTool;

  beforeEach(() => {
    mockClient = { removeDependency: vi.fn().mockResolvedValue(undefined) };
    const tools = captureTools(registerRoadmapTools, mockClient as unknown as KanonClient);
    const tool = tools.get("remove_dependency");
    if (!tool) throw new Error("remove_dependency not registered");
    removeDepTool = tool;
  });

  it("returns ack: { ok, deleted, dependencyId }", async () => {
    const result = await removeDepTool.handler({
      projectKey: "KAN",
      sourceItemId: "item_001",
      dependencyId: "dep_001",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("ok", true);
    expect(parsed).toHaveProperty("deleted", true);
    expect(parsed).toHaveProperty("dependencyId", "dep_001");
  });
});

// ─── KAN-20: 403 FORBIDDEN surfacing — roadmap tools ─────────────────────────
//
// Confirms each tool FORWARDS the credential and SURFACES a 403 as
// { isError: true, code: "FORBIDDEN" }. Enforcement lives in the API layer.

describe("create_roadmap_item — surfaces 403 as FORBIDDEN", () => {
  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const mockClient = {
      createRoadmapItem: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    };
    const tools = captureTools(registerRoadmapTools, mockClient as unknown as KanonClient);
    const handler = tools.get("create_roadmap_item")!.handler;

    const result = await handler({ projectKey: "KAN", title: "Add dark mode" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});
