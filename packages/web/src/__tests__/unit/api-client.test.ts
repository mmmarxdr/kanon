import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useAuthStore } from "@/stores/auth-store";

// We test api-client by importing it after setting up fetch mocks.
// The module now uses cookie-based auth (credentials: 'include') instead of tokens.

describe("fetchApi", () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = window.location;

  beforeEach(() => {
    // Reset auth store
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });

    // Mock window.location
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
      configurable: true,
    });

    // Mock document.cookie for CSRF tests
    Object.defineProperty(document, "cookie", {
      value: "",
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  async function importFreshModule() {
    // Dynamic import so each test gets fresh module behavior
    const mod = await import("@/lib/api-client");
    return mod;
  }

  it("includes credentials: 'include' on all requests", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { fetchApi } = await importFreshModule();
    await fetchApi("/api/test");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });

  it("does not attach Authorization header (cookie-based auth)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { fetchApi } = await importFreshModule();
    await fetchApi("/api/test");

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("adds X-CSRF-Token header on mutation methods", async () => {
    Object.defineProperty(document, "cookie", {
      value: "kanon_csrf=csrf-token-123; other=value",
      writable: true,
      configurable: true,
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { fetchApi } = await importFreshModule();
    await fetchApi("/api/test", { method: "POST", body: JSON.stringify({}) });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token-123");
  });

  it("retries after successful 401 refresh (cookie-based)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;

      // First call: original request returns 401
      if (callCount === 1) {
        return Promise.resolve(
          new Response("", { status: 401 }),
        );
      }

      // Second call: refresh endpoint succeeds (cookie-based, no body needed)
      if (callCount === 2 && url === "/api/auth/refresh") {
        return Promise.resolve(
          new Response("", { status: 200 }),
        );
      }

      // Third call: retry succeeds
      if (callCount === 3) {
        return Promise.resolve(
          new Response(JSON.stringify({ result: "success" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      return Promise.resolve(new Response("", { status: 500 }));
    });

    const { fetchApi } = await importFreshModule();
    const result = await fetchApi<{ result: string }>("/api/data");

    expect(result).toEqual({ result: "success" });
    expect(callCount).toBe(3);
  });

  it("redirects to /login and throws when refresh fails", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;

      // First call: 401
      if (callCount === 1) {
        return Promise.resolve(new Response("", { status: 401 }));
      }

      // Second call: refresh fails
      if (callCount === 2 && url === "/api/auth/refresh") {
        return Promise.resolve(new Response("", { status: 401 }));
      }

      return Promise.resolve(new Response("", { status: 500 }));
    });

    const { fetchApi, ApiError } = await importFreshModule();

    await expect(fetchApi("/api/data")).rejects.toThrow(ApiError);

    // Auth should be cleared
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    // Should redirect to login
    expect(window.location.href).toBe("/login");
  });

  it("throws ApiError on non-2xx responses (non-401)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: "NOT_FOUND", message: "Resource not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const { fetchApi, ApiError } = await importFreshModule();

    try {
      await fetchApi("/api/missing");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(404);
      expect((err as InstanceType<typeof ApiError>).code).toBe("NOT_FOUND");
    }
  });

  it("handles 204 No Content responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const { fetchApi } = await importFreshModule();
    const result = await fetchApi("/api/resource");

    expect(result).toBeUndefined();
  });
});
