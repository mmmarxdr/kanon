/**
 * KAN-33 slice 1 — Right-rail "Synced from your tools" provenance log.
 *
 * Shows only the AI/tool-attributed rows from the unified issue timeline:
 * filters to items whose `via` is one of the supported tool values
 * (claude-code | cursor | codex | antigravity | cli). Excludes `web`, null, and
 * any unrecognized future via values (forward-compatible — they remain
 * visible in the main timeline but are not surfaced as "synced from your
 * tools" until we explicitly add them here).
 *
 * Newest-first order. Reuses `<ViaBadge>` so the cobalt provenance colour
 * and the label map stay in a single place.
 *
 * Undo is OUT OF SCOPE for this slice — see design `view-issue.jsx`
 * SyncItem.undo button. Adding it requires an attribution + revert
 * API (KAN-33 slice 2 / Member.isAgent migration).
 */

import { useUnifiedTimeline } from "./use-unified-timeline";
import { ViaBadge, SUPPORTED_TOOL_VIAS } from "./via-badge";
import type { TimelineItem } from "./timeline-types";

interface SyncedFromToolsSlotProps {
  issueKey: string;
}

export function SyncedFromToolsSlot({ issueKey }: SyncedFromToolsSlotProps) {
  const { items, isLoading, isError } = useUnifiedTimeline(issueKey);

  const synced = filterAndReverse(items, SUPPORTED_TOOL_VIAS);

  return (
    <div
      data-testid="synced-from-tools"
      style={{
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-2)",
      }}
    >
      <div
        style={{
          padding: "12px 18px 8px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "oklch(0.52 0.11 245)",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
          Synced from your tools
        </span>
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--ink-4)" }}
        >
          attributed to you
        </span>
      </div>

      <div
        style={{
          padding: "4px 18px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {isLoading ? (
          <RowMuted>Loading…</RowMuted>
        ) : isError ? (
          <RowMuted>Failed to load sync log.</RowMuted>
        ) : synced.length === 0 ? (
          <RowMuted>Nothing synced yet from your tools.</RowMuted>
        ) : (
          synced.map((item) => <SyncRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Filter timeline items to those whose `via` is a supported tool value, then
 * reverse to newest-first. Pure & exported for unit testing.
 */
export function filterAndReverse(
  items: readonly TimelineItem[],
  supported: ReadonlySet<string>,
): TimelineItem[] {
  return items.filter((i) => i.via !== null && supported.has(i.via)).reverse();
}

function SyncRow({ item }: { item: TimelineItem }) {
  return (
    <div
      data-testid="synced-row"
      data-via={item.via ?? undefined}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        columnGap: 10,
        rowGap: 4,
        padding: "8px 10px",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 5,
        fontSize: 12,
      }}
    >
      <div
        style={{
          color: "var(--ink-2)",
          lineHeight: 1.45,
          minWidth: 0,
          wordBreak: "break-word",
        }}
      >
        {summarise(item)}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
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

function RowMuted({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11.5,
        color: "var(--ink-4)",
        padding: "8px 0",
      }}
    >
      {children}
    </span>
  );
}

function summarise(item: TimelineItem): string {
  switch (item.kind) {
    case "agent-comment":
      return item.body || `${item.source} activity`;
    case "human-comment":
      return item.body || "comment";
    case "state-change":
      return `Changed state${item.from ? ` from ${item.from}` : ""}${
        item.to ? ` to ${item.to}` : ""
      }`;
    case "created":
      return "Created this issue";
    case "assigned":
      return `Updated ${item.field ?? "assignment"}${
        item.newValue ? ` → ${item.newValue}` : ""
      }`;
    case "field-change":
      return `Updated ${item.field ?? "field"}${
        item.from ? ` from ${item.from}` : ""
      }${item.to ? ` to ${item.to}` : ""}`;
    case "deleted":
      return "Deleted this issue";
    case "document-added":
      return `Added design record${item.field ? ` (${item.field})` : ""}`;
    default:
      return assertNever(item);
  }
}

function assertNever(x: never): never {
  throw new Error(`Unhandled TimelineItem kind: ${JSON.stringify(x)}`);
}

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
