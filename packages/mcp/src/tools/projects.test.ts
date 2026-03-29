import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerProjectTools } from "./projects.js";
import { KanonApiError } from "../kanon-client.js";
import type { KanonClient } from "../kanon-client.js";

// ─── Mock MCP Server ────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function createMockServer() {
  const tools = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }),
    getHandler(name: string): ToolHandler {
      const handler = tools.get(name);
      if (!handler) throw new Error(`Tool "${name}" not registered`);
      return handler;
    },
  };
}

// ─── Mock Client ────────────────────────────────────────────────────────────

function createMockClient(overrides: Partial<KanonClient> = {}) {
  return {
    listWorkspaces: vi.fn().mockResolvedValue([]),
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue({}),
    createProject: vi.fn().mockResolvedValue({}),
    updateProject: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as KanonClient;
}

function parseResult(result: unknown): unknown {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

// ─── Tool Registration ──────────────────────────────────────────────────────

describe("registerProjectTools", () => {
  it("registers all expected tools", () => {
    const server = createMockServer();
    const client = createMockClient();
    registerProjectTools(server as any, client);

    const registered = (server.tool as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(registered).toContain("kanon_list_workspaces");
    expect(registered).toContain("kanon_list_projects");
    expect(registered).toContain("kanon_get_project");
    expect(registered).toContain("kanon_create_project");
    expect(registered).toContain("kanon_update_project");
  });
});

// ─── kanon_list_workspaces ──────────────────────────────────────────────────

describe("kanon_list_workspaces handler", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("returns dataResult with workspace data (no success wrapper)", async () => {
    const workspaces = [
      { id: "ws1", name: "Acme", slug: "acme" },
      { id: "ws2", name: "Beta", slug: "beta" },
    ];
    const client = createMockClient({ listWorkspaces: vi.fn().mockResolvedValue(workspaces) });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_list_workspaces");
    const result = parseResult(await handler({ format: "full" })) as any;

    // New shape: data directly, no {success, data} wrapper
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(result).not.toHaveProperty("success");
  });

  it("returns dataResult with empty items when no workspaces", async () => {
    const client = createMockClient({ listWorkspaces: vi.fn().mockResolvedValue([]) });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_list_workspaces");
    const result = parseResult(await handler({ format: "full" })) as any;

    expect(result.items).toEqual([]);
    expect(result).not.toHaveProperty("success");
  });

  it("returns errorResult on API error", async () => {
    const client = createMockClient({
      listWorkspaces: vi.fn().mockRejectedValue(
        new KanonApiError(0, "CONNECTION_ERROR", "Failed to connect"),
      ),
    });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_list_workspaces");
    const raw = await handler({}) as { isError?: boolean; content: Array<{ text: string }> };

    expect(raw.isError).toBe(true);
    const parsed = JSON.parse(raw.content[0].text);
    expect(parsed).not.toHaveProperty("success");
    expect(parsed.code).toBe("CONNECTION_ERROR");
    expect(parsed.error).toBeDefined();
  });
});

// ─── kanon_create_project ───────────────────────────────────────────────────

describe("kanon_create_project handler", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("calls client.createProject with correct args and returns project-write slim", async () => {
    const created = { id: "p1", key: "KAN", name: "Kanon", workspaceId: "ws1", description: "Desc" };
    const createFn = vi.fn().mockResolvedValue(created);
    const client = createMockClient({ createProject: createFn });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_create_project");
    const result = parseResult(await handler({
      workspaceId: "ws1",
      key: "KAN",
      name: "Kanon",
    })) as any;

    // project-write slim: only key and name
    expect(result).toEqual({ key: "KAN", name: "Kanon" });
    expect(result).not.toHaveProperty("success");
    expect(result).not.toHaveProperty("id");
    expect(createFn).toHaveBeenCalledWith("ws1", { key: "KAN", name: "Kanon" });
  });

  it("passes description to client when provided", async () => {
    const createFn = vi.fn().mockResolvedValue({});
    const client = createMockClient({ createProject: createFn });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_create_project");
    await handler({
      workspaceId: "ws1",
      key: "KAN",
      name: "Kanon",
      description: "Desc",
    });

    expect(createFn).toHaveBeenCalledWith("ws1", {
      key: "KAN",
      name: "Kanon",
      description: "Desc",
    });
  });

  it("returns errorResult on conflict", async () => {
    const client = createMockClient({
      createProject: vi.fn().mockRejectedValue(
        new KanonApiError(409, "CONFLICT", "Key already exists"),
      ),
    });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_create_project");
    const raw = await handler({
      workspaceId: "ws1",
      key: "KAN",
      name: "Kanon",
    }) as { isError?: boolean; content: Array<{ text: string }> };

    expect(raw.isError).toBe(true);
    const parsed = JSON.parse(raw.content[0].text);
    expect(parsed.code).toBe("CONFLICT");
  });
});

// ─── kanon_update_project ───────────────────────────────────────────────────

describe("kanon_update_project handler", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("calls client.updateProject with correct key and body, returns project-write slim", async () => {
    const updateFn = vi.fn().mockResolvedValue({ id: "p1", key: "KAN", name: "Kanon", engramNamespace: "kanon" });
    const client = createMockClient({ updateProject: updateFn });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_update_project");
    const result = parseResult(await handler({
      projectKey: "KAN",
      engramNamespace: "kanon",
    })) as any;

    // project-write slim: only key and name
    expect(result).toEqual({ key: "KAN", name: "Kanon" });
    expect(result).not.toHaveProperty("success");
    expect(result).not.toHaveProperty("id");
    expect(updateFn).toHaveBeenCalledWith("KAN", { engramNamespace: "kanon" });
  });

  it("returns errorResult on 404", async () => {
    const client = createMockClient({
      updateProject: vi.fn().mockRejectedValue(
        new KanonApiError(404, "NOT_FOUND", "Project not found"),
      ),
    });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_update_project");
    const raw = await handler({
      projectKey: "NOPE",
      name: "X",
    }) as { isError?: boolean; content: Array<{ text: string }> };

    expect(raw.isError).toBe(true);
    const parsed = JSON.parse(raw.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });

  it("passes null description through for clearing", async () => {
    const updateFn = vi.fn().mockResolvedValue({});
    const client = createMockClient({ updateProject: updateFn });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_update_project");
    await handler({ projectKey: "KAN", description: null });

    expect(updateFn).toHaveBeenCalledWith("KAN", { description: null });
  });

  it("omits undefined optional fields from body", async () => {
    const updateFn = vi.fn().mockResolvedValue({});
    const client = createMockClient({ updateProject: updateFn });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("kanon_update_project");
    await handler({ projectKey: "KAN", name: "New Name" });

    expect(updateFn).toHaveBeenCalledWith("KAN", { name: "New Name" });
  });
});
