import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

const queryState = vi.hoisted(() => ({
  value: {
    data: undefined as { project: { key: string }; subscribed: boolean } | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/routes/_authenticated/issue", () => ({ issueRoute: { useSearch: () => ({ from: undefined }) } }));
vi.mock("@/features/issue-detail/use-issue-detail-queries", () => ({
  useIssueDetailQuery: () => queryState.value,
  useIssueDocuments: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/features/issue-detail/use-unified-timeline", () => ({ useUnifiedTimeline: () => ({ items: [], isLoading: false, isError: false }) }));
vi.mock("@/features/issue-detail/use-issue-mutations", () => ({ useUpdateIssueMutation: () => ({ mutate: vi.fn() }), useAddCommentMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }) }));
vi.mock("@/features/board/use-transition-mutation", () => ({ useTransitionMutation: () => ({ mutate: vi.fn() }) }));
vi.mock("@/features/cycles/use-cycle-mutations", () => ({ useAttachIssueMutation: () => ({ mutate: vi.fn() }), useDetachIssueMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }) }));
vi.mock("@/features/issue-detail/use-subscription-mutations", () => ({ useSubscribeMutation: () => ({ mutate: vi.fn(), isPending: false }), useUnsubscribeMutation: () => ({ mutate: vi.fn(), isPending: false }) }));

describe("useIssueDetail query state", () => {
  it("forwards query data, loading, error and the original error object", async () => {
    const issue = { project: { key: "KAN" }, subscribed: true };
    queryState.value = { data: issue, isLoading: true, isError: false, error: null, refetch: vi.fn() };
    const { useIssueDetail } = await import("../use-issue-detail");
    const { result, rerender } = renderHook(() => useIssueDetail("KAN-404"));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.issue).toBe(issue);
    expect(result.current.projectKey).toBe("KAN");
    expect(result.current.error).toBeNull();

    const error = new ApiError(500, "INTERNAL_ERROR", "Unable to load");
    queryState.value = { data: undefined, isLoading: false, isError: true, error, refetch: vi.fn() };
    rerender();
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(error);
  });

  it("keeps the retry callback void while starting the asynchronous refetch", async () => {
    const refetch = vi.fn().mockResolvedValue({ data: undefined });
    queryState.value = { data: undefined, isLoading: false, isError: false, error: null, refetch };
    const { useIssueDetail } = await import("../use-issue-detail");
    const { result } = renderHook(() => useIssueDetail("KAN-404"));

    expect(result.current.refetch()).toBeUndefined();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("classifies only typed ApiError 404 as not-found", async () => {
    const { getIssueWorkspaceState, useIssueDetail } = await import("../use-issue-detail");
    const missing = new ApiError(404, "NOT_FOUND", "Issue not found");
    queryState.value = { data: undefined, isLoading: false, isError: true, error: missing, refetch: vi.fn() };
    const { result } = renderHook(() => useIssueDetail("KAN-404"));

    expect(result.current.error).toBe(missing);
    expect(getIssueWorkspaceState(result.current)).toEqual({ kind: "not-found" });
    expect(getIssueWorkspaceState({ ...result.current, error: new ApiError(500, "INTERNAL_ERROR", "No"), isError: true })).toEqual({ kind: "error" });
  });

  it("keeps retained issue data ready when a background refetch fails", async () => {
    const issue = { project: { key: "KAN" }, subscribed: true };
    const error = new ApiError(500, "INTERNAL_ERROR", "Background refetch failed");
    queryState.value = { data: issue, isLoading: false, isError: true, error, refetch: vi.fn() };
    const { getIssueWorkspaceState, useIssueDetail } = await import("../use-issue-detail");
    const { result } = renderHook(() => useIssueDetail("KAN-1"));

    expect(result.current.issue).toBe(issue);
    expect(getIssueWorkspaceState(result.current)).toEqual({ kind: "ready" });
  });
});
