/**
 * C3.1 — Issue route validateSearch: ?highlight=mention&commentId=cmt-42
 *         → search.highlight === "mention" y search.commentId === "cmt-42"
 * C3.2 — Issue route validateSearch: ?from=inbox sin highlight
 *         → search.highlight === undefined y search.commentId === undefined
 * C3.3 — Issue route validateSearch: highlight con valor distinto de "mention"
 *         → search.highlight === undefined
 *
 * Refs: REQ-MENTION-009, design §4.3 validateSearch
 */
import { describe, it, expect } from "vitest";
import type { IssueRouteSearch } from "../_authenticated/issue";

// We test validateSearch by importing the route and calling it directly.
// TanStack Router types `route.options.validateSearch` as a union of validator
// shapes; the route uses the function form, so we narrow with a cast.
type ValidateSearchFn = (search: Record<string, unknown>) => IssueRouteSearch;

describe("Issue route validateSearch (C3)", () => {
  it("C3.1 — ?highlight=mention&commentId=cmt-42 → correctly typed search params", async () => {
    const { issueRoute } = await import("../_authenticated/issue");
    const validateSearch = issueRoute.options.validateSearch as ValidateSearchFn;

    const result = validateSearch({
      from: "inbox",
      highlight: "mention",
      commentId: "cmt-42",
    });

    expect(result.from).toBe("inbox");
    expect(result.highlight).toBe("mention");
    expect(result.commentId).toBe("cmt-42");
  });

  it("C3.2 — ?from=inbox without highlight → highlight and commentId are undefined", async () => {
    const { issueRoute } = await import("../_authenticated/issue");
    const validateSearch = issueRoute.options.validateSearch as ValidateSearchFn;

    const result = validateSearch({ from: "inbox" });

    expect(result.from).toBe("inbox");
    expect(result.highlight).toBeUndefined();
    expect(result.commentId).toBeUndefined();
  });

  it("C3.3 — highlight with value other than 'mention' → highlight is undefined", async () => {
    const { issueRoute } = await import("../_authenticated/issue");
    const validateSearch = issueRoute.options.validateSearch as ValidateSearchFn;

    const result = validateSearch({ highlight: "something-else" });

    expect(result.highlight).toBeUndefined();
  });

  it("C3.4 — no params at all → backward compat (no throw)", async () => {
    const { issueRoute } = await import("../_authenticated/issue");
    const validateSearch = issueRoute.options.validateSearch as ValidateSearchFn;

    expect(() => validateSearch({})).not.toThrow();
    const result = validateSearch({});
    expect(result.from).toBeUndefined();
    expect(result.highlight).toBeUndefined();
    expect(result.commentId).toBeUndefined();
  });
});
