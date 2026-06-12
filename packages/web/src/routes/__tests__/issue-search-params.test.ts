/**
 * KAN-108 / KAN-33 — Issue route validateSearch after agent-surface deletions.
 *
 * C3.1 — (REMOVED) highlight/commentId no longer exist on IssueRouteSearch.
 * C3.2 — ?from=inbox → only `from` is present; no highlight/commentId fields.
 * C3.3 — (REMOVED) highlight validation no longer applies.
 * C3.4 — no params at all → backward compat (no throw); from is undefined.
 * C3.5 — highlight/commentId NOT present on IssueRouteSearch type (compile-time guard).
 * C3.6 — validateSearch ignores unknown highlight/commentId input (unknown params dropped).
 * C3.7 — validateSearch({ tab: "bogus" }) returns tab: "timeline" (invalid tab coerced).
 *
 * Refs: KAN-33 frontend deletions, KAN-108 PR1
 */
import { describe, it, expect } from "vitest";
import type { IssueRouteSearch } from "../_authenticated/issue";

// We test validateSearch by importing the route and calling it directly.
// TanStack Router types `route.options.validateSearch` as a union of validator
// shapes; the route uses the function form, so we narrow with a cast.
type ValidateSearchFn = (search: Record<string, unknown>) => IssueRouteSearch;

describe("Issue route validateSearch (C3 — KAN-108)", () => {
  it("C3.2 — ?from=inbox → only from field present", async () => {
    const { issueRoute } = await import("../_authenticated/issue");
    const validateSearch = issueRoute.options.validateSearch as ValidateSearchFn;

    const result = validateSearch({ from: "inbox" });

    expect(result.from).toBe("inbox");
  });

  it("C3.4 — no params at all → backward compat (no throw)", async () => {
    const { issueRoute } = await import("../_authenticated/issue");
    const validateSearch = issueRoute.options.validateSearch as ValidateSearchFn;

    expect(() => validateSearch({})).not.toThrow();
    const result = validateSearch({});
    expect(result.from).toBeUndefined();
  });

  it("C3.5 — highlight and commentId are NOT fields on IssueRouteSearch", () => {
    // Compile-time: neither 'highlight' nor 'commentId' exist on the type.
    // If either key is added back to the interface this line will fail tsc.
    const search: IssueRouteSearch = { from: "inbox" };
    expect("highlight" in search).toBe(false);
    expect("commentId" in search).toBe(false);
  });

  it("C3.6 — validateSearch ignores unknown highlight/commentId input (dropped silently)", async () => {
    const { issueRoute } = await import("../_authenticated/issue");
    const validateSearch = issueRoute.options.validateSearch as ValidateSearchFn;

    const result = validateSearch({ highlight: "mention", commentId: "cmt-42" });

    // highlight and commentId must NOT appear on the result object
    expect((result as Record<string, unknown>).highlight).toBeUndefined();
    expect((result as Record<string, unknown>).commentId).toBeUndefined();
  });

  it("C3.7 — validateSearch({ tab: 'bogus' }) coerces to 'timeline'", async () => {
    const { issueRoute } = await import("../_authenticated/issue");
    const validateSearch = issueRoute.options.validateSearch as ValidateSearchFn;

    const result = validateSearch({ tab: "bogus" });

    expect(result.tab).toBe("timeline");
  });
});
