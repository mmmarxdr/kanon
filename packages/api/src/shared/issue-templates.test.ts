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
