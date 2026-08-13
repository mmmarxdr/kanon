import { describe, expect, it } from "vitest";
import { getIssueDeletedDestination } from "../issue-route-lifecycle";

describe("getIssueDeletedDestination", () => {
  it("replaces an authorized board-origin issue with its originating project board", () => {
    expect(getIssueDeletedDestination({ from: "board", projectKey: "KAN" })).toEqual({
      to: "/board/$projectKey",
      params: { projectKey: "KAN" },
      replace: true,
    });
  });

  it("replaces all other authorized deletions with the project-independent inbox destination", () => {
    expect(getIssueDeletedDestination({ from: undefined, projectKey: "KAN" })).toEqual({ to: "/inbox", replace: true });
    expect(getIssueDeletedDestination({ from: "board", projectKey: "" })).toEqual({ to: "/inbox", replace: true });
  });
});
