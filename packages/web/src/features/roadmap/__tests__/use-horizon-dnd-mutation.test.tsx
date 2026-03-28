import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useHorizonDndMutation } from "../use-roadmap-query";
import { roadmapKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { RoadmapItem } from "@/types/roadmap";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

const PROJECT_KEY = "TEST";

function makeRoadmapItem(
  overrides: Partial<RoadmapItem> & { id: string },
): RoadmapItem {
  return {
    title: `Item ${overrides.id}`,
    horizon: "now",
    labels: [],
    sortOrder: 0,
    promoted: false,
    status: "idea",
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

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

describe("useHorizonDndMutation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("applies optimistic update: moves item to new horizon immediately", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);

    let resolveMutation: (() => void) | undefined;
    mockFetchApi.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveMutation = resolve;
      }),
    );

    const { queryClient, wrapper } = createWrapper();

    const seedItems: RoadmapItem[] = [
      makeRoadmapItem({ id: "item-1", horizon: "now", sortOrder: 1 }),
      makeRoadmapItem({ id: "item-2", horizon: "next", sortOrder: 1 }),
    ];
    queryClient.setQueryData(roadmapKeys.list(PROJECT_KEY), seedItems);

    const { result } = renderHook(
      () => useHorizonDndMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        itemId: "item-1",
        horizon: "later",
        sortOrder: 5,
      });
    });

    // Wait for onMutate (optimistic update)
    await waitFor(() => {
      const cached = queryClient.getQueryData<RoadmapItem[]>(
        roadmapKeys.list(PROJECT_KEY),
      );
      const item = cached?.find((i) => i.id === "item-1");
      expect(item?.horizon).toBe("later");
      expect(item?.sortOrder).toBe(5);
    });

    // item-2 should be untouched
    const cached = queryClient.getQueryData<RoadmapItem[]>(
      roadmapKeys.list(PROJECT_KEY),
    );
    expect(cached?.find((i) => i.id === "item-2")?.horizon).toBe("next");

    resolveMutation?.();
  });

  it("rolls back to original state on mutation error", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockRejectedValue(new Error("Network error"));

    const { queryClient, wrapper } = createWrapper();

    const seedItems: RoadmapItem[] = [
      makeRoadmapItem({ id: "item-1", horizon: "now", sortOrder: 1 }),
    ];
    queryClient.setQueryData(roadmapKeys.list(PROJECT_KEY), seedItems);

    const { result } = renderHook(
      () => useHorizonDndMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        itemId: "item-1",
        horizon: "later",
        sortOrder: 5,
      });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Should be rolled back
    const cached = queryClient.getQueryData<RoadmapItem[]>(
      roadmapKeys.list(PROJECT_KEY),
    );
    expect(cached?.find((i) => i.id === "item-1")?.horizon).toBe("now");
    expect(cached?.find((i) => i.id === "item-1")?.sortOrder).toBe(1);
  });

  it("shows error toast on failure", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockRejectedValue(new Error("Server error"));

    const { queryClient, wrapper } = createWrapper();

    const seedItems: RoadmapItem[] = [
      makeRoadmapItem({ id: "item-1", horizon: "now", sortOrder: 1 }),
    ];
    queryClient.setQueryData(roadmapKeys.list(PROJECT_KEY), seedItems);

    const { result } = renderHook(
      () => useHorizonDndMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        itemId: "item-1",
        horizon: "next",
        sortOrder: 2,
      });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe("error");
    expect(toasts[0]!.message).toContain("reverted");
  });
});
