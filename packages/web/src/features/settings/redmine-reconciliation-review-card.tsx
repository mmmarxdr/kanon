import { useTranslation } from "react-i18next";
import type { RedmineReconciliationReviewItem } from "./redmine-reconciliation-flow";

interface Props {
  item: RedmineReconciliationReviewItem;
  disabled: boolean;
  onAccept: (remoteIssueId: string, recommendationId: string) => void;
  onRejectAll: (remoteIssueId: string) => void;
}

export function RedmineReconciliationReviewCard({ item, disabled, onAccept, onRejectAll }: Props) {
  const { t } = useTranslation("settings");
  const compared = (comparable: boolean, contribution: number, maximum: number) => comparable ? `${contribution}/${maximum}` : t("redmineReconciliation.notCompared");
  return (
    <article className="space-y-3 rounded-md border border-border p-3">
      <header><h3 className="font-medium">{t("redmineReconciliation.remoteIssue", { id: item.remote.id })}</h3>{item.remote.title && <p className="text-sm text-muted-foreground">{item.remote.title}</p>}</header>
      {item.recommendations.map((recommendation) => {
        const factors = recommendation.factorEvidence;
        return <section key={recommendation.id} className="space-y-2 rounded border border-border p-3">
          <p className="text-sm font-medium">{recommendation.localIssue.key} — {recommendation.localIssue.title}</p>
          <p className="text-sm">{t("redmineReconciliation.heuristicScore", { score: recommendation.score })}</p>
          <ul className="text-xs text-muted-foreground">
            <li>{t("redmineReconciliation.factorTitle", { value: `${factors.titleContribution}/50` })}</li>
            <li>{t("redmineReconciliation.factorDescription", { value: `${factors.descriptionContribution}/25` })}</li>
            <li>{t("redmineReconciliation.factorDate", { value: compared(factors.dateComparable, factors.dateContribution, 10) })}</li>
            <li>{t("redmineReconciliation.factorAssignee", { value: compared(factors.assigneeComparable, factors.assigneeContribution, 10) })}</li>
            <li>{t("redmineReconciliation.factorState", { value: compared(factors.stateComparable, factors.stateContribution, 5) })}</li>
          </ul>
          <button type="button" disabled={disabled} onClick={() => onAccept(item.remote.id, recommendation.id)}>{t("redmineReconciliation.accept", { remoteId: item.remote.id, key: recommendation.localIssue.key })}</button>
        </section>;
      })}
      <button type="button" disabled={disabled} onClick={() => onRejectAll(item.remote.id)}>{t("redmineReconciliation.rejectAll")}</button>
    </article>
  );
}
