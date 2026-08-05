import { describe, it, expect } from "vitest";
import {
  LIST_PROFILE,
  PROFILE_ID,
  assertListSqlPlanBoundaries,
  loadListSource,
  runListProfileFixture,
  syntheticListSamples,
  syntheticDismissSamples,
} from "./triage-proposal-list-v1.js";
import { CANARY_GATES, isFullPerfEnabled } from "./profile.js";

describe("triage-proposal-list-v1 profile contract", () => {
  it("names the versioned profile and budgets", () => {
    expect(PROFILE_ID).toBe("triage-proposal-list-v1");
    expect(LIST_PROFILE.budgets.listP95TargetMs).toBe(CANARY_GATES.listP95TargetMs);
    expect(LIST_PROFILE.budgets.dismissP95TargetMs).toBe(CANARY_GATES.dismissP95TargetMs);
    expect(LIST_PROFILE.sql.fetchLimitMax).toBe(51);
    expect(LIST_PROFILE.sql.noContentTableFetch).toBe(true);
  });

  it("asserts SQL-plan boundaries: visibility before predicates, LIMIT 51, no content fetch", () => {
    const source = loadListSource();
    expect(() => assertListSqlPlanBoundaries(source)).not.toThrow();
  });

  it("fixture list/dismiss samples meet engineering targets", () => {
    const result = runListProfileFixture({
      list: syntheticListSamples(40),
      dismiss: syntheticDismissSamples(40),
    });
    expect(result.gates.listP95Ok).toBe(true);
    expect(result.gates.dismissP95Ok).toBe(true);
    expect(result.gates.listBytesOk).toBe(true);
    expect(result.gates.dismissBytesOk).toBe(true);
  });

  it("full 1000-sample path is gated behind TRIAGE_PERF=1", () => {
    if (!isFullPerfEnabled()) {
      expect(() =>
        runListProfileFixture({
          list: syntheticListSamples(20),
          dismiss: syntheticDismissSamples(20),
        }),
      ).not.toThrow();
      return;
    }
    const result = runListProfileFixture({
      list: syntheticListSamples(1000),
      dismiss: syntheticDismissSamples(1000),
    });
    expect(result.listSummary.count).toBeGreaterThanOrEqual(1000);
  });
});
