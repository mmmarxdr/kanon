/**
 * G3 — login() unit tests.
 *
 * Scenarios:
 *   L1 happy path  — correct credentials → credentials written to store
 *   L2 wrong password (401) → process.exit(1) + stderr "Invalid email or password"
 *   L3 no prior install / no server known → process.exit(1) + stderr message
 *   L4 server unreachable (fetch throws)  → process.exit(1) + stderr message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { login } from "./login.js";
import type { CredentialStore } from "./credential-store/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

const SERVER = "server.example.com";
const API_URL = `https://${SERVER}`;
const EMAIL = "dev@example.com";
const PASSWORD = "Password1!";
const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.access.token";
const REFRESH_TOKEN = "opaque-refresh-token-xyz";

function makeStore(existing?: { server: string; refreshToken: string; email: string; savedAt: string } | null): CredentialStore {
  return {
    readCredentials: vi.fn().mockResolvedValue(existing ?? null),
    writeCredentials: vi.fn().mockResolvedValue(undefined),
    clearCredentials: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFetch(responses: Array<{ status: number; body: unknown }>) {
  let callCount = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[callCount] ?? responses[responses.length - 1];
    callCount++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as unknown as Response;
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("login()", () => {
  let store: CredentialStore;

  beforeEach(() => {
    store = makeStore({
      server: SERVER,
      refreshToken: "old-token",
      email: EMAIL,
      savedAt: new Date().toISOString(),
    });
  });

  it("L1 happy path — writes refreshed credentials to store", async () => {
    // POST /api/auth/login → 200 { accessToken }
    // POST /api/auth/refresh-issue → 200 { refreshToken }
    const fetchFn = makeFetch([
      { status: 200, body: { accessToken: ACCESS_TOKEN, refreshToken: "old-stateless-jwt" } },
      { status: 200, body: { refreshToken: REFRESH_TOKEN } },
    ]);

    await login({
      fetchFn,
      credentialStore: store,
      promptEmail: async () => EMAIL,
      promptPassword: async () => PASSWORD,
    });

    // First call: POST /api/auth/login
    const [loginUrl, loginInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe(`${API_URL}/api/auth/login`);
    expect(JSON.parse(loginInit.body as string)).toMatchObject({
      email: EMAIL,
      password: PASSWORD,
    });

    // Second call: POST /api/auth/refresh-issue with Bearer
    const [issueUrl, issueInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(issueUrl).toBe(`${API_URL}/api/auth/refresh-issue`);
    expect((issueInit.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${ACCESS_TOKEN}`,
    );

    // Credentials written with new opaque refresh token
    expect(store.writeCredentials).toHaveBeenCalledWith(
      SERVER,
      expect.objectContaining({
        server: SERVER,
        refreshToken: REFRESH_TOKEN,
        email: EMAIL,
      }),
    );
  });

  it("L2 wrong password (401) → exits 1 with message", async () => {
    const fetchFn = makeFetch([
      { status: 401, body: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } },
    ]);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit");
      });

    await expect(
      login({
        fetchFn,
        credentialStore: store,
        promptEmail: async () => EMAIL,
        promptPassword: async () => PASSWORD,
      }),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toMatch(/invalid email or password/i);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("L3 no prior install / no server known → exits 1", async () => {
    // Store returns null — no known server
    const emptyStore = makeStore(null);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit");
      });

    await expect(
      login({
        fetchFn: vi.fn(),
        credentialStore: emptyStore,
        // No extractServerUrl override — store has no server
        promptEmail: async () => EMAIL,
        promptPassword: async () => PASSWORD,
      }),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toMatch(/no server|not configured|run setup/i);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("L4 server unreachable (fetch throws) → exits 1", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit");
      });

    await expect(
      login({
        fetchFn,
        credentialStore: store,
        promptEmail: async () => EMAIL,
        promptPassword: async () => PASSWORD,
      }),
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrOutput).toMatch(/network|unreachable|failed/i);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
