import { useCallback, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { FocusTrap } from "focus-trap-react";
import { useBackdropClose } from "@/hooks/use-backdrop-close";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { createRedmineReconciliationFlowState, redmineReconciliationFlowReducer, type RedmineReconciliationPreviewMode } from "./redmine-reconciliation-flow";
import { useRedmineReconciliationPreviewMutation } from "./use-redmine-reconciliation";

export interface RedmineReconciliationQueueItem { readonly bindingId: string; readonly projectId: string; readonly remoteProjectId: string; readonly projectName: string; readonly remoteProjectName: string; }
interface Props { workspaceId: string; connectionId: string; queue: readonly RedmineReconciliationQueueItem[]; onClose: () => void; }

export function RedmineReconciliationModal({ workspaceId, connectionId, queue, onClose }: Props) {
  const first = queue[0]!;
  const { t } = useTranslation("settings");
  const { t: common } = useTranslation("common");
  const [state, dispatch] = useReducer(redmineReconciliationFlowReducer, first.bindingId, createRedmineReconciliationFlowState);
  const preview = useRedmineReconciliationPreviewMutation(workspaceId, connectionId, first.bindingId);
  const guardedClose = useCallback(() => { if (!preview.isPending) onClose(); }, [onClose, preview.isPending]);
  useEscapeKey(guardedClose);
  const backdropClose = useBackdropClose(guardedClose);

  const runPreview = (restart = false) => {
    const mode = state.selectedMode;
    if (!mode || preview.isPending) return;
    if (restart) dispatch({ type: "mode-selected", mode });
    preview.mutate({ mode }, {
      onSuccess: (progress) => dispatch({ type: "preview-succeeded", progress }),
      onError: (error) => { const failure = error as Error & { code?: string }; dispatch({ type: "failed", stage: "preview", code: failure.code ?? "UNKNOWN", message: failure.message }); },
    });
  };
  const choose = (mode: RedmineReconciliationPreviewMode) => dispatch({ type: "mode-selected", mode });
  const failure = state.failure;
  const progress = state.previewProgress;

  return (
    <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true, clickOutsideDeactivates: false, initialFocus: false }}>
      <div data-testid="redmine-reconciliation-backdrop" onClick={backdropClose} className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-4 pt-[8vh] backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="redmine-reconciliation-title" aria-busy={preview.isPending} className="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div><h2 id="redmine-reconciliation-title" className="font-semibold">{t("redmineReconciliation.title")}</h2><p className="text-xs text-muted-foreground">{t("redmineReconciliation.projectProgress", { current: 1, total: queue.length })}</p></div>
            <button type="button" aria-label={common("actions.close")} disabled={preview.isPending} onClick={guardedClose} className="disabled:opacity-50">✕</button>
          </header>
          <div className="space-y-4 p-4">
            <p className="text-sm font-medium">{first.projectName} ↔ {first.remoteProjectName}</p>
            <fieldset disabled={preview.isPending} className="space-y-2"><legend className="text-sm">{t("redmineReconciliation.chooseMode")}</legend>
              <label className="flex gap-2 text-sm"><input type="radio" name="redmine-mode" checked={state.selectedMode === "full"} onChange={() => choose("full")} />{t("redmineReconciliation.full")}</label>
              <label className="flex gap-2 text-sm"><input type="radio" name="redmine-mode" checked={state.selectedMode === "future_only"} onChange={() => choose("future_only")} />{t("redmineReconciliation.futureOnly")}</label>
            </fieldset>
            <div aria-live="polite" className="space-y-3">
              {progress && <p className="text-sm text-muted-foreground">{t("redmineReconciliation.counts", { scanned: progress.scannedCount, remaining: progress.remainingCount, eligible: progress.eligibleUnlinkedCount, private: progress.excludedPrivateCount, linked: progress.linkedCount })}</p>}
              {state.phase === "mapping-blocked" && <p role="alert" className="text-sm text-amber-700">{t("redmineReconciliation.mappingBlocked")}</p>}
              {state.phase === "review" && <p className="text-sm">{t("redmineReconciliation.reviewRequired", { count: progress?.eligibleUnlinkedCount ?? 0 })}</p>}
              {state.phase === "activation-ready" && <p className="text-sm text-success">{t("redmineReconciliation.ready")}</p>}
              {failure && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{failure.message}</p>{failure.recovery === "blocked" && <p>{t("redmineReconciliation.blocked")}</p>}
                {failure.recovery === "retry" && <button type="button" onClick={() => runPreview()}>{common("actions.retry")}</button>}
                {failure.recovery === "restart-preview" && <button type="button" onClick={() => runPreview(true)}>{t("redmineReconciliation.restart")}</button>}
                {failure.recovery === "fatal" && <button type="button" onClick={guardedClose}>{common("actions.close")}</button>}
              </div>}
              {!failure && state.phase === "preview" && state.selectedMode && progress?.complete !== true && <button type="button" disabled={preview.isPending} onClick={() => runPreview()} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{preview.isPending ? common("actions.loading") : progress ? t("redmineReconciliation.continue") : t("redmineReconciliation.start")}</button>}
            </div>
          </div>
        </section>
      </div>
    </FocusTrap>
  );
}
