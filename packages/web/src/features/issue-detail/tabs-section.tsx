import { useState } from "react";
import { CommentList } from "./comment-list";
import { ActivityList } from "./activity-list";
import { AgentThread } from "./agent-thread";
import type { Comment, ActivityLog } from "@/types/issue";

type Tab = "comments" | "agent" | "activity";

interface TabsSectionProps {
  comments: Comment[];
  commentsLoading: boolean;
  activities: ActivityLog[];
  activitiesLoading: boolean;
  onAddComment: (body: string) => void;
  isSubmittingComment: boolean;
}

const AGENT_SOURCES = new Set(["mcp", "engram_sync", "system"]);

export function TabsSection({
  comments,
  commentsLoading,
  activities,
  activitiesLoading,
  onAddComment,
  isSubmittingComment,
}: TabsSectionProps) {
  const [activeTab, setActiveTab] = useState<Tab>("comments");

  const humanComments = comments.filter((c) => !AGENT_SOURCES.has(c.source));
  const agentComments = comments.filter((c) => AGENT_SOURCES.has(c.source));

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "comments", label: "Comments", count: humanComments.length },
    { id: "agent", label: "Agent", count: agentComments.length },
    { id: "activity", label: "Activity", count: activities.length },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Tab bar */}
      <div
        role="tablist"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          borderBottom: "1px solid var(--line)",
        }}
      >
        {tabs.map((t) => {
          const active = activeTab === t.id;
          const isAgent = t.id === "agent";
          const accent = isAgent ? "var(--ai)" : "var(--accent)";
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(t.id)}
              style={{
                position: "relative",
                padding: "8px 0",
                fontSize: 12.5,
                fontWeight: active ? 500 : 400,
                color: active
                  ? isAgent
                    ? "var(--ai)"
                    : "var(--ink)"
                  : "var(--ink-3)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {t.label}
              <span
                className="mono"
                style={{ fontSize: 10, color: "var(--ink-4)" }}
              >
                {t.count}
              </span>
              {active && (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: -1,
                    height: 2,
                    background: accent,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div role="tabpanel">
        {activeTab === "comments" && (
          <CommentList
            comments={humanComments}
            isLoading={commentsLoading}
            onAddComment={onAddComment}
            isSubmitting={isSubmittingComment}
          />
        )}
        {activeTab === "agent" && (
          <AgentThread comments={comments} isLoading={commentsLoading} />
        )}
        {activeTab === "activity" && (
          <ActivityList activities={activities} isLoading={activitiesLoading} />
        )}
      </div>
    </div>
  );
}
