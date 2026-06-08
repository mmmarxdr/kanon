import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { issueKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { IssueDetail } from "@/types/issue";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

const ISSUE_KEY = "TEST-1";

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

function makeIssueDetail(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: "issue-id-1",
    key: ISSUE_KEY,
    title: "Test Issue",
    type: "task",
    priority: "medium",
    state: "todo",
    labels: [],
    projectId: "proj-1",
    project: { id: "proj-1", key: "TEST", name: "Test Project" },
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    cycle: null,
    subscribed: false,
    ...overrides,
  };
}

describe("useSubscribeMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls PUT /api/issues/:key/subscription and invalidates issueKeys.detail on success", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ subscribed: true });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), makeIssueDetail({ subscribed: false }));

    const { useSubscribeMutation } = await import("./use-subscription-mutations");
    const { result } = renderHook(() => useSubscribeMutation(ISSUE_KEY), { wrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchApi).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchApi).mock.calls[0]!;
    expect(url).toBe(`/api/issues/${ISSUE_KEY}/subscription`);
    expect((init as { method: string }).method).toBe("PUT");
  });

  it("optimistically sets subscribed=true before the fetch resolves", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    let resolveFetch!: (value: unknown) => void;
    const deferred = new Promise((r) => { resolveFetch = r; });
    vi.mocked(fetchApi).mockReturnValue(deferred as Promise<never>);

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), makeIssueDetail({ subscribed: false }));

    const { useSubscribeMutation } = await import("./use-subscription-mutations");
    const { result } = renderHook(() => useSubscribeMutation(ISSUE_KEY), { wrapper });

    act(() => {
      result.current.mutate();
    });

    // Wait for the optimistic update to be applied (onMutate is async — awaits cancelQueries)
    await waitFor(() => {
      const optimistic = queryClient.getQueryData<IssueDetail>(issueKeys.detail(ISSUE_KEY));
      expect(optimistic?.subscribed).toBe(true);
    });

    // Fetch is still in-flight
    resolveFetch({ subscribed: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back optimistic update on fetch rejection", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Network error"));

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), makeIssueDetail({ subscribed: false }));

    const { useSubscribeMutation } = await import("./use-subscription-mutations");
    const { result } = renderHook(() => useSubscribeMutation(ISSUE_KEY), { wrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const afterRollback = queryClient.getQueryData<IssueDetail>(issueKeys.detail(ISSUE_KEY));
    expect(afterRollback?.subscribed).toBe(false);
  });

  it("shows an error toast on failure", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Subscribe failed"));

    useToastStore.setState({ toasts: [] });

    const { wrapper } = createWrapper();
    const { useSubscribeMutation } = await import("./use-subscription-mutations");
    const { result } = renderHook(() => useSubscribeMutation(ISSUE_KEY), { wrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]!.type).toBe("error");
  });
});

describe("useUnsubscribeMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls DELETE /api/issues/:key/subscription and returns on success", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ subscribed: false });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), makeIssueDetail({ subscribed: true }));

    const { useUnsubscribeMutation } = await import("./use-subscription-mutations");
    const { result } = renderHook(() => useUnsubscribeMutation(ISSUE_KEY), { wrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchApi).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchApi).mock.calls[0]!;
    expect(url).toBe(`/api/issues/${ISSUE_KEY}/subscription`);
    expect((init as { method: string }).method).toBe("DELETE");
  });

  it("optimistically sets subscribed=false before the fetch resolves", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    let resolveFetch!: (value: unknown) => void;
    const deferred = new Promise((r) => { resolveFetch = r; });
    vi.mocked(fetchApi).mockReturnValue(deferred as Promise<never>);

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), makeIssueDetail({ subscribed: true }));

    const { useUnsubscribeMutation } = await import("./use-subscription-mutations");
    const { result } = renderHook(() => useUnsubscribeMutation(ISSUE_KEY), { wrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      const optimistic = queryClient.getQueryData<IssueDetail>(issueKeys.detail(ISSUE_KEY));
      expect(optimistic?.subscribed).toBe(false);
    });

    resolveFetch({ subscribed: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back optimistic update on fetch rejection", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Unsubscribe failed"));

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), makeIssueDetail({ subscribed: true }));

    const { useUnsubscribeMutation } = await import("./use-subscription-mutations");
    const { result } = renderHook(() => useUnsubscribeMutation(ISSUE_KEY), { wrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const afterRollback = queryClient.getQueryData<IssueDetail>(issueKeys.detail(ISSUE_KEY));
    expect(afterRollback?.subscribed).toBe(true);
  });

  it("shows an error toast on failure", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Unsubscribe failed"));

    useToastStore.setState({ toasts: [] });

    const { wrapper } = createWrapper();
    const { useUnsubscribeMutation } = await import("./use-subscription-mutations");
    const { result } = renderHook(() => useUnsubscribeMutation(ISSUE_KEY), { wrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]!.type).toBe("error");
  });
});
