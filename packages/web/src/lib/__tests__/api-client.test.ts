import { describe, it, expect, afterEach, vi } from "vitest";
import { ApiError, fetchApi } from "@/lib/api-client";

describe("ApiError details", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces the parsed response body's details on the thrown ApiError", async () => {
    const responseBody = {
      code: "RECONCILIATION_REQUIRED",
      message: "Unconfirmed captured time must be reconciled before done.",
      details: { totalHours: "5.00", issueKey: "ENG-1" },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      fetchApi("/api/issues/ENG-1/transition", { method: "POST" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "RECONCILIATION_REQUIRED",
      details: { totalHours: "5.00", issueKey: "ENG-1" },
    });
  });

  it("defaults details to undefined when the response body has no details field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "NOT_FOUND", message: "Missing" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    try {
      await fetchApi("/api/issues/ENG-1", { method: "GET" });
      expect.fail("expected fetchApi to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).details).toBeUndefined();
    }
  });
});
