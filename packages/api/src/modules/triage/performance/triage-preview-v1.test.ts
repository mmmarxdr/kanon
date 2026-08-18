import { describe, it, expect } from "vitest";
import {
  PREVIEW_PROFILE,
  PROFILE_ID,
  assertPreviewSqlPlanBoundaries,
  loadSearchSource,
  runPreviewProfileFixture,
  syntheticPreviewSamples,
} from "./triage-preview-v1.js";
import { REFERENCE_RUNTIME } from "./profile.js";

describe("triage-preview-v1 profile contract", () => {
  it("names the versioned profile and runtime envelope", () => {
    expect(PROFILE_ID).toBe("triage-preview-v1");
    expect(PREVIEW_PROFILE.runtime).toEqual(REFERENCE_RUNTIME);
    expect(PREVIEW_PROFILE.budgets.p95MaxMs).toBe(3000);
    expect(PREVIEW_PROFILE.budgets.compactMaxBytes).toBe(16 * 1024);
    expect(PREVIEW_PROFILE.sql.fetchLimitMax).toBe(11);
  });

  it("asserts SQL-plan boundaries: authorized CTE, LIMIT 11, no MCP full-list", () => {
    const source = loadSearchSource();
    expect(() => assertPreviewSqlPlanBoundaries(source)).not.toThrow();
  });

  it("fixture samples pass P95 and compact output gates", () => {
    const result = runPreviewProfileFixture(syntheticPreviewSamples(40));
    expect(result.gates.p95Ok).toBe(true);
    expect(result.gates.compactOk).toBe(true);
  });

  it("keeps the synthetic fixture minimum fixed when TRIAGE_PERF=1", () => {
    process.env["TRIAGE_PERF"] = "1";
    expect(() => runPreviewProfileFixture(syntheticPreviewSamples(20))).not.toThrow();
    expect(() => runPreviewProfileFixture(syntheticPreviewSamples(19))).toThrow(/≥20/);
    delete process.env["TRIAGE_PERF"];
  });
});
