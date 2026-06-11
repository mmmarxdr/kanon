import { describe, it, expect } from "vitest";
import { scopedProjectIds } from "./token-scope.js";

describe("scopedProjectIds()", () => {
  it("returns the allow-list for a scoped (non-empty) claim", () => {
    expect(scopedProjectIds(["p1", "p2"])).toEqual(["p1", "p2"]);
  });

  it("returns null for an empty claim (unscoped, backward-compat)", () => {
    expect(scopedProjectIds([])).toBeNull();
  });

  it("returns null for an absent claim (undefined / null)", () => {
    expect(scopedProjectIds(undefined)).toBeNull();
    expect(scopedProjectIds(null)).toBeNull();
  });
});
