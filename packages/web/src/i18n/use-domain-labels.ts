import { useTranslation } from "react-i18next";
import type { IssueState } from "@/stores/board-store";

/** Translated issue state labels (KAN-158). Prefer over STATE_LABELS in UI. */
export function useStateLabel(state: IssueState): string {
  const { t } = useTranslation("common");
  return t(`state.${state}`);
}

export function useStateLabels(): Record<IssueState, string> {
  const { t } = useTranslation("common");
  return {
    backlog: t("state.backlog"),
    analysis: t("state.analysis"),
    todo: t("state.todo"),
    in_progress: t("state.in_progress"),
    review: t("state.review"),
    done: t("state.done"),
  };
}

export function usePriorityLabels(): Record<string, string> {
  const { t } = useTranslation("common");
  return {
    critical: t("priority.critical"),
    high: t("priority.high"),
    medium: t("priority.medium"),
    low: t("priority.low"),
  };
}

export function useTypeLabels(): Record<string, string> {
  const { t } = useTranslation("common");
  return {
    feature: t("type.feature"),
    bug: t("type.bug"),
    task: t("type.task"),
    spike: t("type.spike"),
    incident: t("type.incident"),
  };
}
