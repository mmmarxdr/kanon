/**
 * Tests for useTransitionMutation — KAN-88 Slice 1.
 *
 * Pattern: Option B real-harness (real QueryClient + vi.spyOn on invalidateQueries,
 * vi.mock on fetchApi). Mirrors use-group-transition-mutation.test.tsx structure.
 *
 * KAN-88-S1-C requirement: onSettled MUST NOT unconditionally invalidate cycleKeys.all.
 * It MUST use the active-observer gate:
 *   if (queryClient.getQueryCache().findAll({ queryKey: cycleKeys.all, type: 'active' }).length > 0)
 *     invalidate cycleKeys.all
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

  it("success path: invalidates issueKeys.list(projectKey) on settled", async () => {
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
  });

  // ── KAN-88-S1-C: active-observer gate for cycleKeys.all ──────────────────

  it("KAN-88-S1-C: onSettled does NOT invalidate cycleKeys.all when no active cycle observer exists", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(undefined);

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    // No active cycle queries — findAll returns []
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

    // Must NOT unconditionally invalidate cycles
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  it("KAN-88-S1-C: onSettled DOES invalidate cycleKeys.all when an active cycle observer exists", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(undefined);

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);
    // Pre-populate cycle cache so the mounted useQuery returns immediately
    queryClient.setQueryData(cycleKeys.all, []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useTransitionMutation } = await import("./use-transition-mutation");
    const { useQuery } = await import("@tanstack/react-query");

    // Render the mutation hook PLUS a useQuery for cycleKeys.all in the same
    // React tree so TanStack registers an active observer for the cycle key.
    const { result } = renderHook(
      () => {
        const mutation = useTransitionMutation(PROJECT_KEY);
        // staleTime=Infinity keeps the observer alive without triggering a fetch
        useQuery({ queryKey: cycleKeys.all, queryFn: () => Promise.resolve([]), staleTime: Infinity });
        return mutation;
      },
      { wrapper },
    );

    act(() => {
      result.current.mutate({ issueKey: ISSUE_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });

  it("error path: issueKeys.list(projectKey) is still invalidated in onSettled even when mutation fails", async () => {
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

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
  });

  it("error path: cycleKeys.all NOT invalidated when no active cycle observer, even on error", async () => {
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

    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: cycleKeys.all }),
    );
  });
});
