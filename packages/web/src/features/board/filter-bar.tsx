import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useBoardStore, type BoardFilters } from "@/stores/board-store";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { NewIssueModal } from "./new-issue-modal";
import {
  FilterChipSelect,
  Segmented,
} from "@/components/ui/primitives";

const ISSUE_TYPE_VALUES = ["feature", "bug", "task", "spike"] as const;
const ISSUE_PRIORITY_VALUES = ["critical", "high", "medium", "low"] as const;

interface FilterBarProps {
  assignees: { id: string; username: string }[];
  projectKey: string;
}

export function FilterBar({ assignees, projectKey }: FilterBarProps) {
  const { t } = useTranslation("board");
  const { t: tCommon } = useTranslation("common");
  const { filters, setFilter, viewMode, setViewMode } = useBoardStore();
  const [showNewIssue, setShowNewIssue] = useState(false);

  const ISSUE_TYPES = useMemo(
    () => ISSUE_TYPE_VALUES.map((value) => ({ value, label: tCommon(`type.${value}`) })),
    [tCommon],
  );
  const ISSUE_PRIORITIES = useMemo(
    () => ISSUE_PRIORITY_VALUES.map((value) => ({ value, label: tCommon(`priority.${value}`) })),
    [tCommon],
  );
  const GROUP_OPTIONS = useMemo(
    () => [
      { value: "grouped", label: t("groupByGroup") },
      { value: "flat", label: t("groupByNone") },
    ],
    [t],
  );

  const createIssueRequested = useCommandPaletteStore(
    (s) => s.createIssueRequested,
  );
  const clearCreateIssueRequest = useCommandPaletteStore(
    (s) => s.clearCreateIssueRequest,
  );

  const closeNewIssue = useCallback(() => setShowNewIssue(false), []);

  useEffect(() => {
    if (createIssueRequested) {
      setShowNewIssue(true);
      clearCreateIssueRequest();
    }
  }, [createIssueRequested, clearCreateIssueRequest]);

  // 'c' shortcut to open New Issue
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

  function handleSelect(key: keyof BoardFilters, value: string) {
    setFilter(key, value || undefined);
  }

  const assigneeOptions = assignees.map((a) => ({
    value: a.id,
    label: a.username,
  }));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <Segmented
        value="board"
        options={[{ id: "board", label: "Board" }]}
      />

      <FilterChipSelect
        label={t("groupBy")}
        value={viewMode === "grouped" ? "grouped" : "flat"}
        options={GROUP_OPTIONS}
        onChange={(v) =>
          setViewMode(v === "grouped" ? "grouped" : "flat")
        }
      />

      <FilterChipSelect
        label={t("filterType")}
        value={filters.type ?? ""}
        options={ISSUE_TYPES}
        onChange={(v) => handleSelect("type", v)}
      />

      <FilterChipSelect
        label={t("filterPriority")}
        value={filters.priority ?? ""}
        options={ISSUE_PRIORITIES}
        onChange={(v) => handleSelect("priority", v)}
      />

      <FilterChipSelect
        label={t("filterAssignee")}
        value={filters.assigneeId ?? ""}
        options={assigneeOptions}
        onChange={(v) => handleSelect("assigneeId", v)}
      />

      {showNewIssue && (
        <NewIssueModal projectKey={projectKey} onClose={closeNewIssue} />
      )}
    </div>
  );
}
