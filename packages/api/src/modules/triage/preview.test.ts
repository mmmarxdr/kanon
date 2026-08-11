import { describe, expect, it } from "vitest";
import { executePreview, PreviewRequestSchema } from "./preview.js";

describe("PreviewRequestSchema", () => {
  it("defaults a deterministic compact prepare", () => {
    expect(PreviewRequestSchema.parse({ phase: "prepare" })).toEqual({
      phase: "prepare",
      format: "compact",
      aiIntent: "none",
    });
  });

  it("requires authenticated context and host outcome for validate", () => {
    expect(PreviewRequestSchema.safeParse({ phase: "validate" }).success).toBe(false);
    expect(
      PreviewRequestSchema.safeParse({
        phase: "validate",
        contextToken: "opaque",
        hostOutcome: { status: "timed_out" },
      }).success,
    ).toBe(true);
  });

  it("rejects work after the end-to-end API deadline", async () => {
    await expect(executePreview({
      issueKey: "KAN-1",
      userId: "00000000-0000-4000-8000-000000000001",
      allowedProjectIds: [],
      correlationId: "deadline-test",
      request: PreviewRequestSchema.parse({ phase: "prepare" }),
      deadlineAt: performance.now() - 1,
    })).rejects.toMatchObject({ code: "PREVIEW_TIMED_OUT", statusCode: 503 });
  });
});
