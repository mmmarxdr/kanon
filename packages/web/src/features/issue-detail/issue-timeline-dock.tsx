import type { TimelineItem } from "./timeline-types";
import { UnifiedTimeline } from "./unified-timeline";
import { IssueComposer } from "./issue-composer";

export interface IssueTimelineDockProps {
  timeline: {
    items: TimelineItem[];
    isLoading: boolean;
    isError: boolean;
  };
  onAddComment: (body: string) => void;
  addCommentPending: boolean;
}

/**
 * KAN-108 slice 2 — IssueTimelineDock: fixed-height dock pinned to the bottom
 * of the main pane.
 *
 * Layout contract:
 *   Root: flexShrink:0, height:300px, display:flex, flexDirection:column,
 *         borderTop:1px solid var(--line)
 *   Inner scroll area: flex:1, minHeight:0, overflowY:auto — wraps UnifiedTimeline
 *   IssueComposer: pinned at dock bottom (flexShrink:0)
 *
 * The dock is a sibling of IssueTopZone in the main-pane flex column.
 * Neither's overflow clips the other.
 */
export function IssueTimelineDock({
  timeline,
  onAddComment,
  addCommentPending,
}: IssueTimelineDockProps) {
  return (
    <div
      data-testid="timeline-dock"
      className="issue-timeline-dock"
      style={{
        flexShrink: 0,
        height: 300,
        display: "flex",
        flexDirection: "column",
        borderTop: "1px solid var(--line)",
      }}
    >
      {/* Scrollable timeline list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "16px 28px",
        }}
      >
        <UnifiedTimeline
          items={timeline.items}
          isLoading={timeline.isLoading}
          isError={timeline.isError}
        />
      </div>

      {/* Composer — pinned at the dock bottom */}
      <IssueComposer onSubmit={onAddComment} isPending={addCommentPending} />
    </div>
  );
}
