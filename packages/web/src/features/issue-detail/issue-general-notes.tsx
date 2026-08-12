import { useTranslation } from "react-i18next";
import { selectCommentTimelineItems } from "./use-unified-timeline";
import { UnifiedTimeline } from "./unified-timeline";
import type { TimelineItem } from "./timeline-types";

interface IssueGeneralNotesProps {
  items: TimelineItem[];
  isLoading: boolean;
  isError: boolean;
}

/** Comment-only issue notes in General; Activity keeps the complete timeline. */
export function IssueGeneralNotes({ items, isLoading, isError }: IssueGeneralNotesProps) {
  const { t } = useTranslation("issue");

  return (
    <section aria-label={t("notes")}>
      <h3>{t("notes")}</h3>
      <UnifiedTimeline
        items={selectCommentTimelineItems(items)}
        isLoading={isLoading}
        isError={isError}
      />
    </section>
  );
}
