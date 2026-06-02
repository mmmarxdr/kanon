/**
 * useCreateWorkspaceMutation — contract tests.
 *
 * Verifies:
 *   - mutationFn calls POST /api/workspaces with correct body
 *   - onSuccess invalidates workspaceKeys.list()
 *   - onError calls addToast with "error" severity
 *   - mutation resolves with returned workspace on success
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { workspaceKeys } from "@/lib/query-keys";
import { useCreateWorkspaceMutation } from "../use-create-workspace-mutation";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("@/stores/toast-store", () => ({
  useToastStore: {
    getState: vi.fn(() => ({
      toasts: [],
      addToast: vi.fn(),
      removeToast: vi.fn(),
    })),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const MOCK_WORKSPACE = {
  id: "ws-1",
  name: "My Workspace",
  slug: "my-workspace",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
};

describe("useCreateWorkspaceMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls POST /api/workspaces with name and slug, returns the created workspace", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(MOCK_WORKSPACE);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkspaceMutation(), { wrapper });

    await act(async () => {
      result.current.mutate({ name: "My Workspace", slug: "my-workspace" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(fetchApi)).toHaveBeenCalledWith("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "My Workspace", slug: "my-workspace" }),
    });
    expect(result.current.data).toEqual(MOCK_WORKSPACE);
  });

  it("invalidates workspaceKeys.list() on success", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(MOCK_WORKSPACE);

    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateWorkspaceMutation(), { wrapper });

    await act(async () => {
      result.current.mutate({ name: "My Workspace", slug: "my-workspace" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workspaceKeys.list(),
    });
  });

  it("calls addToast with error severity on failure", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Network error"));

    const { useToastStore } = await import("@/stores/toast-store");
    const addToastMock = vi.fn();
    vi.mocked(useToastStore.getState).mockReturnValue({
      toasts: [],
      addToast: addToastMock,
      removeToast: vi.fn(),
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkspaceMutation(), { wrapper });

    await act(async () => {
      result.current.mutate({ name: "My Workspace", slug: "my-workspace" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining("Failed"),
      "error",
    );
  });
});
