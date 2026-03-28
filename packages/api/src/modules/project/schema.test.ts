import { describe, it, expect } from "vitest";
import { CreateProjectBody, UpdateProjectBody } from "./schema.js";

describe("Project Zod Schemas", () => {
  // ── CreateProjectBody ────────────────────────────────────────────────

  describe("CreateProjectBody", () => {
    it("accepts valid project data", () => {
      const result = CreateProjectBody.safeParse({
        key: "KAN",
        name: "Kanon",
      });
      expect(result.success).toBe(true);
    });

    it("accepts key with numbers", () => {
      const result = CreateProjectBody.safeParse({
        key: "K2",
        name: "Project K2",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty key", () => {
      const result = CreateProjectBody.safeParse({ key: "", name: "Test" });
      expect(result.success).toBe(false);
    });

    it("rejects key longer than 6 chars", () => {
      const result = CreateProjectBody.safeParse({
        key: "TOOLONG",
        name: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects lowercase key", () => {
      const result = CreateProjectBody.safeParse({
        key: "kan",
        name: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects key starting with number", () => {
      const result = CreateProjectBody.safeParse({
        key: "1KAN",
        name: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects key with special characters", () => {
      const result = CreateProjectBody.safeParse({
        key: "K-N",
        name: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty name", () => {
      const result = CreateProjectBody.safeParse({ key: "KAN", name: "" });
      expect(result.success).toBe(false);
    });

    it("rejects name longer than 100 chars", () => {
      const result = CreateProjectBody.safeParse({
        key: "KAN",
        name: "x".repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it("accepts optional description", () => {
      const result = CreateProjectBody.safeParse({
        key: "KAN",
        name: "Kanon",
        description: "A project management tool",
      });
      expect(result.success).toBe(true);
    });

    it("rejects description longer than 500 chars", () => {
      const result = CreateProjectBody.safeParse({
        key: "KAN",
        name: "Kanon",
        description: "x".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });

  // ── UpdateProjectBody ────────────────────────────────────────────────

  describe("UpdateProjectBody", () => {
    it("accepts partial update", () => {
      const result = UpdateProjectBody.safeParse({ name: "New Name" });
      expect(result.success).toBe(true);
    });

    it("accepts nullable description", () => {
      const result = UpdateProjectBody.safeParse({ description: null });
      expect(result.success).toBe(true);
    });

    it("accepts empty object", () => {
      const result = UpdateProjectBody.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
