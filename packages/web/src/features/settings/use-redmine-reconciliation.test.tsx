import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  redmineReconciliationActivationProgressSchema,
  redmineReconciliationDecisionResultSchema,
  redmineReconciliationMaterializeResultSchema,
  redmineReconciliationPreviewProgressSchema,
  redmineReconciliationReviewPageResultSchema,
} from "@kanon/shared";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchApiValidated } from "@/lib/api-client";
import { integrationKeys, issueKeys } from "@/lib/query-keys";
import {
  useRedmineReconciliationActivationMutation,
  useRedmineReconciliationDecisionMutation,
  useRedmineReconciliationMaterializeMutation,
  useRedmineReconciliationPreviewMutation,
  useRedmineReconciliationReviewPageMutation,
} from "./use-redmine-reconciliation";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  fetchApiValidated: vi.fn(),
}));

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const BINDING_ID = "99999999-9999-4999-8999-999999999999";
const CANDIDATE_ID = "33333333-3333-4333-8333-333333333333";
const RECOMMENDATION_ID = "44444444-4444-4444-8444-444444444444";
const REF_ID = "55555555-5555-4555-8555-555555555555";
const PREVIEW_ID = "66666666-6666-4666-8666-666666666666";
const LOCAL_HASH = `sha256:${"a".repeat(64)}`;
const REMOTE_HASH = `sha256:${"b".repeat(64)}`;
const CURSOR = "opaque_CURSOR-7";
const root = `/api/integrations/workspaces/${WORKSPACE_ID}/connections/${CONNECTION_ID}/bindings/${BINDING_ID}`;

const previewResult = {
  previewIdentity: PREVIEW_ID,
  mode: "full" as const,
  cutoff: "2026-08-24T10:00:00.000Z",
  checkpoint: null,
  complete: true,
  scannedCount: 3,
  remainingCount: 0,
  eligibleUnlinkedCount: 2,
  excludedPrivateCount: 1,
  linkedCount: 0,
  mappingGaps: { statusIds: [], priorityIds: [], assigneeRemoteUserIds: [] },
};
const reviewResult = {
  previewIdentity: PREVIEW_ID,
  processedCandidateCount: 0,
  remainingCandidateCount: 0,
  hiddenCount: 0,
  linkedCount: 0,
  items: [],
  nextCursor: null,
};
const materializeResult = {
  remote: { id: "7", title: "Remote issue", sourceVersion: REMOTE_HASH },
  recommendations: [],
  manualCandidate: null,
};
const decisionResult = {
  remoteIssueId: "7",
  candidateIssueId: CANDIDATE_ID,
  recommendationId: RECOMMENDATION_ID,
  refId: REF_ID,
  replayed: false,
};
const activationResult = {
  importedCount: 1,
  issueKeys: ["KAN-7"],
  replayed: true,
  complete: false,
  processedCount: 10,
  remainingCount: 3,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe("Redmine reconciliation command hooks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates preview and bounded review-page commands", async () => {
    vi.mocked(fetchApiValidated)
      .mockResolvedValueOnce(previewResult)
      .mockResolvedValueOnce(reviewResult);
    const { queryClient, wrapper } = createWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const preview = renderHook(
      () => useRedmineReconciliationPreviewMutation(WORKSPACE_ID, CONNECTION_ID, BINDING_ID),
      { wrapper },
    );
    const review = renderHook(
      () => useRedmineReconciliationReviewPageMutation(WORKSPACE_ID, CONNECTION_ID, BINDING_ID),
      { wrapper },
    );

    let previewData: unknown;
    let reviewData: unknown;
    await act(async () => {
      previewData = await preview.result.current.mutateAsync({ mode: "full" });
      reviewData = await review.result.current.mutateAsync({ cursor: CURSOR });
    });

    expect(previewData).toEqual(previewResult);
    expect(reviewData).toEqual(reviewResult);
    expect(fetchApiValidated).toHaveBeenNthCalledWith(
      1,
      `${root}/inbound/preview`,
      redmineReconciliationPreviewProgressSchema,
      { method: "POST", body: JSON.stringify({ mode: "full" }) },
    );
    expect(fetchApiValidated).toHaveBeenNthCalledWith(
      2,
      `${root}/reconciliation/review-page`,
      redmineReconciliationReviewPageResultSchema,
      { method: "POST", body: JSON.stringify({ cursor: CURSOR, limit: 5 }) },
    );
    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: integrationKeys.connection(WORKSPACE_ID) });

    await act(async () => {
      await expect(review.result.current.mutateAsync({ limit: 6 })).rejects.toMatchObject({
        name: "ZodError",
      });
    });
    expect(fetchApiValidated).toHaveBeenCalledTimes(2);
  });

  it("materializes optional candidates and preserves manual-link evidence", async () => {
    vi.mocked(fetchApiValidated)
      .mockResolvedValueOnce(materializeResult)
      .mockResolvedValueOnce(materializeResult)
      .mockResolvedValueOnce(decisionResult);
    const { queryClient, wrapper } = createWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const materialize = renderHook(
      () => useRedmineReconciliationMaterializeMutation(WORKSPACE_ID, CONNECTION_ID, BINDING_ID),
      { wrapper },
    );
    const decision = renderHook(
      () => useRedmineReconciliationDecisionMutation(WORKSPACE_ID, CONNECTION_ID, BINDING_ID),
      { wrapper },
    );

    await act(async () => {
      await expect(materialize.result.current.mutateAsync({ remoteIssueId: "7" })).resolves.toEqual(materializeResult);
      await expect(materialize.result.current.mutateAsync({ remoteIssueId: "7", candidateIssueId: CANDIDATE_ID })).resolves.toEqual(materializeResult);
    });
    expect(invalidate).not.toHaveBeenCalled();
    const manualLink = {
      kind: "manual-link" as const,
      candidateIssueId: CANDIDATE_ID,
      localFingerprint: LOCAL_HASH,
      remoteFingerprint: REMOTE_HASH,
    };
    await act(async () => {
      await expect(decision.result.current.mutateAsync({ remoteIssueId: "7", decision: manualLink })).resolves.toEqual(decisionResult);
    });

    expect(fetchApiValidated).toHaveBeenNthCalledWith(1, `${root}/reconciliation/recommendations/materialize`, redmineReconciliationMaterializeResultSchema, { method: "POST", body: JSON.stringify({ remoteIssueId: "7" }) });
    expect(fetchApiValidated).toHaveBeenNthCalledWith(2, `${root}/reconciliation/recommendations/materialize`, redmineReconciliationMaterializeResultSchema, { method: "POST", body: JSON.stringify({ remoteIssueId: "7", candidateIssueId: CANDIDATE_ID }) });
    expect(fetchApiValidated).toHaveBeenNthCalledWith(3, `${root}/reconciliation/issues/7/decision`, redmineReconciliationDecisionResultSchema, { method: "POST", body: JSON.stringify(manualLink) });
    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: integrationKeys.connection(WORKSPACE_ID) });
  });

  it("awaits activation connection and issue invalidations", async () => {
    vi.mocked(fetchApiValidated).mockResolvedValueOnce(activationResult);
    const { queryClient, wrapper } = createWrapper();
    let release!: () => void;
    const invalidated = new Promise<void>((resolve) => (release = resolve));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(invalidated);
    const activation = renderHook(
      () => useRedmineReconciliationActivationMutation(WORKSPACE_ID, CONNECTION_ID, BINDING_ID),
      { wrapper },
    );
    let settled = false;
    let pending!: Promise<unknown>;
    act(() => {
      pending = activation.result.current.mutateAsync();
      void pending.then(() => (settled = true));
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    expect(activation.result.current.isPending).toBe(true);
    expect(invalidate.mock.calls).toEqual([
      [{ queryKey: integrationKeys.connection(WORKSPACE_ID) }],
      [{ queryKey: issueKeys.all }],
    ]);
    release();
    await act(async () => expect(pending).resolves.toEqual(activationResult));
    expect(fetchApiValidated).toHaveBeenCalledWith(
      `${root}/inbound/activate`,
      redmineReconciliationActivationProgressSchema,
      { method: "POST" },
    );
  });

  it("preserves ApiError failures without invalidating caches", async () => {
    const error = new ApiError(409, "REDMINE_RECONCILIATION_SCOPE_STALE", "Scope changed");
    vi.mocked(fetchApiValidated).mockRejectedValue(error);
    const { queryClient, wrapper } = createWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const preview = renderHook(
      () => useRedmineReconciliationPreviewMutation(WORKSPACE_ID, CONNECTION_ID, BINDING_ID),
      { wrapper },
    );
    const mutateAsync = preview.result.current.mutateAsync;
    preview.unmount();
    await expect(mutateAsync({ mode: "future_only" })).rejects.toBe(error);
    expect(queryClient.getMutationCache().getAll()[0]?.state.error).toBe(error);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
