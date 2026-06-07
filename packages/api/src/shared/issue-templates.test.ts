import { describe, it, expect } from "vitest";
import { resolveTemplate, ISSUE_TEMPLATES } from "./issue-templates.js";

describe("resolveTemplate", () => {
  it("returns the correct template for a known key", () => {
    const tmpl = resolveTemplate("bug-report");
    expect(tmpl).toBeDefined();
    expect(tmpl!.key).toBe("bug-report");
    expect(tmpl!.type).toBe("bug");
    expect(tmpl!.priority).toBe("high");
    expect(tmpl!.labels).toContain("bug");
    expect(tmpl!.descriptionTemplate).toContain("## Steps to Reproduce");
  });

  it("returns undefined for an unknown key", () => {
    const tmpl = resolveTemplate("nonexistent-template");
    expect(tmpl).toBeUndefined();
  });

  it("returns the feature-request template with correct defaults", () => {
    const tmpl = resolveTemplate("feature-request");
    expect(tmpl).toBeDefined();
    expect(tmpl!.type).toBe("feature");
    expect(tmpl!.priority).toBe("medium");
    expect(tmpl!.labels).toContain("enhancement");
    expect(tmpl!.descriptionTemplate).toContain("## User Story");
  });

  it("returns the spike template with correct defaults", () => {
    const tmpl = resolveTemplate("spike");
    expect(tmpl).toBeDefined();
    expect(tmpl!.type).toBe("spike");
    expect(tmpl!.labels).toContain("investigation");
    expect(tmpl!.descriptionTemplate).toContain("## Question");
  });

  it("ISSUE_TEMPLATES registry contains expected keys", () => {
    expect(Object.keys(ISSUE_TEMPLATES)).toContain("bug-report");
    expect(Object.keys(ISSUE_TEMPLATES)).toContain("feature-request");
    expect(Object.keys(ISSUE_TEMPLATES)).toContain("task");
    expect(Object.keys(ISSUE_TEMPLATES)).toContain("spike");
  });
});

// ─── PR-2: task template descriptionTemplate ─────────────────────────────────

describe("PR-2 — task template descriptionTemplate", () => {
  it("task template descriptionTemplate contains ## Context", () => {
    const tmpl = resolveTemplate("task");
    expect(tmpl!.descriptionTemplate).toContain("## Context");
  });

  it("task template descriptionTemplate contains ## Acceptance Criteria", () => {
    const tmpl = resolveTemplate("task");
    expect(tmpl!.descriptionTemplate).toContain("## Acceptance Criteria");
  });

  it("task template descriptionTemplate contains ## Notes", () => {
    const tmpl = resolveTemplate("task");
    expect(tmpl!.descriptionTemplate).toContain("## Notes");
  });

  it("bug-report template descriptionTemplate is unchanged (still has ## Steps to Reproduce)", () => {
    const tmpl = resolveTemplate("bug-report");
    expect(tmpl!.descriptionTemplate).toContain("## Steps to Reproduce");
    expect(tmpl!.descriptionTemplate).toContain("## Expected Behavior");
    expect(tmpl!.descriptionTemplate).toContain("## Actual Behavior");
    expect(tmpl!.descriptionTemplate).toContain("## Environment");
  });

  it("feature-request template descriptionTemplate is unchanged (still has ## User Story)", () => {
    const tmpl = resolveTemplate("feature-request");
    expect(tmpl!.descriptionTemplate).toContain("## User Story");
    expect(tmpl!.descriptionTemplate).toContain("## Acceptance Criteria");
    expect(tmpl!.descriptionTemplate).toContain("## Design Notes");
  });
});
