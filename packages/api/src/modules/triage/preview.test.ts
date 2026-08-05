import { describe, expect, it } from "vitest";
import { executePreview } from "./preview.js";

describe("preview", () => {
  it("runs preview with valid data", async () => {
    const result = await executePreview({ target: "issue-1" });
    expect(result.success).toBe(true);
    expect(result.data.shape).toBe("compact");
  });

  it("handles fallback and prompt injection", async () => {
    const result = await executePreview({ target: "injection" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("prompt_injection_detected");
  });
});
