import { SearchInput } from "@/components/ui/search-input";
import { FilterChipGroup } from "@/components/ui/filter-chip-group";
import { FilterSelect } from "@/components/ui/filter-select";
import { FilterBar } from "@/components/ui/filter-bar";
import { ClearFiltersButton } from "@/components/ui/clear-filters-button";
import {
  useRoadmapStore,
  ROADMAP_STATUSES,
  type SortPreference,
} from "@/stores/roadmap-store";
import type { Horizon, RoadmapStatus } from "@/types/roadmap";
import { useI18n } from "@/hooks/use-i18n";

interface RoadmapFilterBarProps {
  filteredCount: number;
  totalCount: number;
}

export function RoadmapFilterBar({ filteredCount, totalCount }: RoadmapFilterBarProps) {
  const { t } = useI18n();
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

  const STATUS_OPTIONS = ROADMAP_STATUSES.map((s) => ({
    label:
      s === "idea"
        ? t("roadmap.status.idea")
        : s === "planned"
          ? t("roadmap.status.planned")
          : s === "in_progress"
            ? t("roadmap.status.inProgress")
            : t("roadmap.status.done"),
    value: s as string,
  }));

  const HORIZON_OPTIONS: { label: string; value: string }[] = [
    { label: t("roadmap.horizon.now"), value: "now" },
    { label: t("roadmap.horizon.next"), value: "next" },
    { label: t("roadmap.horizon.later"), value: "later" },
    { label: t("roadmap.horizon.someday"), value: "someday" },
  ];

  const SORT_OPTIONS: { label: string; value: string }[] = [
    { label: t("roadmap.filter.sortOrder"), value: "sortOrder" },
    { label: t("roadmap.filter.sortImpactDesc"), value: "impact" },
    { label: t("roadmap.filter.sortEffortAsc"), value: "effort" },
    { label: t("roadmap.filter.sortNewest"), value: "createdAt" },
  ];

  return (
    <FilterBar>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t("roadmap.filter.searchPlaceholder")}
      />

      <FilterChipGroup
        value={activeStatusFilter as string | undefined}
        onChange={(v) => setStatusFilter(v as RoadmapStatus | undefined)}
        options={STATUS_OPTIONS}
        allLabel={t("roadmap.filter.statusAll")}
      />

      <FilterSelect
        value={activeHorizonFilter ?? ""}
        onChange={(v) => setHorizonFilter((v || undefined) as Horizon | undefined)}
        options={HORIZON_OPTIONS}
        allLabel={t("roadmap.filter.horizonAll")}
      />

      <FilterSelect
        value={sortPreference}
        onChange={(v) => setSortPreference((v || "sortOrder") as SortPreference)}
        options={SORT_OPTIONS}
        allLabel={t("roadmap.filter.sortOrder")}
      />

      <ClearFiltersButton visible={hasActiveFilters} onClick={handleClear} />

      <span className="text-[0.6875rem] text-on-surface/50 tracking-wide">
        {filteredCount}{" "}
        {filteredCount === 1
          ? t("roadmap.filter.countItemOne")
          : t("roadmap.filter.countItemOther")}
        {filteredCount !== totalCount
          ? ` ${t("roadmap.filter.countOf")} ${totalCount}`
          : ""}
      </span>
    </FilterBar>
  );
}
