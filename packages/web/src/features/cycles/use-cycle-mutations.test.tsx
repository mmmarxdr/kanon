import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { cycleKeys, issueKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
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
const CYCLE_ID = "cycle-abc";
const ISSUE_KEY = "TEST-1";

describe("useCreateCycleMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invalidates cycleKeys.list(projectKey) on success", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: CYCLE_ID, name: "Sprint 1" });

    const { queryClient, wrapper } = createWrapper();

    // Seed some data so we can confirm invalidation happens
    queryClient.setQueryData(cycleKeys.list(PROJECT_KEY), []);

    const { useCreateCycleMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useCreateCycleMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        name: "Sprint 1",
        startDate: "2026-05-01",
        endDate: "2026-05-14",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Query should be invalidated (stale)
    const queryState = queryClient.getQueryState(cycleKeys.list(PROJECT_KEY));
    expect(queryState?.isInvalidated).toBe(true);
  });

  it("surfaces an error toast on failure", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Server error"));

    useToastStore.setState({ toasts: [] });

    const { wrapper } = createWrapper();
    const { useCreateCycleMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useCreateCycleMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        name: "Sprint 1",
        startDate: "2026-05-01",
        endDate: "2026-05-14",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]!.type).toBe("error");
  });

  it("sends startDate and endDate as full ISO datetime strings (backend requires z.string().datetime())", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: CYCLE_ID, name: "Sprint 1" });

    const { wrapper } = createWrapper();
    const { useCreateCycleMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useCreateCycleMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        name: "Sprint 1",
        startDate: "2026-05-01",
        endDate: "2026-05-14",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchApi).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetchApi).mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body) as {
      startDate: string;
      endDate: string;
    };
    // Must be ISO 8601 datetime, e.g. "2026-05-01T00:00:00.000Z"
    expect(body.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(body.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Date portion must match what the user picked (UTC midnight is acceptable for cycle dates)
    expect(body.startDate.startsWith("2026-05-01T")).toBe(true);
    expect(body.endDate.startsWith("2026-05-14T")).toBe(true);
  });
});

describe("useCloseCycleMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invalidates cycleKeys.list(projectKey) AND cycleKeys.detail(cycleId) on success", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: CYCLE_ID, state: "done" });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(cycleKeys.list(PROJECT_KEY), []);
    queryClient.setQueryData(cycleKeys.detail(CYCLE_ID), { id: CYCLE_ID });

    const { useCloseCycleMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useCloseCycleMutation(CYCLE_ID, PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(cycleKeys.list(PROJECT_KEY))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(cycleKeys.detail(CYCLE_ID))?.isInvalidated).toBe(true);
  });

  it("surfaces an error toast on failure", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Close failed"));

    useToastStore.setState({ toasts: [] });

    const { wrapper } = createWrapper();
    const { useCloseCycleMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useCloseCycleMutation(CYCLE_ID, PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]!.type).toBe("error");
  });
});

describe("useAttachIssueMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('context "issue-detail": invalidates NOTHING — optimistic update covers the screen', async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: CYCLE_ID });

    const { queryClient, wrapper } = createWrapper();
    // Seed all four keys so we can confirm none get invalidated
    queryClient.setQueryData(cycleKeys.list(PROJECT_KEY), []);
    queryClient.setQueryData(cycleKeys.detail(CYCLE_ID), { id: CYCLE_ID });
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), {
      id: "issue-1", key: ISSUE_KEY, cycle: null,
    });
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useAttachIssueMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useAttachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        cycleId: CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Zero invalidations — setIssueDetailCycle in onMutate already wrote the
    // new cycle to the issue-detail cache; cycle keys have no subscriber on
    // this screen.
    expect(invalidateSpy).toHaveBeenCalledTimes(0);
  });

  it("context issue-detail: optimistic update visible synchronously before fetch resolves", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    // Use a deferred promise so we can inspect cache before resolve
    let resolveFetch!: (value: unknown) => void;
    const deferred = new Promise((r) => { resolveFetch = r; });
    vi.mocked(fetchApi).mockReturnValue(deferred as Promise<never>);

    const { queryClient, wrapper } = createWrapper();
    const originalIssue = {
      id: "issue-1",
      key: ISSUE_KEY,
      title: "Test",
      type: "task",
      priority: "medium",
      state: "todo",
      labels: [],
      projectId: "proj-1",
      project: { id: "proj-1", key: PROJECT_KEY, name: "Test" },
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
      cycle: null,
    };
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), originalIssue);

    const { useAttachIssueMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useAttachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        cycleId: CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });
    });

    // onMutate is async (awaits cancelQueries) — wait for it to apply the
    // optimistic update, but the fetch is still pending (deferred promise).
    await waitFor(() => {
      const optimistic = queryClient.getQueryData<{ cycle: unknown }>(
        issueKeys.detail(ISSUE_KEY),
      );
      expect(optimistic?.cycle).toEqual({ id: CYCLE_ID, name: expect.any(String) });
    });

    // Now resolve the fetch — mutation should complete successfully
    resolveFetch({ id: CYCLE_ID });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("context issue-detail: rolls back optimistic update on fetch rejection", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Network error"));

    const { queryClient, wrapper } = createWrapper();
    const originalIssue = {
      id: "issue-1",
      key: ISSUE_KEY,
      title: "Test",
      type: "task",
      priority: "medium",
      state: "todo",
      labels: [],
      projectId: "proj-1",
      project: { id: "proj-1", key: PROJECT_KEY, name: "Test" },
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
      cycle: null,
    };
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), originalIssue);

    const { useAttachIssueMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useAttachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        cycleId: CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // After rollback, cycle field must be back to original null
    const afterRollback = queryClient.getQueryData<{ cycle: unknown }>(
      issueKeys.detail(ISSUE_KEY),
    );
    expect(afterRollback?.cycle).toBeNull();
  });

  it("skipInvalidation: true → invalidateQueries called 0 times on settle", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: CYCLE_ID });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), {
      id: "issue-1", key: ISSUE_KEY, cycle: null,
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useAttachIssueMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useAttachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        cycleId: CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
        skipInvalidation: true,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledTimes(0);
  });

  it("surfaces an error toast on failure", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Attach failed"));

    useToastStore.setState({ toasts: [] });

    const { wrapper } = createWrapper();
    const { useAttachIssueMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useAttachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        cycleId: CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]!.type).toBe("error");
  });
});

describe("useDetachIssueMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('context "issue-detail": invalidates NOTHING — optimistic update covers the screen', async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: CYCLE_ID });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(cycleKeys.list(PROJECT_KEY), []);
    queryClient.setQueryData(cycleKeys.detail(CYCLE_ID), { id: CYCLE_ID });
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), {
      id: "issue-1", key: ISSUE_KEY,
      cycle: { id: CYCLE_ID, name: "Sprint 1" },
    });
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDetachIssueMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useDetachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        cycleId: CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledTimes(0);
  });

  it("context issue-detail: rolls back cycle to original on fetch rejection (clears to null)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Detach failed"));

    const { queryClient, wrapper } = createWrapper();
    const existingCycle = { id: CYCLE_ID, name: "Sprint 1" };
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), {
      id: "issue-1", key: ISSUE_KEY, cycle: existingCycle,
    });

    const { useDetachIssueMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useDetachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        cycleId: CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // After rollback, cycle must be restored to original value
    const afterRollback = queryClient.getQueryData<{ cycle: unknown }>(
      issueKeys.detail(ISSUE_KEY),
    );
    expect(afterRollback?.cycle).toEqual(existingCycle);
  });

  it("skipInvalidation: true → invalidateQueries called 0 times on settle", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: CYCLE_ID });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), {
      id: "issue-1", key: ISSUE_KEY,
      cycle: { id: CYCLE_ID, name: "Sprint 1" },
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDetachIssueMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useDetachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        cycleId: CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
        skipInvalidation: true,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledTimes(0);
  });

  it("surfaces an error toast on failure", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Detach failed"));

    useToastStore.setState({ toasts: [] });

    const { wrapper } = createWrapper();
    const { useDetachIssueMutation } = await import("./use-cycle-mutations");
    const { result } = renderHook(
      () => useDetachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({
        cycleId: CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]!.type).toBe("error");
  });
});
