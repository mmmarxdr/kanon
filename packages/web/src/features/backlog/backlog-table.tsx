import { useState, useMemo, useCallback } from "react";
import type { Issue, IssuePriority, IssueType, GroupSummary } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";
import { STATE_LABELS, useBoardStore } from "@/stores/board-store";
import { humanizeGroupKey } from "@/lib/humanize-group-key";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_COLORS: Record<IssuePriority, string> = {
  critical: "bg-red-500",
  high: "bg-orange-400",
  medium: "bg-yellow-400",
  low: "bg-gray-400",
};

const PRIORITY_LABELS: Record<IssuePriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const TYPE_COLORS: Record<IssueType, string> = {
  feature: "bg-primary/10 text-primary",
  bug: "bg-red-50 text-red-600",
  task: "bg-secondary text-muted-foreground",
  spike: "bg-violet-50 text-violet-600",
};

const TYPE_LABELS: Record<IssueType, string> = {
  feature: "Feature",
  bug: "Bug",
  task: "Task",
  spike: "Spike",
};

const STATE_COLORS: Record<IssueState, string> = {
  backlog: "bg-gray-100 text-gray-600",
  explore: "bg-blue-50 text-blue-600",
  propose: "bg-indigo-50 text-indigo-600",
  design: "bg-violet-50 text-violet-600",
  spec: "bg-purple-50 text-purple-600",
  tasks: "bg-amber-50 text-amber-600",
  apply: "bg-orange-50 text-orange-600",
  verify: "bg-primary/10 text-primary",
  archived: "bg-gray-50 text-gray-500",
};

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortField =
  | "key"
  | "title"
  | "type"
  | "priority"
  | "state"
  | "assignee"
  | "createdAt";
type SortDirection = "asc" | "desc";

const PRIORITY_ORDER: Record<IssuePriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const STATE_ORDER: Record<IssueState, number> = {
  backlog: 0,
  explore: 1,
  propose: 2,
  design: 3,
  spec: 4,
  tasks: 5,
  apply: 6,
  verify: 7,
  archived: 8,
};

function compareIssues(
  a: Issue,
  b: Issue,
  field: SortField,
  dir: SortDirection,
): number {
  const m = dir === "asc" ? 1 : -1;
  switch (field) {
    case "key": {
      // Extract numeric part for natural sort (e.g., KAN-2 vs KAN-10)
      const numA = parseInt(a.key.split("-").pop() ?? "0", 10);
      const numB = parseInt(b.key.split("-").pop() ?? "0", 10);
      return (numA - numB) * m;
    }
    case "title":
      return a.title.localeCompare(b.title) * m;
    case "type":
      return a.type.localeCompare(b.type) * m;
    case "priority":
      return (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) * m;
    case "state":
      return (STATE_ORDER[a.state] - STATE_ORDER[b.state]) * m;
    case "assignee": {
      const nameA = a.assignee?.username ?? "";
      const nameB = b.assignee?.username ?? "";
      return nameA.localeCompare(nameB) * m;
    }
    case "createdAt":
      return (
        (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * m
      );
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Relative date helper
// ---------------------------------------------------------------------------

function relativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.floor(diffMonth / 12)}y ago`;
}

// ---------------------------------------------------------------------------
// Sort header icon
// ---------------------------------------------------------------------------

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="opacity-0 group-hover:opacity-40 transition-opacity"
      >
        <path d="M3 4.5L6 2L9 4.5" />
        <path d="M3 7.5L6 10L9 7.5" />
      </svg>
    );
  }

  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="text-primary"
    >
      {direction === "asc" ? (
        <path d="M3 7.5L6 4.5L9 7.5" />
      ) : (
        <path d="M3 4.5L6 7.5L9 4.5" />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Chevron icon for expand/collapse
// ---------------------------------------------------------------------------

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
    >
      <path d="M5 3L9 7L5 11" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// IssueRow (extracted for reuse in both flat and grouped modes)
// ---------------------------------------------------------------------------

function IssueRow({
  issue,
  indented,
  onSelectIssue,
}: {
  issue: Issue;
  indented?: boolean;
  onSelectIssue: (key: string, element: HTMLElement) => void;
}) {
  return (
    <tr
      key={issue.id}
      data-testid={`backlog-row-${issue.key}`}
      className="bg-card hover:bg-primary/5 transition-colors border-b border-border cursor-pointer"
      onClick={(e) => onSelectIssue(issue.key, e.currentTarget)}
    >
      {/* Key */}
      <td className="py-2.5 px-4">
        <span
          className={`text-xs font-mono text-primary font-medium ${indented ? "pl-6" : ""}`}
        >
          {issue.key}
        </span>
      </td>

      {/* Title */}
      <td className="py-2.5 px-4">
        <span
          className={`text-sm text-foreground truncate block max-w-[400px] ${indented ? "pl-6" : ""}`}
        >
          {issue.title}
        </span>
      </td>

      {/* Type */}
      <td className="py-2.5 px-4">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${TYPE_COLORS[issue.type]}`}
        >
          {TYPE_LABELS[issue.type]}
        </span>
      </td>

      {/* Priority */}
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${PRIORITY_COLORS[issue.priority]}`}
          />
          <span className="text-xs text-muted-foreground">
            {PRIORITY_LABELS[issue.priority]}
          </span>
        </div>
      </td>

      {/* State */}
      <td className="py-2.5 px-4">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${STATE_COLORS[issue.state]}`}
        >
          {STATE_LABELS[issue.state]}
        </span>
      </td>

      {/* Assignee */}
      <td className="py-2.5 px-4">
        {issue.assignee ? (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-semibold shrink-0">
              {issue.assignee.username.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs text-muted-foreground truncate">
              {issue.assignee.username}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/50">--</span>
        )}
      </td>

      {/* Created */}
      <td className="py-2.5 px-4">
        <span
          className="text-xs text-muted-foreground"
          title={new Date(issue.createdAt).toLocaleString()}
        >
          {relativeDate(issue.createdAt)}
        </span>
      </td>

      {/* Labels */}
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-1 flex-wrap">
          {issue.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className={`text-[11px] px-1.5 py-0.5 rounded ${
                label.startsWith("sdd:")
                  ? "bg-primary/10 text-primary font-semibold"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              {label}
            </span>
          ))}
          {issue.labels.length > 3 && (
            <span className="text-[11px] text-muted-foreground">
              +{issue.labels.length - 3}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// GroupHeaderRow
// ---------------------------------------------------------------------------

function GroupHeaderRow({
  group,
  expanded,
  onToggle,
}: {
  group: GroupSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Count completed issues (archived state)
  const completedLabel =
    group.latestState === "archived"
      ? `${group.count}/${group.count}`
      : `${group.count}`;

  return (
    <tr
      data-testid={`backlog-group-${group.groupKey}`}
      className="bg-secondary/50 hover:bg-secondary/70 transition-colors border-b border-border cursor-pointer select-none"
      onClick={onToggle}
    >
      {/* Chevron + Group title */}
      <td colSpan={2} className="py-2.5 px-4">
        <div className="flex items-center gap-2">
          <ChevronIcon expanded={expanded} />
          <span className="text-sm font-semibold text-foreground">
            {group.title || humanizeGroupKey(group.groupKey)}
          </span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
            {completedLabel}
          </span>
        </div>
      </td>

      {/* Type — empty for group row */}
      <td className="py-2.5 px-4" />

      {/* Priority — empty for group row */}
      <td className="py-2.5 px-4" />

      {/* State — show latest state */}
      <td className="py-2.5 px-4">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${STATE_COLORS[group.latestState]}`}
        >
          {STATE_LABELS[group.latestState]}
        </span>
      </td>

      {/* Assignee — empty for group row */}
      <td className="py-2.5 px-4" />

      {/* Updated */}
      <td className="py-2.5 px-4">
        <span
          className="text-xs text-muted-foreground"
          title={new Date(group.updatedAt).toLocaleString()}
        >
          {relativeDate(group.updatedAt)}
        </span>
      </td>

      {/* Labels — empty for group row */}
      <td className="py-2.5 px-4" />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// BacklogTable
// ---------------------------------------------------------------------------

interface BacklogTableProps {
  issues: Issue[];
  search: string;
  onSelectIssue: (key: string, element: HTMLElement) => void;
  /** Group summaries from API. When provided and viewMode is "grouped", groups are rendered. */
  groups?: GroupSummary[];
}

interface ColumnDef {
  field: SortField;
  label: string;
  className: string;
}

const COLUMNS: ColumnDef[] = [
  { field: "key", label: "Key", className: "w-[100px]" },
  { field: "title", label: "Title", className: "min-w-[200px]" },
  { field: "type", label: "Type", className: "w-[90px]" },
  { field: "priority", label: "Priority", className: "w-[110px]" },
  { field: "state", label: "State", className: "w-[100px]" },
  { field: "assignee", label: "Assignee", className: "w-[120px]" },
  { field: "createdAt", label: "Created", className: "w-[100px]" },
];

export function BacklogTable({
  issues,
  search,
  onSelectIssue,
  groups,
}: BacklogTableProps) {
  const viewMode = useBoardStore((s) => s.viewMode);
  const showUngrouped = useBoardStore((s) => s.showUngrouped);

  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField],
  );

  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const filteredAndSorted = useMemo(() => {
    let result = issues;

    // Client-side text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (issue) =>
          issue.key.toLowerCase().includes(q) ||
          issue.title.toLowerCase().includes(q) ||
          issue.labels.some((l) => l.toLowerCase().includes(q)) ||
          issue.assignee?.username.toLowerCase().includes(q),
      );
    }

    // Sort
    return [...result].sort((a, b) =>
      compareIssues(a, b, sortField, sortDir),
    );
  }, [issues, search, sortField, sortDir]);

  // Group issues by groupKey for the grouped view
  const issuesByGroup = useMemo(() => {
    if (viewMode !== "grouped") return null;
    const map = new Map<string, Issue[]>();
    for (const issue of filteredAndSorted) {
      const key = issue.groupKey ?? "__ungrouped__";
      const arr = map.get(key);
      if (arr) {
        arr.push(issue);
      } else {
        map.set(key, [issue]);
      }
    }
    return map;
  }, [filteredAndSorted, viewMode]);

  const isGroupedMode = viewMode === "grouped" && groups && groups.length > 0;

  // Filter groups by search text (match group title or key)
  const filteredGroups = useMemo(() => {
    if (!isGroupedMode || !groups) return [];
    let result = groups;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (g) =>
          g.groupKey.toLowerCase().includes(q) ||
          g.title.toLowerCase().includes(q) ||
          // Also include groups that have matching child issues
          (issuesByGroup?.get(g.groupKey)?.length ?? 0) > 0,
      );
    }
    return result;
  }, [groups, isGroupedMode, search, issuesByGroup]);

  const ungroupedIssues = useMemo(() => {
    if (!isGroupedMode) return [];
    return filteredAndSorted.filter(
      (issue) => !issue.groupKey,
    );
  }, [filteredAndSorted, isGroupedMode]);

  // In flat mode, or when no groups exist, render the original flat table
  const hasContent =
    isGroupedMode
      ? filteredGroups.length > 0 || (showUngrouped && ungroupedIssues.length > 0)
      : filteredAndSorted.length > 0;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-muted-foreground text-sm">No issues found</p>
      </div>
    );
  }

  return (
    <table className="w-full border-collapse">
      {/* Header */}
      <thead className="sticky top-0 z-10">
        <tr className="bg-secondary">
          {COLUMNS.map((col) => (
            <th
              key={col.field}
              className={`${col.className} text-left text-xs uppercase tracking-wider text-muted-foreground font-medium py-2.5 px-4 cursor-pointer select-none group`}
              onClick={() => handleSort(col.field)}
            >
              <div className="flex items-center gap-1">
                <span>{col.label}</span>
                <SortIcon
                  active={sortField === col.field}
                  direction={sortDir}
                />
              </div>
            </th>
          ))}
          {/* Labels column — not sortable */}
          <th className="min-w-[120px] text-left text-xs uppercase tracking-wider text-muted-foreground font-medium py-2.5 px-4">
            Labels
          </th>
        </tr>
      </thead>

      {/* Body */}
      <tbody>
        {isGroupedMode ? (
          <>
            {/* Grouped rows */}
            {filteredGroups.map((group) => {
              const expanded = expandedGroups.has(group.groupKey);
              const childIssues = issuesByGroup?.get(group.groupKey) ?? [];
              return (
                <GroupSection
                  key={group.groupKey}
                  group={group}
                  expanded={expanded}
                  childIssues={childIssues}
                  onToggle={() => toggleGroup(group.groupKey)}
                  onSelectIssue={onSelectIssue}
                />
              );
            })}

            {/* Ungrouped issues (shown only when showUngrouped is on) */}
            {showUngrouped && ungroupedIssues.length > 0 && (
              <>
                <tr className="bg-secondary/30 border-b border-border">
                  <td
                    colSpan={COLUMNS.length + 1}
                    className="py-2 px-4"
                  >
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Ungrouped ({ungroupedIssues.length})
                    </span>
                  </td>
                </tr>
                {ungroupedIssues.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    onSelectIssue={onSelectIssue}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          /* Flat mode — original behavior */
          filteredAndSorted.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              onSelectIssue={onSelectIssue}
            />
          ))
        )}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// GroupSection — renders a group header + its child rows when expanded
// ---------------------------------------------------------------------------

function GroupSection({
  group,
  expanded,
  childIssues,
  onToggle,
  onSelectIssue,
}: {
  group: GroupSummary;
  expanded: boolean;
  childIssues: Issue[];
  onToggle: () => void;
  onSelectIssue: (key: string, element: HTMLElement) => void;
}) {
  return (
    <>
      <GroupHeaderRow
        group={group}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded &&
        childIssues.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            indented
            onSelectIssue={onSelectIssue}
          />
        ))}
    </>
  );
}
