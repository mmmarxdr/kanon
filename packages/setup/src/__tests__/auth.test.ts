import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveAuth, isLocalhost } from "../auth.js";
import type { PlatformContext, AuthDeps } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockCtx(): PlatformContext {
  return {
    platform: "linux",
    homedir: "/home/testuser",
  };
}

function makeMockFetch(responses: Array<{ ok: boolean; data: unknown }>): typeof globalThis.fetch {
  let callIndex = 0;
  return async () => {
    const resp = responses[callIndex++];
    if (!resp) {
      throw new Error("Unexpected fetch call");
    }
    return {
      ok: resp.ok,
      status: resp.ok ? 200 : 500,
      json: async () => resp.data,
    } as Response;
  };
}

// ── isLocalhost ──────────────────────────────────────────────────────────────

describe("isLocalhost", () => {
  it("should return true for localhost", () => {
    expect(isLocalhost("http://localhost:3000")).toBe(true);
    expect(isLocalhost("http://localhost")).toBe(true);
    expect(isLocalhost("https://localhost:8443/path")).toBe(true);
  });

  it("should return true for 127.0.0.1", () => {
    expect(isLocalhost("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalhost("http://127.0.0.1")).toBe(true);
  });

  it("should return true for ::1", () => {
    expect(isLocalhost("http://[::1]:3000")).toBe(true);
    expect(isLocalhost("http://[::1]")).toBe(true);
  });

  it("should return true for 0.0.0.0", () => {
    expect(isLocalhost("http://0.0.0.0:3000")).toBe(true);
  });

  it("should return false for remote URLs", () => {
    expect(isLocalhost("https://kanon.example.com")).toBe(false);
    expect(isLocalhost("http://192.168.1.100:3000")).toBe(false);
    expect(isLocalhost("https://api.kanon.io")).toBe(false);
  });

  it("should return false for invalid URLs", () => {
    expect(isLocalhost("not-a-url")).toBe(false);
    expect(isLocalhost("")).toBe(false);
  });
});

// NOTE: autoGenerateApiKey was removed in PR1 (KAN-35).
// POST /api/auth/api-key no longer exists. Onboard via the installer (install.sh).

// ── resolveAuth cascade ──────────────────────────────────────────────────────

describe("resolveAuth", () => {
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    delete process.env["KANON_API_URL"];
    delete process.env["KANON_API_KEY"];
    // Ensure TTY for prompt tests
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true, configurable: true });
  });

  const ctx = makeMockCtx();

  // Deps that block prompts by default
  function baseDeps(overrides?: Partial<AuthDeps>): AuthDeps {
    return {
      extractExisting: () => ({}),
      promptUrl: async () => { throw new Error("promptUrl should not be called"); },
      promptKey: async () => { throw new Error("promptKey should not be called"); },
      fetchFn: async () => { throw new Error("fetchFn should not be called"); },
      ...overrides,
    };
  }

  describe("flag precedence", () => {
    it("should use CLI flags over env vars", async () => {
      process.env["KANON_API_URL"] = "http://env-url";
      process.env["KANON_API_KEY"] = "env-key";

      const result = await resolveAuth(
        { apiUrl: "http://flag-url", apiKey: "flag-key" },
        ctx,
        baseDeps(),
      );

      expect(result.apiUrl).toBe("http://flag-url");
      expect(result.apiKey).toBe("flag-key");
      expect(result.urlSource).toBe("flag");
      expect(result.keySource).toBe("flag");
    });
  });

  describe("env var fallback", () => {
    it("should use env vars when no flags are provided", async () => {
      process.env["KANON_API_URL"] = "http://env-url";
      process.env["KANON_API_KEY"] = "env-key";

      const result = await resolveAuth({}, ctx, baseDeps());

      expect(result.apiUrl).toBe("http://env-url");
      expect(result.apiKey).toBe("env-key");
      expect(result.urlSource).toBe("env");
      expect(result.keySource).toBe("env");
    });
  });

  describe("existing config fallback", () => {
    it("should use existing config when no flag or env", async () => {
      const result = await resolveAuth({}, ctx, baseDeps({
        extractExisting: () => ({
          apiUrl: "http://existing-url",
          apiKey: "existing-key",
        }),
      }));

      expect(result.apiUrl).toBe("http://existing-url");
      expect(result.apiKey).toBe("existing-key");
      expect(result.urlSource).toBe("existing-config");
      expect(result.keySource).toBe("existing-config");
    });

    it("should prefer env over existing config", async () => {
      process.env["KANON_API_URL"] = "http://env-url";
      process.env["KANON_API_KEY"] = "env-key";

      const result = await resolveAuth({}, ctx, baseDeps({
        extractExisting: () => ({
          apiUrl: "http://existing-url",
          apiKey: "existing-key",
        }),
      }));

      expect(result.apiUrl).toBe("http://env-url");
      expect(result.apiKey).toBe("env-key");
      expect(result.urlSource).toBe("env");
      expect(result.keySource).toBe("env");
    });
  });

  describe("auto-detect localhost URL fallback", () => {
    it("should auto-detect localhost URL when health check passes, then prompt for key", async () => {
      // URL is auto-detected; key has no auto-generate step anymore (removed in PR1).
      const result = await resolveAuth({}, ctx, baseDeps({
        fetchFn: async (urlArg: string | URL | Request) => {
          const url = typeof urlArg === "string" ? urlArg : String(urlArg);
          if (url === "http://localhost:3000/health") {
            return { ok: true } as Response;
          }
          throw new Error("unexpected fetch");
        },
        promptKey: async () => "k-prompted",
      }));

      expect(result.apiUrl).toBe("http://localhost:3000");
      expect(result.urlSource).toBe("auto-generated");
      expect(result.apiKey).toBe("k-prompted");
      expect(result.keySource).toBe("prompt");
    });
  });

  describe("interactive prompt fallback", () => {
    it("should prompt for URL and key when all auto steps fail", async () => {
      const result = await resolveAuth({}, ctx, baseDeps({
        fetchFn: async () => { throw new Error("no server"); },
        autoGenerateKey: async () => null,
        promptUrl: async () => "http://prompted-url",
        promptKey: async () => "prompted-key",
      }));

      expect(result.apiUrl).toBe("http://prompted-url");
      expect(result.apiKey).toBe("prompted-key");
      expect(result.urlSource).toBe("prompt");
      expect(result.keySource).toBe("prompt");
    });
  });

  describe("--yes mode", () => {
    it("should throw when URL cannot be resolved non-interactively", async () => {
      await expect(
        resolveAuth({ yes: true }, ctx, baseDeps({
          fetchFn: async () => { throw new Error("no server"); },
        })),
      ).rejects.toThrow("API URL could not be resolved automatically");
    });

    it("should throw when key cannot be resolved non-interactively", async () => {
      process.env["KANON_API_URL"] = "http://localhost:3000";

      await expect(
        resolveAuth({ yes: true }, ctx, baseDeps()),
      ).rejects.toThrow("API key could not be resolved automatically");
    });

    it("should succeed when URL and key come from env", async () => {
      process.env["KANON_API_URL"] = "http://localhost:3000";
      process.env["KANON_API_KEY"] = "k-env";

      const result = await resolveAuth({ yes: true }, ctx, baseDeps());

      expect(result.apiUrl).toBe("http://localhost:3000");
      expect(result.apiKey).toBe("k-env");
    });
  });

  describe("non-TTY mode", () => {
    it("should throw when no auth and stdin is not a TTY", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

      await expect(
        resolveAuth({}, ctx, baseDeps({
          fetchFn: async () => { throw new Error("no server"); },
        })),
      ).rejects.toThrow("API URL could not be resolved automatically");
    });
  });
});
