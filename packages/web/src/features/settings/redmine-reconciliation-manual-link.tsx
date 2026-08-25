import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useIssueSearchQuery } from "@/features/board/use-issue-search-query";
import type { RedmineReconciliationReviewItem } from "./redmine-reconciliation-flow";
import { RedmineReconciliationEvidence } from "./redmine-reconciliation-review-card";

export interface ManualIssueSummary { readonly id: string; readonly key: string; readonly title: string; }
type ManualCandidate = NonNullable<RedmineReconciliationReviewItem["manualCandidate"]>;
interface Props { remoteIssueId: string; projectKey: string | null; excludedIssueIds: readonly string[]; candidate: ManualCandidate | null; disabled: boolean; failure: { message: string; retryable: boolean } | null; onSelect: (issue: ManualIssueSummary) => void; onConfirm: () => void; onCancel: () => void; onQueryChange: () => void; onRetry: () => void; }

function SearchResults({ projectKey, rawQuery, excludedIssueIds, disabled, onSelect }: Pick<Props, "projectKey" | "excludedIssueIds" | "disabled" | "onSelect"> & { projectKey: string; rawQuery: string }) {
  const { t } = useTranslation("settings");
  const search = useIssueSearchQuery(projectKey, rawQuery, {});
  if (search.isFetching) return <p>{t("redmineReconciliation.searching")}</p>;
  const excluded = new Set(excludedIssueIds);
  const issues = (search.data ?? []).filter((issue) => !excluded.has(issue.id)).slice(0, 10);
  return <ul>{issues.map((issue) => <li key={issue.id}><button type="button" disabled={disabled} onClick={() => onSelect({ id: issue.id, key: issue.key, title: issue.title })}>{issue.key} — {issue.title}</button></li>)}</ul>;
}

export function RedmineReconciliationManualLink({ remoteIssueId, projectKey, excludedIssueIds, candidate, disabled, failure, onSelect, onConfirm, onCancel, onQueryChange, onRetry }: Props) {
  const { t } = useTranslation("settings");
  const [rawQuery, setRawQuery] = useState("");
  const searchable = projectKey !== null && rawQuery.trim().length >= 3;
  return <section className="space-y-3 rounded-md border border-border p-3" aria-label={t("redmineReconciliation.manualTitle", { id: remoteIssueId })}>
    {!projectKey ? <p>{t("redmineReconciliation.manualUnavailable")}</p> : <label>{t("redmineReconciliation.searchLabel")}<input aria-label={t("redmineReconciliation.searchLabel")} value={rawQuery} disabled={disabled} onChange={(event) => { setRawQuery(event.target.value); onQueryChange(); }} /></label>}
    {searchable && <SearchResults projectKey={projectKey} rawQuery={rawQuery} excludedIssueIds={excludedIssueIds} disabled={disabled} onSelect={onSelect} />}
    {failure && <div role="alert"><p>{failure.message}</p>{failure.retryable && <button type="button" disabled={disabled} onClick={onRetry}>{t("common:actions.retry")}</button>}</div>}
    {candidate && <div><p>{candidate.localIssue.key} — {candidate.localIssue.title}</p><RedmineReconciliationEvidence {...candidate} /><button type="button" disabled={disabled} onClick={onConfirm}>{t("redmineReconciliation.confirmManual", { key: candidate.localIssue.key })}</button></div>}
    <button type="button" disabled={disabled} onClick={onCancel}>{t("common:actions.cancel")}</button>
  </section>;
}
