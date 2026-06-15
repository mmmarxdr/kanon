/**
 * PaletteFilterBar — compact chip row for the command palette.
 *
 * Sits between the search input and the results list.
 * Each chip reads from and writes through the raw input string so that
 * chips and typed tokens share ONE source of truth (ADR-4).
 *
 * Uses FilterChipSelect from primitives — same component as the board
 * filter bar — so the visual language is consistent.
 */
import { useMemo } from "react";
import { FilterChipSelect } from "@/components/ui/primitives";
import {
  parseSearchTokens,
  setFilterToken,
} from "@/features/board/parse-search-tokens";

const STATE_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "analysis", label: "Analysis" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

const TYPE_OPTIONS = [
  { value: "feature", label: "Feature" },
  { value: "bug", label: "Bug" },
  { value: "task", label: "Task" },
  { value: "spike", label: "Spike" },
];

const PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

interface PaletteFilterBarProps {
  /** The raw palette input string (single source of truth). */
  raw: string;
  /** Called with the new raw string when a chip changes. */
  onRawChange: (raw: string) => void;
}

export function PaletteFilterBar({ raw, onRawChange }: PaletteFilterBarProps) {
  const { filters } = useMemo(() => parseSearchTokens(raw), [raw]);

  function handleChip(
    prefix: "state" | "type" | "priority",
    value: string,
  ): void {
    onRawChange(setFilterToken(raw, prefix, value || undefined));
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        borderBottom: "1px solid var(--line)",
        flexWrap: "wrap",
      }}
    >
      <FilterChipSelect
        label="State"
        value={filters.state ?? ""}
        options={STATE_OPTIONS}
        onChange={(v) => handleChip("state", v)}
        allLabel="any"
      />
      <FilterChipSelect
        label="Type"
        value={filters.type ?? ""}
        options={TYPE_OPTIONS}
        onChange={(v) => handleChip("type", v)}
        allLabel="any"
      />
      <FilterChipSelect
        label="Priority"
        value={filters.priority ?? ""}
        options={PRIORITY_OPTIONS}
        onChange={(v) => handleChip("priority", v)}
        allLabel="any"
      />
    </div>
  );
}
