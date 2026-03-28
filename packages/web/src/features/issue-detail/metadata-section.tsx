import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { issueKeys } from "@/lib/query-keys";
import {
  ISSUE_STATES,
  STATE_LABELS,
  type IssueState,
} from "@/stores/board-store";
import type {
  IssueDetail,
  IssueType,
  IssuePriority,
  Issue,
} from "@/types/issue";

const ISSUE_TYPES: IssueType[] = ["feature", "bug", "task", "spike"];
const ISSUE_PRIORITIES: IssuePriority[] = ["critical", "high", "medium", "low"];

/** Capitalize first letter for display labels. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface MetadataSectionProps {
  issue: IssueDetail;
  projectKey: string;
  onFieldChange: (payload: Record<string, unknown>) => void;
  onTransition: (toState: IssueState) => void;
}

/**
 * Grid of metadata fields for the issue detail panel.
 *
 * Each dropdown select fires a mutation on change:
 * - type, priority, assignee, labels: onFieldChange (PATCH)
 * - state: onTransition (POST /transition)
 *
 * Assignee list is derived from the board issues cache
 * (unique assignees already loaded on the board).
 */
export function MetadataSection({
  issue,
  projectKey,
  onFieldChange,
  onTransition,
}: MetadataSectionProps) {
  const queryClient = useQueryClient();

  // Derive unique assignees from the board issues cache
  const assignees = useAssigneesFromCache(projectKey, queryClient);

  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onFieldChange({ type: e.target.value as IssueType });
    },
    [onFieldChange],
  );

  const handlePriorityChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onFieldChange({ priority: e.target.value as IssuePriority });
    },
    [onFieldChange],
  );

  const handleStateChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onTransition(e.target.value as IssueState);
    },
    [onTransition],
  );

  const handleAssigneeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      onFieldChange({ assigneeId: value || undefined });
    },
    [onFieldChange],
  );

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {/* Type */}
      <MetadataField label="Type">
        <select
          value={issue.type}
          onChange={handleTypeChange}
          className="w-full rounded bg-secondary text-sm text-foreground border border-border px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {capitalize(t)}
            </option>
          ))}
        </select>
      </MetadataField>

      {/* Priority */}
      <MetadataField label="Priority">
        <select
          value={issue.priority}
          onChange={handlePriorityChange}
          className="w-full rounded bg-secondary text-sm text-foreground border border-border px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          {ISSUE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {capitalize(p)}
            </option>
          ))}
        </select>
      </MetadataField>

      {/* State (uses transition endpoint) */}
      <MetadataField label="State">
        <select
          value={issue.state}
          onChange={handleStateChange}
          className="w-full rounded bg-secondary text-sm text-foreground border border-border px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          {ISSUE_STATES.map((s) => (
            <option key={s} value={s}>
              {STATE_LABELS[s]}
            </option>
          ))}
        </select>
      </MetadataField>

      {/* Assignee (derived from board cache) */}
      <MetadataField label="Assignee">
        <select
          value={issue.assigneeId ?? ""}
          onChange={handleAssigneeChange}
          className="w-full rounded bg-secondary text-sm text-foreground border border-border px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          <option value="">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.username}
            </option>
          ))}
        </select>
      </MetadataField>

      {/* Labels (read-only text for v1) */}
      <MetadataField label="Labels">
        <div className="flex flex-wrap gap-1 py-1">
          {issue.labels.length > 0 ? (
            issue.labels.map((label) => (
              <span
                key={label}
                className="text-xs px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
              >
                {label}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">None</span>
          )}
        </div>
      </MetadataField>

      {/* Timestamps (read-only) */}
      <MetadataField label="Created">
        <span className="text-xs text-muted-foreground py-1">
          {formatDate(issue.createdAt)}
        </span>
      </MetadataField>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function MetadataField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

interface CachedAssignee {
  id: string;
  username: string;
}

/**
 * Derives unique assignees from the board issues list cache.
 * Falls back to empty array if cache is not populated.
 */
function useAssigneesFromCache(
  projectKey: string,
  queryClient: ReturnType<typeof import("@tanstack/react-query").useQueryClient>,
): CachedAssignee[] {
  const issues = queryClient.getQueryData<Issue[]>(
    issueKeys.list(projectKey),
  );

  if (!issues) return [];

  const map = new Map<string, CachedAssignee>();
  for (const issue of issues) {
    if (issue.assigneeId && issue.assignee) {
      map.set(issue.assigneeId, {
        id: issue.assigneeId,
        username: issue.assignee.username,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.username.localeCompare(b.username),
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
