import { describe, it, expect } from "vitest";
import { deriveSlug } from "../derive-slug";

describe("deriveSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(deriveSlug("My Workspace")).toBe("my-workspace");
  });

  it("collapses multiple consecutive spaces/hyphens into a single hyphen", () => {
    expect(deriveSlug("Hello   World")).toBe("hello-world");
  });

  it("strips invalid characters (non-alphanumeric non-space)", () => {
    expect(deriveSlug("Acme Corp!")).toBe("acme-corp");
  });

  it("strips leading and trailing hyphens", () => {
    expect(deriveSlug("  My Workspace  ")).toBe("my-workspace");
  });

  it("handles mixed specials and numbers", () => {
    expect(deriveSlug("Team 42 — Alpha")).toBe("team-42-alpha");
  });

  it("returns empty string for all-invalid input", () => {
    expect(deriveSlug("!!!")).toBe("");
  });
});
