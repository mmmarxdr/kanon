/**
 * TDD tests for buildIssueSearchParams (RED phase).
 *
 * Converts a q string + IssueFilters object into URLSearchParams using
 * snake_case wire names. Falsy/undefined/empty values are OMITTED.
 */

import { describe, it, expect } from "vitest";
import { buildIssueSearchParams } from "@/features/board/build-issue-search-params";
import type { IssueFilters } from "@kanon/shared";

function toObj(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

describe("buildIssueSearchParams", () => {
  it("maps q to q param", () => {
    const params = buildIssueSearchParams("auth", {});
    expect(params.get("q")).toBe("auth");
  });

  it("omits q when empty string", () => {
    const params = buildIssueSearchParams("", {});
    expect(params.has("q")).toBe(false);
  });

  it("omits q when only whitespace", () => {
    const params = buildIssueSearchParams("   ", {});
    expect(params.has("q")).toBe(false);
  });

  it("maps state filter to state param", () => {
    const filters: IssueFilters = { state: "done" };
    const params = buildIssueSearchParams("", filters);
    expect(params.get("state")).toBe("done");
  });

  it("maps type filter to type param", () => {
    const filters: IssueFilters = { type: "bug" };
    const params = buildIssueSearchParams("", filters);
    expect(params.get("type")).toBe("bug");
  });

  it("maps priority filter to priority param", () => {
    const filters: IssueFilters = { priority: "high" };
    const params = buildIssueSearchParams("", filters);
    expect(params.get("priority")).toBe("high");
  });

  it("maps hasDocuments=true to has_documents=true", () => {
    const filters: IssueFilters = { hasDocuments: true };
    const params = buildIssueSearchParams("", filters);
    expect(params.get("has_documents")).toBe("true");
  });

  it("omits has_documents when false", () => {
    const filters: IssueFilters = { hasDocuments: false };
    const params = buildIssueSearchParams("", filters);
    expect(params.has("has_documents")).toBe(false);
  });

  it("omits has_documents when undefined", () => {
    const filters: IssueFilters = {};
    const params = buildIssueSearchParams("", filters);
    expect(params.has("has_documents")).toBe(false);
  });

  it("maps documentKind to document_kind param", () => {
    const filters: IssueFilters = { documentKind: "adr" };
    const params = buildIssueSearchParams("", filters);
    expect(params.get("document_kind")).toBe("adr");
  });

  it("omits document_kind when undefined", () => {
    const filters: IssueFilters = {};
    const params = buildIssueSearchParams("", filters);
    expect(params.has("document_kind")).toBe(false);
  });

  it("does NOT include has_documents when documentKind is set (precedence)", () => {
    // has:adr → documentKind=adr; hasDocuments should not also be sent
    const filters: IssueFilters = { documentKind: "adr" };
    const params = buildIssueSearchParams("", filters);
    expect(params.has("has_documents")).toBe(false);
    expect(params.get("document_kind")).toBe("adr");
  });

  it("composes q and all filters together", () => {
    const filters: IssueFilters = {
      state: "in_progress",
      type: "feature",
      priority: "critical",
    };
    const params = buildIssueSearchParams("auth endpoint", filters);
    const obj = toObj(params);
    expect(obj).toMatchObject({
      q: "auth endpoint",
      state: "in_progress",
      type: "feature",
      priority: "critical",
    });
  });

  it("omits undefined filter fields", () => {
    const filters: IssueFilters = { state: "done" };
    const params = buildIssueSearchParams("", filters);
    expect(params.has("type")).toBe(false);
    expect(params.has("priority")).toBe(false);
    expect(params.has("has_documents")).toBe(false);
    expect(params.has("document_kind")).toBe(false);
  });

  it("produces empty params for empty q and empty filters", () => {
    const params = buildIssueSearchParams("", {});
    expect(params.toString()).toBe("");
  });
});
