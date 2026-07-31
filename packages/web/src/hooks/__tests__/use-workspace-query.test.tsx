import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useActiveWorkspaceId,
  useSetActiveWorkspace,
  useWorkspacesQuery,
} from "../use-workspace-query";
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  useWorkspaceStore,
} from "@/stores/workspace-store";
import { projectKeys } from "@/lib/query-keys";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from "@/lib/api-client";

const workspaces = [
  {
    id: "ws-a",
    name: "Alpha",
    slug: "alpha",
    allowedDomains: [],
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "ws-b",
    name: "Beta",
    slug: "beta",
    allowedDomains: [],
    createdAt: "2026-02-01T00:00:00Z",
  },
];

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useActiveWorkspaceId", () => {
  beforeEach(() => {
    localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    vi.mocked(fetchApi).mockResolvedValue(workspaces);
  });

  it("returns stored id when it is still a member", async () => {
    useWorkspaceStore.getState().setActiveWorkspaceId("ws-b");
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useActiveWorkspaceId(), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current).toBe("ws-b"));
  });

  it("falls back to first workspace and rewrites storage when stored id is stale", async () => {
    useWorkspaceStore.getState().setActiveWorkspaceId("ws-gone");
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useActiveWorkspaceId(), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current).toBe("ws-a"));
    await waitFor(() =>
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-a"),
    );
  });
});

describe("useSetActiveWorkspace", () => {
  beforeEach(() => {
    localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    useWorkspaceStore.setState({ activeWorkspaceId: null });
  });

  it("persists id and invalidates project lists", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useSetActiveWorkspace(), {
      wrapper: wrapperFor(client),
    });

    act(() => {
      result.current("ws-b");
    });

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-b");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.lists(),
    });
  });
});

describe("useWorkspacesQuery", () => {
  it("fetches workspaces", async () => {
    vi.mocked(fetchApi).mockResolvedValue(workspaces);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useWorkspacesQuery(), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.data).toEqual(workspaces));
  });
});
