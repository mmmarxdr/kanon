import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpawnOptions } from "child_process";

// ─── Types ─────────────────────────────────────────────────────────────────

import type { WrapperDeps } from "./wrapper.js";
import type { CredentialStore } from "./credential-store/types.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a minimal mock ChildProcess EventEmitter.
 * Needs: .on("exit", cb), .on("error", cb), .kill()
 */
function makeMockChild(exitCode: number = 0) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const child = {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event]!.push(cb);
      return child;
    },
    off: vi.fn().mockReturnThis(),
    kill: vi.fn(),
    _emit(event: string, ...args: unknown[]) {
      for (const cb of listeners[event] ?? []) cb(...args);
    },
  };

  // Fire the exit event after the microtask queue drains
  setImmediate(() => child._emit("exit", exitCode));

  return child;
}

function makeSpawn(child: ReturnType<typeof makeMockChild>) {
  return vi.fn().mockReturnValue(child);
}

function makeCredStore(creds: { refreshToken: string } | null): CredentialStore {
  return {
    readCredentials: vi.fn().mockResolvedValue(
      creds
        ? {
            server: "https://server.example.com",
            refreshToken: creds.refreshToken,
            email: "dev@example.com",
            savedAt: new Date().toISOString(),
          }
        : null
    ),
    writeCredentials: vi.fn().mockResolvedValue(undefined),
    clearCredentials: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe("runWrapper", () => {
  let stderrOutput: string[];
  let exitCode: number | undefined;

  beforeEach(() => {
    stderrOutput = [];
    exitCode = undefined;
  });

  /**
   * S4.1 — Happy path: valid refresh → exchange → spawn with accessToken
   */
  it("S4.1: exchanges refresh token and spawns MCP server with KANON_API_KEY", async () => {
    const { runWrapper } = await import("./wrapper.js");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accessToken: "acc-token-123", expiresIn: 900 }),
    });

    const mockChild = makeMockChild(0);
    const spawnFn = makeSpawn(mockChild);

    const deps: WrapperDeps = {
      argv: ["node", "wrapper.js", "--server", "https://server.example.com"],
      env: {},
      fetch: mockFetch,
      getCredentialStore: () => makeCredStore({ refreshToken: "refresh-tok-abc" }),
      stderr: { write: (s: string) => { stderrOutput.push(s); } },
      exit: (code: number) => { exitCode = code; },
      spawn: spawnFn as unknown as WrapperDeps["spawn"],
    };

    await runWrapper(deps);

    // fetch called with correct endpoint + body
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://server.example.com/api/auth/exchange");
    const body = JSON.parse(init.body as string) as { refreshToken: string };
    expect(body.refreshToken).toBe("refresh-tok-abc");

    // spawn called with inherited stdio + KANON_API_KEY injected
    expect(spawnFn).toHaveBeenCalledOnce();
    const [, , opts] = spawnFn.mock.calls[0] as [string, string[], SpawnOptions & { env: Record<string, string> }];
    expect(opts.stdio).toBe("inherit");
    expect(opts.env["KANON_API_KEY"]).toBe("acc-token-123");
    expect(opts.env["KANON_API_URL"]).toBe("https://server.example.com");

    // exits with child's exit code
    expect(exitCode).toBe(0);
    expect(stderrOutput).toHaveLength(0);
  });

  /**
   * S4.2 — Exchange returns 4xx → wrapper exits 1, MCP NOT spawned
   */
  it("S4.2: exchange 401 → stderr message + exit 1, MCP not spawned", async () => {
    const { runWrapper } = await import("./wrapper.js");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "TOKEN_REVOKED" }),
    });

    const spawnFn = vi.fn();

    const deps: WrapperDeps = {
      argv: ["node", "wrapper.js", "--server", "https://server.example.com"],
      env: {},
      fetch: mockFetch,
      getCredentialStore: () => makeCredStore({ refreshToken: "stale-token" }),
      stderr: { write: (s: string) => { stderrOutput.push(s); } },
      exit: (code: number) => { exitCode = code; },
      spawn: spawnFn as unknown as WrapperDeps["spawn"],
    };

    await runWrapper(deps);

    expect(spawnFn).not.toHaveBeenCalled();
    expect(exitCode).toBe(1);
    expect(stderrOutput.join("")).toMatch(/Refresh expired or revoked/i);
    expect(stderrOutput.join("")).toMatch(/npx @kanon-pm\/setup login/i);
  });

  /**
   * S4.3a — KANON_API_KEY is a static (non-JWT) key → FAIL FAST, no spawn
   * Static API keys were removed in PR1 (KAN-35). Must redirect to onboarding.
   */
  it("S4.3a: KANON_API_KEY is a static key → stderr onboarding message + exit 1, MCP not spawned", async () => {
    const { runWrapper } = await import("./wrapper.js");

    const mockFetch = vi.fn();
    const mockStore = makeCredStore({ refreshToken: "should-not-be-read" });
    const spawnFn = vi.fn();

    const deps: WrapperDeps = {
      argv: ["node", "wrapper.js", "--server", "https://server.example.com"],
      env: { KANON_API_KEY: "sk-statickey" },
      fetch: mockFetch,
      getCredentialStore: () => mockStore,
      stderr: { write: (s: string) => { stderrOutput.push(s); } },
      exit: (code: number) => { exitCode = code; },
      spawn: spawnFn as unknown as WrapperDeps["spawn"],
    };

    await runWrapper(deps);

    // No credential store read, no exchange call, no spawn
    expect(mockStore.readCredentials).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(spawnFn).not.toHaveBeenCalled();

    // Must fail with a clear message pointing to onboarding
    expect(exitCode).toBe(1);
    expect(stderrOutput.join("")).toMatch(/static API key/i);
    expect(stderrOutput.join("")).toMatch(/npx @kanon-pm\/setup/i);
  });

  /**
   * S4.3b — KANON_API_KEY is a JWT (eyJ…) preset → JWT passthrough: no exchange, spawns directly
   * Dev/CI environments injecting a real access token should still work.
   */
  it("S4.3b: KANON_API_KEY is a JWT preset → skips exchange, spawns with existing JWT", async () => {
    const { runWrapper } = await import("./wrapper.js");

    const mockFetch = vi.fn();
    const mockStore = makeCredStore({ refreshToken: "should-not-be-read" });
    const mockChild = makeMockChild(0);
    const spawnFn = makeSpawn(mockChild);

    const jwtToken = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig";

    const deps: WrapperDeps = {
      argv: ["node", "wrapper.js", "--server", "https://server.example.com"],
      env: { KANON_API_KEY: jwtToken },
      fetch: mockFetch,
      getCredentialStore: () => mockStore,
      stderr: { write: (s: string) => { stderrOutput.push(s); } },
      exit: (code: number) => { exitCode = code; },
      spawn: spawnFn as unknown as WrapperDeps["spawn"],
    };

    await runWrapper(deps);

    // No credential store read, no exchange call
    expect(mockStore.readCredentials).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();

    // Spawn called with passthrough JWT
    expect(spawnFn).toHaveBeenCalledOnce();
    const [, , opts] = spawnFn.mock.calls[0] as [string, string[], SpawnOptions & { env: Record<string, string> }];
    expect(opts.env["KANON_API_KEY"]).toBe(jwtToken);

    expect(exitCode).toBe(0);
    expect(stderrOutput).toHaveLength(0);
  });

  /**
   * S4.4 — Network failure during exchange → exit 1
   */
  it("S4.4: network failure during exchange → stderr + exit 1, MCP not spawned", async () => {
    const { runWrapper } = await import("./wrapper.js");

    const mockFetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
    );

    const spawnFn = vi.fn();

    const deps: WrapperDeps = {
      argv: ["node", "wrapper.js", "--server", "https://server.example.com"],
      env: {},
      fetch: mockFetch,
      getCredentialStore: () => makeCredStore({ refreshToken: "tok" }),
      stderr: { write: (s: string) => { stderrOutput.push(s); } },
      exit: (code: number) => { exitCode = code; },
      spawn: spawnFn as unknown as WrapperDeps["spawn"],
    };

    await runWrapper(deps);

    expect(spawnFn).not.toHaveBeenCalled();
    expect(exitCode).toBe(1);
    expect(stderrOutput.join("")).toMatch(/server\.example\.com/);
    expect(stderrOutput.join("")).toMatch(/npx @kanon-pm\/setup login/i);
  });

  /**
   * S4.5 — No credentials in store → stderr "No credentials found" + exit 1
   */
  it("S4.5: no credentials in store → stderr + exit 1", async () => {
    const { runWrapper } = await import("./wrapper.js");

    const mockFetch = vi.fn();
    const spawnFn = vi.fn();

    const deps: WrapperDeps = {
      argv: ["node", "wrapper.js", "--server", "https://server.example.com"],
      env: {},
      fetch: mockFetch,
      getCredentialStore: () => makeCredStore(null),
      stderr: { write: (s: string) => { stderrOutput.push(s); } },
      exit: (code: number) => { exitCode = code; },
      spawn: spawnFn as unknown as WrapperDeps["spawn"],
    };

    await runWrapper(deps);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(spawnFn).not.toHaveBeenCalled();
    expect(exitCode).toBe(1);
    expect(stderrOutput.join("")).toMatch(/No credentials found/i);
    expect(stderrOutput.join("")).toMatch(/npx @kanon-pm\/setup/i);
  });
});
