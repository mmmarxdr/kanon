import { describe, it, expect } from "vitest";
import {
  issueKeys,
  projectKeys,
  workspaceKeys,
  cycleKeys,
  proposalKeys,
  dashboardKeys,
} from "@/lib/query-keys";

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

  describe("cycleKeys", () => {
    it("has a stable 'all' base key", () => {
      expect(cycleKeys.all).toEqual(["cycles"]);
    });

    it("lists() extends 'all' with 'list'", () => {
      expect(cycleKeys.lists()).toEqual(["cycles", "list"]);
    });

    it("list(projectKey) produces the correct key", () => {
      expect(cycleKeys.list("PROJ-1")).toEqual(["cycles", "list", "PROJ-1"]);
    });

    it("details() extends 'all' with 'detail'", () => {
      expect(cycleKeys.details()).toEqual(["cycles", "detail"]);
    });

    it("detail(cycleId) produces the correct key", () => {
      expect(cycleKeys.detail("cycle-abc")).toEqual([
        "cycles",
        "detail",
        "cycle-abc",
      ]);
    });

    it("all is a prefix of list(projectKey)", () => {
      const listKey = cycleKeys.list("PROJ-1");
      expect(listKey.slice(0, cycleKeys.all.length)).toEqual([...cycleKeys.all]);
    });

    it("all is a prefix of detail(cycleId)", () => {
      const detailKey = cycleKeys.detail("cycle-abc");
      expect(detailKey.slice(0, cycleKeys.all.length)).toEqual([
        ...cycleKeys.all,
      ]);
    });

    it("list('A') and list('B') are distinct", () => {
      expect(cycleKeys.list("A")).not.toEqual(cycleKeys.list("B"));
    });

    it("list(projectKey) and detail(cycleId) are distinct", () => {
      expect(cycleKeys.list("PROJ-1")).not.toEqual(cycleKeys.detail("PROJ-1"));
    });
  });

  describe("proposalKeys", () => {
    it("has a stable 'all' base key", () => {
      expect(proposalKeys.all).toEqual(["proposals"]);
    });

    it("lists() extends 'all' with 'list'", () => {
      expect(proposalKeys.lists()).toEqual(["proposals", "list"]);
    });

    it("list(workspaceId) produces the correct key", () => {
      expect(proposalKeys.list("ws-1")).toEqual(["proposals", "list", "ws-1"]);
    });

    it("list(null) produces the correct key with null segment", () => {
      expect(proposalKeys.list(null)).toEqual(["proposals", "list", null]);
    });

    it("pending(workspaceId) produces the correct key", () => {
      expect(proposalKeys.pending("ws-1")).toEqual([
        "proposals",
        "pending",
        "ws-1",
      ]);
    });

    it("pending(null) produces the correct key with null segment", () => {
      expect(proposalKeys.pending(null)).toEqual([
        "proposals",
        "pending",
        null,
      ]);
    });

    it("all is a prefix of list(workspaceId)", () => {
      const listKey = proposalKeys.list("ws-1");
      expect(listKey.slice(0, proposalKeys.all.length)).toEqual([
        ...proposalKeys.all,
      ]);
    });

    it("all is a prefix of pending(workspaceId)", () => {
      const pendingKey = proposalKeys.pending("ws-1");
      expect(pendingKey.slice(0, proposalKeys.all.length)).toEqual([
        ...proposalKeys.all,
      ]);
    });

    it("list and pending keys are distinct for the same workspaceId", () => {
      expect(proposalKeys.list("ws-1")).not.toEqual(
        proposalKeys.pending("ws-1"),
      );
    });
  });

  describe("dashboardKeys", () => {
    it("has a stable 'all' base key", () => {
      expect(dashboardKeys.all).toEqual(["dashboard"]);
    });

    it("details() extends 'all' with 'detail'", () => {
      expect(dashboardKeys.details()).toEqual(["dashboard", "detail"]);
    });

    it("detail(workspaceId) produces the correct key", () => {
      expect(dashboardKeys.detail("ws-1")).toEqual([
        "dashboard",
        "detail",
        "ws-1",
      ]);
    });

    it("detail(null) produces the correct key with null segment", () => {
      expect(dashboardKeys.detail(null)).toEqual(["dashboard", "detail", null]);
    });

    it("all is a prefix of detail(workspaceId)", () => {
      const detailKey = dashboardKeys.detail("ws-1");
      expect(detailKey.slice(0, dashboardKeys.all.length)).toEqual([
        ...dashboardKeys.all,
      ]);
    });

    it("detail('ws-A') and detail('ws-B') are distinct", () => {
      expect(dashboardKeys.detail("ws-A")).not.toEqual(
        dashboardKeys.detail("ws-B"),
      );
    });
  });
});
