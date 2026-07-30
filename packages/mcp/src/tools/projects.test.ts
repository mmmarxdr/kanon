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
    expect(registered).toContain("list_workspaces");
    expect(registered).toContain("list_projects");
    expect(registered).toContain("get_project");
    expect(registered).toContain("create_project");
    expect(registered).toContain("update_project");
  });
});

// ─── list_workspaces ──────────────────────────────────────────────────

describe("list_workspaces handler", () => {
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

    const handler = server.getHandler("list_workspaces");
    const result = parseResult(await handler({ format: "full" })) as any;

    // New shape: data directly, no {success, data} wrapper
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(result).not.toHaveProperty("success");
  });

  it("returns dataResult with empty items when no workspaces", async () => {
    const client = createMockClient({ listWorkspaces: vi.fn().mockResolvedValue([]) });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("list_workspaces");
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

    const handler = server.getHandler("list_workspaces");
    const raw = await handler({}) as { isError?: boolean; content: Array<{ text: string }> };

    expect(raw.isError).toBe(true);
    const parsed = JSON.parse(raw.content[0].text);
    expect(parsed).not.toHaveProperty("success");
    expect(parsed.code).toBe("CONNECTION_ERROR");
    expect(parsed.error).toBeDefined();
  });
});

// ─── create_project ───────────────────────────────────────────────────

describe("create_project handler", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("calls client.createProject with correct args and returns ack by default", async () => {
    const created = { id: "p1", key: "KAN", name: "Kanon", workspaceId: "ws1", description: "Desc" };
    const createFn = vi.fn().mockResolvedValue(created);
    const client = createMockClient({ createProject: createFn });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("create_project");
    const result = parseResult(await handler({
      workspaceId: "ws1",
      key: "KAN",
      name: "Kanon",
    })) as any;

    // ack default: { ok, id, key, name }
    expect(result).toHaveProperty("ok", true);
    expect(result).toHaveProperty("id", "p1");
    expect(result).toHaveProperty("key", "KAN");
    expect(result).toHaveProperty("name", "Kanon");
    expect(result).not.toHaveProperty("success");
    expect(result).not.toHaveProperty("description");
    expect(createFn).toHaveBeenCalledWith("ws1", { key: "KAN", name: "Kanon" });
  });

  it("passes description to client when provided", async () => {
    const createFn = vi.fn().mockResolvedValue({});
    const client = createMockClient({ createProject: createFn });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("create_project");
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

    const handler = server.getHandler("create_project");
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

// ─── update_project ───────────────────────────────────────────────────

describe("update_project handler", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("calls client.updateProject with correct key and body, returns ack by default", async () => {
    const updateFn = vi.fn().mockResolvedValue({ id: "p1", key: "KAN", name: "Kanon Updated" });
    const client = createMockClient({ updateProject: updateFn });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("update_project");
    const result = parseResult(await handler({
      projectKey: "KAN",
      name: "Kanon Updated",
    })) as any;

    // ack default: { ok, id, key, name }
    expect(result).toHaveProperty("ok", true);
    expect(result).toHaveProperty("id", "p1");
    expect(result).toHaveProperty("key", "KAN");
    expect(result).toHaveProperty("name", "Kanon Updated");
    expect(result).not.toHaveProperty("success");
    expect(updateFn).toHaveBeenCalledWith("KAN", { name: "Kanon Updated" });
  });

  it("returns errorResult on 404", async () => {
    const client = createMockClient({
      updateProject: vi.fn().mockRejectedValue(
        new KanonApiError(404, "NOT_FOUND", "Project not found"),
      ),
    });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("update_project");
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

    const handler = server.getHandler("update_project");
    await handler({ projectKey: "KAN", description: null });

    expect(updateFn).toHaveBeenCalledWith("KAN", { description: null });
  });

  it("omits undefined optional fields from body", async () => {
    const updateFn = vi.fn().mockResolvedValue({});
    const client = createMockClient({ updateProject: updateFn });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("update_project");
    await handler({ projectKey: "KAN", name: "New Name" });

    expect(updateFn).toHaveBeenCalledWith("KAN", { name: "New Name" });
  });
});

// ─── C13: create_project — ack default ─────────────────────────────────

describe("create_project — format tier (C13)", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("defaults to ack: returns { ok, id, key, name } with no other fields", async () => {
    const created = { id: "p1", key: "KAN", name: "Kanon", workspaceId: "ws1", description: "Desc" };
    const client = createMockClient({ createProject: vi.fn().mockResolvedValue(created) });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("create_project");
    const result = parseResult(await handler({
      workspaceId: "ws1",
      key: "KAN",
      name: "Kanon",
    })) as any;

    expect(result).toHaveProperty("ok", true);
    expect(result).toHaveProperty("id", "p1");
    expect(result).toHaveProperty("key", "KAN");
    expect(result).toHaveProperty("name", "Kanon");
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("workspaceId");
  });

  it("format: 'full' returns the raw project entity", async () => {
    const created = { id: "p1", key: "KAN", name: "Kanon", workspaceId: "ws1", description: "Desc" };
    const client = createMockClient({ createProject: vi.fn().mockResolvedValue(created) });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("create_project");
    const result = parseResult(await handler({
      workspaceId: "ws1",
      key: "KAN",
      name: "Kanon",
      format: "full",
    })) as any;

    expect(result).toHaveProperty("id", "p1");
    expect(result).toHaveProperty("description", "Desc");
    expect(result).toHaveProperty("workspaceId", "ws1");
    expect(result).not.toHaveProperty("ok");
  });
});

// ─── C14: update_project — ack default ─────────────────────────────────

describe("update_project — format tier (C14)", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("defaults to ack: returns { ok, id, key, name } with no other fields", async () => {
    const updated = { id: "p1", key: "KAN", name: "Kanon Updated", engramNamespace: "kanon" };
    const client = createMockClient({ updateProject: vi.fn().mockResolvedValue(updated) });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("update_project");
    const result = parseResult(await handler({
      projectKey: "KAN",
      name: "Kanon Updated",
    })) as any;

    expect(result).toHaveProperty("ok", true);
    expect(result).toHaveProperty("id", "p1");
    expect(result).toHaveProperty("key", "KAN");
    expect(result).toHaveProperty("name", "Kanon Updated");
    expect(result).not.toHaveProperty("engramNamespace");
  });

  it("format: 'full' returns the raw project entity", async () => {
    const updated = { id: "p1", key: "KAN", name: "Kanon Updated", engramNamespace: "kanon" };
    const client = createMockClient({ updateProject: vi.fn().mockResolvedValue(updated) });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("update_project");
    const result = parseResult(await handler({
      projectKey: "KAN",
      name: "Kanon Updated",
      format: "full",
    })) as any;

    expect(result).toHaveProperty("id", "p1");
    expect(result).toHaveProperty("engramNamespace", "kanon");
    expect(result).not.toHaveProperty("ok");
  });
});

// ─── KAN-20: 403 FORBIDDEN surfacing — project tools ─────────────────────────
//
// Confirms each tool FORWARDS the credential and SURFACES a 403 as
// { isError: true, code: "FORBIDDEN" }. Enforcement lives in the API layer.

describe("create_project — surfaces 403 as FORBIDDEN", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const client = createMockClient({
      createProject: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("create_project");
    const raw = await handler({
      workspaceId: "ws1",
      key: "KAN",
      name: "Kanon",
    }) as { isError?: boolean; content: Array<{ text: string }> };

    expect(raw.isError).toBe(true);
    const parsed = JSON.parse(raw.content[0].text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});

describe("update_project — surfaces 403 as FORBIDDEN", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("returns isError:true with code FORBIDDEN when API rejects with 403", async () => {
    const client = createMockClient({
      updateProject: vi.fn().mockRejectedValue(
        new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project"),
      ),
    });
    registerProjectTools(server as any, client);

    const handler = server.getHandler("update_project");
    const raw = await handler({
      projectKey: "KAN",
      name: "Updated",
    }) as { isError?: boolean; content: Array<{ text: string }> };

    expect(raw.isError).toBe(true);
    const parsed = JSON.parse(raw.content[0].text);
    expect(parsed.code).toBe("FORBIDDEN");
  });
});
