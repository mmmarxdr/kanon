import { describe, it, expect } from "vitest";
import {
  CreateIssueBody,
  UpdateIssueBody,
  TransitionBody,
  IssueFilterQuery,
} from "./schema.js";

describe("Issue Zod Schemas", () => {
  // ── CreateIssueBody ──────────────────────────────────────────────────

  describe("CreateIssueBody", () => {
    it("accepts valid issue with only required fields", () => {
      const result = CreateIssueBody.safeParse({ title: "Fix login bug" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBeUndefined(); // optional — service applies "task" default
        expect(result.data.priority).toBeUndefined(); // optional — service applies "medium" default
        expect(result.data.labels).toEqual([]); // default
      }
    });

    it("accepts valid issue with all fields", () => {
      const result = CreateIssueBody.safeParse({
        title: "Fix login bug",
        description: "The login form crashes on mobile",
        type: "bug",
        priority: "high",
        assigneeId: "550e8400-e29b-41d4-a716-446655440000",
        sprintId: "550e8400-e29b-41d4-a716-446655440001",
        parentId: "550e8400-e29b-41d4-a716-446655440002",
        labels: ["frontend", "urgent"],
        dueDate: "2026-04-01T00:00:00.000Z",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty title", () => {
      const result = CreateIssueBody.safeParse({ title: "" });
      expect(result.success).toBe(false);
    });

    it("rejects title longer than 200 chars", () => {
      const result = CreateIssueBody.safeParse({ title: "x".repeat(201) });
      expect(result.success).toBe(false);
    });

    it("rejects invalid type", () => {
      const result = CreateIssueBody.safeParse({
        title: "Test",
        type: "invalid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid priority", () => {
      const result = CreateIssueBody.safeParse({
        title: "Test",
        priority: "urgent", // not in enum
      });
      expect(result.success).toBe(false);
    });

    it("accepts all valid types", () => {
      for (const type of ["feature", "bug", "task", "spike"]) {
        const result = CreateIssueBody.safeParse({ title: "Test", type });
        expect(result.success).toBe(true);
      }
    });

    it("accepts all valid priorities", () => {
      for (const priority of ["critical", "high", "medium", "low"]) {
        const result = CreateIssueBody.safeParse({ title: "Test", priority });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid assigneeId format", () => {
      const result = CreateIssueBody.safeParse({
        title: "Test",
        assigneeId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });
  });

  // ── UpdateIssueBody ──────────────────────────────────────────────────

  describe("UpdateIssueBody", () => {
    it("accepts partial updates", () => {
      const result = UpdateIssueBody.safeParse({ title: "Updated title" });
      expect(result.success).toBe(true);
    });

    it("accepts empty object (no updates)", () => {
      const result = UpdateIssueBody.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts nullable fields set to null", () => {
      const result = UpdateIssueBody.safeParse({
        description: null,
        assigneeId: null,
        sprintId: null,
      });
      expect(result.success).toBe(true);
    });
  });

  // ── TransitionBody ───────────────────────────────────────────────────

  describe("TransitionBody", () => {
    it("accepts valid state", () => {
      const result = TransitionBody.safeParse({ to_state: "apply" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid state", () => {
      const result = TransitionBody.safeParse({ to_state: "invalid" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid states", () => {
      const states = [
        "backlog", "explore", "propose", "design",
        "spec", "tasks", "apply", "verify", "archived",
      ];
      for (const state of states) {
        const result = TransitionBody.safeParse({ to_state: state });
        expect(result.success).toBe(true);
      }
    });

    it("rejects missing to_state", () => {
      const result = TransitionBody.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // ── IssueFilterQuery ─────────────────────────────────────────────────

  describe("IssueFilterQuery", () => {
    it("accepts empty query (no filters)", () => {
      const result = IssueFilterQuery.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid state filter", () => {
      const result = IssueFilterQuery.safeParse({ state: "backlog" });
      expect(result.success).toBe(true);
    });

    it("accepts multiple filters", () => {
      const result = IssueFilterQuery.safeParse({
        state: "backlog",
        type: "bug",
        priority: "high",
        label: "frontend",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid state filter", () => {
      const result = IssueFilterQuery.safeParse({ state: "invalid" });
      expect(result.success).toBe(false);
    });
  });
});
