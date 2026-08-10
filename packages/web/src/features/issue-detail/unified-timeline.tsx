/**
 * KAN-32 — UnifiedTimeline: renders the merged chronological issue feed.
 *
 * Accepts TimelineItem[] from useUnifiedTimeline (already sorted ASC).
 * Renders each item via a per-kind row renderer and mounts ViaBadge on
 * every row. Handles empty, loading, and error states.
 *
 * AgentThread right pane is NOT replaced here — that is an accepted
 * transitional duplication until the sidebar rework lands.
 */

import { Markdown } from "@/components/ui/markdown";
import { ViaBadge } from "./via-badge";
import type { TimelineItem } from "./timeline-types";

interface UnifiedTimelineProps {
  items: TimelineItem[];
  isLoading: boolean;
  isError: boolean;
}

export function UnifiedTimeline({ items, isLoading, isError }: UnifiedTimelineProps) {
  if (isLoading) {
    return (
      <div
        data-testid="timeline-loading"
        style={{
          padding: "24px 0",
          textAlign: "center",
          fontSize: 12,
          color: "var(--ink-3)",
        }}
      >
        Loading timeline…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        data-testid="timeline-error"
        style={{
          padding: "24px 0",
          textAlign: "center",
          fontSize: 12,
          color: "var(--ink-3)",
        }}
      >
        Failed to load timeline.
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        data-testid="timeline-empty"
        style={{
          padding: "24px 0",
          textAlign: "center",
          fontSize: 12,
          color: "var(--ink-4)",
        }}
      >
        No activity yet.
      </div>
    );
  }

  return (
    <ol
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {items.map((item) => (
        <li key={item.id} data-testid="timeline-item">
          <TimelineRow item={item} />
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Per-kind row renderers
// ---------------------------------------------------------------------------

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px solid var(--line)",
        fontSize: 12.5,
        color: "var(--ink-2)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <RowContent item={item} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <ViaBadge via={item.via} />
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--ink-4)", whiteSpace: "nowrap" }}
        >
          {formatTime(item.createdAt)}
        </span>
      </div>
    </div>
  );
}

function RowContent({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "human-comment":
      return (
        <div>
          <span style={{ fontWeight: 500, marginRight: 6 }}>
            <ActorName actor={item.author} />
          </span>
          <div style={{ marginTop: 2, color: "var(--ink)" }}>
            <Markdown>{item.body}</Markdown>
          </div>
        </div>
      );

    case "agent-comment":
      return (
        <div>
          <span style={{ fontWeight: 500, marginRight: 6 }}>
            {item.author?.username ?? "agent"}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              padding: "1px 4px",
              borderRadius: 3,
              background: "var(--ai)",
              color: "var(--btn-ink)",
              marginRight: 4,
            }}
          >
            {item.source}
          </span>
          <div style={{ marginTop: 2, color: "var(--ink)" }}>
            <Markdown>{item.body}</Markdown>
          </div>
        </div>
      );

    case "state-change":
      return (
        <span>
          <ActorName actor={item.actor} /> changed state
          {item.from && <> from <code>{item.from}</code></>}
          {item.to && <> to <code>{item.to}</code></>}
        </span>
      );

    case "created":
      return (
        <span>
          <ActorName actor={item.actor} /> created this issue
        </span>
      );

    case "assigned":
      return (
        <span>
          <ActorName actor={item.actor} />
          {item.field && <> updated {item.field}</>}
          {item.newValue && <> → <code>{item.newValue}</code></>}
        </span>
      );

    case "field-change":
      return (
        <span>
          <ActorName actor={item.actor} />
          {item.field && <> updated {item.field}</>}
          {item.from && <> from <code>{item.from}</code></>}
          {item.to && <> to <code>{item.to}</code></>}
        </span>
      );

    case "deleted":
      return (
        <span>
          <ActorName actor={item.actor} /> deleted this issue
        </span>
      );

    case "document-added":
      return (
        <span>
          <ActorName actor={item.actor} /> added a design record
          {item.field && <> ({item.field})</>}
        </span>
      );
  }
}

function ActorName({ actor }: { actor: import("./timeline-types").Actor }) {
  return (
    <span style={{ fontWeight: 500 }}>
      {actor?.username ?? "unknown"}
      {actor?.provider ? ` (${actor.provider})` : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
