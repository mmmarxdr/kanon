import { issueRoute, SubscribeButton } from "./issue";
import { useIssueDetail } from "@/features/issue-detail/use-issue-detail";
import { IssueDetailHeader } from "@/features/issue-detail/issue-detail-header";
import { MetadataSection } from "@/features/issue-detail/metadata-section";
import { IssueTopZone } from "@/features/issue-detail/issue-top-zone";
import { IssueTimelineDock } from "@/features/issue-detail/issue-timeline-dock";
import { Icon } from "@/components/ui/icons";

export default function IssuePage() {
  const { key: issueKey } = issueRoute.useParams();

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

  return (
    <div
      className="issue-layout"
      style={{
        display: "grid",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* MAIN PANE — flex column with fixed-height dock pinned at the bottom */}
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
            flexShrink: 0,
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

        {/* Scrollable content zone — Description, Design Records, Sub-issues, Dependencies */}
        <IssueTopZone
          issueKey={issueKey}
          description={d.issue.description}
          onDescriptionSave={d.onDescriptionSave}
          documents={d.documents ?? []}
          documentsLoading={d.documentsLoading}
          children={d.issue.children ?? []}
          onSelectChild={d.onSelectChild}
          blocks={d.issue.blocks ?? []}
          blockedBy={d.issue.blockedBy ?? []}
        />

        {/* Fixed-height timeline dock — timeline + composer always pinned at bottom */}
        <IssueTimelineDock
          timeline={d.timeline}
          onAddComment={d.onAddComment}
          addCommentPending={d.addCommentPending}
        />
      </div>

      {/* RIGHT PANE: properties + reserved schedule slot (UNCHANGED) */}
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
