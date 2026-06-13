import { useState } from "react";
import { issueRoute, SubscribeButton } from "./issue";
import { useIssueDetail } from "@/features/issue-detail/use-issue-detail";
import { IssueDescription } from "@/features/issue-detail/issue-description";
import { IssueComposer } from "@/features/issue-detail/issue-composer";
import { IssueDetailHeader } from "@/features/issue-detail/issue-detail-header";
import { MetadataSection } from "@/features/issue-detail/metadata-section";
import { ChildrenSection } from "@/features/issue-detail/children-section";
import { DependenciesSection } from "@/features/issue-detail/dependencies-section";
import { DocumentList } from "@/features/issue-detail/document-list";
import { UnifiedTimeline } from "@/features/issue-detail/unified-timeline";
import { Icon } from "@/components/ui/icons";

type Tab = "timeline" | "children" | "deps" | "documents";

export default function IssuePage() {
  const { key: issueKey } = issueRoute.useParams();
  const { tab: tabFromSearch } = issueRoute.useSearch();

  const [tab, setTab] = useState<Tab>(tabFromSearch ?? "timeline");

  const d = useIssueDetail(issueKey);

  if (d.isLoading || !d.issue) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        Loading issue…
      </div>
    );
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "timeline", label: "Timeline", count: d.timeline.items.length },
    { id: "children", label: "Sub-issues", count: d.issue.children?.length ?? 0 },
    {
      id: "deps",
      label: "Dependencies",
      count:
        (d.issue.blocks?.length ?? 0) + (d.issue.blockedBy?.length ?? 0),
    },
    { id: "documents", label: "Design Records", count: d.documents?.length ?? 0 },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 380px",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* MAIN PANE */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid var(--line)",
          minWidth: 0,
        }}
      >
        {/* Subtoolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            onClick={d.onBack}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--ink-3)",
              fontSize: 12,
            }}
          >
            <Icon.ChevL /> Back
          </button>
          <span style={{ flex: 1 }} />
          <SubscribeButton
            isSubscribed={d.isSubscribed}
            isSubscriptionPending={d.isSubscriptionPending}
            onToggle={d.onSubscribeToggle}
          />
          <button type="button" style={{ color: "var(--ink-4)" }}>
            <Icon.More />
          </button>
        </div>

        <IssueDetailHeader
          issueKey={d.issue.key}
          title={d.issue.title}
          type={d.issue.type}
          priority={d.issue.priority}
          state={d.issue.state}
          hasAgent={(d.issue.activeWorkers ?? []).some((w) => w.isAgent)}
          onTitleChange={d.onTitleChange}
          onClose={d.onBack}
        />

        <IssueDescription value={d.issue.description} onSave={d.onDescriptionSave} />

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "16px 28px 0",
            borderBottom: "1px solid var(--line)",
            flexShrink: 0,
          }}
        >
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  position: "relative",
                  padding: "8px 0",
                  fontSize: 12.5,
                  fontWeight: active ? 500 : 400,
                  color: active ? "var(--ink)" : "var(--ink-3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {t.label}
                {t.count != null && (
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: "var(--ink-4)" }}
                  >
                    {t.count}
                  </span>
                )}
                {active && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: -1,
                      height: 2,
                      background: "var(--accent)",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "16px 28px 24px",
          }}
        >
          {tab === "timeline" && (
            <UnifiedTimeline
              items={d.timeline.items}
              isLoading={d.timeline.isLoading}
              isError={d.timeline.isError}
            />
          )}
          {tab === "children" && (
            <ChildrenSection
              children={d.issue.children ?? []}
              onSelect={d.onSelectChild}
            />
          )}
          {tab === "deps" && (
            <DependenciesSection
              blocks={d.issue.blocks ?? []}
              blockedBy={d.issue.blockedBy ?? []}
            />
          )}
          {tab === "documents" && (
            <DocumentList
              documents={d.documents ?? []}
              isLoading={d.documentsLoading}
              issueKey={issueKey}
            />
          )}
        </div>

        <IssueComposer onSubmit={d.onAddComment} isPending={d.addCommentPending} />
      </div>

      {/* RIGHT PANE: properties + agent thread */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg-2)",
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: "0.06em",
              marginBottom: 10,
              textTransform: "uppercase",
            }}
          >
            Properties
          </div>
          <MetadataSection
            issue={d.issue}
            projectKey={d.projectKey}
            onFieldChange={d.onFieldChange}
            onTransition={d.onTransition}
            onCycleChange={(nextId, currentId) => {
              d.onCycleChange(nextId, currentId);
            }}
          />
        </div>

        {/* Reserved slot for future Schedule section (ADR-0005/KAN-98) */}
        <div data-testid="schedule-slot" style={{ flex: 1 }} />
      </div>
    </div>
  );
}
