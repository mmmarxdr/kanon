import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KanonClient, KanonApiError } from "./kanon-client.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const BASE_URL = "https://kanon.example.com";
const API_KEY = "test-api-key";

let client: KanonClient;

beforeEach(() => {
  client = new KanonClient({ baseUrl: BASE_URL, apiKey: API_KEY });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── listWorkspaces ─────────────────────────────────────────────────────────

describe("KanonClient.listWorkspaces", () => {
  it("calls GET /api/workspaces", async () => {
    const workspaces = [{ id: "ws1", name: "Acme", slug: "acme" }];
    const fetchMock = mockFetch(workspaces);
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.listWorkspaces();

    expect(result).toEqual(workspaces);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/workspaces`);
    expect(opts.method).toBe("GET");
  });

  it("sends X-API-Key header for non-JWT keys", async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await client.listWorkspaces();

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe(API_KEY);
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("throws KanonApiError on non-OK response", async () => {
    const fetchMock = mockFetch({ code: "FORBIDDEN", message: "No access" }, 403);
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.listWorkspaces()).rejects.toThrow(KanonApiError);
  });
});

// ─── createProject ──────────────────────────────────────────────────────────

describe("KanonClient.createProject", () => {
  const workspaceId = "550e8400-e29b-41d4-a716-446655440000";

  it("calls POST /api/workspaces/:wid/projects with body", async () => {
    const created = { id: "p1", key: "KAN", name: "Kanon", workspaceId };
    const fetchMock = mockFetch(created, 201);
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.createProject(workspaceId, {
      key: "KAN",
      name: "Kanon",
    });

    expect(result).toEqual(created);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/workspaces/${workspaceId}/projects`);
    expect(opts.method).toBe("POST");
    expect(opts.headers).toHaveProperty("Content-Type", "application/json");
    expect(JSON.parse(opts.body as string)).toEqual({ key: "KAN", name: "Kanon" });
  });

  it("includes description in body when provided", async () => {
    const fetchMock = mockFetch({ id: "p1", key: "KAN", name: "Kanon" }, 201);
    vi.stubGlobal("fetch", fetchMock);

    await client.createProject(workspaceId, {
      key: "KAN",
      name: "Kanon",
      description: "A project",
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toHaveProperty("description", "A project");
  });

  it("throws KanonApiError with conflict details on 409", async () => {
    const fetchMock = mockFetch(
      { code: "CONFLICT", message: "Key already exists" },
      409,
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await client.createProject(workspaceId, { key: "KAN", name: "Kanon" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KanonApiError);
      expect((err as KanonApiError).statusCode).toBe(409);
      expect((err as KanonApiError).code).toBe("CONFLICT");
    }
  });
});

// ─── updateProject ──────────────────────────────────────────────────────────

describe("KanonClient.updateProject", () => {
  it("calls PATCH /api/projects/:key with body", async () => {
    const updated = { id: "p1", key: "KAN", name: "Kanon Updated" };
    const fetchMock = mockFetch(updated);
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.updateProject("KAN", { name: "Kanon Updated" });

    expect(result).toEqual(updated);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/projects/KAN`);
    expect(opts.method).toBe("PATCH");
  });

  it("throws KanonApiError on 404", async () => {
    const fetchMock = mockFetch(
      { code: "NOT_FOUND", message: "Project not found" },
      404,
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.updateProject("NOPE", { name: "X" })).rejects.toThrow(KanonApiError);
  });
});

// ─── Auth header ────────────────────────────────────────────────────────────

describe("KanonClient auth headers", () => {
  it("uses Bearer auth for JWT-shaped keys", async () => {
    const jwtKey = "eyJhbGciOiJIUzI1NiJ9.test.payload";
    const jwtClient = new KanonClient({ baseUrl: BASE_URL, apiKey: jwtKey });
    const fetchMock = mockFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await jwtClient.listWorkspaces();

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${jwtKey}`);
    expect(headers["X-API-Key"]).toBeUndefined();
  });
});
