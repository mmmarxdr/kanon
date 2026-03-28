import { describe, it, expect } from "vitest";
import { humanizeGroupKey } from "@/lib/humanize-group-key";

describe("humanizeGroupKey", () => {
  it("converts sdd/auth-model to Auth Model", () => {
    expect(humanizeGroupKey("sdd/auth-model")).toBe("Auth Model");
  });

  it("converts sdd/grouped-cards to Grouped Cards", () => {
    expect(humanizeGroupKey("sdd/grouped-cards")).toBe("Grouped Cards");
  });

  it("handles underscores", () => {
    expect(humanizeGroupKey("sdd/my_feature")).toBe("My Feature");
  });

  it("handles single segment (no slash)", () => {
    expect(humanizeGroupKey("standalone")).toBe("Standalone");
  });

  it("handles deeply nested paths (uses last segment)", () => {
    expect(humanizeGroupKey("a/b/my-feature")).toBe("My Feature");
  });

  it("handles single-word last segment", () => {
    expect(humanizeGroupKey("prefix/auth")).toBe("Auth");
  });
});
