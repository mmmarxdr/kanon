import { describe, it, expect } from "vitest";
import {
  ListWorkspacesInput,
  CreateProjectInput,
  UpdateProjectInput,
  ListIssuesInput,
  ListRoadmapInput,
  CreateIssueInput,
  UpdateIssueInput,
  TITLE_COACHING,
} from "./types.js";

// ─── ListWorkspacesInput ─────────────────────────────────────────────────────

describe("ListWorkspacesInput", () => {
  it("accepts empty object", () => {
    const result = ListWorkspacesInput.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts format=slim", () => {
    const result = ListWorkspacesInput.safeParse({ format: "slim" });
    expect(result.success).toBe(true);
  });

  it("accepts format=full", () => {
    const result = ListWorkspacesInput.safeParse({ format: "full" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid format value", () => {
    const result = ListWorkspacesInput.safeParse({ format: "verbose" });
    expect(result.success).toBe(false);
  });
});

// ─── CreateProjectInput ──────────────────────────────────────────────────────

describe("CreateProjectInput", () => {
  const validInput = {
    workspaceId: "550e8400-e29b-41d4-a716-446655440000",
    key: "MYAPP",
    name: "My Application",
  };

  it("accepts valid input with required fields", () => {
    const result = CreateProjectInput.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts valid input with optional description", () => {
    const result = CreateProjectInput.safeParse({
      ...validInput,
      description: "A cool project",
    });
    expect(result.success).toBe(true);
  });

  // ─── workspaceId validation ──────────────────────────────────────────────

  it("rejects non-UUID workspaceId", () => {
    const result = CreateProjectInput.safeParse({
      ...validInput,
      workspaceId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  // ─── key validation ─────────────────────────────────────────────────────

  it("accepts single uppercase letter key", () => {
    const result = CreateProjectInput.safeParse({ ...validInput, key: "K" });
    expect(result.success).toBe(true);
  });

  it("accepts max-length key (6 chars)", () => {
    const result = CreateProjectInput.safeParse({ ...validInput, key: "KANON1" });
    expect(result.success).toBe(true);
  });

  it("accepts key with uppercase letters and digits", () => {
    const result = CreateProjectInput.safeParse({ ...validInput, key: "AB12" });
    expect(result.success).toBe(true);
  });

  it("rejects key starting with digit", () => {
    const result = CreateProjectInput.safeParse({ ...validInput, key: "123" });
    expect(result.success).toBe(false);
  });

  it("rejects lowercase key", () => {
    const result = CreateProjectInput.safeParse({ ...validInput, key: "kan" });
    expect(result.success).toBe(false);
  });

  it("rejects key longer than 6 characters", () => {
    const result = CreateProjectInput.safeParse({ ...validInput, key: "TOOLONG" });
    expect(result.success).toBe(false);
  });

  it("rejects empty key", () => {
    const result = CreateProjectInput.safeParse({ ...validInput, key: "" });
    expect(result.success).toBe(false);
  });

  it("rejects key with special characters", () => {
    const result = CreateProjectInput.safeParse({ ...validInput, key: "KA-N" });
    expect(result.success).toBe(false);
  });

  // ─── name validation ────────────────────────────────────────────────────

  it("rejects empty name", () => {
    const result = CreateProjectInput.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    const result = CreateProjectInput.safeParse({
      ...validInput,
      name: "x".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  // ─── description validation ──────────────────────────────────────────────

  it("rejects description over 500 chars", () => {
    const result = CreateProjectInput.safeParse({
      ...validInput,
      description: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("accepts description at exactly 500 chars", () => {
    const result = CreateProjectInput.safeParse({
      ...validInput,
      description: "x".repeat(500),
    });
    expect(result.success).toBe(true);
  });
});

// ─── UpdateProjectInput ──────────────────────────────────────────────────────

describe("UpdateProjectInput", () => {
  it("accepts projectKey with no optional fields", () => {
    const result = UpdateProjectInput.safeParse({ projectKey: "KAN" });
    expect(result.success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const result = UpdateProjectInput.safeParse({
      projectKey: "KAN",
      name: "New Name",
      description: "New desc",
      engramNamespace: "kanon-ns",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null description (for clearing)", () => {
    const result = UpdateProjectInput.safeParse({
      projectKey: "KAN",
      description: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null engramNamespace (for clearing)", () => {
    const result = UpdateProjectInput.safeParse({
      projectKey: "KAN",
      engramNamespace: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects name over 100 chars", () => {
    const result = UpdateProjectInput.safeParse({
      projectKey: "KAN",
      name: "x".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("rejects description over 500 chars", () => {
    const result = UpdateProjectInput.safeParse({
      projectKey: "KAN",
      description: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects engramNamespace over 100 chars", () => {
    const result = UpdateProjectInput.safeParse({
      projectKey: "KAN",
      engramNamespace: "x".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("accepts missing projectKey (resolved from .kanon binding at runtime)", () => {
    // projectKey is now optional — the handler resolves it from the .kanon walk-up binding.
    const result = UpdateProjectInput.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });
});

// ─── Format Param (expanded to include "compact") ──────────────────────────

describe("FormatParam — compact support", () => {
  it("ListWorkspacesInput accepts format=compact", () => {
    const result = ListWorkspacesInput.safeParse({ format: "compact" });
    expect(result.success).toBe(true);
  });

  it("ListWorkspacesInput accepts format=slim", () => {
    const result = ListWorkspacesInput.safeParse({ format: "slim" });
    expect(result.success).toBe(true);
  });

  it("ListWorkspacesInput accepts format=full", () => {
    const result = ListWorkspacesInput.safeParse({ format: "full" });
    expect(result.success).toBe(true);
  });

  it("ListWorkspacesInput rejects format=xml", () => {
    const result = ListWorkspacesInput.safeParse({ format: "xml" });
    expect(result.success).toBe(false);
  });

  it("ListIssuesInput accepts format=compact", () => {
    const result = ListIssuesInput.safeParse({ projectKey: "KAN", format: "compact" });
    expect(result.success).toBe(true);
  });

  it("ListRoadmapInput accepts format=compact", () => {
    const result = ListRoadmapInput.safeParse({ projectKey: "KAN", format: "compact" });
    expect(result.success).toBe(true);
  });
});

// ─── IssueTitle refine ────────────────────────────────────────────────────────

describe("IssueTitle refine", () => {
  it("valid title accepted: [Auth] Fix OAuth redirect", () => {
    const result = CreateIssueInput.safeParse({
      title: "[Auth] Fix OAuth redirect",
      projectKey: "KAN",
    });
    expect(result.success).toBe(true);
  });

  it("bare title rejected with coaching message containing [Area] and a good example", () => {
    const result = CreateIssueInput.safeParse({
      title: "fix thing",
      projectKey: "KAN",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "";
      expect(msg).toContain("[Area]");
      expect(msg).toMatch(/\[Auth\].*Fix OAuth redirect|Fix OAuth redirect/);
    }
  });

  it("SDD path title rejected: sdd/ai-pm-assistant/apply", () => {
    const result = CreateIssueInput.safeParse({
      title: "sdd/ai-pm-assistant/apply",
      projectKey: "KAN",
    });
    expect(result.success).toBe(false);
  });

  it("short valid title accepted: [API] Fix crash", () => {
    const result = CreateIssueInput.safeParse({
      title: "[API] Fix crash",
      projectKey: "KAN",
    });
    expect(result.success).toBe(true);
  });

  it("multiline title rejected: valid prefix followed by newline payload", () => {
    const result = CreateIssueInput.safeParse({
      title: "[Auth] Fix OAuth redirect\nunrelated second line",
      projectKey: "KAN",
    });
    expect(result.success).toBe(false);
  });
});

// ─── PR-2: description .describe() coaching ──────────────────────────────────

describe("PR-2 — description field coaching annotations", () => {
  it("CreateIssueInput.description describe contains recommended structure hint", () => {
    const schema = CreateIssueInput.shape.description;
    const description = schema._def.description as string;
    expect(description).toContain("## Context");
    expect(description).toContain("## Acceptance Criteria");
    expect(description).toContain("## Notes");
  });

  it("UpdateIssueInput.description describe contains preserve structure hint", () => {
    const schema = UpdateIssueInput.shape.description;
    const description = schema._def.description as string;
    expect(description).toContain("## Context");
    expect(description).toContain("## Acceptance Criteria");
    expect(description).toContain("## Notes");
  });

  it("UpdateIssueInput with partial description (no ## heading) still passes validation", () => {
    const result = UpdateIssueInput.safeParse({
      issueKey: "KAN-42",
      description: "Just a plain text update with no headings",
    });
    expect(result.success).toBe(true);
  });

  it("CreateIssueInput with no description still passes validation (optional field)", () => {
    const result = CreateIssueInput.safeParse({
      title: "[Auth] Fix OAuth redirect",
      projectKey: "KAN",
    });
    expect(result.success).toBe(true);
  });
});

// ─── UpdateIssueInput.title refine ───────────────────────────────────────────

describe("UpdateIssueInput.title refine", () => {
  it("valid titled update accepted", () => {
    const result = UpdateIssueInput.safeParse({
      issueKey: "KAN-42",
      title: "[Auth] Fix OAuth redirect",
    });
    expect(result.success).toBe(true);
  });

  it("bare title update rejected with same coaching message", () => {
    const result = UpdateIssueInput.safeParse({
      issueKey: "KAN-42",
      title: "fix thing",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "";
      expect(msg).toBe(TITLE_COACHING);
    }
  });
});
