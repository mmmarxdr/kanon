import { describe, it, expect } from "vitest";
import { CreateCommentBody } from "./schema.js";

describe("Comment Zod Schemas", () => {
  describe("CreateCommentBody", () => {
    it("accepts valid comment with body only", () => {
      const result = CreateCommentBody.safeParse({ body: "Great work!" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe("human"); // default
      }
    });

    it("accepts valid comment with explicit source", () => {
      const result = CreateCommentBody.safeParse({
        body: "Auto-generated comment",
        source: "mcp",
      });
      expect(result.success).toBe(true);
    });

    it("accepts all valid sources", () => {
      for (const source of ["human", "mcp", "engram_sync", "system"]) {
        const result = CreateCommentBody.safeParse({
          body: "Test",
          source,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects empty body", () => {
      const result = CreateCommentBody.safeParse({ body: "" });
      expect(result.success).toBe(false);
    });

    it("rejects body longer than 10000 chars", () => {
      const result = CreateCommentBody.safeParse({
        body: "x".repeat(10001),
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid source", () => {
      const result = CreateCommentBody.safeParse({
        body: "Test",
        source: "invalid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing body", () => {
      const result = CreateCommentBody.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
