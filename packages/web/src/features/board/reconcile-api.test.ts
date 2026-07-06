/**
 * Unit tests for the shared reconcile-time API surface (KAN-188 PR3 FIX 3).
 * Extracted from use-transition-mutation.ts and use-group-transition-mutation.ts
 * to eliminate a byte-for-byte duplicated wire contract.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>(
    "@/lib/api-client",
  );
  return {
    ...actual,
    fetchApi: vi.fn(),
  };
});

describe("toFiniteHours", () => {
  it("parses a numeric string into a finite number", async () => {
    const { toFiniteHours } = await import("./reconcile-api");
    expect(toFiniteHours("5.00")).toBe(5);
  });

  it("passes through an already-finite number", async () => {
    const { toFiniteHours } = await import("./reconcile-api");
    expect(toFiniteHours(2.5)).toBe(2.5);
  });

  it("returns null for a non-numeric string", async () => {
    const { toFiniteHours } = await import("./reconcile-api");
    expect(toFiniteHours("not-a-number")).toBeNull();
  });

  it("returns null for undefined", async () => {
    const { toFiniteHours } = await import("./reconcile-api");
    expect(toFiniteHours(undefined)).toBeNull();
  });

  it("returns null for NaN", async () => {
    const { toFiniteHours } = await import("./reconcile-api");
    expect(toFiniteHours(NaN)).toBeNull();
  });
});

describe("reconcileTime", () => {
  it("POSTs to /api/issues/:key/reconcile-time with confirmedTotalHours as a string", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValueOnce(undefined);

    const { reconcileTime } = await import("./reconcile-api");
    await reconcileTime("TEST-1", 4.5);

    expect(fetchApi).toHaveBeenCalledWith(
      "/api/issues/TEST-1/reconcile-time",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ confirmedTotalHours: "4.5" }),
      }),
    );
  });

  it("URL-encodes the issue key", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValueOnce(undefined);

    const { reconcileTime } = await import("./reconcile-api");
    await reconcileTime("TEST/1", 1);

    expect(fetchApi).toHaveBeenCalledWith(
      "/api/issues/TEST%2F1/reconcile-time",
      expect.anything(),
    );
  });
});

describe("RECONCILIATION_ERROR_CODE", () => {
  it("is the literal RECONCILIATION_REQUIRED", async () => {
    const { RECONCILIATION_ERROR_CODE } = await import("./reconcile-api");
    expect(RECONCILIATION_ERROR_CODE).toBe("RECONCILIATION_REQUIRED");
  });
});
