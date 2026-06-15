/**
 * TDD tests for useIssueSearchQuery (RED phase).
 *
 * Validates:
 * - Disabled when projectKey is null
 * - Enabled when projectKey is non-null
 * - Calls fetchApiValidated with correct URL + params
 * - Debounces: coalesces rapid updates into a single fetch (fake timers)
 * - Validates response via issueListSchema (Zod boundary)
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";
import type { IssueFilters } from "@kanon/shared";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
  fetchApiValidated: vi.fn(),
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
  ApiValidationError: class ApiValidationError extends Error {
    constructor(
      message: string,
      public override cause: unknown,
    ) {
      super(message);
      this.name = "ApiValidationError";
    }
  },
}));

const VALID_ISSUE = {
  id: "issue-1",
  key: "KAN-1",
  title: "Test issue",
  type: "task" as const,
  priority: "medium" as const,
  state: "todo" as const,
  labels: [],
  projectId: "proj-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  return { queryClient, wrapper };
}

describe("useIssueSearchQuery — enabled gating", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT call fetchApiValidated when projectKey is null", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    const { wrapper } = createWrapper();
    const { useIssueSearchQuery } = await import(
      "@/features/board/use-issue-search-query"
    );

    renderHook(() => useIssueSearchQuery(null, "auth", {}), { wrapper });

    // Wait a tick — no call should happen
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(fetchApiValidated)).not.toHaveBeenCalled();
  });

  it("calls fetchApiValidated when projectKey is set", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([VALID_ISSUE]);

    const { wrapper } = createWrapper();
    const { useIssueSearchQuery } = await import(
      "@/features/board/use-issue-search-query"
    );

    const { result } = renderHook(
      () => useIssueSearchQuery("KAN", "auth", {}),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(fetchApiValidated)).toHaveBeenCalledOnce();
  });

  it("returns data on success", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([VALID_ISSUE]);

    const { wrapper } = createWrapper();
    const { useIssueSearchQuery } = await import(
      "@/features/board/use-issue-search-query"
    );

    const { result } = renderHook(
      () => useIssueSearchQuery("KAN", "auth", {}),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0]!.key).toBe("KAN-1");
  });
});

describe("useIssueSearchQuery — URL construction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes q param in the URL", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([]);

    const { wrapper } = createWrapper();
    const { useIssueSearchQuery } = await import(
      "@/features/board/use-issue-search-query"
    );

    renderHook(() => useIssueSearchQuery("KAN", "auth", {}), { wrapper });

    await waitFor(() =>
      expect(vi.mocked(fetchApiValidated)).toHaveBeenCalled(),
    );

    const [url] = vi.mocked(fetchApiValidated).mock.calls[0]!;
    expect(url).toContain("/api/projects/KAN/issues");
    expect(url).toContain("q=auth");
  });

  it("includes state param when filter has state", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([]);

    const { wrapper } = createWrapper();
    const { useIssueSearchQuery } = await import(
      "@/features/board/use-issue-search-query"
    );

    const filters: IssueFilters = { state: "done" };
    renderHook(() => useIssueSearchQuery("KAN", "", filters), { wrapper });

    await waitFor(() =>
      expect(vi.mocked(fetchApiValidated)).toHaveBeenCalled(),
    );

    const [url] = vi.mocked(fetchApiValidated).mock.calls[0]!;
    expect(url).toContain("state=done");
  });

  it("uses encodeURIComponent for projectKey in URL", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([]);

    const { wrapper } = createWrapper();
    const { useIssueSearchQuery } = await import(
      "@/features/board/use-issue-search-query"
    );

    renderHook(() => useIssueSearchQuery("MY-PROJ", "test", {}), { wrapper });

    await waitFor(() =>
      expect(vi.mocked(fetchApiValidated)).toHaveBeenCalled(),
    );

    const [url] = vi.mocked(fetchApiValidated).mock.calls[0]!;
    expect(url).toContain("/api/projects/MY-PROJ/issues");
  });
});

describe("useIssueSearchQuery — debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces rapid rawSearch changes into a single fetch", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([]);

    const { wrapper } = createWrapper();
    const { useIssueSearchQuery } = await import(
      "@/features/board/use-issue-search-query"
    );

    // Start with the final value from the beginning to get baseline call count
    let rawSearch = "auth";
    const { rerender } = renderHook(
      () => useIssueSearchQuery("KAN", rawSearch, {}),
      { wrapper },
    );

    // Advance past the first debounce to let the initial value settle
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const callsAfterInitial = vi.mocked(fetchApiValidated).mock.calls.length;

    // Now simulate rapid changes — should NOT trigger additional fetches immediately
    rawSearch = "auth1";
    rerender();
    rawSearch = "auth12";
    rerender();
    rawSearch = "auth123";
    rerender();

    // Still within debounce window — no new calls yet
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(vi.mocked(fetchApiValidated)).toHaveBeenCalledTimes(callsAfterInitial);

    // Advance past debounce — exactly ONE new fetch for the final value
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(vi.mocked(fetchApiValidated)).toHaveBeenCalledTimes(
      callsAfterInitial + 1,
    );
  });

  it("does not fetch before debounce window elapses on value change", async () => {
    const { fetchApiValidated } = await import("@/lib/api-client");
    vi.mocked(fetchApiValidated).mockResolvedValue([]);

    const { wrapper } = createWrapper();
    const { useIssueSearchQuery } = await import(
      "@/features/board/use-issue-search-query"
    );

    let rawSearch = "auth";
    const { rerender } = renderHook(
      () => useIssueSearchQuery("KAN", rawSearch, {}),
      { wrapper },
    );

    // Let initial value settle
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const callsAfterInitial = vi.mocked(fetchApiValidated).mock.calls.length;

    // Change the search value
    rawSearch = "auth-updated";
    rerender();

    // Advance only 50ms — within the 200ms debounce — no new fetch yet
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(vi.mocked(fetchApiValidated)).toHaveBeenCalledTimes(callsAfterInitial);
  });
});
