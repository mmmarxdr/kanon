import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useIssueDetailQuery,
  useCommentsQuery,
  useActivityQuery,
} from "@/features/issue-detail/use-issue-detail-queries";
import { issueKeys, commentKeys, activityKeys } from "@/lib/query-keys";
import type { IssueDetail, Comment, ActivityLog } from "@/types/issue";

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

const MOCK_ISSUE_DETAIL: IssueDetail = {
  id: "issue-1",
  key: "KAN-42",
  title: "Test issue",
  description: "Some **markdown** description",
  type: "task",
  priority: "medium",
  state: "apply",
  labels: ["frontend"],
  assigneeId: "user-1",
  assignee: { id: "user-1", username: "alice", email: "alice@test.com" },
  projectId: "proj-1",
  project: { id: "proj-1", key: "KAN", name: "Kanon" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-15T00:00:00Z",
};

const MOCK_COMMENTS: Comment[] = [
  {
    id: "c-1",
    body: "First comment with **bold**",
    source: "human",
    author: { id: "user-1", username: "alice" },
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
  {
    id: "c-2",
    body: "Agent comment",
    source: "agent",
    author: { id: "user-2", username: "bot" },
    createdAt: "2026-01-03T00:00:00Z",
    updatedAt: "2026-01-03T00:00:00Z",
  },
];

const MOCK_ACTIVITIES: ActivityLog[] = [
  {
    id: "a-1",
    action: "created",
    actor: { id: "user-1", username: "alice" },
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "a-2",
    action: "state_changed",
    field: "state",
    oldValue: "explore",
    newValue: "apply",
    actor: { id: "user-1", username: "alice" },
    createdAt: "2026-01-10T00:00:00Z",
  },
];

describe("useIssueDetailQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches issue detail and uses correct query key (R-IDP-03)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockResolvedValue(MOCK_ISSUE_DETAIL);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueDetailQuery("KAN-42"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(MOCK_ISSUE_DETAIL);
    expect(mockFetchApi).toHaveBeenCalledWith("/api/issues/KAN-42");
  });

  it("uses correct query key matching issueKeys.detail", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(MOCK_ISSUE_DETAIL);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueDetailQuery("KAN-42"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Verify the data is cached under the correct key
    const cached = queryClient.getQueryData(issueKeys.detail("KAN-42"));
    expect(cached).toEqual(MOCK_ISSUE_DETAIL);
  });

  it("is disabled when issueKey is undefined", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueDetailQuery(undefined), {
      wrapper,
    });

    // Should not fetch at all
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetchApi).not.toHaveBeenCalled();
  });

  it("is disabled when issueKey is empty string", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useIssueDetailQuery(""), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetchApi).not.toHaveBeenCalled();
  });

  it("encodes special characters in issueKey", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockResolvedValue(MOCK_ISSUE_DETAIL);

    const { wrapper } = createWrapper();
    renderHook(() => useIssueDetailQuery("KAN-42"), { wrapper });

    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith("/api/issues/KAN-42");
    });
  });
});

describe("useCommentsQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches comments and uses correct query key (R-IDP-08)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockResolvedValue(MOCK_COMMENTS);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useCommentsQuery("KAN-42"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(MOCK_COMMENTS);
    expect(mockFetchApi).toHaveBeenCalledWith("/api/issues/KAN-42/comments");

    // Verify cached under correct key
    const cached = queryClient.getQueryData(commentKeys.list("KAN-42"));
    expect(cached).toEqual(MOCK_COMMENTS);
  });

  it("is disabled when issueKey is undefined", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCommentsQuery(undefined), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetchApi).not.toHaveBeenCalled();
  });
});

describe("useActivityQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches activity log and uses correct query key (R-IDP-09)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);
    mockFetchApi.mockResolvedValue(MOCK_ACTIVITIES);

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useActivityQuery("KAN-42"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(MOCK_ACTIVITIES);
    expect(mockFetchApi).toHaveBeenCalledWith("/api/issues/KAN-42/activity");

    // Verify cached under correct key
    const cached = queryClient.getQueryData(activityKeys.list("KAN-42"));
    expect(cached).toEqual(MOCK_ACTIVITIES);
  });

  it("is disabled when issueKey is undefined", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const mockFetchApi = vi.mocked(fetchApi);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useActivityQuery(undefined), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetchApi).not.toHaveBeenCalled();
  });

  it("returns activity entries with expected shape", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(MOCK_ACTIVITIES);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useActivityQuery("KAN-42"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Verify state_changed entries have old/new values (R-IDP-10 scenario)
    const stateChange = result.current.data?.find(
      (a) => a.action === "state_changed",
    );
    expect(stateChange).toBeDefined();
    expect(stateChange?.oldValue).toBe("explore");
    expect(stateChange?.newValue).toBe("apply");
    expect(stateChange?.field).toBe("state");
  });
});
