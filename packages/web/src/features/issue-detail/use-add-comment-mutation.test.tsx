/**
 * REQ-CM-03 — Scenario 6: comment mutation dual-cache invalidation contract.
 *
 * useAddCommentMutation.onSuccess MUST invalidate BOTH:
 *   - commentKeys.list(issueKey)  — refreshes the comment list
 *   - activityKeys.list(issueKey) — adding a comment generates an activity entry
 *
 * Pattern: real QueryClient + vi.spyOn on invalidateQueries + vi.mock on fetchApi.
 * Mirrors use-transition-mutation.test.tsx structure.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { commentKeys, activityKeys } from "@/lib/query-keys";

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

const ISSUE_KEY = "TEST-1";

describe("useAddCommentMutation — dual-cache invalidation (REQ-CM-03 Scenario 6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("onSuccess invalidates commentKeys.list(issueKey) AND activityKeys.list(issueKey)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({
      id: "cmt-1",
      body: "hello",
      source: "human",
      via: null,
      createdAt: "2026-06-01T10:00:00Z",
      updatedAt: "2026-06-01T10:00:00Z",
      author: { id: "u-1", username: "alice" },
    });

    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useAddCommentMutation } = await import("./use-issue-mutations");
    const { result } = renderHook(() => useAddCommentMutation(ISSUE_KEY), { wrapper });

    act(() => {
      result.current.mutate("hello");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: commentKeys.list(ISSUE_KEY) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: activityKeys.list(ISSUE_KEY) }),
    );
    // Exactly these two invalidations — no more
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});
