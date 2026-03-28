import { describe, it, expect } from "vitest";
import { CreateWorkspaceBody, UpdateWorkspaceBody } from "./schema.js";

describe("Workspace Zod Schemas", () => {
  // ── CreateWorkspaceBody ──────────────────────────────────────────────

  describe("CreateWorkspaceBody", () => {
    it("accepts valid workspace data", () => {
      const result = CreateWorkspaceBody.safeParse({
        name: "My Workspace",
        slug: "my-workspace",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty name", () => {
      const result = CreateWorkspaceBody.safeParse({
        name: "",
        slug: "my-workspace",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name longer than 100 chars", () => {
      const result = CreateWorkspaceBody.safeParse({
        name: "x".repeat(101),
        slug: "my-workspace",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty slug", () => {
      const result = CreateWorkspaceBody.safeParse({
        name: "Test",
        slug: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects slug with uppercase", () => {
      const result = CreateWorkspaceBody.safeParse({
        name: "Test",
        slug: "My-Workspace",
      });
      expect(result.success).toBe(false);
    });

    it("rejects slug with spaces", () => {
      const result = CreateWorkspaceBody.safeParse({
        name: "Test",
        slug: "my workspace",
      });
      expect(result.success).toBe(false);
    });

    it("accepts slug with hyphens", () => {
      const result = CreateWorkspaceBody.safeParse({
        name: "Test",
        slug: "my-cool-workspace",
      });
      expect(result.success).toBe(true);
    });

    it("rejects slug starting with hyphen", () => {
      const result = CreateWorkspaceBody.safeParse({
        name: "Test",
        slug: "-invalid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects slug with consecutive hyphens", () => {
      const result = CreateWorkspaceBody.safeParse({
        name: "Test",
        slug: "my--workspace",
      });
      expect(result.success).toBe(false);
    });
  });

  // ── UpdateWorkspaceBody ──────────────────────────────────────────────

  describe("UpdateWorkspaceBody", () => {
    it("accepts partial update with name only", () => {
      const result = UpdateWorkspaceBody.safeParse({ name: "New Name" });
      expect(result.success).toBe(true);
    });

    it("accepts partial update with slug only", () => {
      const result = UpdateWorkspaceBody.safeParse({ slug: "new-slug" });
      expect(result.success).toBe(true);
    });

    it("accepts empty object", () => {
      const result = UpdateWorkspaceBody.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
