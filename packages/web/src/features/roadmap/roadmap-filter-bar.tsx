import { FilterChipSelect } from "@/components/ui/primitives";
import {
  useRoadmapStore,
  ROADMAP_STATUSES,
  STATUS_LABELS,
  type SortPreference,
} from "@/stores/roadmap-store";
import type { Horizon, RoadmapStatus } from "@/types/roadmap";

const STATUS_OPTIONS = ROADMAP_STATUSES.map((s) => ({
  label: STATUS_LABELS[s],
  value: s as string,
}));

const HORIZON_OPTIONS: { label: string; value: string }[] = [
  { label: "Now", value: "now" },
  { label: "Next", value: "next" },
  { label: "Later", value: "later" },
  { label: "Someday", value: "someday" },
];

const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: "Manual", value: "sortOrder" },
  { label: "Impact ↓", value: "impact" },
  { label: "Effort ↑", value: "effort" },
  { label: "Newest", value: "createdAt" },
];

interface RoadmapFilterBarProps {
  filteredCount: number;
  totalCount: number;
}

export function RoadmapFilterBar({ filteredCount, totalCount }: RoadmapFilterBarProps) {
  const activeStatusFilter = useRoadmapStore((s) => s.activeStatusFilter);
  const setStatusFilter = useRoadmapStore((s) => s.setStatusFilter);
  const activeHorizonFilter = useRoadmapStore((s) => s.activeHorizonFilter);
  const setHorizonFilter = useRoadmapStore((s) => s.setHorizonFilter);
  const sortPreference = useRoadmapStore((s) => s.sortPreference);
  const setSortPreference = useRoadmapStore((s) => s.setSortPreference);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <FilterChipSelect
        label="Horizon"
        value={activeHorizonFilter ?? ""}
        options={HORIZON_OPTIONS}
        onChange={(v) => setHorizonFilter((v || undefined) as Horizon | undefined)}
        allLabel="all"
      />

      <FilterChipSelect
        label="Status"
        value={(activeStatusFilter as string | undefined) ?? ""}
        options={STATUS_OPTIONS}
        onChange={(v) => setStatusFilter((v || undefined) as RoadmapStatus | undefined)}
        allLabel="any"
      />

      <FilterChipSelect
        label="Sort"
        value={sortPreference}
        options={SORT_OPTIONS}
        onChange={(v) => setSortPreference((v || "sortOrder") as SortPreference)}
        allLabel="manual"
      />

      <span
        style={{
          height: 16,
          width: 1,
          background: "var(--line)",
          marginLeft: 4,
        }}
      />
      <span
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-3)" }}
      >
        {filteredCount} item{filteredCount !== 1 ? "s" : ""}
        {filteredCount !== totalCount ? ` of ${totalCount}` : ""}
      </span>
    </div>
  );
}
