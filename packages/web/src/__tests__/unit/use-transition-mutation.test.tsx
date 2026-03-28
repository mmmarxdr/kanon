import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTransitionMutation } from "@/features/board/use-transition-mutation";
import { issueKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { Issue } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";

// Mock fetchApi at the module level
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

function makeIssue(
  overrides: Partial<Issue> & { key: string; state: IssueState },
): Issue {
  return {
    id: `id-${overrides.key}`,
    title: `Issue ${overrides.key}`,
    type: "task",
    priority: "medium",
    labels: [],
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const PROJECT_KEY = "TEST";

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

describe("useTransitionMutation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset toast store
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("applies optimistic update: moves card to new column immediately", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);

    // Make the mutation hang (never resolve) so we can inspect optimistic state
    let resolveMutation: (() => void) | undefined;
    mockFetchApi.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveMutation = resolve;
      }),
    );

    const { queryClient, wrapper } = createWrapper();

    const seedIssues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "explore" }),
      makeIssue({ key: "KAN-2", state: "propose" }),
    ];
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), seedIssues);

    const { result } = renderHook(() => useTransitionMutation(PROJECT_KEY), {
      wrapper,
    });

    // Trigger the mutation
    act(() => {
      result.current.mutate({ issueKey: "KAN-1", toState: "apply" });
    });

    // Wait for onMutate to execute (optimistic update)
    await waitFor(() => {
      const cached = queryClient.getQueryData<Issue[]>(
        issueKeys.list(PROJECT_KEY),
      );
      const issue = cached?.find((i) => i.key === "KAN-1");
      expect(issue?.state).toBe("apply");
    });

    // KAN-2 should be untouched
    const cached = queryClient.getQueryData<Issue[]>(
      issueKeys.list(PROJECT_KEY),
    );
    expect(cached?.find((i) => i.key === "KAN-2")?.state).toBe("propose");

    // Clean up: resolve the pending mutation
    resolveMutation?.();
  });

  it("rolls back to original column on mutation error", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockRejectedValue(new Error("Network error"));

    const { queryClient, wrapper } = createWrapper();

    const seedIssues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "explore" }),
    ];
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), seedIssues);

    const { result } = renderHook(() => useTransitionMutation(PROJECT_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ issueKey: "KAN-1", toState: "verify" });
    });

    // Wait for error handling to complete (rollback)
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // The issue should be rolled back to its original state
    const cached = queryClient.getQueryData<Issue[]>(
      issueKeys.list(PROJECT_KEY),
    );
    expect(cached?.find((i) => i.key === "KAN-1")?.state).toBe("explore");
  });

  it("shows error toast when mutation fails (R-WEB-10)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockRejectedValue(new Error("Server error"));

    const { queryClient, wrapper } = createWrapper();

    const seedIssues: Issue[] = [
      makeIssue({ key: "KAN-5", state: "design" }),
    ];
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), seedIssues);

    const { result } = renderHook(() => useTransitionMutation(PROJECT_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ issueKey: "KAN-5", toState: "spec" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Verify toast was shown
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe("error");
    expect(toasts[0]!.message).toContain("KAN-5");
    expect(toasts[0]!.message).toContain("spec");
  });
});
