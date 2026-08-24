import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FocusTrap } from "focus-trap-react";
import { useBackdropClose } from "@/hooks/use-backdrop-close";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { classifyRedmineReconciliationFailure, createRedmineReconciliationFlowState, redmineReconciliationFlowReducer, type RedmineReconciliationFailure, type RedmineReconciliationPreviewMode, type RedmineReconciliationReviewItem } from "./redmine-reconciliation-flow";
import { useRedmineReconciliationActivationMutation, useRedmineReconciliationDecisionMutation, useRedmineReconciliationMaterializeMutation, useRedmineReconciliationPreviewMutation, useRedmineReconciliationReviewPageMutation, type RedmineReconciliationDecisionInput } from "./use-redmine-reconciliation";
import { RedmineReconciliationReviewCard } from "./redmine-reconciliation-review-card";
import { RedmineReconciliationManualLink, type ManualIssueSummary } from "./redmine-reconciliation-manual-link";

export interface RedmineReconciliationQueueItem { readonly bindingId: string; readonly projectId: string; readonly projectKey: string | null; readonly remoteProjectId: string; readonly projectName: string; readonly remoteProjectName: string; }
interface Props { workspaceId: string; connectionId: string; binding: RedmineReconciliationQueueItem; current: number; total: number; onBindingComplete: () => Promise<void>; onRestartSession: () => Promise<void>; onClose: () => void; }
type RefreshFailure = Pick<RedmineReconciliationFailure, "stage" | "code" | "message">;
type ManualCandidate = NonNullable<RedmineReconciliationReviewItem["manualCandidate"]>;
type ManualState = { remoteIssueId: string; excludedIssueIds: readonly string[]; selectedIssueId: string | null; candidate: ManualCandidate | null; failure: { message: string; retryable: boolean } | null };
type MaterializeTarget = { remoteIssueId: string; candidateIssueId?: string };
type MaterializePurpose = { kind: "suggested"; refreshFailure: RefreshFailure } | { kind: "manual-select" } | { kind: "manual-refresh"; refreshFailure: RefreshFailure; fallbackItem: RedmineReconciliationReviewItem };
type LastOperation = { kind: "preview"; mode: RedmineReconciliationPreviewMode } | { kind: "review"; cursor?: string } | { kind: "decision"; input: RedmineReconciliationDecisionInput } | { kind: "materialize"; target: MaterializeTarget; purpose: MaterializePurpose } | { kind: "activation" };
type Coordination = { kind: "handoff" | "restart"; pending: boolean; error: string | null };
const MANUAL_CANDIDATE_UNAVAILABLE = new Set(["REDMINE_RECONCILIATION_CANDIDATE_INVALID", "REDMINE_RECONCILIATION_CANDIDATE_LINKED", "REDMINE_RECONCILIATION_ALREADY_LINKED", "REDMINE_RECONCILIATION_LINK_CONFLICT"]);
const RESTART_SESSION_CODES = new Set(["INTEGRATION_BOOTSTRAP_REQUIRED", "INTEGRATION_BINDING_NOT_FOUND"]);

export function RedmineReconciliationModal({ workspaceId, connectionId, binding: first, current, total, onBindingComplete, onRestartSession, onClose }: Props) {
  const { t } = useTranslation("settings");
  const { t: common } = useTranslation("common");
  const [state, dispatch] = useReducer(redmineReconciliationFlowReducer, first.bindingId, createRedmineReconciliationFlowState);
  const [manual, setManual] = useState<ManualState | null>(null);
  const [coordination, setCoordination] = useState<Coordination | null>(null);
  const preview = useRedmineReconciliationPreviewMutation(workspaceId, connectionId, first.bindingId);
  const review = useRedmineReconciliationReviewPageMutation(workspaceId, connectionId, first.bindingId);
  const decision = useRedmineReconciliationDecisionMutation(workspaceId, connectionId, first.bindingId);
  const materialize = useRedmineReconciliationMaterializeMutation(workspaceId, connectionId, first.bindingId);
  const activation = useRedmineReconciliationActivationMutation(workspaceId, connectionId, first.bindingId);
  const busy = preview.isPending || review.isPending || decision.isPending || materialize.isPending || activation.isPending || coordination?.pending === true;
  const inFlight = useRef(false);
  const handoffStarted = useRef(false);
  const lastOperation = useRef<LastOperation | null>(null);
  const guardedClose = useCallback(() => { if (!busy && !inFlight.current) onClose(); }, [busy, onClose]);
  useEscapeKey(guardedClose);
  const backdropClose = useBackdropClose(guardedClose);
  const begin = () => { if (busy || inFlight.current) return false; inFlight.current = true; return true; };
  const finish = () => { inFlight.current = false; };
  const failureFrom = (stage: RefreshFailure["stage"], error: unknown): RefreshFailure => {
    const failure = error as Error & { code?: string };
    return { stage, code: failure.code ?? "UNKNOWN", message: failure.message };
  };
  const restartSession = async () => {
    if (!begin()) return;
    setCoordination({ kind: "restart", pending: true, error: null });
    try { await onRestartSession(); finish(); handoffStarted.current = false; lastOperation.current = null; setManual(null); dispatch({ type: "reset" }); setCoordination(null); }
    catch (error) { finish(); setCoordination({ kind: "restart", pending: false, error: failureFrom("activation", error).message }); }
  };
  const completeBinding = async (retry = false) => {
    if ((handoffStarted.current && !retry) || !begin()) return;
    handoffStarted.current = true; setCoordination({ kind: "handoff", pending: true, error: null });
    try { await onBindingComplete(); finish(); setCoordination(null); }
    catch (error) {
      finish(); const failure = failureFrom("activation", error);
      if (RESTART_SESSION_CODES.has(failure.code)) { handoffStarted.current = false; setCoordination(null); void restartSession(); }
      else setCoordination({ kind: "handoff", pending: false, error: failure.message });
    }
  };

  const runMaterialize = (target: MaterializeTarget, purpose: MaterializePurpose) => {
    if (!begin()) return;
    lastOperation.current = { kind: "materialize", target, purpose };
    materialize.mutate(target, {
      onSuccess: (item) => {
        finish();
        if (purpose.kind === "suggested") { dispatch({ type: "failed", ...purpose.refreshFailure }); dispatch({ type: "item-refreshed", item }); return; }
        const candidate = item.manualCandidate;
        setManual((current) => current?.remoteIssueId === target.remoteIssueId ? { ...current, selectedIssueId: candidate?.localIssue.id ?? null, candidate, failure: candidate ? null : { message: t("redmineReconciliation.candidateUnavailable"), retryable: false } } : current);
        if (purpose.kind === "manual-refresh") { dispatch({ type: "failed", ...purpose.refreshFailure }); dispatch({ type: "item-refreshed", item }); }
      },
      onError: (error) => {
        finish(); const failure = failureFrom("decision", error);
        if (purpose.kind !== "suggested" && MANUAL_CANDIDATE_UNAVAILABLE.has(failure.code)) {
          setManual((current) => current?.remoteIssueId === target.remoteIssueId ? { ...current, selectedIssueId: null, candidate: null, failure: { message: failure.message, retryable: false } } : current);
          if (purpose.kind === "manual-refresh") { dispatch({ type: "failed", ...purpose.refreshFailure }); dispatch({ type: "item-refreshed", item: purpose.fallbackItem }); }
        } else if (purpose.kind === "manual-select" && classifyRedmineReconciliationFailure(failure.code) === "retry") setManual((current) => current ? { ...current, failure: { message: failure.message, retryable: true } } : current);
        else dispatch({ type: "failed", ...failure });
      },
    });
  };
  const runDecision = (input: RedmineReconciliationDecisionInput) => {
    if (!begin()) return;
    lastOperation.current = { kind: "decision", input };
    decision.mutate(input, {
      onSuccess: () => { finish(); setManual((current) => current?.remoteIssueId === input.remoteIssueId ? null : current); dispatch({ type: "remote-resolved", remoteIssueId: input.remoteIssueId }); },
      onError: (error) => {
        finish(); const failure = failureFrom("decision", error); dispatch({ type: "failed", ...failure });
        if (classifyRedmineReconciliationFailure(failure.code) !== "refresh-item") return;
        const item = state.unresolvedItems.find((candidate) => candidate.remote.id === input.remoteIssueId);
        const candidateIssueId = input.decision.kind === "manual-link" ? input.decision.candidateIssueId : null;
        if (candidateIssueId && item) {
          setManual((current) => current ? { ...current, selectedIssueId: candidateIssueId, candidate: null, failure: null } : current);
          runMaterialize({ remoteIssueId: input.remoteIssueId, candidateIssueId }, { kind: "manual-refresh", refreshFailure: failure, fallbackItem: item });
        } else runMaterialize({ remoteIssueId: input.remoteIssueId }, { kind: "suggested", refreshFailure: failure });
      },
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
  const runActivation = () => {
    if (!begin()) return;
    lastOperation.current = { kind: "activation" }; dispatch({ type: "activation-started" });
    activation.mutate(undefined, {
      onSuccess: (next) => { finish(); dispatch({ type: "activation-succeeded", progress: next }); },
      onError: (error) => { finish(); const failure = failureFrom("activation", error); if (RESTART_SESSION_CODES.has(failure.code)) void restartSession(); else dispatch({ type: "failed", ...failure }); },
    });
  };
  const retryLast = () => {
    const operation = lastOperation.current;
    if (!operation) return;
    if (operation.kind === "preview") runPreview(operation.mode);
    else if (operation.kind === "review") runReview(operation.cursor);
    else if (operation.kind === "decision") runDecision(operation.input);
    else if (operation.kind === "materialize") runMaterialize(operation.target, operation.purpose);
    else runActivation();
  };
  const restartPreview = () => { const mode = state.selectedMode; if (!mode) return; lastOperation.current = null; inFlight.current = false; setManual(null); dispatch({ type: "mode-selected", mode }); runPreview(mode); };
  const selectManual = (issue: ManualIssueSummary) => { if (!manual) return; setManual({ ...manual, selectedIssueId: issue.id, candidate: null, failure: null }); runMaterialize({ remoteIssueId: manual.remoteIssueId, candidateIssueId: issue.id }, { kind: "manual-select" }); };
  const confirmManual = () => { if (!manual?.candidate) return; const candidate = manual.candidate; runDecision({ remoteIssueId: manual.remoteIssueId, decision: { kind: "manual-link", candidateIssueId: candidate.localIssue.id, localFingerprint: candidate.factorEvidence.localFingerprint, remoteFingerprint: candidate.factorEvidence.remoteFingerprint } }); };
  const clearManualSelection = () => setManual((current) => current ? { ...current, selectedIssueId: null, candidate: null, failure: null } : current);
  const choose = (mode: RedmineReconciliationPreviewMode) => dispatch({ type: "mode-selected", mode });
  const failure = state.failure;
  const progress = state.previewProgress;
  useEffect(() => { if (state.phase === "complete" && !busy && !coordination) void completeBinding(); }, [state.phase, busy, coordination]);

  return (
    <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true, clickOutsideDeactivates: false, initialFocus: false }}>
      <div data-testid="redmine-reconciliation-backdrop" onClick={backdropClose} className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-4 pt-[8vh] backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="redmine-reconciliation-title" aria-busy={busy} className="max-h-[84vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background shadow-xl">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div><h2 id="redmine-reconciliation-title" className="font-semibold">{t("redmineReconciliation.title")}</h2><p className="text-xs text-muted-foreground">{t("redmineReconciliation.projectProgress", { current, total })}</p></div>
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
                {state.unresolvedItems.map((item) => <RedmineReconciliationReviewCard key={item.remote.id} item={item} disabled={busy} manualAvailable={first.projectKey !== null} onManualLink={(remoteIssueId, excludedIssueIds) => setManual({ remoteIssueId, excludedIssueIds, selectedIssueId: null, candidate: null, failure: null })} onAccept={(remoteIssueId, recommendationId) => runDecision({ remoteIssueId, decision: { kind: "accept", recommendationId } })} onRejectAll={(remoteIssueId) => runDecision({ remoteIssueId, decision: { kind: "reject-all" } })} />)}
                {manual && state.unresolvedItems.some((item) => item.remote.id === manual.remoteIssueId) && <RedmineReconciliationManualLink key={manual.remoteIssueId} remoteIssueId={manual.remoteIssueId} projectKey={first.projectKey} excludedIssueIds={manual.excludedIssueIds} candidate={manual.candidate} disabled={busy} failure={manual.failure} onSelect={selectManual} onConfirm={confirmManual} onCancel={() => setManual(null)} onQueryChange={clearManualSelection} onRetry={retryLast} />}
                {state.expectedNextCursor !== null && <button type="button" disabled={busy || state.unresolvedItems.length > 0} onClick={() => runReview()}>{t(state.expectedNextCursor === undefined ? "redmineReconciliation.loadRecommendations" : "redmineReconciliation.loadNextRecommendations")}</button>}
              </>}
              {state.phase === "activation-ready" && !coordination && <><p className="text-sm text-success">{t("redmineReconciliation.ready")}</p><button type="button" disabled={busy} onClick={runActivation}>{t("redmineReconciliation.startActivation")}</button></>}
              {state.phase === "activation" && !coordination && <>{state.activationProgress && <p className="text-sm text-muted-foreground">{t("redmineReconciliation.activationCounts", { imported: state.activationProgress.importedCount, processed: state.activationProgress.processedCount, remaining: state.activationProgress.remainingCount })}</p>}<button type="button" disabled={busy} onClick={runActivation}>{t("redmineReconciliation.continueActivation")}</button></>}
              {failure && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{failure.message}</p>{failure.recovery === "blocked" && <p>{t("redmineReconciliation.blocked")}</p>}
                {failure.recovery === "retry" && <button type="button" disabled={busy} onClick={retryLast}>{common("actions.retry")}</button>}
                {failure.recovery === "restart-preview" && <button type="button" disabled={busy} onClick={restartPreview}>{t("redmineReconciliation.restart")}</button>}
                {failure.recovery === "fatal" && <button type="button" disabled={busy} onClick={guardedClose}>{common("actions.close")}</button>}
              </div>}
              {coordination?.error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{coordination.error}</p><button type="button" disabled={busy} onClick={() => coordination.kind === "handoff" ? void completeBinding(true) : void restartSession()}>{common("actions.retry")}</button></div>}
              {!failure && state.phase === "preview" && state.selectedMode && progress?.complete !== true && <button type="button" disabled={busy} onClick={() => runPreview()} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? common("actions.loading") : progress ? t("redmineReconciliation.continue") : t("redmineReconciliation.start")}</button>}
            </div>
          </div>
        </section>
      </div>
    </FocusTrap>
  );
}
