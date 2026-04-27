/**
 * Tests for useTransitionMutation — belt-and-suspenders cycleKeys invalidation.
 *
 * Pattern: Option B real-harness (real QueryClient + vi.spyOn on invalidateQueries,
 * vi.mock on fetchApi). Mirrors use-group-transition-mutation.test.tsx structure.
 *
 * F2 requirement: onSettled MUST invalidate cycleKeys.all regardless of
 * success or error, as a defensive duplicate of the SSE path (F1).
 */

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
const ISSUE_KEY = "TEST-1";

describe("useTransitionMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("success path: invalidates issueKeys.list(projectKey) AND cycleKeys.all on settled", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(undefined);

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useTransitionMutation } = await import("./use-transition-mutation");
    const { result } = renderHook(
      () => useTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ issueKey: ISSUE_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  it("error path: cycleKeys.all is still invalidated in onSettled even when mutation fails", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(new Error("Transition failed"));

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useTransitionMutation } = await import("./use-transition-mutation");
    const { result } = renderHook(
      () => useTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ issueKey: ISSUE_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // onSettled fires on both success and error — cycleKeys.all must be invalidated
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });
});
