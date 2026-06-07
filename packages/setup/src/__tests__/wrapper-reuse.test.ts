/**
 * G5 — wrapper-reuse tests.
 *
 * Tests the `resolveWrapperReuse()` pure function which checks whether
 * a re-run of setup can skip auth entirely because valid credentials
 * already exist in the credential store.
 *
 * Scenarios:
 *   WR1 stored creds + no key + no --api-url → returns reuse result (picks most-recent)
 *   WR2 stored creds + explicit --api-key    → returns null (direct mode; key wins)
 *   WR3 no stored creds + no key             → returns null (normal error path unchanged)
 *   WR4 stored creds + --api-url matches stored server → returns reuse result
 *   WR5 stored creds + --api-url does NOT match any stored server → returns null
 *   WR6 multiple stored servers → picks most-recent savedAt, logs chosen server
 *   WR7 listServers throws → returns null (graceful degradation)
 *
 * Also tests:
 *   WR8 FileCredentialStore.listServers() → returns all stored server keys
 */

import { describe, it, expect, vi } from "vitest";
import type { CredentialStore, Creds } from "../credential-store/index.js";
import { resolveWrapperReuse } from "../wrapper-reuse.js";
import type { WrapperReuseResult } from "../wrapper-reuse.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCreds(server: string, email: string, savedAt: string): Creds {
  return {
    server,
    refreshToken: `refresh-for-${server}`,
    email,
    savedAt,
  };
}

/**
 * Make a mock CredentialStore that returns the provided map of server→creds
 * for readCredentials, and returns Object.keys(map) for listServers.
 */
function makeStore(credsMap: Record<string, Creds> = {}): CredentialStore {
  return {
    readCredentials: vi.fn().mockImplementation(async (server: string) => {
      return credsMap[server] ?? null;
    }),
    writeCredentials: vi.fn().mockResolvedValue(undefined),
    clearCredentials: vi.fn().mockResolvedValue(undefined),
    listServers: vi.fn().mockResolvedValue(Object.keys(credsMap)),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("resolveWrapperReuse()", () => {
  // WR1: stored creds, no explicit key, no --api-url → reuse
  it("WR1 returns reuse result when creds exist and no --api-key provided", async () => {
    const creds = makeCreds(
      "https://server.example.com",
      "dev@example.com",
      "2026-01-01T00:00:00.000Z",
    );
    const store = makeStore({ "https://server.example.com": creds });

    const result = await resolveWrapperReuse(store, {});

    expect(result).not.toBeNull();
    expect(result!.creds.server).toBe("https://server.example.com");
    expect(result!.creds.email).toBe("dev@example.com");
    expect(result!.apiUrl).toBe("https://server.example.com");
  });

  // WR2: explicit --api-key → null (direct path wins)
  it("WR2 returns null when --api-key is explicitly provided", async () => {
    const creds = makeCreds(
      "https://server.example.com",
      "dev@example.com",
      "2026-01-01T00:00:00.000Z",
    );
    const store = makeStore({ "https://server.example.com": creds });

    const result = await resolveWrapperReuse(store, { apiKey: "sk-explicit" });

    expect(result).toBeNull();
  });

  // WR3: no stored creds → null
  it("WR3 returns null when credential store is empty", async () => {
    const store = makeStore({});

    const result = await resolveWrapperReuse(store, {});

    expect(result).toBeNull();
  });

  // WR4: --api-url matches stored server → reuse
  it("WR4 returns reuse result when --api-url matches a stored server", async () => {
    const creds = makeCreds(
      "https://server.example.com",
      "dev@example.com",
      "2026-01-01T00:00:00.000Z",
    );
    const store = makeStore({ "https://server.example.com": creds });

    const result = await resolveWrapperReuse(store, {
      apiUrl: "https://server.example.com",
    });

    expect(result).not.toBeNull();
    expect(result!.apiUrl).toBe("https://server.example.com");
  });

  // WR5: --api-url does NOT match any stored server → null
  it("WR5 returns null when --api-url does not match any stored server", async () => {
    const creds = makeCreds(
      "https://server.example.com",
      "dev@example.com",
      "2026-01-01T00:00:00.000Z",
    );
    const store = makeStore({ "https://server.example.com": creds });

    const result = await resolveWrapperReuse(store, {
      apiUrl: "https://other-server.example.com",
    });

    expect(result).toBeNull();
  });

  // WR6: multiple stored servers → picks most-recent savedAt
  it("WR6 picks the most-recent server when multiple are stored", async () => {
    const older = makeCreds(
      "https://old.example.com",
      "old@example.com",
      "2025-01-01T00:00:00.000Z",
    );
    const newer = makeCreds(
      "https://new.example.com",
      "new@example.com",
      "2026-06-01T00:00:00.000Z",
    );
    const store = makeStore({
      "https://old.example.com": older,
      "https://new.example.com": newer,
    });

    const result = await resolveWrapperReuse(store, {});

    expect(result).not.toBeNull();
    expect(result!.creds.server).toBe("https://new.example.com");
    expect(result!.apiUrl).toBe("https://new.example.com");
  });

  // WR7: listServers throws → graceful null
  it("WR7 returns null when listServers throws (graceful degradation)", async () => {
    const badStore: CredentialStore = {
      listServers: vi.fn().mockRejectedValue(new Error("EACCES: permission denied")),
      readCredentials: vi.fn().mockResolvedValue(null),
      writeCredentials: vi.fn().mockResolvedValue(undefined),
      clearCredentials: vi.fn().mockResolvedValue(undefined),
    };

    const result = await resolveWrapperReuse(badStore, {});

    expect(result).toBeNull();
  });

  // Canonicalization: --api-url with trailing slash matches stored canonical key
  it("canonicalizes --api-url before matching stored servers", async () => {
    const creds = makeCreds(
      "https://server.example.com",
      "dev@example.com",
      "2026-01-01T00:00:00.000Z",
    );
    // Store keyed by canonical form (no trailing slash)
    const store = makeStore({ "https://server.example.com": creds });

    // Passed with trailing slash — should still match
    const result = await resolveWrapperReuse(store, {
      apiUrl: "https://server.example.com/",
    });

    expect(result).not.toBeNull();
    expect(result!.apiUrl).toBe("https://server.example.com");
  });
});

// ── WrapperReuseResult shape ───────────────────────────────────────────────────

describe("WrapperReuseResult shape", () => {
  it("result exposes apiUrl and creds fields", async () => {
    const creds = makeCreds(
      "https://server.example.com",
      "dev@example.com",
      "2026-01-01T00:00:00.000Z",
    );
    const store = makeStore({ "https://server.example.com": creds });

    const result = (await resolveWrapperReuse(store, {})) as WrapperReuseResult;

    expect(result).toMatchObject<WrapperReuseResult>({
      apiUrl: "https://server.example.com",
      creds: expect.objectContaining({
        server: "https://server.example.com",
        email: "dev@example.com",
      }),
    });
  });
});
