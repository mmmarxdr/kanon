import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import {
  ISSUE_STATES,
  type IssueState,
} from "@/stores/board-store";
import type {
  IssueDetail,
  IssueType,
  IssuePriority,
} from "@/types/issue";
import { useCyclesQuery } from "@/features/cycles/use-cycles-query";
import { useProjectMembersQuery } from "@/features/project-members/use-project-members-queries";
import type { Cycle } from "@/types/cycle";

const ISSUE_TYPES: IssueType[] = ["feature", "bug", "task", "spike"];
const ISSUE_PRIORITIES: IssuePriority[] = ["critical", "high", "medium", "low"];

interface MetadataSectionProps {
  issue: IssueDetail;
  projectKey: string;
  onFieldChange: (payload: Record<string, unknown>) => void;
  onTransition: (toState: IssueState) => void;
  /**
   * Called when the user changes the cycle assignment on this issue.
   * nextCycleId is null when the user selects "Unassigned".
   * currentCycleId is null when the issue had no cycle before.
   */
  onCycleChange: (nextCycleId: string | null, currentCycleId: string | null) => void;
}

/**
 * Grid of metadata fields for the issue detail panel.
 *
 * Each dropdown select fires a mutation on change:
 * - type, priority, assignee, labels: onFieldChange (PATCH)
 * - state: onTransition (POST /transition)
 *
 * Assignee list comes from the project's effective members.
 */
export function MetadataSection({
  issue,
  projectKey,
  onFieldChange,
  onTransition,
  onCycleChange,
}: MetadataSectionProps) {
  const { t } = useTranslation("issue");
  const { t: tCommon } = useTranslation("common");
  const { data: members } = useProjectMembersQuery(projectKey);
  const assignees = [...(members ?? [])].sort((a, b) =>
    (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email),
  );

  // Fetch all cycles for this project to populate the cycle picker
  const { data: allCycles } = useCyclesQuery(projectKey);
  const sortedCycles = sortCyclesForDropdown(allCycles ?? []);

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

  const handleCycleSelectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const nextCycleId = e.target.value || null;
      const currentCycleId = issue.cycle?.id ?? null;
      onCycleChange(nextCycleId, currentCycleId);
    },
    [issue.cycle?.id, onCycleChange],
  );

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {/* Type */}
      <MetadataField label={t("fieldType")}>
        <select
          value={issue.type}
          onChange={handleTypeChange}
          className="w-full rounded bg-secondary text-sm text-foreground border border-border px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          {ISSUE_TYPES.map((type) => (
            <option key={type} value={type}>
              {tCommon(`type.${type}`)}
            </option>
          ))}
        </select>
      </MetadataField>

      {/* Priority */}
      <MetadataField label={t("fieldPriority")}>
        <select
          value={issue.priority}
          onChange={handlePriorityChange}
          className="w-full rounded bg-secondary text-sm text-foreground border border-border px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          {ISSUE_PRIORITIES.map((prio) => (
            <option key={prio} value={prio}>
              {tCommon(`priority.${prio}`)}
            </option>
          ))}
        </select>
      </MetadataField>

      {/* State (uses transition endpoint) */}
      <MetadataField label={t("fieldState")}>
        <select
          value={issue.state}
          onChange={handleStateChange}
          className="w-full rounded bg-secondary text-sm text-foreground border border-border px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          {ISSUE_STATES.map((s) => (
            <option key={s} value={s}>
              {tCommon(`state.${s}`)}
            </option>
          ))}
        </select>
      </MetadataField>

      {/* Cycle (attach/detach via cycle-scoped endpoints — NOT via PATCH issue) */}
      <MetadataField label={t("fieldCycle")}>
        <select
          value={issue.cycle?.id ?? ""}
          onChange={handleCycleSelectChange}
          data-testid="metadata-cycle-select"
          className="w-full rounded bg-secondary text-sm text-foreground border border-border px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          <option value="">{tCommon("actions.unassigned")}</option>
          {sortedCycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </MetadataField>

      {/* Assignee */}
      <MetadataField label={t("fieldAssignee")}>
        <select
          data-testid="metadata-assignee-select"
          value={issue.assigneeId ?? ""}
          onChange={handleAssigneeChange}
          className="w-full rounded bg-secondary text-sm text-foreground border border-border px-2 py-1 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          <option value="">{tCommon("actions.unassigned")}</option>
          {assignees.map((a) => (
            <option key={a.memberId} value={a.memberId}>
              {a.displayName ?? a.email}
            </option>
          ))}
        </select>
      </MetadataField>

      {/* Labels (read-only text for v1) */}
      <MetadataField label={t("fieldLabels")}>
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
            <span className="text-xs text-muted-foreground">{t("labelsNone")}</span>
          )}
        </div>
      </MetadataField>

      {/* Timestamps (read-only) */}
      <MetadataField label={t("fieldCreated")}>
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

/**
 * Sort cycles for the dropdown per design D3:
 * 1. active first
 * 2. upcoming — ascending by startDate
 * 3. done — descending by startDate
 */
function sortCyclesForDropdown(cycles: Cycle[]): Cycle[] {
  const active = cycles.filter((c) => c.state === "active");
  const upcoming = cycles
    .filter((c) => c.state === "upcoming")
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
  const done = cycles
    .filter((c) => c.state === "done")
    .sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
  return [...active, ...upcoming, ...done];
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
