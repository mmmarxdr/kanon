import { afterEach, describe, expect, it, vi } from "vitest";
import { RedmineHttpClient, RedmineHttpError } from "./http-client.js";

const publicDns = async () => [{ address: "203.0.114.10", family: 4 } as const];
const response = (statusCode: number, body = "") => ({
  statusCode,
  body: { text: vi.fn().mockResolvedValue(body) },
});

describe("RedmineHttpClient", () => {
  afterEach(() => vi.useRealTimers());

  it("sends authenticated JSON with a pinned dispatcher and redirects disabled", async () => {
    const transport = vi.fn().mockResolvedValue(response(200, '{"id":7}'));
    const client = new RedmineHttpClient("https://redmine.example/redmine", "api-secret", {
      resolve: publicDns,
      transport,
    });

    await expect(client.get<{ id: number }>("/my/account.json")).resolves.toEqual({ id: 7 });

    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe("https://redmine.example/redmine/my/account.json");
    expect(options).toMatchObject({
      method: "GET",
      headers: { "X-Redmine-API-Key": "api-secret", accept: "application/json" },
      maxRedirections: 0,
      headersTimeout: 10_000,
      bodyTimeout: 10_000,
    });
    expect(options.dispatcher).toBeDefined();
  });

  it("serializes request bodies and does not retry non-idempotent creates", async () => {
    const transport = vi.fn().mockResolvedValue(response(500));
    const client = new RedmineHttpClient("https://redmine.example", "secret", {
      resolve: publicDns,
      transport,
      sleep: vi.fn(),
    });

    await expect(client.post("/issues.json", { issue: { subject: "A" } })).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: '{"issue":{"subject":"A"}}',
      headers: { "content-type": "application/json" },
    });
  });

  it("re-resolves and retries idempotent requests after 429 and 5xx", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, '{"projects":[]}'));
    const resolve = vi.fn(publicDns);
    const sleep = vi.fn();
    const client = new RedmineHttpClient("https://redmine.example", "secret", {
      resolve,
      transport,
      sleep,
    });

    await expect(client.get("/projects.json")).resolves.toEqual({ projects: [] });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(new Set(transport.mock.calls.map(([, options]) => options.dispatcher)).size).toBe(3);
  });

  it("blocks a private DNS rebound before a retry can send credentials", async () => {
    const transport = vi.fn().mockResolvedValue(response(503));
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([{ address: "203.0.114.10", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const client = new RedmineHttpClient("https://redmine.example", "secret", {
      resolve,
      transport,
      sleep: vi.fn(),
    });

    await expect(client.get("/projects.json")).rejects.toThrow("Unsafe remote endpoint");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("re-resolves an allowlisted private HTTP origin and fails closed on mismatch", async () => {
    const transport = vi.fn().mockResolvedValue(response(200, "{}"));
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([{ address: "10.20.30.40", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.20.30.41", family: 4 }]);
    const client = new RedmineHttpClient("http://redmine.internal.example", "secret", {
      endpointAllowlist: { "http://redmine.internal.example": ["10.20.30.40"] },
      resolve,
      transport,
    });

    await expect(client.get("/projects.json")).resolves.toEqual({});
    await expect(client.get("/projects.json")).rejects.toThrow("Unsafe remote endpoint");

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]![0]).toBe("http://redmine.internal.example/projects.json");
    expect(transport.mock.calls[0]![1]).toMatchObject({ maxRedirections: 0 });
  });

  it("aborts requests at the configured timeout", async () => {
    vi.useFakeTimers();
    const transport = vi.fn((_url, options) => {
      return new Promise<never>((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const client = new RedmineHttpClient("https://redmine.example", "secret", {
      resolve: publicDns,
      transport,
      timeoutMs: 25,
    });

    const result = expect(client.get("/projects.json")).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(25);
    await result;
  });

  it("times out before sending credentials when DNS resolution hangs", async () => {
    vi.useFakeTimers();
    const transport = vi.fn();
    const client = new RedmineHttpClient("https://redmine.example", "secret", {
      resolve: vi.fn(() => new Promise<never>(() => {})),
      transport,
      timeoutMs: 25,
    });

    const result = expect(client.get("/projects.json")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(25);
    await result;
    expect(transport).not.toHaveBeenCalled();
  });

  it("returns status errors without following redirects or leaking credentials", async () => {
    const transport = vi.fn().mockResolvedValue(response(302));
    const client = new RedmineHttpClient("https://redmine.example", "api-secret", {
      resolve: publicDns,
      transport,
    });

    const error = await client.get("/redirect").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RedmineHttpError);
    expect(error).toMatchObject({ statusCode: 302 });
    expect(String(error)).not.toContain("api-secret");
    expect(transport).toHaveBeenCalledOnce();
  });
});
