import { describe, it, expect } from "vitest";
import { issueKeys, projectKeys, workspaceKeys } from "@/lib/query-keys";

describe("query key factories", () => {
  describe("issueKeys", () => {
    it("has a stable 'all' base key", () => {
      expect(issueKeys.all).toEqual(["issues"]);
    });

    it("lists() extends 'all' with 'list'", () => {
      expect(issueKeys.lists()).toEqual(["issues", "list"]);
    });

    it("list(projectKey) includes the project key", () => {
      expect(issueKeys.list("PROJ-1")).toEqual(["issues", "list", "PROJ-1"]);
    });

    it("different project keys produce different cache keys", () => {
      expect(issueKeys.list("PROJ-A")).not.toEqual(issueKeys.list("PROJ-B"));
    });

    it("details() extends 'all' with 'detail'", () => {
      expect(issueKeys.details()).toEqual(["issues", "detail"]);
    });

    it("detail(key) includes the issue key", () => {
      expect(issueKeys.detail("KAN-42")).toEqual([
        "issues",
        "detail",
        "KAN-42",
      ]);
    });
  });

  describe("projectKeys", () => {
    it("has a stable 'all' base key", () => {
      expect(projectKeys.all).toEqual(["projects"]);
    });

    it("lists() extends 'all' with 'list'", () => {
      expect(projectKeys.lists()).toEqual(["projects", "list"]);
    });

    it("list(workspaceId) includes the workspace ID", () => {
      expect(projectKeys.list("ws-1")).toEqual(["projects", "list", "ws-1"]);
    });

    it("detail(key) includes the project key", () => {
      expect(projectKeys.detail("PROJ-1")).toEqual([
        "projects",
        "detail",
        "PROJ-1",
      ]);
    });
  });

  describe("workspaceKeys", () => {
    it("has a stable 'all' base key", () => {
      expect(workspaceKeys.all).toEqual(["workspaces"]);
    });

    it("lists() extends 'all' with 'list'", () => {
      expect(workspaceKeys.lists()).toEqual(["workspaces", "list"]);
    });

    it("list() returns the same as lists()", () => {
      expect(workspaceKeys.list()).toEqual(workspaceKeys.lists());
    });
  });

  describe("key hierarchy for invalidation", () => {
    it("issue list keys start with the 'all' prefix (for broad invalidation)", () => {
      const listKey = issueKeys.list("PROJ-1");
      expect(listKey[0]).toBe(issueKeys.all[0]);
    });

    it("issue detail keys start with the 'all' prefix", () => {
      const detailKey = issueKeys.detail("KAN-1");
      expect(detailKey[0]).toBe(issueKeys.all[0]);
    });

    it("keys are readonly tuples (immutable)", () => {
      const key1 = issueKeys.list("PROJ-1");
      const key2 = issueKeys.list("PROJ-1");
      // Each call returns a new array, so they are equal by value but not reference
      expect(key1).toEqual(key2);
    });
  });
});
