/**
 * Tests for the reconcile-on-409 intercept in useTransitionMutation — KAN-188 PR3.
 *
 * When a transition to "done" is blocked by 409 RECONCILIATION_REQUIRED, the
 * mutation must NOT show the generic revert toast. Instead it surfaces a
 * `reconcileState` the caller can use to render <ReconcileModal>. Confirming
 * calls POST /api/issues/:key/reconcile-time then retries the transition, and
 * the existing onSettled cache invalidation (issueKeys/cycleKeys) must still fire.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { issueKeys } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>(
    "@/lib/api-client",
  );
  return {
    ...actual,
    fetchApi: vi.fn(),
  };
});

const addToastMock = vi.fn();
vi.mock("@/stores/toast-store", () => ({
  useToastStore: {
    getState: () => ({
      addToast: addToastMock,
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

describe("useTransitionMutation — reconcile intercept", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    addToastMock.mockClear();
  });

  it("opens a reconcile state (not a toast) when transition to done hits 409 RECONCILIATION_REQUIRED", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValueOnce(
      new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
        totalHours: "5.00",
        issueKey: ISSUE_KEY,
      }),
    );

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const { useTransitionMutation } = await import("./use-transition-mutation");
    const { result } = renderHook(() => useTransitionMutation(PROJECT_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ issueKey: ISSUE_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.reconcileState).not.toBeNull();
    });

    expect(result.current.reconcileState).toMatchObject({
      issueKey: ISSUE_KEY,
      totalHours: 5,
    });
    // Must NOT show the generic revert toast for the reconcile-required case
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it("still shows the generic revert toast for non-reconcile errors", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValueOnce(new Error("Network error"));

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const { useTransitionMutation } = await import("./use-transition-mutation");
    const { result } = renderHook(() => useTransitionMutation(PROJECT_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ issueKey: ISSUE_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining("reverted"),
      "error",
    );
    expect(result.current.reconcileState).toBeNull();
  });

  it("confirming reconcile calls reconcile-time then retries the transition, and settles invalidation fires", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const calls: { path: string; method?: string; body?: string }[] = [];

    vi.mocked(fetchApi).mockImplementation((path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method, body: init?.body as string });
      if (path.endsWith("/transition") && calls.length === 1) {
        return Promise.reject(
          new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
            totalHours: "5.00",
            issueKey: ISSUE_KEY,
          }),
        );
      }
      return Promise.resolve(undefined);
    });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useTransitionMutation } = await import("./use-transition-mutation");
    const { result } = renderHook(() => useTransitionMutation(PROJECT_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ issueKey: ISSUE_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.reconcileState).not.toBeNull();
    });

    await act(async () => {
      await result.current.confirmReconcile(4.5);
    });

    await waitFor(() => {
      expect(result.current.reconcileState).toBeNull();
    });

    const reconcileCall = calls.find((c) => c.path.includes("reconcile-time"));
    expect(reconcileCall).toBeDefined();
    expect(reconcileCall?.method).toBe("POST");
    expect(JSON.parse(reconcileCall!.body!)).toMatchObject({
      confirmedTotalHours: "4.5",
    });

    // The transition must have been retried after reconcile succeeded
    const transitionCalls = calls.filter((c) => c.path.includes("/transition"));
    expect(transitionCalls.length).toBe(2);

    // onSettled cache invalidation still fires through the same query keys
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: issueKeys.list(PROJECT_KEY) }),
    );
  });

  it("surfaces an error toast and keeps the modal actionable when reconcileTime itself rejects (e.g. 409 RECONCILE_NO_ANCHOR)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockImplementation((path: string) => {
      if (path.endsWith("/transition")) {
        return Promise.reject(
          new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
            totalHours: "5.00",
            issueKey: ISSUE_KEY,
          }),
        );
      }
      if (path.includes("/reconcile-time")) {
        return Promise.reject(
          new ApiError(409, "RECONCILE_NO_ANCHOR", "No approved anchor found"),
        );
      }
      return Promise.resolve(undefined);
    });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const { useTransitionMutation } = await import("./use-transition-mutation");
    const { result } = renderHook(() => useTransitionMutation(PROJECT_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ issueKey: ISSUE_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.reconcileState).not.toBeNull();
    });

    await act(async () => {
      await result.current.confirmReconcile(5);
    });

    // Error must be surfaced via the same toast mechanism — no silent dead end.
    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining(ISSUE_KEY),
      "error",
    );
    // The modal must stay actionable (not silently stuck with zero feedback) —
    // reconcileState is kept so the user can retry or cancel from a known state.
    expect(result.current.reconcileState).not.toBeNull();
  });

  it("surfaces an error toast when reconcile succeeds but the retried transition rejects", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockImplementation((path: string) => {
      if (path.endsWith("/transition")) {
        return Promise.reject(
          new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
            totalHours: "5.00",
            issueKey: ISSUE_KEY,
          }),
        );
      }
      return Promise.resolve(undefined);
    });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const { useTransitionMutation } = await import("./use-transition-mutation");
    const { result } = renderHook(() => useTransitionMutation(PROJECT_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ issueKey: ISSUE_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.reconcileState).not.toBeNull();
    });

    // Second call: reconcile-time resolves, but retried transition rejects again
    // (simulate a subsequent, unrelated transition failure).
    vi.mocked(fetchApi).mockImplementation((path: string) => {
      if (path.includes("/reconcile-time")) {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error("Server error"));
    });

    await act(async () => {
      await result.current.confirmReconcile(5);
    });

    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining(ISSUE_KEY),
      "error",
    );
    expect(result.current.reconcileState).not.toBeNull();
  });

  it("cancelReconcile clears the reconcile state without transitioning", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValueOnce(
      new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
        totalHours: "2.00",
        issueKey: ISSUE_KEY,
      }),
    );

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.list(PROJECT_KEY), []);

    const { useTransitionMutation } = await import("./use-transition-mutation");
    const { result } = renderHook(() => useTransitionMutation(PROJECT_KEY), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ issueKey: ISSUE_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.reconcileState).not.toBeNull();
    });

    act(() => {
      result.current.cancelReconcile();
    });

    expect(result.current.reconcileState).toBeNull();
    expect(vi.mocked(fetchApi).mock.calls.length).toBe(1);
  });
});
