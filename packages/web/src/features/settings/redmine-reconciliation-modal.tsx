import { useCallback, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FocusTrap } from "focus-trap-react";
import { useBackdropClose } from "@/hooks/use-backdrop-close";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { classifyRedmineReconciliationFailure, createRedmineReconciliationFlowState, redmineReconciliationFlowReducer, type RedmineReconciliationFailure, type RedmineReconciliationPreviewMode } from "./redmine-reconciliation-flow";
import { useRedmineReconciliationDecisionMutation, useRedmineReconciliationMaterializeMutation, useRedmineReconciliationPreviewMutation, useRedmineReconciliationReviewPageMutation, type RedmineReconciliationDecisionInput } from "./use-redmine-reconciliation";
import { RedmineReconciliationReviewCard } from "./redmine-reconciliation-review-card";

export interface RedmineReconciliationQueueItem { readonly bindingId: string; readonly projectId: string; readonly remoteProjectId: string; readonly projectName: string; readonly remoteProjectName: string; }
interface Props { workspaceId: string; connectionId: string; queue: readonly RedmineReconciliationQueueItem[]; onClose: () => void; }
type RefreshFailure = Pick<RedmineReconciliationFailure, "stage" | "code" | "message">;
type LastOperation = { kind: "preview"; mode: RedmineReconciliationPreviewMode } | { kind: "review"; cursor?: string } | { kind: "decision"; input: RedmineReconciliationDecisionInput } | { kind: "materialize"; remoteIssueId: string; refreshFailure: RefreshFailure };

export function RedmineReconciliationModal({ workspaceId, connectionId, queue, onClose }: Props) {
  const first = queue[0]!;
  const { t } = useTranslation("settings");
  const { t: common } = useTranslation("common");
  const [state, dispatch] = useReducer(redmineReconciliationFlowReducer, first.bindingId, createRedmineReconciliationFlowState);
  const preview = useRedmineReconciliationPreviewMutation(workspaceId, connectionId, first.bindingId);
  const review = useRedmineReconciliationReviewPageMutation(workspaceId, connectionId, first.bindingId);
  const decision = useRedmineReconciliationDecisionMutation(workspaceId, connectionId, first.bindingId);
  const materialize = useRedmineReconciliationMaterializeMutation(workspaceId, connectionId, first.bindingId);
  const busy = preview.isPending || review.isPending || decision.isPending || materialize.isPending;
  const inFlight = useRef(false);
  const lastOperation = useRef<LastOperation | null>(null);
  const guardedClose = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useEscapeKey(guardedClose);
  const backdropClose = useBackdropClose(guardedClose);
  const begin = () => { if (busy || inFlight.current) return false; inFlight.current = true; return true; };
  const finish = () => { inFlight.current = false; };
  const failureFrom = (stage: RefreshFailure["stage"], error: unknown): RefreshFailure => {
    const failure = error as Error & { code?: string };
    return { stage, code: failure.code ?? "UNKNOWN", message: failure.message };
  };

  const runMaterialize = (remoteIssueId: string, refreshFailure: RefreshFailure) => {
    if (!begin()) return;
    lastOperation.current = { kind: "materialize", remoteIssueId, refreshFailure };
    materialize.mutate({ remoteIssueId }, {
      onSuccess: (item) => { finish(); dispatch({ type: "failed", ...refreshFailure }); dispatch({ type: "item-refreshed", item }); },
      onError: (error) => { finish(); dispatch({ type: "failed", ...failureFrom("decision", error) }); },
    });
  };
  const runDecision = (input: RedmineReconciliationDecisionInput) => {
    if (!begin()) return;
    lastOperation.current = { kind: "decision", input };
    decision.mutate(input, {
      onSuccess: () => { finish(); dispatch({ type: "remote-resolved", remoteIssueId: input.remoteIssueId }); },
      onError: (error) => { finish(); const failure = failureFrom("decision", error); dispatch({ type: "failed", ...failure }); if (classifyRedmineReconciliationFailure(failure.code) === "refresh-item") runMaterialize(input.remoteIssueId, failure); },
    });
  };
  const runReview = (cursor = state.expectedNextCursor) => {
    if (cursor === null || !begin()) return;
    lastOperation.current = { kind: "review", ...(cursor === undefined ? {} : { cursor }) };
    review.mutate({ limit: 5, ...(cursor === undefined ? {} : { cursor }) }, {
      onSuccess: (page) => { finish(); dispatch({ type: "review-succeeded", ...(cursor === undefined ? {} : { requestedCursor: cursor }), page }); },
      onError: (error) => { finish(); dispatch({ type: "failed", ...failureFrom("review", error) }); },
    });
  };
  const runPreview = (mode = state.selectedMode) => {
    if (!mode || !begin()) return;
    lastOperation.current = { kind: "preview", mode };
    preview.mutate({ mode }, {
      onSuccess: (progress) => { finish(); dispatch({ type: "preview-succeeded", progress }); },
      onError: (error) => { finish(); dispatch({ type: "failed", ...failureFrom("preview", error) }); },
    });
  };
  const retryLast = () => {
    const operation = lastOperation.current;
    if (!operation) return;
    if (operation.kind === "preview") runPreview(operation.mode);
    else if (operation.kind === "review") runReview(operation.cursor);
    else if (operation.kind === "decision") runDecision(operation.input);
    else runMaterialize(operation.remoteIssueId, operation.refreshFailure);
  };
  const restartPreview = () => { const mode = state.selectedMode; if (!mode) return; lastOperation.current = null; inFlight.current = false; dispatch({ type: "mode-selected", mode }); runPreview(mode); };
  const choose = (mode: RedmineReconciliationPreviewMode) => dispatch({ type: "mode-selected", mode });
  const failure = state.failure;
  const progress = state.previewProgress;

  return (
    <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true, clickOutsideDeactivates: false, initialFocus: false }}>
      <div data-testid="redmine-reconciliation-backdrop" onClick={backdropClose} className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-4 pt-[8vh] backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="redmine-reconciliation-title" aria-busy={busy} className="max-h-[84vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background shadow-xl">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div><h2 id="redmine-reconciliation-title" className="font-semibold">{t("redmineReconciliation.title")}</h2><p className="text-xs text-muted-foreground">{t("redmineReconciliation.projectProgress", { current: 1, total: queue.length })}</p></div>
            <button type="button" aria-label={common("actions.close")} disabled={busy} onClick={guardedClose} className="disabled:opacity-50">✕</button>
          </header>
          <div className="space-y-4 p-4">
            <p className="text-sm font-medium">{first.projectName} ↔ {first.remoteProjectName}</p>
            <fieldset disabled={busy} className="space-y-2"><legend className="text-sm">{t("redmineReconciliation.chooseMode")}</legend>
              <label className="flex gap-2 text-sm"><input type="radio" name="redmine-mode" checked={state.selectedMode === "full"} onChange={() => choose("full")} />{t("redmineReconciliation.full")}</label>
              <label className="flex gap-2 text-sm"><input type="radio" name="redmine-mode" checked={state.selectedMode === "future_only"} onChange={() => choose("future_only")} />{t("redmineReconciliation.futureOnly")}</label>
            </fieldset>
            <div aria-live="polite" className="space-y-3">
              {progress && <p className="text-sm text-muted-foreground">{t("redmineReconciliation.counts", { scanned: progress.scannedCount, remaining: progress.remainingCount, eligible: progress.eligibleUnlinkedCount, private: progress.excludedPrivateCount, linked: progress.linkedCount })}</p>}
              {state.phase === "mapping-blocked" && <p role="alert" className="text-sm text-amber-700">{t("redmineReconciliation.mappingBlocked")}</p>}
              {state.phase === "review" && <><p className="text-sm">{t("redmineReconciliation.reviewRequired", { count: state.remainingCandidateCount + state.unresolvedItems.length })}</p>
                {state.unresolvedItems.map((item) => <RedmineReconciliationReviewCard key={item.remote.id} item={item} disabled={busy} onAccept={(remoteIssueId, recommendationId) => runDecision({ remoteIssueId, decision: { kind: "accept", recommendationId } })} onRejectAll={(remoteIssueId) => runDecision({ remoteIssueId, decision: { kind: "reject-all" } })} />)}
                {state.expectedNextCursor !== null && <button type="button" disabled={busy || state.unresolvedItems.length > 0} onClick={() => runReview()}>{t(state.expectedNextCursor === undefined ? "redmineReconciliation.loadRecommendations" : "redmineReconciliation.loadNextRecommendations")}</button>}
              </>}
              {state.phase === "activation-ready" && <p className="text-sm text-success">{t("redmineReconciliation.ready")}</p>}
              {failure && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{failure.message}</p>{failure.recovery === "blocked" && <p>{t("redmineReconciliation.blocked")}</p>}
                {failure.recovery === "retry" && <button type="button" disabled={busy} onClick={retryLast}>{common("actions.retry")}</button>}
                {failure.recovery === "restart-preview" && <button type="button" disabled={busy} onClick={restartPreview}>{t("redmineReconciliation.restart")}</button>}
                {failure.recovery === "fatal" && <button type="button" disabled={busy} onClick={guardedClose}>{common("actions.close")}</button>}
              </div>}
              {!failure && state.phase === "preview" && state.selectedMode && progress?.complete !== true && <button type="button" disabled={busy} onClick={() => runPreview()} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? common("actions.loading") : progress ? t("redmineReconciliation.continue") : t("redmineReconciliation.start")}</button>}
            </div>
          </div>
        </section>
      </div>
    </FocusTrap>
  );
}
