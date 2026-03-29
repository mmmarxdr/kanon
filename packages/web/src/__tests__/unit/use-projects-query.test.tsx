import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { projectKeys } from "@/lib/query-keys";
import type { Project } from "@/types/project";

// Mock fetchApi at module level
vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const MOCK_PROJECTS: Project[] = [
  { id: "p-1", key: "KAN", name: "Kanon", description: null },
  { id: "p-2", key: "TEST", name: "Test Project", description: "A test project" },
];

describe("useProjectsQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls fetchApi with correct workspace URL", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockResolvedValue(MOCK_PROJECTS);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjectsQuery("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetchApi).toHaveBeenCalledWith("/api/workspaces/ws-1/projects");
  });

  it("uses correct query key matching projectKeys.list", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(MOCK_PROJECTS);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useProjectsQuery("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const cached = queryClient.getQueryData(projectKeys.list("ws-1"));
    expect(cached).toEqual(MOCK_PROJECTS);
  });

  it("is disabled when workspaceId is undefined", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjectsQuery(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetchApi).not.toHaveBeenCalled();
  });

  it("returns project data with expected shape", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(MOCK_PROJECTS);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useProjectsQuery("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]).toMatchObject({
      id: "p-1",
      key: "KAN",
      name: "Kanon",
    });
  });
});
