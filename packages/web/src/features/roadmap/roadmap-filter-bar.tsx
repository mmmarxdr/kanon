import { SearchInput } from "@/components/ui/search-input";
import { FilterChipGroup } from "@/components/ui/filter-chip-group";
import { FilterSelect } from "@/components/ui/filter-select";
import { FilterBar } from "@/components/ui/filter-bar";
import { ClearFiltersButton } from "@/components/ui/clear-filters-button";
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
  { label: "Sort order", value: "sortOrder" },
  { label: "Impact \u2193", value: "impact" },
  { label: "Effort \u2191", value: "effort" },
  { label: "Newest", value: "createdAt" },
];

interface RoadmapFilterBarProps {
  filteredCount: number;
  totalCount: number;
}

export function RoadmapFilterBar({ filteredCount, totalCount }: RoadmapFilterBarProps) {
  const search = useRoadmapStore((s) => s.search);
  const setSearch = useRoadmapStore((s) => s.setSearch);
  const activeStatusFilter = useRoadmapStore((s) => s.activeStatusFilter);
  const setStatusFilter = useRoadmapStore((s) => s.setStatusFilter);
  const activeHorizonFilter = useRoadmapStore((s) => s.activeHorizonFilter);
  const setHorizonFilter = useRoadmapStore((s) => s.setHorizonFilter);
  const sortPreference = useRoadmapStore((s) => s.sortPreference);
  const setSortPreference = useRoadmapStore((s) => s.setSortPreference);

  const hasActiveFilters =
    search !== "" ||
    activeStatusFilter !== undefined ||
    activeHorizonFilter !== undefined ||
    sortPreference !== "sortOrder";

  function handleClear() {
    setSearch("");
    setStatusFilter(undefined);
    setHorizonFilter(undefined);
    setSortPreference("sortOrder");
  }

  return (
    <FilterBar>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search items..."
      />

      <FilterChipGroup
        value={activeStatusFilter as string | undefined}
        onChange={(v) => setStatusFilter(v as RoadmapStatus | undefined)}
        options={STATUS_OPTIONS}
        allLabel="All"
      />

      <FilterSelect
        value={activeHorizonFilter ?? ""}
        onChange={(v) => setHorizonFilter((v || undefined) as Horizon | undefined)}
        options={HORIZON_OPTIONS}
        allLabel="All horizons"
      />

      <FilterSelect
        value={sortPreference}
        onChange={(v) => setSortPreference((v || "sortOrder") as SortPreference)}
        options={SORT_OPTIONS}
        allLabel="Sort order"
      />

      <ClearFiltersButton visible={hasActiveFilters} onClick={handleClear} />

      <span className="text-[0.6875rem] text-on-surface/50 tracking-wide">
        {filteredCount} item{filteredCount !== 1 ? "s" : ""}
        {filteredCount !== totalCount ? ` of ${totalCount}` : ""}
      </span>
    </FilterBar>
  );
}
