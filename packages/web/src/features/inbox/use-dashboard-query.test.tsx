/**
 * C2.1 — Proposal mutation context-scoped invalidation contract.
 *
 * Real QueryClient + real fetchApi mock (Option B pattern — no wholesale
 * module mock of the hooks themselves).
 *
 * Contract under test:
 *   useApplyProposalMutation / useDismissProposalMutation must gate
 *   dashboardKeys.detail invalidation on context === "inbox" | "all".
 *
 *   context: "inbox"   → invalidates dashboardKeys.detail + proposalKeys.list + proposalKeys.pending
 *   context: "roadmap" → invalidates ONLY proposalKeys.list + proposalKeys.pending
 *                        (dashboardKeys.detail is NOT touched)
 *   context: "all"     → invalidates all three keys
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { dashboardKeys, proposalKeys } from "@/lib/query-keys";

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

const WS_ID = "ws-abc";
const PROPOSAL_ID = "prop-1";

const FAKE_PROPOSAL = {
  id: PROPOSAL_ID,
  title: "Add auth module",
  status: "pending",
  kind: "create_issue",
};

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

// ─── useApplyProposalMutation ────────────────────────────────────────────────

describe("useApplyProposalMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('context "inbox": invalidates dashboardKeys.detail + proposalKeys.list + proposalKeys.pending', async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(FAKE_PROPOSAL);

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(dashboardKeys.detail(WS_ID), { counts: {} });
    queryClient.setQueryData(proposalKeys.list(WS_ID), []);
    queryClient.setQueryData(proposalKeys.pending(WS_ID), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useApplyProposalMutation } = await import("./use-dashboard-query");
    const { result } = renderHook(
      () => useApplyProposalMutation(WS_ID, "inbox"),
      { wrapper },
    );

    act(() => {
      result.current.mutate(PROPOSAL_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: dashboardKeys.detail(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.list(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.pending(WS_ID) }),
    );
  });

  it('context "roadmap": invalidates proposalKeys.list + proposalKeys.pending, NOT dashboardKeys.detail', async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(FAKE_PROPOSAL);

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(dashboardKeys.detail(WS_ID), { counts: {} });
    queryClient.setQueryData(proposalKeys.list(WS_ID), []);
    queryClient.setQueryData(proposalKeys.pending(WS_ID), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useApplyProposalMutation } = await import("./use-dashboard-query");
    const { result } = renderHook(
      () => useApplyProposalMutation(WS_ID, "roadmap"),
      { wrapper },
    );

    act(() => {
      result.current.mutate(PROPOSAL_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: dashboardKeys.detail(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.list(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.pending(WS_ID) }),
    );
  });

  it('context "all": invalidates dashboardKeys.detail + proposalKeys.list + proposalKeys.pending', async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue(FAKE_PROPOSAL);

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(dashboardKeys.detail(WS_ID), { counts: {} });
    queryClient.setQueryData(proposalKeys.list(WS_ID), []);
    queryClient.setQueryData(proposalKeys.pending(WS_ID), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useApplyProposalMutation } = await import("./use-dashboard-query");
    const { result } = renderHook(
      () => useApplyProposalMutation(WS_ID, "all"),
      { wrapper },
    );

    act(() => {
      result.current.mutate(PROPOSAL_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: dashboardKeys.detail(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.list(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.pending(WS_ID) }),
    );
  });
});

// ─── useDismissProposalMutation ──────────────────────────────────────────────

describe("useDismissProposalMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('context "inbox": invalidates dashboardKeys.detail + proposalKeys.list + proposalKeys.pending', async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ ...FAKE_PROPOSAL, status: "dismissed" });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(dashboardKeys.detail(WS_ID), { counts: {} });
    queryClient.setQueryData(proposalKeys.list(WS_ID), []);
    queryClient.setQueryData(proposalKeys.pending(WS_ID), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDismissProposalMutation } = await import("./use-dashboard-query");
    const { result } = renderHook(
      () => useDismissProposalMutation(WS_ID, "inbox"),
      { wrapper },
    );

    act(() => {
      result.current.mutate(PROPOSAL_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: dashboardKeys.detail(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.list(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.pending(WS_ID) }),
    );
  });

  it('context "roadmap": invalidates proposalKeys.list + proposalKeys.pending, NOT dashboardKeys.detail', async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ ...FAKE_PROPOSAL, status: "dismissed" });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(dashboardKeys.detail(WS_ID), { counts: {} });
    queryClient.setQueryData(proposalKeys.list(WS_ID), []);
    queryClient.setQueryData(proposalKeys.pending(WS_ID), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDismissProposalMutation } = await import("./use-dashboard-query");
    const { result } = renderHook(
      () => useDismissProposalMutation(WS_ID, "roadmap"),
      { wrapper },
    );

    act(() => {
      result.current.mutate(PROPOSAL_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: dashboardKeys.detail(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.list(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.pending(WS_ID) }),
    );
  });

  it('context "all": invalidates dashboardKeys.detail + proposalKeys.list + proposalKeys.pending', async () => {
    const { fetchApi } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockResolvedValue({ ...FAKE_PROPOSAL, status: "dismissed" });

    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(dashboardKeys.detail(WS_ID), { counts: {} });
    queryClient.setQueryData(proposalKeys.list(WS_ID), []);
    queryClient.setQueryData(proposalKeys.pending(WS_ID), []);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { useDismissProposalMutation } = await import("./use-dashboard-query");
    const { result } = renderHook(
      () => useDismissProposalMutation(WS_ID, "all"),
      { wrapper },
    );

    act(() => {
      result.current.mutate(PROPOSAL_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: dashboardKeys.detail(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.list(WS_ID) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: proposalKeys.pending(WS_ID) }),
    );
  });
});
