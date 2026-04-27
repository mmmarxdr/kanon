/**
 * B3.1 — handleCycleChange single-invalidation contract.
 *
 * IssuePage is router-integrated (uses issueRoute.useParams / useSearch /
 * useNavigate). Rather than spinning up the full TanStack Router, we test
 * handleCycleChange's invalidation contract through its underlying mutation
 * hooks — which is the ONLY place invalidations actually happen.
 *
 * Contract under test:
 *   When handleCycleChange(nextId, currentId) is called with both IDs set:
 *   - detachIssueMutation fires → onSettled calls invalidateAfterCycleMembership
 *     with context "issue-detail" → exactly 1 invalidateQueries call for issueKeys.detail
 *   - attachIssueMutation fires → same → 1 more call for issueKeys.detail
 *   Total: ≤ 2 calls, ALL scoped to issueKeys.detail, ZERO for cycleKeys.list or issueKeys.list
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { cycleKeys, issueKeys } from "@/lib/query-keys";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

const PROJECT_KEY = "TEST";
const ISSUE_KEY = "TEST-1";
const CURRENT_CYCLE_ID = "cycle-current";
const NEXT_CYCLE_ID = "cycle-next";

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

describe("handleCycleChange single-invalidation contract (issue-detail context)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switch A→B: spy called ≤ 2 times, both calls scoped to issueKeys.detail, zero with cycleKeys.list or issueKeys.list", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: "ok" });

    const { queryClient, wrapper } = createWrapper();

    // Pre-seed the issue detail cache (needed for optimistic update in onMutate)
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), {
      id: "issue-1",
      key: ISSUE_KEY,
      title: "Test",
      type: "task",
      priority: "medium",
      state: "todo",
      labels: [],
      projectId: "proj-1",
      project: { id: "proj-1", key: PROJECT_KEY, name: "Test" },
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
      cycle: { id: CURRENT_CYCLE_ID, name: "Sprint 1" },
    });

    // Also seed the next cycle detail so optimistic attach can read the name
    queryClient.setQueryData(cycleKeys.detail(NEXT_CYCLE_ID), {
      id: NEXT_CYCLE_ID,
      name: "Sprint 2",
      state: "upcoming",
      projectId: "proj-1",
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const {
      useAttachIssueMutation,
      useDetachIssueMutation,
    } = await import("@/features/cycles/use-cycle-mutations");

    const { result: detachResult } = renderHook(
      () => useDetachIssueMutation(PROJECT_KEY),
      { wrapper },
    );
    const { result: attachResult } = renderHook(
      () => useAttachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    // Simulate handleCycleChange(NEXT_CYCLE_ID, CURRENT_CYCLE_ID)
    await act(async () => {
      // Step 1: detach from current (awaited, as handleCycleChange does)
      await detachResult.current.mutateAsync({
        cycleId: CURRENT_CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });

      // Step 2: attach to next (fire-and-forget, as handleCycleChange does)
      attachResult.current.mutate({
        cycleId: NEXT_CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });
    });

    await waitFor(() => expect(attachResult.current.isSuccess).toBe(true));

    // Contract: ZERO invalidations for issue-detail context (optimistic
    // update via setIssueDetailCycle in onMutate covers everything).
    expect(invalidateSpy).toHaveBeenCalledTimes(0);
  });

  it("detach only (nextCycleId null): zero invalidations under issue-detail context", async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ id: "ok" });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(issueKeys.detail(ISSUE_KEY), {
      id: "issue-1",
      key: ISSUE_KEY,
      cycle: { id: CURRENT_CYCLE_ID, name: "Sprint 1" },
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDetachIssueMutation } = await import("@/features/cycles/use-cycle-mutations");
    const { result } = renderHook(
      () => useDetachIssueMutation(PROJECT_KEY),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        cycleId: CURRENT_CYCLE_ID,
        issueKey: ISSUE_KEY,
        context: "issue-detail",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(0);
  });
});
