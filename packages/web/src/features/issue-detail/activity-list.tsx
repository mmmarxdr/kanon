import type { ActivityLog } from "@/types/issue";

interface ActivityListProps {
  activities: ActivityLog[];
  isLoading: boolean;
}

/**
 * Activity tab content for the issue detail panel.
 *
 * Renders activity log entries in reverse-chronological order as a timeline.
 * Each entry shows: actor, action type, field change details (old -> new), and timestamp.
 */
export function ActivityList({ activities, isLoading }: ActivityListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Loading activity...
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No activity yet.
      </p>
    );
  }

  // Display in reverse chronological order (newest first)
  const sorted = [...activities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <ul className="flex flex-col">
      {sorted.map((entry, idx) => (
        <ActivityItem
          key={entry.id}
          entry={entry}
          isLast={idx === sorted.length - 1}
        />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Single activity entry                                              */
/* ------------------------------------------------------------------ */

const ACTION_CONFIG: Record<string, { icon: string; label: string }> = {
  created: { icon: "+", label: "created this issue" },
  state_changed: { icon: "~", label: "changed state" },
  assigned: { icon: "@", label: "changed assignee" },
  commented: { icon: "#", label: "commented" },
  edited: { icon: "/", label: "edited" },
};

function ActivityItem({
  entry,
  isLast,
}: {
  entry: ActivityLog;
  isLast: boolean;
}) {
  const config = ACTION_CONFIG[entry.action] ?? {
    icon: "?",
    label: entry.action,
  };

  return (
    <li className="relative flex gap-3 pb-4">
      {/* Timeline connector line */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
      )}

      {/* Icon dot */}
      <div className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
        {config.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1 flex-wrap">
          <span className="text-sm font-medium text-foreground">
            {entry.actor.username}
          </span>
          <span className="text-sm text-muted-foreground">
            {config.label}
          </span>
          {entry.field && (
            <span className="text-xs text-muted-foreground">
              ({entry.field})
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground shrink-0">
            {formatRelativeTime(entry.createdAt)}
          </span>
        </div>

        {/* Old -> New value display */}
        {(entry.oldValue || entry.newValue) && (
          <div className="flex items-center gap-1.5 mt-1 text-xs">
            {entry.oldValue && (
              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 line-through">
                {entry.oldValue}
              </span>
            )}
            {entry.oldValue && entry.newValue && (
              <span className="text-muted-foreground">&rarr;</span>
            )}
            {entry.newValue && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                {entry.newValue}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(iso: string): string {
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
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
