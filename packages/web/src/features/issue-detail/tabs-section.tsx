import { useState, useCallback } from "react";
import { CommentList } from "./comment-list";
import { ActivityList } from "./activity-list";
import type { Comment, ActivityLog } from "@/types/issue";
import { useI18n } from "@/hooks/use-i18n";

type Tab = "comments" | "activity";

interface TabsSectionProps {
  comments: Comment[];
  commentsLoading: boolean;
  activities: ActivityLog[];
  activitiesLoading: boolean;
  onAddComment: (body: string) => void;
  isSubmittingComment: boolean;
}

/**
 * Tab switcher between Comments and Activity tabs
 * in the issue detail panel.
 */
export function TabsSection({
  comments,
  commentsLoading,
  activities,
  activitiesLoading,
  onAddComment,
  isSubmittingComment,
}: TabsSectionProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>("comments");

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {/* Tab bar */}
      <div className="flex border-b border-border" role="tablist">
        <TabButton
          label={t("issueDetail.tabs.comments")}
          count={comments.length}
          isActive={activeTab === "comments"}
          onClick={() => handleTabChange("comments")}
        />
        <TabButton
          label={t("issueDetail.tabs.activity")}
          count={activities.length}
          isActive={activeTab === "activity"}
          onClick={() => handleTabChange("activity")}
        />
      </div>

      {/* Tab content */}
      <div role="tabpanel">
        {activeTab === "comments" ? (
          <CommentList
            comments={comments}
            isLoading={commentsLoading}
            onAddComment={onAddComment}
            isSubmitting={isSubmittingComment}
          />
        ) : (
          <ActivityList
            activities={activities}
            isLoading={activitiesLoading}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab button                                                         */
/* ------------------------------------------------------------------ */

function TabButton({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px
        ${
          isActive
            ? "border-primary text-primary"
            : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
        }`}
    >
      {label}
      {count > 0 && (
        <span className="ml-1.5 text-xs text-muted-foreground">
          ({count})
        </span>
      )}
    </button>
  );
}
