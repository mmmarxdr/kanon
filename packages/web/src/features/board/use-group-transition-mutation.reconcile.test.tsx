/**
 * Tests for the per-issue reconcile intercept in useGroupTransitionMutation — KAN-188 PR3.
 *
 * The group 409 payload shape is `blockedIssues: [{ key, totalHours }, ...]`
 * (distinct from the single-issue flat `totalHours`). Each blocked issue must
 * surface its own confirm step with its own hours; a group transition that
 * hits no reconciliation gate must NOT show any modal.
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
const GROUP_KEY = "todo";

describe("useGroupTransitionMutation — reconcile intercept", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    addToastMock.mockClear();
  });

  it("surfaces blockedIssues (each with its own hours) when the group 409s with RECONCILIATION_REQUIRED", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValueOnce(
      new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
        blockedIssues: [
          { key: "TEST-1", totalHours: "5.00" },
          { key: "TEST-2", totalHours: "2.50" },
        ],
      }),
    );

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), []);

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.blockedIssues).not.toBeNull();
    });

    expect(result.current.blockedIssues).toEqual([
      { key: "TEST-1", totalHours: 5 },
      { key: "TEST-2", totalHours: 2.5 },
    ]);
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it("does not show any reconcile state for non-reconcile errors", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValueOnce(new Error("Network error"));

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), []);

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "in_progress" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.blockedIssues).toBeNull();
    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining("reverted"),
      "error",
    );
  });

  it("confirming an individual blocked issue calls reconcile-time for that issue then re-transitions it, removing it from blockedIssues", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    const calls: { path: string; method?: string }[] = [];

    vi.mocked(fetchApi).mockImplementation((path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method });
      if (path.includes("/groups/") && path.includes("/transition") && calls.length === 1) {
        return Promise.reject(
          new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
            blockedIssues: [{ key: "TEST-1", totalHours: "5.00" }],
          }),
        );
      }
      return Promise.resolve(undefined);
    });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), []);

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.blockedIssues).not.toBeNull();
    });

    await act(async () => {
      await result.current.confirmReconcile("TEST-1", 4.5);
    });

    await waitFor(() => {
      expect(result.current.blockedIssues).toEqual([]);
    });

    const reconcileCall = calls.find(
      (c) => c.path.includes("TEST-1/reconcile-time"),
    );
    expect(reconcileCall).toBeDefined();
    expect(reconcileCall?.method).toBe("POST");

    const perIssueTransitionCall = calls.find(
      (c) => c.path.includes("/issues/TEST-1/transition"),
    );
    expect(perIssueTransitionCall).toBeDefined();
  });

  it("surfaces an error toast and keeps the issue in blockedIssues when reconcileTime itself rejects (e.g. 409 RECONCILE_NO_ANCHOR)", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockImplementation((path: string) => {
      if (path.includes("/groups/") && path.includes("/transition")) {
        return Promise.reject(
          new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
            blockedIssues: [{ key: "TEST-1", totalHours: "5.00" }],
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
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), []);

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.blockedIssues).not.toBeNull();
    });

    await act(async () => {
      await result.current.confirmReconcile("TEST-1", 5);
    });

    // Error surfaced via the existing toast mechanism.
    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining("TEST-1"),
      "error",
    );
    // The issue must NOT be silently dropped or half-transitioned — it stays
    // in blockedIssues so it can be retried.
    expect(result.current.blockedIssues).toEqual([
      { key: "TEST-1", totalHours: 5 },
    ]);
  });

  it("surfaces an error toast and keeps the issue in blockedIssues when the retried per-issue transition rejects", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockImplementation((path: string) => {
      if (path.includes("/groups/") && path.includes("/transition")) {
        return Promise.reject(
          new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
            blockedIssues: [{ key: "TEST-1", totalHours: "5.00" }],
          }),
        );
      }
      if (path.includes("/reconcile-time")) {
        return Promise.resolve(undefined);
      }
      // The raw per-issue retry (transitionIssue) rejects — this is OUTSIDE
      // useMutation today and must still be caught.
      return Promise.reject(new Error("Server error"));
    });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), []);

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.blockedIssues).not.toBeNull();
    });

    await act(async () => {
      await result.current.confirmReconcile("TEST-1", 5);
    });

    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining("TEST-1"),
      "error",
    );
    expect(result.current.blockedIssues).toEqual([
      { key: "TEST-1", totalHours: 5 },
    ]);
  });

  it("exposes isSubmitting=true while a per-issue reconcile+retry is in flight, then false again", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    let resolveReconcile!: () => void;

    vi.mocked(fetchApi).mockImplementation((path: string) => {
      if (path.includes("/groups/") && path.includes("/transition")) {
        return Promise.reject(
          new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
            blockedIssues: [{ key: "TEST-1", totalHours: "5.00" }],
          }),
        );
      }
      if (path.includes("/reconcile-time")) {
        return new Promise((resolve) => {
          resolveReconcile = () => resolve(undefined);
        });
      }
      return Promise.resolve(undefined);
    });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), []);

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.blockedIssues).not.toBeNull();
    });

    expect(result.current.isSubmitting).toBe(false);

    let confirmPromise!: Promise<void>;
    act(() => {
      confirmPromise = result.current.confirmReconcile("TEST-1", 5);
    });

    await waitFor(() => {
      expect(result.current.isSubmitting).toBe(true);
    });

    await act(async () => {
      resolveReconcile();
      await confirmPromise;
    });

    expect(result.current.isSubmitting).toBe(false);
  });

  it("cancelReconcile(key) removes only that issue from blockedIssues", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValueOnce(
      new ApiError(409, "RECONCILIATION_REQUIRED", "Reconcile required", {
        blockedIssues: [
          { key: "TEST-1", totalHours: "5.00" },
          { key: "TEST-2", totalHours: "2.50" },
        ],
      }),
    );

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.groups(PROJECT_KEY), []);

    const { useGroupTransitionMutation } = await import(
      "./use-group-transition-mutation"
    );
    const { result } = renderHook(
      () => useGroupTransitionMutation(PROJECT_KEY),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ groupKey: GROUP_KEY, toState: "done" });
    });

    await waitFor(() => {
      expect(result.current.blockedIssues).not.toBeNull();
    });

    act(() => {
      result.current.cancelReconcile("TEST-1");
    });

    expect(result.current.blockedIssues).toEqual([
      { key: "TEST-2", totalHours: 2.5 },
    ]);
  });
});
