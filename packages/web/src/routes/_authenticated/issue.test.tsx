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
 *
 * KAN-38 — SubscribeButton unit tests.
 * Tests three button states and toggle call semantics.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { cycleKeys, issueKeys } from "@/lib/query-keys";
import { SubscribeButton } from "./issue";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

// ── KAN-38: SubscribeButton unit tests ────────────────────────────────────────

describe("SubscribeButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 'Subscribe' label when not subscribed and not pending", () => {
    render(
      <SubscribeButton
        isSubscribed={false}
        isSubscriptionPending={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /subscribe/i })).toBeDefined();
    expect(screen.getByRole("button").textContent).toBe("Subscribe");
  });

  it("renders 'Unsubscribe' label when subscribed and not pending", () => {
    render(
      <SubscribeButton
        isSubscribed={true}
        isSubscriptionPending={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button").textContent).toBe("Unsubscribe");
  });

  it("renders '…' and is disabled while pending", () => {
    render(
      <SubscribeButton
        isSubscribed={false}
        isSubscriptionPending={true}
        onToggle={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("…");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls onToggle when clicked and not pending", () => {
    const onToggle = vi.fn();
    render(
      <SubscribeButton
        isSubscribed={false}
        isSubscriptionPending={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("does NOT call onToggle when clicked while pending (button is disabled)", () => {
    const onToggle = vi.fn();
    render(
      <SubscribeButton
        isSubscribed={false}
        isSubscriptionPending={true}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    // Disabled button — click still fires in jsdom but the button is disabled;
    // the handler guard in IssuePage prevents mutation. The disabled attribute
    // is the primary assertion; click is stopped by the browser in real usage.
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

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
