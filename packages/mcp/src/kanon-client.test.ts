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

  it("sends Bearer Authorization header for any apiKey (X-API-Key removed in PR1)", async () => {
    // PR1 (KAN-35): Bearer-only path. Any key value — JWT or not — is sent as Bearer.
    // The wrapper always supplies a short-lived access JWT; this test verifies there
    // is no X-API-Key fallback remaining.
    const fetchMock = mockFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await client.listWorkspaces();

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
    expect(headers["X-API-Key"]).toBeUndefined();
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

// ─── Cycles ─────────────────────────────────────────────────────────────────

describe("KanonClient.listCycles", () => {
  it("calls GET /api/projects/:key/cycles", async () => {
    const cycles = [
      { id: "c1", name: "Sprint 1", state: "active", startDate: "2026-01-01", endDate: "2026-01-14" },
    ];
    const fetchMock = mockFetch(cycles);
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.listCycles("KAN");

    expect(result).toEqual(cycles);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/projects/KAN/cycles`);
    expect(opts.method).toBe("GET");
  });
});

describe("KanonClient.getCycle", () => {
  it("calls GET /api/cycles/:id", async () => {
    const cycleId = "550e8400-e29b-41d4-a716-446655440001";
    const detail = { id: cycleId, name: "Sprint 1", burnup: [0, 1, 2], scopeLine: [5, 5, 5] };
    const fetchMock = mockFetch(detail);
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.getCycle(cycleId);

    expect(result).toEqual(detail);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/cycles/${cycleId}`);
    expect(opts.method).toBe("GET");
  });
});

describe("KanonClient.createCycle", () => {
  it("calls POST /api/projects/:key/cycles with body", async () => {
    const created = {
      id: "c1", name: "Sprint 1", state: "upcoming",
      startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-01-14T00:00:00.000Z",
    };
    const fetchMock = mockFetch(created, 201);
    vi.stubGlobal("fetch", fetchMock);

    const body = {
      name: "Sprint 1",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-14T00:00:00.000Z",
    };
    const result = await client.createCycle("KAN", body);

    expect(result).toEqual(created);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/projects/KAN/cycles`);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual(body);
  });

  it("includes goal and state when provided", async () => {
    const fetchMock = mockFetch({}, 201);
    vi.stubGlobal("fetch", fetchMock);

    await client.createCycle("KAN", {
      name: "Sprint 1",
      goal: "Ship cycles",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-14T00:00:00.000Z",
      state: "active",
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(opts.body as string);
    expect(sent.goal).toBe("Ship cycles");
    expect(sent.state).toBe("active");
  });
});

describe("KanonClient.attachIssuesToCycle", () => {
  const cycleId = "550e8400-e29b-41d4-a716-446655440001";

  it("calls POST /api/cycles/:id/issues with add/remove/reason body", async () => {
    const detail = { id: cycleId, name: "Sprint 1", issues: [] };
    const fetchMock = mockFetch(detail);
    vi.stubGlobal("fetch", fetchMock);

    const body = { add: ["KAN-1", "KAN-2"], remove: ["KAN-3"], reason: "rebalancing" };
    const result = await client.attachIssuesToCycle(cycleId, body);

    expect(result).toEqual(detail);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/cycles/${cycleId}/issues`);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual(body);
  });
});

describe("KanonClient.closeCycle", () => {
  const cycleId = "550e8400-e29b-41d4-a716-446655440001";

  it("calls POST /api/cycles/:id/close with empty body", async () => {
    const closed = { id: cycleId, name: "Sprint 1", state: "done" };
    const fetchMock = mockFetch(closed);
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.closeCycle(cycleId);

    expect(result).toEqual(closed);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/cycles/${cycleId}/close`);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({});
  });
});

// ─── D9: batchTransitionByKeys client method ─────────────────────────────────

describe("KanonClient.batchTransitionByKeys (D9)", () => {
  it("calls POST /api/projects/:key/issues/batch-transition with keys and state", async () => {
    const result = { count: 2, keys: ["KAN-1", "KAN-2"] };
    const fetchMock = mockFetch(result);
    vi.stubGlobal("fetch", fetchMock);

    const returned = await client.batchTransitionByKeys("KAN", ["KAN-1", "KAN-2"], "done");

    expect(returned).toEqual(result);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/projects/KAN/issues/batch-transition`);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body).toHaveProperty("keys", ["KAN-1", "KAN-2"]);
    expect(body).toHaveProperty("to_state", "done");
  });
});

// ─── D5: createCycle passes attachIssueKeys in body ─────────────────────────

describe("KanonClient.createCycle — attachIssueKeys (D5)", () => {
  it("includes attachIssueKeys in POST body when provided", async () => {
    const fetchMock = mockFetch({ id: "c1", name: "Sprint 1", state: "upcoming" }, 201);
    vi.stubGlobal("fetch", fetchMock);

    await client.createCycle("KAN", {
      name: "Sprint 1",
      startDate: "2026-05-01T00:00:00.000Z",
      endDate: "2026-05-14T00:00:00.000Z",
      attachIssueKeys: ["KAN-1", "KAN-2"],
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body).toHaveProperty("attachIssueKeys", ["KAN-1", "KAN-2"]);
  });
});

// ─── D7: getCycle passes includeAllScopeEvents query param ───────────────────

describe("KanonClient.getCycle — includeAllScopeEvents (D7)", () => {
  const cycleId = "550e8400-e29b-41d4-a716-446655440001";

  it("appends ?includeAllScopeEvents=true when option is true", async () => {
    const fetchMock = mockFetch({ id: cycleId, name: "Sprint 1" });
    vi.stubGlobal("fetch", fetchMock);

    await client.getCycle(cycleId, { includeAllScopeEvents: true });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("includeAllScopeEvents=true");
  });

  it("does not append param when option is false/absent", async () => {
    const fetchMock = mockFetch({ id: cycleId, name: "Sprint 1" });
    vi.stubGlobal("fetch", fetchMock);

    await client.getCycle(cycleId);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("includeAllScopeEvents");
  });
});

// ─── D3: listIssues keys[] forwarded as CSV ──────────────────────────────────

describe("KanonClient.listIssues — keys[] filter (D3)", () => {
  it("appends keys as CSV query param when provided", async () => {
    const issues = [{ id: "i1", key: "KAN-1" }, { id: "i2", key: "KAN-2" }];
    const fetchMock = mockFetch(issues);
    vi.stubGlobal("fetch", fetchMock);

    await client.listIssues("KAN", { keys: ["KAN-1", "KAN-2"] });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("keys=KAN-1%2CKAN-2");
  });

  it("does not add keys param when keys is absent", async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await client.listIssues("KAN", {});

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("keys=");
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

// ─── KAN-20: JWT path 403 surfacing ─────────────────────────────────────────
//
// Confirms that a KanonClient using a JWT (Bearer) apiKey surfaces a 403
// response as KanonApiError with statusCode 403 and code "FORBIDDEN".
// Enforcement lives in the API layer; this verifies the client throws correctly.

describe("KanonClient JWT path — surfaces 403 as KanonApiError FORBIDDEN", () => {
  it("throws KanonApiError with statusCode 403 and code FORBIDDEN for JWT-keyed client", async () => {
    const jwtKey = "eyJhbGciOiJIUzI1NiJ9.test.payload";
    const jwtClient = new KanonClient({ baseUrl: BASE_URL, apiKey: jwtKey });
    const fetchMock = mockFetch({ code: "FORBIDDEN", message: "Not a project member" }, 403);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await jwtClient.listWorkspaces();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KanonApiError);
      expect((err as KanonApiError).statusCode).toBe(403);
      expect((err as KanonApiError).code).toBe("FORBIDDEN");
    }
  });
});

// ─── 204 No Content handling ────────────────────────────────────────────────

describe("KanonClient 204 No Content", () => {
  it("does not call response.json() on DELETE roadmap item (204)", async () => {
    const jsonSpy = vi.fn().mockRejectedValue(new SyntaxError("Unexpected end of JSON input"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: jsonSpy,
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      client.deleteRoadmapItem("KAN", "abc-123"),
    ).resolves.toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("does not call response.json() on DELETE dependency (204)", async () => {
    const jsonSpy = vi.fn().mockRejectedValue(new SyntaxError("Unexpected end of JSON input"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: jsonSpy,
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      client.removeDependency("KAN", "src-1", "dep-1"),
    ).resolves.toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });
});

// ─── McpAuthError (T3.2 / T3.3) ─────────────────────────────────────────────
// Fetch seam decision: vi.stubGlobal('fetch', mockFn) — global fetch already used in production.

import { McpAuthError } from "./kanon-client.js";

describe("McpAuthError", () => {
  it("is an instance of McpAuthError and has code REFRESH_FAILED", () => {
    const err = new McpAuthError({ code: "REFRESH_FAILED" });
    expect(err).toBeInstanceOf(McpAuthError);
    expect(err.code).toBe("REFRESH_FAILED");
  });

  it("is an instance of Error", () => {
    const err = new McpAuthError({ code: "REFRESH_FAILED", message: "re-onboard" });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("re-onboard");
  });
});

// ─── KanonClient 401-retry (R1) ──────────────────────────────────────────────

/**
 * Build a sequenced fetch mock that returns different responses per call.
 * Each item in responses[] corresponds to one fetch() invocation (in order).
 */
function sequencedFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[call++] ?? responses[responses.length - 1]!;
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      json: () => Promise.resolve(r.body),
      text: () => Promise.resolve(JSON.stringify(r.body)),
    });
  });
}

const REFRESH_TOKEN = "rt-test-token";
const NEW_ACCESS_TOKEN = "new-access-token-xyz";
const EXCHANGE_RESPONSE = { accessToken: NEW_ACCESS_TOKEN, expiresIn: 3600 };

describe("KanonClient 401-retry (R1)", () => {
  let refreshClient: KanonClient;

  beforeEach(() => {
    vi.stubEnv("KANON_REFRESH_TOKEN", REFRESH_TOKEN);
    refreshClient = new KanonClient({ baseUrl: BASE_URL, apiKey: "old-access-token" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // R1a: 401 → exchange(200) → retry(200) → resolves; exchange called once; retry uses new token
  it("R1a: 401 → successful exchange → retry with new token → resolves", async () => {
    const fetchMock = sequencedFetch([
      { ok: false, status: 401, body: { code: "TOKEN_EXPIRED" } },           // original request 401
      { ok: true,  status: 200, body: EXCHANGE_RESPONSE },                   // exchange succeeds
      { ok: true,  status: 200, body: [{ id: "ws1", name: "Acme" }] },       // retry succeeds
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshClient.listWorkspaces();
    expect(result).toEqual([{ id: "ws1", name: "Acme" }]);

    // Exchange called exactly once (second call to fetch)
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const exchangeCall = calls[1]!;
    expect(exchangeCall[0]).toContain("/api/auth/exchange");

    // Retry uses new access token
    const retryCall = calls[2]!;
    const retryHeaders = retryCall[1]!.headers as Record<string, string>;
    expect(retryHeaders["Authorization"]).toBe(`Bearer ${NEW_ACCESS_TOKEN}`);
  });

  // R1b: 401 → exchange(401) → McpAuthError(REFRESH_FAILED); original NOT retried again
  it("R1b: 401 → exchange returns 401 → throws McpAuthError(REFRESH_FAILED)", async () => {
    const fetchMock = sequencedFetch([
      { ok: false, status: 401, body: { code: "TOKEN_EXPIRED" } },
      { ok: false, status: 401, body: { code: "TOKEN_REVOKED" } }, // exchange itself 401s
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshClient.listWorkspaces()).rejects.toMatchObject({
      code: "REFRESH_FAILED",
    });
    await expect(refreshClient.listWorkspaces().catch(e => e)).resolves.toBeInstanceOf(McpAuthError);

    // Only 2 fetch calls total (original + exchange); no retry of original
    expect(fetchMock).toHaveBeenCalledTimes(4); // 2 calls per listWorkspaces above
  });

  // R1c: 500 → exchange NOT called; error propagates as KanonApiError; no retry
  it("R1c: 500 → exchange not called; KanonApiError propagates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ code: "INTERNAL_ERROR", message: "oops" }),
      text: () => Promise.resolve(JSON.stringify({ code: "INTERNAL_ERROR", message: "oops" })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshClient.listWorkspaces()).rejects.toBeInstanceOf(KanonApiError);

    // Only one fetch call — no exchange, no retry
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("/api/auth/exchange");
  });

  // R1d: 401 → exchange(200) → retry still 401 → McpAuthError; total exchange calls === 1
  it("R1d: 401 → exchange succeeds → retry also 401 → McpAuthError; exchange called once", async () => {
    const fetchMock = sequencedFetch([
      { ok: false, status: 401, body: { code: "TOKEN_EXPIRED" } },
      { ok: true,  status: 200, body: EXCHANGE_RESPONSE },
      { ok: false, status: 401, body: { code: "TOKEN_EXPIRED" } }, // retry also 401
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const err = await refreshClient.listWorkspaces().catch(e => e);
    expect(err).toBeInstanceOf(McpAuthError);
    expect(err.code).toBe("REFRESH_FAILED");

    // Exchange was called exactly once (call index 1)
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const exchangeCalls = calls.filter(([url]) => url.includes("/api/auth/exchange"));
    expect(exchangeCalls).toHaveLength(1);
  });

  // R1e: exchange call itself returns 401 → McpAuthError; no recursion
  it("R1e: exchange 401 → McpAuthError(REFRESH_FAILED); no recursive exchange", async () => {
    const fetchMock = sequencedFetch([
      { ok: false, status: 401, body: { code: "TOKEN_EXPIRED" } },
      { ok: false, status: 401, body: { code: "EXCHANGE_401" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const err = await refreshClient.listWorkspaces().catch(e => e);
    expect(err).toBeInstanceOf(McpAuthError);
    expect(err.code).toBe("REFRESH_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + exchange only
  });

  // T4: KANON_REFRESH_TOKEN unset → 401 propagates as KanonApiError, no exchange
  it("T4: no KANON_REFRESH_TOKEN → 401 propagates as-is, no exchange attempted", async () => {
    vi.unstubAllEnvs(); // clear KANON_REFRESH_TOKEN
    const noRefreshClient = new KanonClient({ baseUrl: BASE_URL, apiKey: "old-token" });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ code: "TOKEN_EXPIRED", message: "expired" }),
      text: () => Promise.resolve(JSON.stringify({ code: "TOKEN_EXPIRED", message: "expired" })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const err = await noRefreshClient.listWorkspaces().catch(e => e);
    expect(err).toBeInstanceOf(KanonApiError);
    expect(err).not.toBeInstanceOf(McpAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no exchange call
  });
});

// ─── KanonClient single-flight guard (R2) ────────────────────────────────────

describe("KanonClient single-flight exchange guard (R2)", () => {
  let refreshClient: KanonClient;

  beforeEach(() => {
    vi.stubEnv("KANON_REFRESH_TOKEN", REFRESH_TOKEN);
    refreshClient = new KanonClient({ baseUrl: BASE_URL, apiKey: "old-token" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // R2a + R2b: N concurrent 401s → exchange called exactly once; all N resolve
  it("R2a/R2b: N concurrent 401s → exchange called once; all callers get successful response", async () => {
    const N = 5;
    let exchangeCallCount = 0;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/auth/exchange")) {
        exchangeCallCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ accessToken: NEW_ACCESS_TOKEN, expiresIn: 3600 }),
          text: () => Promise.resolve(JSON.stringify({ accessToken: NEW_ACCESS_TOKEN, expiresIn: 3600 })),
        });
      }
      // All original requests 401
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ code: "TOKEN_EXPIRED" }),
        text: () => Promise.resolve(JSON.stringify({ code: "TOKEN_EXPIRED" })),
      });
    });

    // Override the second call to /api/workspaces (retry) to succeed
    let retryCount = 0;
    const originalImpl = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string) => {
      if (!(url as string).includes("/api/auth/exchange")) {
        retryCount++;
        if (retryCount > N) {
          // These are retries — succeed
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: "ws1" }]),
            text: () => Promise.resolve(JSON.stringify([{ id: "ws1" }])),
          });
        }
      }
      return originalImpl(url);
    });

    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all(
      Array.from({ length: N }, () => refreshClient.listWorkspaces()),
    );

    expect(exchangeCallCount).toBe(1);
    expect(results).toHaveLength(N);
  });

  // R2c: after first burst settles (exchange resolved), second 401 → new exchange (total === 2)
  it("R2c: after first burst settles, second 401 triggers a new exchange (latch resets on resolve)", async () => {
    let exchangeCallCount = 0;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/auth/exchange")) {
        exchangeCallCount++;
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ accessToken: NEW_ACCESS_TOKEN, expiresIn: 3600 }),
          text: () => Promise.resolve(""),
        });
      }
      return Promise.resolve({
        ok: false, status: 401,
        json: () => Promise.resolve({ code: "TOKEN_EXPIRED" }),
        text: () => Promise.resolve(""),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // First burst
    await refreshClient.listWorkspaces().catch(() => {});

    // Second 401 after first burst settled
    await refreshClient.listWorkspaces().catch(() => {});

    expect(exchangeCallCount).toBe(2);
  });

  // R2d: after first burst settles (exchange rejected), second 401 → new exchange attempted (latch not stuck)
  it("R2d: after failed burst, second 401 triggers a new exchange (latch resets on reject)", async () => {
    let exchangeCallCount = 0;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/auth/exchange")) {
        exchangeCallCount++;
        return Promise.resolve({
          ok: false, status: 401,
          json: () => Promise.resolve({ code: "REVOKED" }),
          text: () => Promise.resolve(""),
        });
      }
      return Promise.resolve({
        ok: false, status: 401,
        json: () => Promise.resolve({ code: "TOKEN_EXPIRED" }),
        text: () => Promise.resolve(""),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // First burst → exchange fails
    await refreshClient.listWorkspaces().catch(() => {});

    // Second 401 → latch should be cleared; new exchange attempted
    await refreshClient.listWorkspaces().catch(() => {});

    expect(exchangeCallCount).toBe(2);
  });
});
