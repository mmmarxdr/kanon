import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { issueKeys, cycleKeys } from "@/lib/query-keys";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

vi.mock("@/stores/toast-store", () => ({
  useToastStore: {
    getState: () => ({
      addToast: vi.fn(),
    }),
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

const PROJECT_KEY = "TEST";
const GROUP_KEY = "todo";

describe("useGroupTransitionMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invalidates issueKeys.groups(projectKey) on success", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({
      count: 3,
      groupKey: GROUP_KEY,
      state: "in_progress",
    });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), [
      { groupKey: GROUP_KEY, latestState: "todo", issues: [] },
    ]);
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.groups(PROJECT_KEY) }),
    );
  });

  it("does NOT invalidate issueKeys.list(projectKey) on success", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({
      count: 3,
      groupKey: GROUP_KEY,
      state: "in_progress",
    });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), [
      { groupKey: GROUP_KEY, latestState: "todo", issues: [] },
    ]);
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
  });

  it("applies optimistic update: issueKeys.groups snapshot reflects toState before fetch resolves", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    let resolveFetch!: (value: unknown) => void;
    const deferred = new Promise((r) => {
      resolveFetch = r;
    });
    vi.mocked(fetchApi).mockReturnValue(deferred as Promise<never>);

    const { queryClient, wrapper } = createWrapper();
    const originalGroups = [
      { groupKey: GROUP_KEY, latestState: "todo", issues: [] },
    ];
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), originalGroups);

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "in_progress" });
    });

    // onMutate is async — wait for the optimistic update to apply
    await waitFor(() => {
      const optimistic = queryClient.getQueryData<
        { groupKey: string; latestState: string }[]
      >(issueKeys.groups(PROJECT_KEY));
      const group = optimistic?.find((g) => g.groupKey === GROUP_KEY);
      expect(group?.latestState).toBe("in_progress");
    });

    // Resolve fetch so the mutation completes cleanly
    resolveFetch({ count: 3, groupKey: GROUP_KEY, state: "in_progress" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  // ── F3: cycleKeys.all invalidation (belt-and-suspenders) ────────────────

  it("F3 success path: invalidates cycleKeys.all on settled", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({
      count: 3,
      groupKey: GROUP_KEY,
      state: "in_progress",
    });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), [
      { groupKey: GROUP_KEY, latestState: "todo", issues: [] },
    ]);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // F3: cycleKeys.all must be invalidated in onSettled alongside issueKeys.groups
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  it("F3 error path: cycleKeys.all still invalidated in onSettled when mutation fails", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Group transition failed"));

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), [
      { groupKey: GROUP_KEY, latestState: "todo", issues: [] },
    ]);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // onSettled fires on both success and error — cycleKeys.all must be invalidated
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  // ── Existing rollback test ─────────────────────────────────────────────────

  it("rolls back optimistic update on error and restores original snapshot", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Transition failed"));

    const { queryClient, wrapper } = createWrapper();
    const originalGroups = [
      { groupKey: GROUP_KEY, latestState: "todo", issues: [] },
    ];
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), originalGroups);

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // After rollback, original snapshot must be restored
    const afterRollback = queryClient.getQueryData<
      { groupKey: string; latestState: string }[]
    >(issueKeys.groups(PROJECT_KEY));
    const group = afterRollback?.find((g) => g.groupKey === GROUP_KEY);
    expect(group?.latestState).toBe("todo");
  });
});
