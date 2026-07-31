import { beforeEach, describe, expect, it } from "vitest";
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  resolveActiveWorkspaceId,
  useWorkspaceStore,
} from "../workspace-store";

describe("resolveActiveWorkspaceId", () => {
  it("returns undefined when membership is empty and clears stale storage flag", () => {
    expect(resolveActiveWorkspaceId("ws-old", [])).toEqual({
      id: undefined,
      shouldPersist: true,
    });
  });

  it("keeps stored id when still a member", () => {
    expect(resolveActiveWorkspaceId("ws-b", ["ws-a", "ws-b"])).toEqual({
      id: "ws-b",
      shouldPersist: false,
    });
  });

  it("falls back to first workspace when stored id is stale", () => {
    expect(resolveActiveWorkspaceId("ws-gone", ["ws-a", "ws-b"])).toEqual({
      id: "ws-a",
      shouldPersist: true,
    });
  });

  it("falls back to first when nothing stored", () => {
    expect(resolveActiveWorkspaceId(null, ["ws-a", "ws-b"])).toEqual({
      id: "ws-a",
      shouldPersist: true,
    });
  });
});

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    useWorkspaceStore.setState({ activeWorkspaceId: null });
  });

  it("persists active workspace id to localStorage", () => {
    useWorkspaceStore.getState().setActiveWorkspaceId("ws-1");
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe("ws-1");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-1");
  });

  it("clears storage when set to null", () => {
    useWorkspaceStore.getState().setActiveWorkspaceId("ws-1");
    useWorkspaceStore.getState().setActiveWorkspaceId(null);
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBeNull();
  });
});
