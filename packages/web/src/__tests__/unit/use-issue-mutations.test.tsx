import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useUpdateIssueMutation,
  useAddCommentMutation,
} from "@/features/issue-detail/use-issue-mutations";
import { issueKeys, commentKeys, activityKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { IssueDetail, Issue, Comment } from "@/types/issue";

// Mock fetchApi at module level
vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

const PROJECT_KEY = "KAN";
const ISSUE_KEY = "KAN-42";

const MOCK_DETAIL: IssueDetail = {
  id: "issue-1",
  key: ISSUE_KEY,
  title: "Original title",
  description: "Original description",
  type: "task",
  priority: "medium",
  state: "apply",
  labels: ["frontend"],
  assigneeId: "user-1",
  assignee: { id: "user-1", username: "alice", email: "alice@test.com" },
  projectId: "proj-1",
  project: { id: "proj-1", key: PROJECT_KEY, name: "Kanon" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-15T00:00:00Z",
};

const MOCK_LIST_ISSUES: Issue[] = [
  {
    id: "issue-1",
    key: ISSUE_KEY,
    title: "Original title",
    type: "task",
    priority: "medium",
    state: "apply",
    labels: ["frontend"],
    assigneeId: "user-1",
    assignee: { username: "alice" },
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
  },
  {
    id: "issue-2",
    key: "KAN-43",
    title: "Other issue",
    type: "bug",
    priority: "high",
    state: "verify",
    labels: [],
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
  },
];

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

describe("useUpdateIssueMutation", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies optimistic update to detail cache immediately (R-IDP-07)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);

    // Make mutation hang so we can inspect optimistic state
    let resolveMutation: ((v: IssueDetail) => void) | undefined;
    mockFetchApi.mockReturnValue(
      new Promise<IssueDetail>((resolve) => {
        resolveMutation = resolve;
      }),
    );

    const { queryClient, wrapper } = createWrapper();

    // Seed caches
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), MOCK_DETAIL);
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    const { result } = renderHook(
      () => useUpdateIssueMutation(ISSUE_KEY, PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ priority: "critical" });
    });

    // Optimistic update should be visible immediately
    await waitFor(() => {
      const cached = queryClient.getQueryData<IssueDetail>(
        issueKeys.detail(ISSUE_KEY),
      );
      expect(cached?.priority).toBe("critical");
    });

    // List cache should also be updated
    const listCached = queryClient.getQueryData<Issue[]>(
      issueKeys.list(PROJECT_KEY),
    );
    const updated = listCached?.find((i) => i.key === ISSUE_KEY);
    expect(updated?.priority).toBe("critical");

    // Other issues should be untouched
    const other = listCached?.find((i) => i.key === "KAN-43");
    expect(other?.priority).toBe("high");

    // Clean up
    resolveMutation?.({ ...MOCK_DETAIL, priority: "critical" });
  });

  it("rolls back both caches on mutation error (R-IDP-07)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockRejectedValue(new Error("Server error"));

    const { queryClient, wrapper } = createWrapper();

    // Seed caches
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), MOCK_DETAIL);
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), MOCK_LIST_ISSUES);

    const { result } = renderHook(
      () => useUpdateIssueMutation(ISSUE_KEY, PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ priority: "critical" });
    });

    // Wait for error
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Detail cache should be rolled back to original
    const detailCached = queryClient.getQueryData<IssueDetail>(
      issueKeys.detail(ISSUE_KEY),
    );
    expect(detailCached?.priority).toBe("medium");

    // List cache should be rolled back
    const listCached = queryClient.getQueryData<Issue[]>(
      issueKeys.list(PROJECT_KEY),
    );
    const issue = listCached?.find((i) => i.key === ISSUE_KEY);
    expect(issue?.priority).toBe("medium");
  });

  it("shows error toast on mutation failure (R-IDP-07)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Server error"));

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), MOCK_DETAIL);

    const { result } = renderHook(
      () => useUpdateIssueMutation(ISSUE_KEY, PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ title: "New title" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe("error");
    expect(toasts[0]!.message).toContain(ISSUE_KEY);
  });

  it("sends PATCH to correct endpoint with payload (R-IDP-05, R-IDP-06)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockResolvedValue({ ...MOCK_DETAIL, title: "Updated title" });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), MOCK_DETAIL);

    const { result } = renderHook(
      () => useUpdateIssueMutation(ISSUE_KEY, PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ title: "Updated title" });
    });

    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith(
        `/api/issues/${ISSUE_KEY}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated title" }),
        },
      );
    });
  });

  it("optimistically updates title for inline editing (R-IDP-05)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    let resolveMutation: ((v: IssueDetail) => void) | undefined;
    vi.mocked(fetchApi).mockReturnValue(
      new Promise<IssueDetail>((resolve) => {
        resolveMutation = resolve;
      }),
    );

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), MOCK_DETAIL);

    const { result } = renderHook(
      () => useUpdateIssueMutation(ISSUE_KEY, PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ title: "New title via inline edit" });
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<IssueDetail>(
        issueKeys.detail(ISSUE_KEY),
      );
      expect(cached?.title).toBe("New title via inline edit");
    });

    resolveMutation?.({ ...MOCK_DETAIL, title: "New title via inline edit" });
  });
});

describe("useAddCommentMutation", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends POST to correct endpoint (R-IDP-08)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    const mockComment: Comment = {
      id: "c-new",
      body: "New comment",
      source: "human",
      author: { id: "user-1", username: "alice" },
      createdAt: "2026-01-20T00:00:00Z",
      updatedAt: "2026-01-20T00:00:00Z",
    };
    mockFetchApi.mockResolvedValue(mockComment);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAddCommentMutation(ISSUE_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate("New comment");
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetchApi).toHaveBeenCalledWith(
      `/api/issues/${ISSUE_KEY}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body: "New comment" }),
      },
    );
  });

  it("invalidates comment and activity caches on success (R-IDP-08)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({
      id: "c-new",
      body: "Test",
      source: "human",
      author: { id: "user-1", username: "alice" },
      createdAt: "2026-01-20T00:00:00Z",
      updatedAt: "2026-01-20T00:00:00Z",
    });

    const { queryClient, wrapper } = createWrapper();

    // Seed comment and activity caches
    queryClient.setQueryData(commentKeys.list(ISSUE_KEY), []);
    queryClient.setQueryData(activityKeys.list(ISSUE_KEY), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useAddCommentMutation(ISSUE_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate("A comment");
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Should invalidate both comments and activity
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: commentKeys.list(ISSUE_KEY),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: activityKeys.list(ISSUE_KEY),
      }),
    );
  });

  it("shows error toast on failure (R-IDP-08)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Network error"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAddCommentMutation(ISSUE_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate("Failing comment");
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe("error");
    expect(toasts[0]!.message).toContain(ISSUE_KEY);
  });
});
