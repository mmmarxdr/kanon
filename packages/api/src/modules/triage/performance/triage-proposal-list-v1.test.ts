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

describe("triage-proposal-list-v1 profile contract", () => {
  it("names the versioned profile and budgets", () => {
    expect(PROFILE_ID).toBe("triage-proposal-list-v1");
    expect(LIST_PROFILE.budgets).toMatchObject({ listP95TargetMs: 1500, dismissP95TargetMs: 1000 });
    expect(LIST_PROFILE.sql.fetchLimitMax).toBe(51);
    expect(LIST_PROFILE.sql.noContentTableFetch).toBe(true);
  });

  it("asserts SQL-plan boundaries: visibility before predicates, LIMIT 51, no content fetch", () => {
    const source = loadListSource();
    expect(() => assertListSqlPlanBoundaries(source)).not.toThrow();
    expect(source).not.toContain("triage_proposal_contents");
    expect(() => assertListSqlPlanBoundaries(`${source}\nSELECT 1 FROM triage_proposal_contents`))
      .toThrow(/content table/i);
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

  it("keeps the synthetic fixture minimum fixed when TRIAGE_PERF=1", () => {
    process.env["TRIAGE_PERF"] = "1";
    expect(() =>
      runListProfileFixture({
        list: syntheticListSamples(20),
        dismiss: syntheticDismissSamples(20),
      }),
    ).not.toThrow();
    delete process.env["TRIAGE_PERF"];
  });
});
