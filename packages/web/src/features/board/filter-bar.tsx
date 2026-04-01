import { useState, useEffect, useCallback } from "react";
import { useBoardStore, type BoardFilters } from "@/stores/board-store";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import type { IssueType, IssuePriority } from "@/types/issue";
import { SearchInput } from "@/components/ui/search-input";
import { FilterSelect } from "@/components/ui/filter-select";
import { FilterBar as FilterBarLayout } from "@/components/ui/filter-bar";
import { ClearFiltersButton } from "@/components/ui/clear-filters-button";
import { useI18n } from "@/hooks/use-i18n";
import { ColumnToggle } from "./column-toggle";
import { NewIssueModal } from "./new-issue-modal";

const ISSUE_TYPES: { value: string; label: string }[] = [
  { value: "feature", label: "Feature" },
  { value: "bug", label: "Bug" },
  { value: "task", label: "Task" },
  { value: "spike", label: "Spike" },
];

const ISSUE_PRIORITIES: { value: string; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

interface FilterBarProps {
  /** Unique assignees extracted from the current issue set. */
  assignees: { id: string; username: string }[];
  /** Project key needed for creating issues. */
  projectKey: string;
}

export function FilterBar({ assignees, projectKey }: FilterBarProps) {
  const { t } = useI18n();
  const { filters, setFilter, clearFilters, viewMode, setViewMode, showUngrouped, setShowUngrouped } = useBoardStore();
  const [showNewIssue, setShowNewIssue] = useState(false);

  const createIssueRequested = useCommandPaletteStore(
    (s) => s.createIssueRequested,
  );
  const clearCreateIssueRequest = useCommandPaletteStore(
    (s) => s.clearCreateIssueRequest,
  );

  const openNewIssue = useCallback(() => setShowNewIssue(true), []);
  const closeNewIssue = useCallback(() => setShowNewIssue(false), []);

  // Open New Issue modal when requested from the command palette
  useEffect(() => {
    if (createIssueRequested) {
      setShowNewIssue(true);
      clearCreateIssueRequest();
    }
  }, [createIssueRequested, clearCreateIssueRequest]);

  // 'c' keyboard shortcut to open New Issue modal (only when no input focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if ((e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        setShowNewIssue(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const hasActiveFilters =
    filters.type || filters.priority || filters.assigneeId || filters.search;

  function handleSelect(key: keyof BoardFilters, value: string) {
    setFilter(key, value || undefined);
  }

  const assigneeOptions = assignees.map((a) => ({
    value: a.id,
    label: a.username,
  }));
  const issueTypes = ISSUE_TYPES.map((item) => ({
    ...item,
    label:
      item.value === "feature"
        ? t("backlog.type.feature")
        : item.value === "bug"
          ? t("backlog.type.bug")
          : item.value === "task"
            ? t("backlog.type.task")
            : t("backlog.type.spike"),
  }));
  const issuePriorities = ISSUE_PRIORITIES.map((item) => ({
    ...item,
    label:
      item.value === "critical"
        ? t("backlog.priority.critical")
        : item.value === "high"
          ? t("backlog.priority.high")
          : item.value === "medium"
            ? t("backlog.priority.medium")
            : t("backlog.priority.low"),
  }));

  return (
    <FilterBarLayout>
      {/* Text search with icon */}
      <SearchInput
        value={filters.search ?? ""}
        onChange={(v) => handleSelect("search", v)}
        placeholder={t("backlog.searchPlaceholder")}
        data-testid="filter-search"
      />

      {/* Type filter */}
      <FilterSelect
        value={filters.type ?? ""}
        onChange={(v) => handleSelect("type", v)}
        options={issueTypes}
        allLabel={t("board.filter.allTypes")}
        data-testid="filter-type"
      />

      {/* Priority filter */}
      <FilterSelect
        value={filters.priority ?? ""}
        onChange={(v) => handleSelect("priority", v)}
        options={issuePriorities}
        allLabel={t("board.filter.allPriorities")}
        data-testid="filter-priority"
      />

      {/* Assignee filter */}
      <FilterSelect
        value={filters.assigneeId ?? ""}
        onChange={(v) => handleSelect("assigneeId", v)}
        options={assigneeOptions}
        allLabel={t("board.filter.allAssignees")}
      />

      {/* Clear all button */}
      <ClearFiltersButton
        visible={!!hasActiveFilters}
        onClick={clearFilters}
        data-testid="filter-clear"
      />

      {/* Spacer to push right-side controls */}
      <div className="flex-1" />

      {/* Show ungrouped toggle (only visible in grouped mode) */}
      {viewMode === "grouped" && (
        <label
          className="inline-flex items-center gap-1.5 text-[0.6875rem] text-on-surface/50 uppercase tracking-wider cursor-pointer select-none"
          data-testid="toggle-show-ungrouped"
        >
          <input
            type="checkbox"
            checked={showUngrouped}
            onChange={(e) => setShowUngrouped(e.target.checked)}
            className="rounded border-outline-variant/30 text-primary focus:ring-primary/30 h-3.5 w-3.5"
          />
          {t("backlog.ungrouped")}
        </label>
      )}

      {/* View mode toggle (grouped/flat) */}
      <div className="inline-flex items-center gap-0 rounded-md bg-surface-container-high overflow-hidden">
        <button
          type="button"
          data-testid="view-mode-grouped"
          onClick={() => setViewMode("grouped")}
          className={`h-7 px-2.5 text-xs font-medium transition-all duration-200
            ${viewMode === "grouped"
              ? "bg-primary text-[var(--color-filter-active-foreground)]"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            }`}
          title={t("board.view.groupedTitle")}
        >
          {t("backlog.viewGrouped")}
        </button>
        <button
          type="button"
          data-testid="view-mode-flat"
          onClick={() => setViewMode("flat")}
          className={`h-7 px-2.5 text-xs font-medium transition-all duration-200
            ${viewMode === "flat"
              ? "bg-primary text-[var(--color-filter-active-foreground)]"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            }`}
          title={t("board.view.flatTitle")}
        >
          {t("backlog.viewFlat")}
        </button>
      </div>

      {/* Column toggle */}
      <ColumnToggle />

      {/* New Issue button */}
      <button
        type="button"
        onClick={openNewIssue}
        className="bg-gradient-to-b from-primary to-primary-hover text-primary-foreground hover:from-primary-hover hover:to-primary-hover rounded px-3 py-1.5 text-sm font-medium transition-all duration-200"
        data-testid="new-issue-button"
      >
        {t("backlog.newIssue")}
      </button>

      {/* New Issue modal */}
      {showNewIssue && (
        <NewIssueModal projectKey={projectKey} onClose={closeNewIssue} />
      )}
    </FilterBarLayout>
  );
}
