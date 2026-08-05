import { describe, it, expect } from "vitest";
import {
  PREVIEW_PROFILE,
  PROFILE_ID,
  assertPreviewSqlPlanBoundaries,
  loadSearchSource,
  runPreviewProfileFixture,
  syntheticPreviewSamples,
} from "./triage-preview-v1.js";
import { CANARY_GATES, isFullPerfEnabled, REFERENCE_RUNTIME } from "./profile.js";

describe("triage-preview-v1 profile contract", () => {
  it("names the versioned profile and runtime envelope", () => {
    expect(PROFILE_ID).toBe("triage-preview-v1");
    expect(PREVIEW_PROFILE.runtime).toEqual(REFERENCE_RUNTIME);
    expect(PREVIEW_PROFILE.budgets.p95MaxMs).toBe(CANARY_GATES.previewP95MaxMs);
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
    expect(result.summary.p95Ms).toBeLessThan(3000);
    expect(result.summary.maxOutputBytes).toBeLessThanOrEqual(16 * 1024);
  });

  it("full 1000-sample path is gated behind TRIAGE_PERF=1", () => {
    if (!isFullPerfEnabled()) {
      expect(() => runPreviewProfileFixture(syntheticPreviewSamples(20))).not.toThrow();
      expect(() => runPreviewProfileFixture(syntheticPreviewSamples(19))).toThrow(/≥20/);
      return;
    }
    const result = runPreviewProfileFixture(syntheticPreviewSamples(1000));
    expect(result.summary.count).toBeGreaterThanOrEqual(1000);
    expect(result.gates.p95Ok).toBe(true);
  });
});
