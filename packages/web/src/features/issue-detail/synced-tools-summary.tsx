import { useUnifiedTimeline } from "./use-unified-timeline";
import { filterAndReverse } from "./synced-from-tools-slot";
import { SUPPORTED_TOOL_VIAS, ViaBadge } from "./via-badge";
import type { TimelineItem } from "./timeline-types";

interface SyncedToolsSummaryContentProps {
  items: readonly TimelineItem[];
  isLoading: boolean;
  isError: boolean;
}

/** Bounded sticky-rail provenance: count and at most one latest item. */
export function SyncedToolsSummaryContent({ items, isLoading, isError }: SyncedToolsSummaryContentProps) {
  const synced = filterAndReverse(items, SUPPORTED_TOOL_VIAS);

  if (isLoading) return <p data-testid="synced-tools-summary">Loading synced tools…</p>;
  if (isError) return <p data-testid="synced-tools-summary">Synced tools are unavailable.</p>;
  if (!synced.length) return <p data-testid="synced-tools-summary">No synced tool activity.</p>;

  const latest = synced[0]!;
  return (
    <div data-testid="synced-tools-summary">
      <p>{synced.length} synced tool {synced.length === 1 ? "item" : "items"}</p>
      <div data-testid="synced-tools-summary-latest">
        <ViaBadge via={latest.via} />
        <time dateTime={latest.createdAt}>{latest.createdAt}</time>
      </div>
    </div>
  );
}

export function SyncedToolsSummary({ issueKey }: { issueKey: string }) {
  const timeline = useUnifiedTimeline(issueKey);
  return <SyncedToolsSummaryContent {...timeline} />;
}
