import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EngramClient } from "./engram-client.js";
import { EngramConnectionError } from "./types.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: response.json ?? (() => Promise.resolve({})),
    text: response.text ?? (() => Promise.resolve("")),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── health ────────────────────────────────────────────────────────────────

describe("EngramClient.health", () => {
  it('returns true when status is "ok"', async () => {
    mockFetch({
      json: () =>
        Promise.resolve({
          service: "engram",
          status: "ok",
          version: "1.0.0",
        }),
    });

    const client = new EngramClient();
    expect(await client.health()).toBe(true);
  });

  it("returns false on non-ok status", async () => {
    mockFetch({
      json: () =>
        Promise.resolve({
          service: "engram",
          status: "degraded",
          version: "1.0.0",
        }),
    });

    const client = new EngramClient();
    expect(await client.health()).toBe(false);
  });

  it("returns false on network error (connection refused)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const client = new EngramClient();
    expect(await client.health()).toBe(false);
  });
});

// ─── checkConnectivity ─────────────────────────────────────────────────────

describe("EngramClient.checkConnectivity", () => {
  it("returns ok with version on healthy response", async () => {
    mockFetch({
      json: () =>
        Promise.resolve({
          service: "engram",
          status: "ok",
          version: "2.0.0",
        }),
    });

    const client = new EngramClient();
    const result = await client.checkConnectivity();

    expect(result.ok).toBe(true);
    expect(result.version).toBe("2.0.0");
    expect(result.error).toBeUndefined();
  });

  it("returns error message on connection failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const client = new EngramClient({ baseUrl: "http://localhost:9999" });
    const result = await client.checkConnectivity();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Connection refused");
    expect(result.error).toContain("localhost:9999");
  });
});

// ─── search ────────────────────────────────────────────────────────────────

describe("EngramClient.search", () => {
  it("sends correct URL parameters", async () => {
    const fetchMock = mockFetch({
      json: () => Promise.resolve([]),
    });

    const client = new EngramClient({ baseUrl: "http://engram:7437" });
    await client.search("my query", {
      project: "kanon",
      type: "architecture",
      limit: 5,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/search?");
    expect(url).toContain("q=my+query");
    expect(url).toContain("project=kanon");
    expect(url).toContain("type=architecture");
    expect(url).toContain("limit=5");
  });

  it("returns search results", async () => {
    const mockResults = [
      { id: 1, title: "Result 1", rank: 1, content: "content" },
      { id: 2, title: "Result 2", rank: 2, content: "content" },
    ];
    mockFetch({ json: () => Promise.resolve(mockResults) });

    const client = new EngramClient();
    const results = await client.search("test");

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe(1);
  });

  it("throws EngramConnectionError on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const client = new EngramClient();
    await expect(client.search("test")).rejects.toThrow(EngramConnectionError);
  });
});

// ─── getObservation ────────────────────────────────────────────────────────

describe("EngramClient.getObservation", () => {
  it("fetches observation by ID", async () => {
    const obs = { id: 42, title: "My Observation", content: "Full content" };
    const fetchMock = mockFetch({ json: () => Promise.resolve(obs) });

    const client = new EngramClient();
    const result = await client.getObservation(42);

    expect(result.id).toBe(42);
    expect(result.content).toBe("Full content");

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/observations/42");
  });

  it("throws EngramConnectionError on 404", async () => {
    mockFetch({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    });

    const client = new EngramClient();
    await expect(client.getObservation(999)).rejects.toThrow(
      EngramConnectionError,
    );
    await expect(client.getObservation(999)).rejects.toThrow(/404/);
  });
});

// ─── listRecent ────────────────────────────────────────────────────────────

describe("EngramClient.listRecent", () => {
  it("sends project and limit parameters", async () => {
    const fetchMock = mockFetch({ json: () => Promise.resolve([]) });

    const client = new EngramClient();
    await client.listRecent("kanon", 10);

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/observations/recent?");
    expect(url).toContain("project=kanon");
    expect(url).toContain("limit=10");
  });

  it("works without parameters", async () => {
    const fetchMock = mockFetch({ json: () => Promise.resolve([]) });

    const client = new EngramClient();
    await client.listRecent();

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/observations/recent");
    expect(url).not.toContain("?");
  });

  it("returns list of observations", async () => {
    const mockObs = [
      { id: 1, title: "Recent 1" },
      { id: 2, title: "Recent 2" },
    ];
    mockFetch({ json: () => Promise.resolve(mockObs) });

    const client = new EngramClient();
    const results = await client.listRecent();

    expect(results).toHaveLength(2);
  });
});

// ─── createObservation ────────────────────────────────────────────────────

describe("EngramClient.createObservation", () => {
  it("sends POST to /observations with correct headers and body", async () => {
    const created = {
      id: 100,
      title: "New Observation",
      content: "Some content",
      type: "decision",
      project: "kanon",
      scope: "project",
      topic_key: "arch/auth",
    };
    const fetchMock = mockFetch({ json: () => Promise.resolve(created) });

    const client = new EngramClient({ baseUrl: "http://engram:7437" });
    const result = await client.createObservation({
      title: "New Observation",
      content: "Some content",
      type: "decision",
      project: "kanon",
      scope: "project",
      topic_key: "arch/auth",
    });

    expect(fetchMock).toHaveBeenCalledOnce();

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe("http://engram:7437/observations");

    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect((options.headers as Record<string, string>)["Accept"]).toBe(
      "application/json",
    );

    const sentBody = JSON.parse(options.body as string);
    expect(sentBody).toEqual({
      title: "New Observation",
      content: "Some content",
      type: "decision",
      project: "kanon",
      scope: "project",
      topic_key: "arch/auth",
    });

    expect(result.id).toBe(100);
    expect(result.title).toBe("New Observation");
  });

  it("sends Authorization header when apiKey is provided", async () => {
    mockFetch({
      json: () =>
        Promise.resolve({ id: 101, title: "Obs", content: "c" }),
    });
    const fetchMock = vi.mocked(fetch);

    const client = new EngramClient({
      baseUrl: "http://engram:7437",
      apiKey: "secret-key",
    });
    await client.createObservation({
      title: "Obs",
      content: "c",
      type: "bugfix",
      project: "kanon",
      scope: "project",
      topic_key: "bugs/fix-1",
    });

    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer secret-key",
    );
  });

  it("returns the created observation", async () => {
    const created = {
      id: 200,
      sync_id: "abc",
      session_id: "sess1",
      title: "Created",
      content: "body",
      type: "architecture",
      project: "kanon",
      scope: "project",
      topic_key: "sdd/test/spec",
      revision_count: 0,
      duplicate_count: 0,
      last_seen_at: "2026-03-22T00:00:00Z",
      created_at: "2026-03-22T00:00:00Z",
      updated_at: "2026-03-22T00:00:00Z",
    };
    mockFetch({ json: () => Promise.resolve(created) });

    const client = new EngramClient();
    const result = await client.createObservation({
      title: "Created",
      content: "body",
      type: "architecture",
      project: "kanon",
      scope: "project",
      topic_key: "sdd/test/spec",
    });

    expect(result).toEqual(created);
  });

  it("throws EngramConnectionError on non-OK response", async () => {
    mockFetch({
      ok: false,
      status: 422,
      text: () => Promise.resolve("Validation failed"),
    });

    const client = new EngramClient();
    await expect(
      client.createObservation({
        title: "Bad",
        content: "",
        type: "bugfix",
        project: "kanon",
        scope: "project",
        topic_key: "test",
      }),
    ).rejects.toThrow(EngramConnectionError);
    await expect(
      client.createObservation({
        title: "Bad",
        content: "",
        type: "bugfix",
        project: "kanon",
        scope: "project",
        topic_key: "test",
      }),
    ).rejects.toThrow(/422/);
  });

  it("throws EngramConnectionError on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const client = new EngramClient();
    await expect(
      client.createObservation({
        title: "Fail",
        content: "c",
        type: "bugfix",
        project: "kanon",
        scope: "project",
        topic_key: "test",
      }),
    ).rejects.toThrow(EngramConnectionError);
  });
});

// ─── updateObservation ────────────────────────────────────────────────────

describe("EngramClient.updateObservation", () => {
  it("sends PATCH to /observations/:id with correct headers and body", async () => {
    const updated = {
      id: 42,
      title: "Updated Title",
      content: "Updated content",
      type: "decision",
    };
    const fetchMock = mockFetch({ json: () => Promise.resolve(updated) });

    const client = new EngramClient({ baseUrl: "http://engram:7437" });
    const result = await client.updateObservation(42, {
      title: "Updated Title",
      content: "Updated content",
    });

    expect(fetchMock).toHaveBeenCalledOnce();

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe("http://engram:7437/observations/42");

    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(options.method).toBe("PATCH");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect((options.headers as Record<string, string>)["Accept"]).toBe(
      "application/json",
    );

    const sentBody = JSON.parse(options.body as string);
    expect(sentBody).toEqual({
      title: "Updated Title",
      content: "Updated content",
    });

    expect(result.id).toBe(42);
    expect(result.title).toBe("Updated Title");
  });

  it("sends partial payload (only content)", async () => {
    const fetchMock = mockFetch({
      json: () =>
        Promise.resolve({ id: 10, title: "Original", content: "New body" }),
    });

    const client = new EngramClient();
    await client.updateObservation(10, { content: "New body" });

    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    const sentBody = JSON.parse(options.body as string);
    expect(sentBody).toEqual({ content: "New body" });
    expect(sentBody.title).toBeUndefined();
  });

  it("sends Authorization header when apiKey is provided", async () => {
    mockFetch({
      json: () => Promise.resolve({ id: 5, title: "T", content: "C" }),
    });
    const fetchMock = vi.mocked(fetch);

    const client = new EngramClient({ apiKey: "patch-key" });
    await client.updateObservation(5, { title: "T" });

    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer patch-key",
    );
  });

  it("returns the updated observation", async () => {
    const updated = {
      id: 55,
      sync_id: "xyz",
      session_id: "sess2",
      title: "Patched",
      content: "patched content",
      type: "bugfix",
      project: "kanon",
      scope: "project",
      topic_key: "bugs/fix-2",
      revision_count: 3,
      duplicate_count: 0,
      last_seen_at: "2026-03-22T12:00:00Z",
      created_at: "2026-03-22T00:00:00Z",
      updated_at: "2026-03-22T12:00:00Z",
    };
    mockFetch({ json: () => Promise.resolve(updated) });

    const client = new EngramClient();
    const result = await client.updateObservation(55, {
      title: "Patched",
      content: "patched content",
    });

    expect(result).toEqual(updated);
  });

  it("throws EngramConnectionError on non-OK response", async () => {
    mockFetch({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Observation not found"),
    });

    const client = new EngramClient();
    await expect(
      client.updateObservation(999, { title: "Nope" }),
    ).rejects.toThrow(EngramConnectionError);
    await expect(
      client.updateObservation(999, { title: "Nope" }),
    ).rejects.toThrow(/404/);
  });

  it("throws EngramConnectionError on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const client = new EngramClient();
    await expect(
      client.updateObservation(1, { content: "fail" }),
    ).rejects.toThrow(EngramConnectionError);
  });

  it("includes URL in EngramConnectionError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const client = new EngramClient({ baseUrl: "http://engram:7437" });
    try {
      await client.updateObservation(77, { title: "fail" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EngramConnectionError);
      expect((err as EngramConnectionError).url).toBe(
        "http://engram:7437/observations/77",
      );
    }
  });
});

// ─── Error handling ────────────────────────────────────────────────────────

describe("EngramClient error handling", () => {
  it("includes URL in EngramConnectionError on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const client = new EngramClient({ baseUrl: "http://engram:7437" });
    try {
      await client.search("test");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EngramConnectionError);
      expect((err as EngramConnectionError).url).toContain("engram:7437");
    }
  });

  it("includes HTTP status in error on non-2xx response", async () => {
    mockFetch({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const client = new EngramClient();
    await expect(client.search("test")).rejects.toThrow(/500/);
  });

  it("sends Authorization header when apiKey is provided", async () => {
    const fetchMock = mockFetch({ json: () => Promise.resolve([]) });

    const client = new EngramClient({ apiKey: "my-secret-key" });
    await client.listRecent();

    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-secret-key",
    );
  });

  it("does not send Authorization header when no apiKey", async () => {
    const fetchMock = mockFetch({ json: () => Promise.resolve([]) });

    const client = new EngramClient();
    await client.listRecent();

    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(
      (options.headers as Record<string, string>)["Authorization"],
    ).toBeUndefined();
  });

  it("strips trailing slash from baseUrl", async () => {
    const fetchMock = mockFetch({ json: () => Promise.resolve([]) });

    const client = new EngramClient({
      baseUrl: "http://engram:7437/",
    });
    await client.listRecent();

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toMatch(/^http:\/\/engram:7437\/observations/);
    expect(url).not.toContain("//observations");
  });
});
