import { describe, it, expect } from "vitest";
import { buildSseHeaders } from "./sse-client.js";

/**
 * Unit tests for SSE header construction.
 * Verifies Bearer-only auth — X-API-Key path was removed in PR1 (KAN-35).
 */
describe("buildSseHeaders", () => {
  it("sends Authorization: Bearer for a JWT token", () => {
    const headers = buildSseHeaders("eyJhbGciOiJSUzI1NiJ9.payload.sig");
    expect(headers["Authorization"]).toBe("Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig");
    expect(headers["Accept"]).toBe("text/event-stream");
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("sends Authorization: Bearer even for a non-JWT string (no X-API-Key fallback)", () => {
    const headers = buildSseHeaders("sk-some-static-key");
    expect(headers["Authorization"]).toBe("Bearer sk-some-static-key");
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("includes Last-Event-ID when provided", () => {
    const headers = buildSseHeaders("eyJtoken", "42");
    expect(headers["Last-Event-ID"]).toBe("42");
  });

  it("omits Last-Event-ID when not provided", () => {
    const headers = buildSseHeaders("eyJtoken");
    expect(headers["Last-Event-ID"]).toBeUndefined();
  });

  it("omits Last-Event-ID when undefined is passed explicitly", () => {
    const headers = buildSseHeaders("eyJtoken", undefined);
    expect(headers["Last-Event-ID"]).toBeUndefined();
  });
});
