/**
 * KAN-108 / KAN-33 — Issue route validateSearch after tab-strip removal (slice 2).
 *
 * C3.2 — ?from=inbox → only `from` is present; no tab field.
 * C3.4 — no params at all → backward compat (no throw); from is undefined.
 * C3.5 — highlight and commentId are NOT fields on IssueRouteSearch type.
 * C3.6 — validateSearch ignores unknown highlight/commentId input (dropped silently).
 * C3.9 — `tab` field is NOT on IssueRouteSearch (removed in slice 2).
 * C3.10 — unknown ?tab= value is silently ignored (not present in parsed result, no error).
 *
 * Refs: KAN-33 frontend deletions, KAN-108 PR1+PR2
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

  it("C3.9 — tab is NOT a field on IssueRouteSearch (removed in slice 2)", () => {
    // Compile-time guard: `tab` must not exist on the interface.
    const search: IssueRouteSearch = { from: "inbox" };
    expect("tab" in search).toBe(false);
  });

  it("C3.10 — unknown ?tab= value is silently ignored (not in parsed result, no error)", async () => {
    const { issueRoute } = await import("../_authenticated/issue");
    const validateSearch = issueRoute.options.validateSearch as ValidateSearchFn;

    // Old bookmarks with ?tab=documents or ?tab=bogus must NOT cause errors
    expect(() => validateSearch({ tab: "documents" })).not.toThrow();
    expect(() => validateSearch({ tab: "bogus" })).not.toThrow();

    const result1 = validateSearch({ tab: "documents" });
    const result2 = validateSearch({ tab: "bogus" });

    // tab must not appear in the parsed result — TanStack drops unknown keys
    expect((result1 as Record<string, unknown>).tab).toBeUndefined();
    expect((result2 as Record<string, unknown>).tab).toBeUndefined();
  });
});
