import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "./policy.js";

describe("policy", () => {
  it("deterministic policy v1", () => {
    const result = evaluatePolicy({ target: "issue-1", scope: "global" });
    expect(result.confidence).toBe("high");
    expect(result.rules[0]).toBe("rule-1");
  });
  
  it("policy provenance", () => {
    const result = evaluatePolicy({ target: "issue-2", scope: "global" });
    expect(result.provenance).toBeDefined();
    expect(result.urgency).toBeDefined();
  });
});
