import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityKeys, commentKeys, issueKeys } from "@/lib/query-keys";
import { useDeleteIssueMutation } from "./use-delete-issue-mutation";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("useDeleteIssueMutation", () => {
  it("removes issue-scoped caches and invalidates project collections after success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ deletedIssueId: "i1", deletedIssueKey: "KAN-1", remoteDeleteQueued: false }), { status: 200, headers: { "content-type": "application/json" } })));
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(issueKeys.detail("KAN-1"), { id: "i1" });
    queryClient.setQueryData(issueKeys.documents("KAN-1"), []);
    queryClient.setQueryData(commentKeys.list("KAN-1"), []);
    queryClient.setQueryData(activityKeys.list("KAN-1"), []);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDeleteIssueMutation("KAN-1", "KAN"), { wrapper });

    await act(() => result.current.mutateAsync({}));

    expect(queryClient.getQueryData(issueKeys.detail("KAN-1"))).toBeUndefined();
    expect(queryClient.getQueryData(issueKeys.documents("KAN-1"))).toBeUndefined();
    expect(queryClient.getQueryData(commentKeys.list("KAN-1"))).toBeUndefined();
    expect(queryClient.getQueryData(activityKeys.list("KAN-1"))).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: issueKeys.list("KAN") }));
  });
});
