/**
 * PaletteFilterBar — compact chip row for the command palette.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FilterChipSelect } from "@/components/ui/primitives";
import {
  parseSearchTokens,
  setFilterToken,
} from "@/features/board/parse-search-tokens";

interface PaletteFilterBarProps {
  raw: string;
  onRawChange: (raw: string) => void;
}

export function PaletteFilterBar({ raw, onRawChange }: PaletteFilterBarProps) {
  const { t } = useTranslation("palette");
  const { t: tCommon } = useTranslation("common");
  const { filters } = useMemo(() => parseSearchTokens(raw), [raw]);

  const STATE_OPTIONS = useMemo(
    () =>
      (["backlog", "analysis", "todo", "in_progress", "review", "done"] as const).map(
        (value) => ({ value, label: tCommon(`state.${value}`) }),
      ),
    [tCommon],
  );
  const TYPE_OPTIONS = useMemo(
    () =>
      (["feature", "bug", "task", "spike"] as const).map((value) => ({
        value,
        label: tCommon(`type.${value}`),
      })),
    [tCommon],
  );
  const PRIORITY_OPTIONS = useMemo(
    () =>
      (["critical", "high", "medium", "low"] as const).map((value) => ({
        value,
        label: tCommon(`priority.${value}`),
      })),
    [tCommon],
  );

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
        label={t("filterState")}
        value={filters.state ?? ""}
        options={STATE_OPTIONS}
        onChange={(v) => handleChip("state", v)}
        allLabel={tCommon("actions.any")}
      />
      <FilterChipSelect
        label={t("filterType")}
        value={filters.type ?? ""}
        options={TYPE_OPTIONS}
        onChange={(v) => handleChip("type", v)}
        allLabel={tCommon("actions.any")}
      />
      <FilterChipSelect
        label={t("filterPriority")}
        value={filters.priority ?? ""}
        options={PRIORITY_OPTIONS}
        onChange={(v) => handleChip("priority", v)}
        allLabel={tCommon("actions.any")}
      />
    </div>
  );
}
