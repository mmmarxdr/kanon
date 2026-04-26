import { useState, useEffect, useCallback } from "react";
import { useBoardStore, type BoardFilters } from "@/stores/board-store";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { NewIssueModal } from "./new-issue-modal";
import {
  FilterChipSelect,
  Segmented,
} from "@/components/ui/primitives";

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

const GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: "grouped", label: "Group" },
  { value: "flat", label: "None" },
];

interface FilterBarProps {
  assignees: { id: string; username: string }[];
  projectKey: string;
}

export function FilterBar({ assignees, projectKey }: FilterBarProps) {
  const { filters, setFilter, viewMode, setViewMode } = useBoardStore();
  const [showNewIssue, setShowNewIssue] = useState(false);

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
        label="Group by"
        value={viewMode === "grouped" ? "grouped" : "flat"}
        options={GROUP_OPTIONS}
        onChange={(v) =>
          setViewMode(v === "grouped" ? "grouped" : "flat")
        }
        allLabel="state"
      />

      <FilterChipSelect
        label="Type"
        value={filters.type ?? ""}
        options={ISSUE_TYPES}
        onChange={(v) => handleSelect("type", v)}
        allLabel="any"
      />

      <FilterChipSelect
        label="Priority"
        value={filters.priority ?? ""}
        options={ISSUE_PRIORITIES}
        onChange={(v) => handleSelect("priority", v)}
        allLabel="any"
      />

      <FilterChipSelect
        label="Assignee"
        value={filters.assigneeId ?? ""}
        options={assigneeOptions}
        onChange={(v) => handleSelect("assigneeId", v)}
        allLabel="any"
      />

      {showNewIssue && (
        <NewIssueModal projectKey={projectKey} onClose={closeNewIssue} />
      )}
    </div>
  );
}
