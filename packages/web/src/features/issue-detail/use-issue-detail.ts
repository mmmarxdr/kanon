import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getIssueDeletedDestination } from "./issue-route-lifecycle";
import { issueRoute } from "@/routes/_authenticated/issue";
import {
  useIssueDetailQuery,
  useIssueDocuments,
} from "@/features/issue-detail/use-issue-detail-queries";
import {
  useUpdateIssueMutation,
  useAddCommentMutation,
} from "@/features/issue-detail/use-issue-mutations";
import { useTransitionMutation } from "@/features/board/use-transition-mutation";
import {
  useAttachIssueMutation,
  useDetachIssueMutation,
} from "@/features/cycles/use-cycle-mutations";
import {
  useSubscribeMutation,
  useUnsubscribeMutation,
} from "@/features/issue-detail/use-subscription-mutations";
import { useUnifiedTimeline } from "@/features/issue-detail/use-unified-timeline";
import type { IssueState } from "@/stores/board-store";
import type { IssueDocument } from "@/types/issue";
import type { UnifiedTimelineResult } from "@/features/issue-detail/use-unified-timeline";
import { ApiError } from "@/lib/api-client";

export interface UseIssueDetailResult {
  issue: NonNullable<ReturnType<typeof useIssueDetailQuery>["data"]> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  documents: IssueDocument[] | undefined;
  documentsLoading: boolean;
  documentsError: Error | null;
  timeline: UnifiedTimelineResult;
  projectKey: string;
  // subscription
  isSubscribed: boolean;
  isSubscriptionPending: boolean;
  onSubscribeToggle: () => void;
  // handlers (stable callbacks)
  onBack: () => void;
  onDeleted: () => void;
  onTitleChange: (t: string) => void;
  onFieldChange: (p: Record<string, unknown>) => void;
  onTransition: (s: IssueState) => void;
  onAddComment: (body: string) => Promise<unknown>;
  onSelectChild: (key: string) => void;
  onDescriptionSave: (next: string) => void;
  onCycleChange: (nextId: string | null, curId: string | null) => void;
  addCommentPending: boolean;
  addCommentError: Error | null;
}

export type IssueWorkspaceState = {
  kind: "loading" | "error" | "not-found" | "ready";
};

/**
 * Keeps the page's empty-state decision aligned with the API client's typed
 * error semantics. fetchApi rejects 404 responses, so an absent query value
 * alone is not enough to make a real missing issue reachable.
 */
export function getIssueWorkspaceState(
  result: Pick<UseIssueDetailResult, "issue" | "isLoading" | "isError" | "error">,
): IssueWorkspaceState {
  if (result.isLoading) return { kind: "loading" };
  if (result.issue) return { kind: "ready" };
  if (result.isError) {
    return result.error instanceof ApiError && result.error.status === 404
      ? { kind: "not-found" }
      : { kind: "error" };
  }
  return { kind: "not-found" };
}

/**
 * Orchestration hook for the issue detail page.
 * Absorbs ALL query/mutation wiring and cross-cutting handlers.
 *
 * Description-edit state (isEditing, descriptionDraft, textareaRef, effects)
 * lives in IssueDescription — not here.
 * Composer draft state lives in IssueComposer — not here.
 */
export function useIssueDetail(issueKey: string): UseIssueDetailResult {
  const { from } = issueRoute.useSearch();
  const navigate = useNavigate();

  const { data: issue, isLoading, isError, error, refetch } = useIssueDetailQuery(issueKey);
  const { data: documents, isLoading: documentsLoading, isError: documentsIsError, error: documentsQueryError } =
    useIssueDocuments(issueKey);
  const timeline = useUnifiedTimeline(issueKey);

  const projectKey = issue?.project.key ?? issueKey.split("-")[0] ?? "";
  const updateMutation = useUpdateIssueMutation(issueKey, projectKey);
  const addCommentMutation = useAddCommentMutation(issueKey);
  const transitionMutation = useTransitionMutation(projectKey);
  // Cycle attach/detach mutations — constructed at top level because React
  // forbids conditional hook calls. cycleId is passed at mutate()-call time.
  const attachIssueMutation = useAttachIssueMutation(projectKey);
  const detachIssueMutation = useDetachIssueMutation(projectKey);

  // Subscription mutations
  const subscribeMutation = useSubscribeMutation(issueKey);
  const unsubscribeMutation = useUnsubscribeMutation(issueKey);
  const isSubscribed = issue?.subscribed ?? false;
  const isSubscriptionPending =
    subscribeMutation.isPending || unsubscribeMutation.isPending;

  const onSubscribeToggle = useCallback(() => {
    if (isSubscriptionPending) return;
    if (isSubscribed) {
      unsubscribeMutation.mutate();
    } else {
      subscribeMutation.mutate();
    }
  }, [isSubscribed, isSubscriptionPending, subscribeMutation, unsubscribeMutation]);

  const onBack = useCallback(() => {
    if (from === "board" && projectKey) {
      void navigate({ to: "/board/$projectKey", params: { projectKey } });
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
    } else {
      void navigate({ to: "/inbox" });
    }
  }, [navigate, from, projectKey]);

  const onDeleted = useCallback(() => {
    void navigate(getIssueDeletedDestination({ from, projectKey }));
  }, [navigate, from, projectKey]);

  const onTitleChange = useCallback(
    (newTitle: string) => updateMutation.mutate({ title: newTitle }),
    [updateMutation],
  );

  const onFieldChange = useCallback(
    (payload: Record<string, unknown>) =>
      updateMutation.mutate(
        payload as Parameters<typeof updateMutation.mutate>[0],
      ),
    [updateMutation],
  );

  const onTransition = useCallback(
    (toState: IssueState) =>
      transitionMutation.mutate({ issueKey, toState }),
    [transitionMutation, issueKey],
  );

  const onAddComment = useCallback(
    (body: string) => addCommentMutation.mutateAsync(body),
    [addCommentMutation],
  );

  const onSelectChild = useCallback(
    (childKey: string) => {
      void navigate({
        to: "/issue/$key",
        params: { key: childKey },
        search: from ? { from } : {},
      });
    },
    [navigate, from],
  );

  const onDescriptionSave = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      const original = (issue?.description ?? "").trim();
      if (trimmed !== original) {
        updateMutation.mutate({ description: trimmed });
      }
    },
    [issue?.description, updateMutation],
  );

  /**
   * Handles cycle assignment changes from MetadataSection.
   *
   * Sequencing:
   * - If currentCycleId is set, detach first (await).
   * - Only after detach resolves (or if no detach needed), attach to nextCycleId.
   * This ensures CycleScopeEvent history is preserved correctly.
   */
  const onCycleChange = useCallback(
    (nextCycleId: string | null, currentCycleId: string | null) => {
      void (async () => {
        if (!nextCycleId && !currentCycleId) return;

        if (currentCycleId) {
          await detachIssueMutation.mutateAsync({
            cycleId: currentCycleId,
            issueKey,
            context: "issue-detail",
          });
        }
        if (nextCycleId) {
          attachIssueMutation.mutate({
            cycleId: nextCycleId,
            issueKey,
            context: "issue-detail",
          });
        }
      })();
    },
    [issueKey, attachIssueMutation, detachIssueMutation],
  );

  return {
    issue,
    isLoading,
    isError,
    error,
    refetch: () => { void refetch(); },
    documents,
    documentsLoading,
    documentsError: documentsIsError ? documentsQueryError : null,
    timeline,
    projectKey,
    isSubscribed,
    isSubscriptionPending,
    onSubscribeToggle,
    onBack,
    onDeleted,
    onTitleChange,
    onFieldChange,
    onTransition,
    onAddComment,
    onSelectChild,
    onDescriptionSave,
    onCycleChange,
    addCommentPending: addCommentMutation.isPending,
    addCommentError: addCommentMutation.isError ? addCommentMutation.error : null,
  };
}
